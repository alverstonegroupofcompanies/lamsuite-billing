<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\CounterSequence;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RemoteCounterSyncTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'LamStone Main Pharmacy',
            'code' => 'STORE-01',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'store_id' => $this->store->id,
            'name' => 'Store Owner',
            'email' => 'owner@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'store_owner',
            'is_active' => true,
        ]);
    }

    /**
     * CNT-002 / CNT-003 / CNT-014: the owner pre-creates a home counter, issues it
     * a code, and the number series exists once that code has been claimed.
     */
    public function test_a_remote_counter_is_created_by_the_owner_and_claimed_by_the_till(): void
    {
        $create = $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/admin/counters', [
                'counter_name' => "Owner's Home Station",
                'counter_code' => 'c03',
                'location_name' => 'Owner Residence',
                'is_remote' => true,
                'is_digital_only' => true,
            ])
            ->assertCreated();

        $counterId = $create->json('counter.id');
        $counter = Counter::find($counterId);
        $this->assertSame(Counter::STATUS_UNCLAIMED, $counter->status);
        $this->assertTrue($counter->is_remote);
        $this->assertTrue($counter->is_digital_only);

        $code = $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson("/api/admin/counters/{$counterId}/activation-code")
            ->assertStatus(200)
            ->json('code');

        $this->postJson('/api/counters/claim', [
            'code' => $code,
            'device_uuid' => 'dev_remote_home_9988',
            'device_name' => "Owner's Home Station",
        ])->assertStatus(200);

        $counter->refresh();
        $this->assertSame(Counter::STATUS_ACTIVE, $counter->status);
        $this->assertSame('dev_remote_home_9988', $counter->device_uuid);
        $this->assertCount(7, $counter->sequences); // every series CNT-014 gives a counter
    }

    public function test_offline_concurrent_billing_merges_stock_deltas_and_flags_negative(): void
    {
        // Setup counter and item
        $counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C02',
            'counter_name' => 'Home Counter',
            'location_name' => 'Owner Residence',
            'is_remote' => true,
            'status' => 'active',
            'device_uuid' => 'dev_uuid_c02',
        ]);

        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 650mg',
            'mrp' => 30.00,
            'selling_price' => 25.00,
            'gst_rate' => 12.00,
            'current_stock' => 5,
        ]);

        $batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $product->id,
            'batch_no' => 'PCM-BATCH-1',
            'expiry_date' => '2028-01-01',
            'stock_qty' => 5,
            'mrp' => 30.00,
            'purchase_rate' => 18.00,
        ]);

        // Counter 1 (Shop) sells 4 units
        $this->postJson('/api/sync/push/stock-events', [
            'events' => [
                [
                    'id' => 'stk_c01_001',
                    'idempotency_key' => 'stk_c01_001',
                    'product_id' => $product->id,
                    'batch_id' => $batch->id,
                    'batch_no' => $batch->batch_no,
                    'counter_id' => 1,
                    'counter_code' => 'C01',
                    'location_name' => 'Shop Floor',
                    'qty_delta' => -4,
                    'reference_type' => 'invoice',
                    'reference_id' => 'C01-INV-1001',
                ],
            ],
        ])->assertStatus(200);

        // Counter 2 (Home) sells 3 units concurrently while offline (Total 7 sold from batch of 5)
        $this->postJson('/api/sync/push/stock-events', [
            'events' => [
                [
                    'id' => 'stk_c02_001',
                    'idempotency_key' => 'stk_c02_001',
                    'product_id' => $product->id,
                    'batch_id' => $batch->id,
                    'batch_no' => $batch->batch_no,
                    'counter_id' => $counter->id,
                    'counter_code' => 'C02',
                    'location_name' => 'Owner Residence',
                    'qty_delta' => -3,
                    'reference_type' => 'invoice',
                    'reference_id' => 'C02-INV-1001',
                ],
            ],
        ])->assertStatus(200);

        // Verify batch stock went to -2 and negative flag is set
        $batch->refresh();
        $this->assertEquals(-2, (float)$batch->stock_qty);

        $negativeEntry = StockLedgerEntry::where('batch_id', $batch->id)
            ->where('is_reconciled_negative', true)
            ->first();
        $this->assertNotNull($negativeEntry);
        $this->assertEquals('C02', $negativeEntry->counter_code);

        // Check negative stock report endpoint
        // G1-SEC: the owner reads the negative-stock report (counters have no
        // permission declared for it), scoped to the owner's store.
        $reportRes = $this->actingAs($this->admin, 'sanctum')->getJson('/api/inventory/negative-stock-report');
        $reportRes->assertStatus(200);
        $reportRes->assertJsonFragment(['batch_no' => 'PCM-BATCH-1']);
        $this->assertGreaterThanOrEqual(1, $reportRes->json('negative_batches_count'));
    }

    public function test_distributed_invoice_locking_prevents_concurrent_edits(): void
    {
        $c1 = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Shop Counter 1',
            'status' => 'active',
        ]);

        $c2 = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C02',
            'counter_name' => 'Remote Home Counter',
            'status' => 'active',
        ]);

        $invoice = \App\Models\Invoice::create([
            'store_id' => $this->store->id,
            'invoice_number' => 'C01-INV-1050',
            'invoice_date' => now()->toDateString(),
            'customer_name' => 'Walk-in',
            'subtotal' => 500,
            'tax_total' => 60,
            'grand_total' => 560,
            'paid_amount' => 560,
            'status' => 'issued',
        ]);

        // Counter 1 acquires lock
        $lock1 = $this->postJson("/api/invoices/{$invoice->id}/lock", [
            'counter_id' => $c1->id,
            'counter_code' => 'C01',
        ]);
        $lock1->assertStatus(200);

        // Counter 2 attempts to lock the same invoice while locked by Counter 1
        $lock2 = $this->postJson("/api/invoices/{$invoice->id}/lock", [
            'counter_id' => $c2->id,
            'counter_code' => 'C02',
        ]);
        $lock2->assertStatus(423); // 423 Locked
        $this->assertTrue($lock2->json('locked'));

        // Counter 1 releases lock
        $this->postJson("/api/invoices/{$invoice->id}/unlock")->assertStatus(200);

        // Counter 2 can now acquire lock
        $lock3 = $this->postJson("/api/invoices/{$invoice->id}/lock", [
            'counter_id' => $c2->id,
            'counter_code' => 'C02',
        ]);
        $lock3->assertStatus(200);
    }
}

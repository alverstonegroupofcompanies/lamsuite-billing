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

    public function test_remote_counter_enrollment_and_approval_workflow(): void
    {
        // 1. Device submits enrollment request
        $enrollResponse = $this->postJson('/api/counters/enroll', [
            'store_id' => $this->store->id,
            'device_uuid' => 'dev_remote_home_9988',
            'counter_name' => "Owner's Home Station",
            'counter_code' => 'C03',
            'location_name' => 'Owner Residence',
            'is_remote' => true,
            'is_digital_only' => true,
        ]);

        $enrollResponse->assertStatus(201);
        $enrollResponse->assertJson(['status' => 'pending_approval']);
        $counterId = $enrollResponse->json('counter.id');

        $counter = Counter::find($counterId);
        $this->assertEquals('pending_approval', $counter->status);
        $this->assertTrue($counter->is_remote);
        $this->assertTrue($counter->is_digital_only);

        // 2. Owner approves device in Admin Panel
        $approveResponse = $this->actingAs($this->admin)->postJson("/api/admin/counters/{$counterId}/status", [
            'status' => 'active',
            'location_name' => 'Owner Residence, Suite 4',
        ]);

        $approveResponse->assertStatus(200);
        $approveResponse->assertJson(['success' => true]);

        $counter->refresh();
        $this->assertEquals('active', $counter->status);
        $this->assertCount(3, $counter->sequences); // Auto-initialized invoice, return, receipt sequences
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
        $reportRes = $this->getJson('/api/inventory/negative-stock-report');
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

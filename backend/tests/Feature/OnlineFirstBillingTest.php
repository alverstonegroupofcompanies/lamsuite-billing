<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\CounterSequence;
use App\Models\GstLockPeriod;
use App\Models\HeldBill;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\SyncEvent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OnlineFirstBillingTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Counter $counter;
    private Product $product;
    private ProductBatch $batch;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Online Supermarket',
            'code' => 'OSM01',
            'is_active' => true,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Billing Counter 01',
            'location_name' => 'Ground Floor',
            'status' => 'active',
            'device_uuid' => 'uuid_counter_c01',
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 500mg',
            'barcode' => '8901234567890',
            'current_stock' => 10,
            'mrp' => 20.00,
            'sel_rate' => 18.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'BCH-2026-X',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 10,
            'mrp' => 20.00,
            'selling_rate' => 18.00,
        ]);
    }

    public function test_online_authoritative_invoice_creation(): void
    {
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C01',
                'customer_name' => 'John Doe',
                'payment_mode' => 'Cash',
                'items' => [
                    [
                        'product_id' => $this->product->id,
                        'batch_id' => $this->batch->id,
                        'batch_no' => 'BCH-2026-X',
                        'qty' => 2,
                        'unit_price' => 18.00,
                        'gst_percent' => 12.00,
                    ],
                ],
            ]);

        $response->assertStatus(201)
            ->assertJson([
                'success' => true,
            ]);

        $invNumber = $response->json('invoice.invoice_number');
        $this->assertStringContainsString('C01-INV', $invNumber);

        // Verify remaining stock is 8
        $this->assertEquals(8, $this->batch->fresh()->stock_qty);
        $this->assertEquals(8, $this->product->fresh()->current_stock);

        // Verify real-time sync event was created for other counters
        $this->assertDatabaseHas('sync_events', [
            'store_id' => $this->store->id,
            'entity_type' => 'stock_event',
            'entity_id' => (string)$this->batch->id,
        ]);
    }

    public function test_idempotent_retry_prevents_duplicate_billing(): void
    {
        $idempotencyKey = 'client_unique_tx_12345';

        $payload = [
            'idempotency_key' => $idempotencyKey,
            'counter_code' => 'C01',
            'customer_name' => 'Alice',
            'payment_mode' => 'UPI',
            'items' => [
                [
                    'product_id' => $this->product->id,
                    'batch_id' => $this->batch->id,
                    'qty' => 1,
                    'unit_price' => 18.00,
                ],
            ],
        ];

        // First call: 201 Created
        $res1 = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $payload);
        $res1->assertStatus(201);
        $invId = $res1->json('invoice.id');
        $this->assertEquals(9, $this->batch->fresh()->stock_qty);

        // Second call with same idempotency key: 200 OK without double stock deduction
        $res2 = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $payload);
        $res2->assertStatus(200);
        $this->assertTrue($res2->json('is_idempotent_replay'));
        $this->assertEquals($invId, $res2->json('invoice.id'));
        $this->assertEquals(9, $this->batch->fresh()->stock_qty);
    }

    public function test_period_lock_enforcement(): void
    {
        // Lock October 2026
        GstLockPeriod::create([
            'store_id' => $this->store->id,
            'period_month' => '2026-10',
            'is_locked' => true,
        ]);

        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C01',
                'invoice_date' => '2026-10-15',
                'items' => [
                    [
                        'product_id' => $this->product->id,
                        'batch_id' => $this->batch->id,
                        'qty' => 1,
                        'unit_price' => 18.00,
                    ],
                ],
            ]);

        $response->assertStatus(422)
            ->assertJsonFragment(['success' => false]);
    }

    public function test_customer_credit_limit_enforcement(): void
    {
        $party = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Credit Customer Bob',
            'credit_limit' => 50.00,
            'current_balance' => 40.00,
        ]);

        // Attempt to bill ₹36 on credit -> balance would be ₹76 > ₹50
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C01',
                'customer_id' => $party->id,
                'payment_mode' => 'Credit',
                'items' => [
                    [
                        'product_id' => $this->product->id,
                        'batch_id' => $this->batch->id,
                        'qty' => 2,
                        'unit_price' => 18.00,
                    ],
                ],
            ]);

        $response->assertStatus(422);
        $this->assertStringContainsString('credit limit', strtolower($response->json('error')));
    }

    public function test_counter_sequence_block_leasing(): void
    {
        $response = $this->postJson("/api/counters/{$this->counter->id}/lease-sequence", [
            'doc_type' => 'invoice',
            'allocate_block' => true,
            'block_size' => 50,
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'leased_block' => [
                    'range_start' => 1001,
                    'range_end' => 1050,
                    'block_size' => 50,
                ],
            ]);

        // CounterSequence next_number should now be 1051
        $this->assertEquals(1051, $this->counter->sequences()->first()->next_number);
    }

    public function test_held_bills_lifecycle_and_cross_counter_sync(): void
    {
        // Counter 1 holds bill
        $holdRes = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/held-bills', [
                'held_by_counter_id' => 'C01',
                'held_by_counter_name' => 'Counter 1',
                'items_count' => 3,
                'grand_total' => 150.00,
                'cart_payload' => ['sample' => 'data'],
            ]);

        $holdRes->assertStatus(201);
        $holdId = $holdRes->json('held_bill.id');

        // Counter 2 lists held bills
        $listRes = $this->withHeader('X-Store-Id', $this->store->id)
            ->getJson('/api/held-bills');
        $listRes->assertStatus(200)
            ->assertJsonCount(1, 'held_bills');

        // Counter 2 claims held bill
        $claimRes = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson("/api/held-bills/{$holdId}/claim", [
                'counter_id' => 'C02',
            ]);
        $claimRes->assertStatus(200)
            ->assertJson([
                'success' => true,
                'held_bill' => [
                    'status' => 'claimed',
                    'claimed_by_counter_id' => 'C02',
                ],
            ]);

        // Second counter attempting to claim already claimed bill gets 409
        $conflictRes = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson("/api/held-bills/{$holdId}/claim", [
                'counter_id' => 'C03',
            ]);
        $conflictRes->assertStatus(409);
    }

    public function test_two_counters_selling_last_unit_concurrently(): void
    {
        // Counter 1 buys all 10 remaining units
        $res1 = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C01',
                'customer_name' => 'First Customer',
                'items' => [
                    [
                        'product_id' => $this->product->id,
                        'batch_id' => $this->batch->id,
                        'qty' => 10,
                        'unit_price' => 18.00,
                    ],
                ],
            ]);
        $res1->assertStatus(201);
        $this->assertEquals(0, $this->batch->fresh()->stock_qty);

        // Counter 2 attempts to sell 1 more unit of that batch when negative stock is disallowed
        \App\Models\CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'inventory_settings',
            'value' => ['allow_negative_stock' => false],
        ]);

        $res2 = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C02',
                'customer_name' => 'Second Customer',
                'items' => [
                    [
                        'product_id' => $this->product->id,
                        'batch_id' => $this->batch->id,
                        'qty' => 1,
                        'unit_price' => 18.00,
                    ],
                ],
            ]);

        $res2->assertStatus(422);
        $this->assertStringContainsString('insufficient stock', strtolower($res2->json('error')));

        // When negative stock is allowed (e.g. offline sale reconnecting or emergency sale)
        $setting = \App\Models\CompanySetting::where('store_id', $this->store->id)
            ->where('key', 'inventory_settings')
            ->first();
        $setting->update(['value' => ['allow_negative_stock' => true]]);

        $res3 = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C02',
                'customer_name' => 'Third Customer',
                'items' => [
                    [
                        'product_id' => $this->product->id,
                        'batch_id' => $this->batch->id,
                        'qty' => 1,
                        'unit_price' => 18.00,
                    ],
                ],
            ]);

        $res3->assertStatus(201);
        $this->assertEquals(-1, $this->batch->fresh()->stock_qty);

        // Check negative stock report
        $reportRes = $this->withHeader('X-Store-Id', $this->store->id)
            ->getJson('/api/inventory/negative-stock-report');
        $reportRes->assertStatus(200);
        $this->assertGreaterThanOrEqual(1, $reportRes->json('negative_batches_count'));
    }

    public function test_emergency_temporary_number_mapping(): void
    {
        // Counter operated offline and exhausted block, used TEMP-C01-999
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C01',
                'invoice_number' => 'TEMP-C01-999',
                'is_offline_temp' => true,
                'items' => [
                    [
                        'product_id' => $this->product->id,
                        'batch_id' => $this->batch->id,
                        'qty' => 1,
                        'unit_price' => 18.00,
                    ],
                ],
            ]);

        $response->assertStatus(201);
        $this->assertEquals('TEMP-C01-999', $response->json('temp_mapped_from'));
        $this->assertStringStartsWith('C01-INV-', $response->json('invoice.invoice_number'));
    }

    public function test_invoice_creation_auto_creates_and_links_customer_in_db(): void
    {
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C01',
                'customer_name' => 'Kavya Rajesh',
                'customer_phone' => '9847123999',
                'customer_gstin' => '32AAACB1111Q1ZZ',
                'items' => [
                    [
                        'product_id' => $this->product->id,
                        'batch_id' => $this->batch->id,
                        'qty' => 1,
                        'unit_price' => 18.00,
                    ],
                ],
            ]);

        $response->assertStatus(201);
        $invoiceCustomerId = $response->json('invoice.customer_id');
        $this->assertNotNull($invoiceCustomerId);

        $savedCustomer = Party::find($invoiceCustomerId);
        $this->assertNotNull($savedCustomer);
        $this->assertEquals('Kavya Rajesh', $savedCustomer->name);
        $this->assertEquals('9847123999', $savedCustomer->phone);
        $this->assertEquals('32AAACB1111Q1ZZ', $savedCustomer->gstin);
        $this->assertEquals('customer', $savedCustomer->type);
    }
}

<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Party;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SyncControllerIntegrityTest extends TestCase
{
    use RefreshDatabase;

    private Store $inclusiveStore;
    private Store $exclusiveStore;
    private Store $compositionStore;
    private Party $registeredCustomer;
    private Party $walkInCustomer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateDevice::class);

        $this->inclusiveStore = Store::create([
            'name' => 'Metro Retail Palakkad',
            'code' => 'ST-INC-01',
            'tax_mode' => 'inclusive',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->exclusiveStore = Store::create([
            'name' => 'Metro Wholesale Hub',
            'code' => 'ST-EXC-01',
            'tax_mode' => 'exclusive',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->compositionStore = Store::create([
            'name' => 'Local Small Mart',
            'code' => 'ST-COMP-01',
            'tax_mode' => 'inclusive',
            'gst_type' => 'composition',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->registeredCustomer = Party::create([
            'store_id' => $this->inclusiveStore->id,
            'type' => 'customer',
            'name' => 'K. Ramanathan (Monthly Account)',
            'phone' => '9847012345',
            'credit_limit' => 10000,
            'is_active' => true,
        ]);

        $this->walkInCustomer = Party::create([
            'store_id' => $this->inclusiveStore->id,
            'type' => 'customer',
            'name' => 'Walk-in Retail Customer',
            'phone' => '9999999999',
            'credit_limit' => 0,
            'is_active' => true,
        ]);
    }

    public function test_offline_invoice_sync_recalculates_missing_or_zero_taxable_subtotal(): void
    {
        $payload = [
            'invoices' => [
                [
                    'external_id' => 'inv_test_tax_recalc_01',
                    'invoice_number' => 'INV-TEST-001',
                    'store_id' => $this->inclusiveStore->id,
                    'grand_total' => 100.00,
                    'taxable_subtotal' => 0, // Missing / zero
                    'tax_total' => 0,
                    'payment_mode' => 'Cash',
                    'customer_name' => 'Walk-in Customer',
                ],
            ],
        ];

        $response = $this->postJson('/api/sync/push/invoices', $payload);
        $response->assertStatus(200);
        $response->assertJson([
            'success' => true,
            'ingested_count' => 1,
            'failed_count' => 0,
        ]);

        $invoice = Invoice::where('external_id', 'inv_test_tax_recalc_01')->first();
        $this->assertNotNull($invoice);

        // 12% GST inclusive check on 100.00:
        // taxable = round(100 / 1.12, 2) = 89.29
        // tax = round(100 - 89.29, 2) = 10.71
        // cgst = 5.36, sgst = 5.35, round_off = 0.00
        $this->assertEquals(89.29, (float)$invoice->taxable_subtotal);
        $this->assertEquals(10.71, (float)$invoice->tax_total);
        $this->assertEquals(5.36, (float)$invoice->cgst_total);
        $this->assertEquals(5.35, (float)$invoice->sgst_total);
        $this->assertEquals(0.00, (float)$invoice->round_off);

        // Check identity: grand_total == taxable_subtotal + tax_total + round_off
        $sum = (float)$invoice->taxable_subtotal + (float)$invoice->tax_total + (float)$invoice->round_off;
        $this->assertEquals((float)$invoice->grand_total, round($sum, 2));
    }

    public function test_offline_invoice_sync_with_exclusive_store_tax_mode(): void
    {
        $payload = [
            'invoices' => [
                [
                    'external_id' => 'inv_test_exc_01',
                    'invoice_number' => 'INV-TEST-002',
                    'store_id' => $this->exclusiveStore->id,
                    'subtotal' => 200.00,
                    'grand_total' => 224.00,
                    'taxable_subtotal' => null, // Omitted
                    'payment_mode' => 'Cash',
                ],
            ],
        ];

        $response = $this->postJson('/api/sync/push/invoices', $payload);
        $response->assertStatus(200);

        $invoice = Invoice::where('external_id', 'inv_test_exc_01')->first();
        $this->assertNotNull($invoice);
        $this->assertEquals(200.00, (float)$invoice->taxable_subtotal);
        $this->assertEquals(24.00, (float)$invoice->tax_total);
        $this->assertEquals(12.00, (float)$invoice->cgst_total);
        $this->assertEquals(12.00, (float)$invoice->sgst_total);
        $this->assertEquals(0.00, (float)$invoice->round_off);
        $this->assertEquals(224.00, (float)$invoice->grand_total);
    }

    public function test_offline_invoice_sync_with_composition_store_has_zero_tax(): void
    {
        $payload = [
            'invoices' => [
                [
                    'external_id' => 'inv_test_comp_01',
                    'invoice_number' => 'INV-TEST-003',
                    'store_id' => $this->compositionStore->id,
                    'grand_total' => 150.00,
                    'taxable_subtotal' => 0,
                    'payment_mode' => 'Cash',
                ],
            ],
        ];

        $response = $this->postJson('/api/sync/push/invoices', $payload);
        $response->assertStatus(200);

        $invoice = Invoice::where('external_id', 'inv_test_comp_01')->first();
        $this->assertNotNull($invoice);
        $this->assertEquals(150.00, (float)$invoice->taxable_subtotal);
        $this->assertEquals(0.00, (float)$invoice->tax_total);
        $this->assertEquals(0.00, (float)$invoice->cgst_total);
        $this->assertEquals(0.00, (float)$invoice->sgst_total);
    }

    public function test_offline_invoice_sync_rejects_credit_sale_when_customer_is_null_or_walk_in(): void
    {
        // 1. Credit sale with null customer_id
        $payload1 = [
            'invoices' => [
                [
                    'external_id' => 'inv_test_credit_anon',
                    'invoice_number' => 'INV-TEST-004',
                    'store_id' => $this->inclusiveStore->id,
                    'grand_total' => 500.00,
                    'payment_mode' => 'Credit',
                    'customer_id' => null,
                    'customer_name' => 'Walk-in Customer',
                ],
            ],
        ];

        $response1 = $this->postJson('/api/sync/push/invoices', $payload1);
        $response1->assertStatus(422);
        $response1->assertJson([
            'success' => false,
            'ingested_count' => 0,
            'failed_count' => 1,
        ]);
        $this->assertNull(Invoice::where('external_id', 'inv_test_credit_anon')->first());

        // 2. Credit sale assigned to Walk-in customer party
        $payload2 = [
            'invoices' => [
                [
                    'external_id' => 'inv_test_credit_walkin_party',
                    'invoice_number' => 'INV-TEST-005',
                    'store_id' => $this->inclusiveStore->id,
                    'grand_total' => 300.00,
                    'payment_mode' => 'Credit',
                    'customer_id' => $this->walkInCustomer->id,
                ],
            ],
        ];

        $response2 = $this->postJson('/api/sync/push/invoices', $payload2);
        $response2->assertStatus(422);
        $this->assertNull(Invoice::where('external_id', 'inv_test_credit_walkin_party')->first());
    }

    public function test_offline_invoice_sync_accepts_credit_sale_for_registered_customer(): void
    {
        $payload = [
            'invoices' => [
                [
                    'external_id' => 'inv_test_credit_valid',
                    'invoice_number' => 'INV-TEST-006',
                    'store_id' => $this->inclusiveStore->id,
                    'grand_total' => 750.00,
                    'payment_mode' => 'Credit',
                    'customer_id' => $this->registeredCustomer->id,
                    'customer_name' => $this->registeredCustomer->name,
                ],
            ],
        ];

        $response = $this->postJson('/api/sync/push/invoices', $payload);
        $response->assertStatus(200);
        $response->assertJson([
            'success' => true,
            'ingested_count' => 1,
            'failed_count' => 0,
        ]);

        $invoice = Invoice::where('external_id', 'inv_test_credit_valid')->first();
        $this->assertNotNull($invoice);
        $this->assertEquals($this->registeredCustomer->id, $invoice->customer_id);
        $this->assertEquals('Credit', $invoice->payment_mode);
        $this->assertEquals(750.00, (float)$invoice->grand_total);
    }
}

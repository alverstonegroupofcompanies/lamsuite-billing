<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\Invoice;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * G11-TAX regression cover for the defects reported against R3:
 * TAX-01 (percent + its own amount discounted twice), TAX-03 (walk-in billed
 * inter-state from a hardcoded place of supply) and TAX-02 (no MRP cap).
 */
class G11TaxDefectsTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Counter $counter;
    private Product $paracet;
    private ProductBatch $paracetBatch;
    private Product $bigBox;
    private ProductBatch $bigBoxBatch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        // Karnataka store: a walk-in sale must be CGST + SGST here, never IGST.
        $this->store = Store::create([
            'name' => 'Karnataka Pharmacy',
            'code' => 'KA-01',
            'state_code' => '29',
            'store_type' => 'pharmacy',
            'gst_type' => 'regular',
            'is_active' => true,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Billing Counter 01',
            'location_name' => 'Ground Floor',
            'status' => 'active',
            'device_uuid' => 'uuid_g11_c01',
        ]);

        // The defect reproductions need discounts and rates the default counter
        // profile would otherwise hold for approval; the gate is not what these
        // tests are about, so this counter is given room to bill.
        $this->counter->update([
            'permission_profile' => array_merge(\App\Support\Counter\CounterProfile::defaults(), [
                'discount' => ['max_pct' => 100, 'approval_pct' => null, 'max_amount' => null],
                'price_override' => ['allowed' => true, 'approval_pct' => null],
            ]),
        ]);

        $this->paracet = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 500 Strip',
            'hsn_sac_code' => '3004',
            'mrp' => 90,
            'sel_rate' => 90,
            'gst_percent' => 12,
            'units_per_pack' => 15,
            'current_stock' => 300,
            'is_active' => true,
        ]);
        $this->paracetBatch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->paracet->id,
            'batch_no' => 'PA-01',
            'expiry_date' => '2028-01-31',
            'stock_qty' => 300,
            'mrp' => 90,
            'selling_rate' => 90,
        ]);

        $this->bigBox = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Surgical Kit Box',
            'hsn_sac_code' => '3005',
            'mrp' => 600,
            'sel_rate' => 600,
            'gst_percent' => 12,
            'units_per_pack' => 15,
            'current_stock' => 100,
            'is_active' => true,
        ]);
        $this->bigBoxBatch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->bigBox->id,
            'batch_no' => 'SK-01',
            'expiry_date' => '2028-01-31',
            'stock_qty' => 100,
            'mrp' => 600,
            'selling_rate' => 600,
        ]);
    }

    private function sell(array $overrides = [])
    {
        return $this->withHeader('X-Store-Id', (string) $this->store->id)
            ->postJson('/api/invoices', array_merge([
                'counter_code' => 'C01',
                'customer_name' => 'Walk-in Customer',
                'payment_mode' => 'Cash',
                'items' => [[
                    'product_id' => $this->paracet->id,
                    'batch_id' => $this->paracetBatch->id,
                    'batch_no' => 'PA-01',
                    'qty' => 1,
                    'loose_qty' => 0,
                    'units_per_pack' => 15,
                    'unit_price' => 90,
                    'mrp' => 90,
                    'gst_percent' => 12,
                ]],
            ], $overrides));
    }

    public function test_percent_discount_with_its_derived_amount_is_applied_once(): void
    {
        $res = $this->sell([
            'paid_amount' => 36,
            'items' => [[
                'product_id' => $this->paracet->id,
                'batch_id' => $this->paracetBatch->id,
                'batch_no' => 'PA-01',
                'qty' => 1,
                'loose_qty' => 0,
                'units_per_pack' => 15,
                'unit_price' => 90,
                'mrp' => 90,
                'discount_percent' => 60,
                // The till sends the percent's own result alongside the percent.
                'discount_amount' => 54,
                'gst_percent' => 12,
            ]],
        ]);

        $res->assertStatus(201);

        $invoice = Invoice::findOrFail($res->json('invoice.id'));
        // 90 inclusive of 12% less a 54 discount = 36 payable (32.14 + 3.86).
        $this->assertSame(90.0, (float) $invoice->subtotal);
        $this->assertSame(54.0, (float) $invoice->discount_total);
        $this->assertSame(32.14, (float) $invoice->taxable_subtotal);
        $this->assertSame(3.86, (float) $invoice->tax_total);
        $this->assertSame(36.0, (float) $invoice->grand_total);

        $item = $invoice->items()->firstOrFail();
        $this->assertSame(54.0, (float) $item->discount_amount);
        $this->assertSame(32.14, (float) $item->taxable_amount);
        $this->assertSame(36.0, (float) $item->total_amount);
    }

    public function test_walk_in_sale_uses_the_store_state_not_the_client_place_of_supply(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'billing',
            'value' => ['tax_mode' => 'exclusive', 'gst_type' => 'regular'],
        ]);

        // The R3 till hardcodes "32-Kerala" for walk-ins in every store.
        $res = $this->sell([
            'place_of_supply' => '32-Kerala',
            'items' => [[
                'product_id' => $this->bigBox->id,
                'batch_id' => $this->bigBoxBatch->id,
                'batch_no' => 'SK-01',
                'qty' => 1,
                'loose_qty' => 0,
                'units_per_pack' => 15,
                'unit_price' => 600,
                'mrp' => 600,
                'gst_percent' => 12,
            ]],
        ]);

        $res->assertStatus(201);

        $invoice = Invoice::findOrFail($res->json('invoice.id'));
        $this->assertSame('29', $invoice->store_state_code);
        $this->assertSame('29', substr((string) $invoice->place_of_supply, 0, 2));
        $this->assertSame(0.0, (float) $invoice->igst_total);
        $this->assertSame(36.0, (float) $invoice->cgst_total);
        $this->assertSame(36.0, (float) $invoice->sgst_total);
    }

    public function test_named_customer_in_another_state_still_sells_inter_state(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'billing',
            'value' => ['tax_mode' => 'exclusive', 'gst_type' => 'regular'],
        ]);

        $party = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Kerala Buyer',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $res = $this->sell([
            'customer_id' => $party->id,
            'customer_name' => $party->name,
            'place_of_supply' => '32-Kerala',
            'items' => [[
                'product_id' => $this->bigBox->id,
                'batch_id' => $this->bigBoxBatch->id,
                'batch_no' => 'SK-01',
                'qty' => 1,
                'loose_qty' => 0,
                'units_per_pack' => 15,
                'unit_price' => 600,
                'mrp' => 600,
                'gst_percent' => 12,
            ]],
        ]);

        $res->assertStatus(201);

        $invoice = Invoice::findOrFail($res->json('invoice.id'));
        $this->assertSame('32', substr((string) $invoice->place_of_supply, 0, 2));
        $this->assertSame(72.0, (float) $invoice->igst_total);
        $this->assertSame(0.0, (float) $invoice->cgst_total);
    }

    public function test_pharmacy_blocks_a_rate_above_the_batch_mrp(): void
    {
        $res = $this->sell([
            'items' => [[
                'product_id' => $this->paracet->id,
                'batch_id' => $this->paracetBatch->id,
                'batch_no' => 'PA-01',
                'qty' => 1,
                'loose_qty' => 0,
                'units_per_pack' => 15,
                'unit_price' => 150,
                'mrp' => 150,
                'rate_basis' => 'sel_rate',
                'gst_percent' => 12,
            ]],
        ]);

        $res->assertStatus(422)->assertJsonPath('code', 'MRP_EXCEEDED');
        $this->assertSame(0, Invoice::count());
        $this->assertSame(300.0, (float) $this->paracetBatch->fresh()->stock_qty);
    }

    public function test_loose_rate_is_capped_per_pack_not_per_unit(): void
    {
        $ok = $this->sell([
            'items' => [[
                'product_id' => $this->paracet->id,
                'batch_id' => $this->paracetBatch->id,
                'batch_no' => 'PA-01',
                'qty' => 0,
                'loose_qty' => 5,
                'units_per_pack' => 15,
                // INR 6 a tablet: 15 of them is 90, the printed MRP.
                'unit_price' => 6,
                'rate_basis' => 'loose_rate',
                'gst_percent' => 12,
            ]],
        ]);
        $ok->assertStatus(201);

        $tooHigh = $this->sell([
            'items' => [[
                'product_id' => $this->paracet->id,
                'batch_id' => $this->paracetBatch->id,
                'batch_no' => 'PA-01',
                'qty' => 0,
                'loose_qty' => 5,
                'units_per_pack' => 15,
                'unit_price' => 6.5,
                'rate_basis' => 'loose_rate',
                'gst_percent' => 12,
            ]],
        ]);
        $tooHigh->assertStatus(422)->assertJsonPath('code', 'MRP_EXCEEDED');
    }

    public function test_mrp_cap_can_be_switched_off_per_store(): void
    {
        $this->store->update(['feature_flags' => ['enforce_mrp_capping' => false]]);

        $res = $this->sell([
            'items' => [[
                'product_id' => $this->paracet->id,
                'batch_id' => $this->paracetBatch->id,
                'batch_no' => 'PA-01',
                'qty' => 1,
                'loose_qty' => 0,
                'units_per_pack' => 15,
                'unit_price' => 150,
                'gst_percent' => 12,
            ]],
        ]);

        $res->assertStatus(201);
        $this->assertSame(150.0, (float) Invoice::findOrFail($res->json('invoice.id'))->grand_total);
    }

    public function test_a_synced_bill_above_mrp_is_booked_and_flagged(): void
    {
        // The strip went out at Rs 150 against a printed MRP of Rs 90 while the line was
        // down. Refusing the document now would punish the store for the outage and leave
        // the money it collected off the books, so ingest books it and flags the breach.
        $this->withHeader('X-Store-Id', (string) $this->store->id)
            ->postJson('/api/sync/push/batch', [
                'items' => [[
                    'entity_type' => 'invoice',
                    'entity_id' => 'offline_mrp_bill',
                    'action' => 'create',
                    'payload' => [
                        'id' => 'offline_mrp_bill',
                        'module_key' => 'invoice',
                        'invoice_number' => 'C01-INV-MRP',
                        'invoice_date' => '2026-11-20',
                        'customer_name' => 'Walk-in Customer',
                        'payment_mode' => 'Cash',
                        'status' => 'issued',
                        'place_of_supply' => '29',
                        'taxable_subtotal' => 133.93,
                        'tax_total' => 16.07,
                        'grand_total' => 150.00,
                        'paid_amount' => 150.00,
                        'items' => [[
                            'product_id' => $this->paracet->id,
                            'product_name' => $this->paracet->name,
                            'batch_no' => 'PA-01',
                            'qty' => 1,
                            'loose_qty' => 0,
                            'units_per_pack' => 15,
                            'unit_price' => 150,
                            'rate_basis' => 'sel_rate',
                            'gst_percent' => 12,
                            'taxable_amount' => 133.93,
                            'tax_amount' => 16.07,
                            'total_amount' => 150.00,
                        ]],
                    ],
                ]],
            ])->assertStatus(200);

        $invoice = Invoice::where('store_id', $this->store->id)
            ->where('external_id', 'offline_mrp_bill')
            ->firstOrFail();
        $this->assertEqualsWithDelta(150.0, (float) $invoice->grand_total, 0.02);

        $event = \App\Models\SyncEvent::where('entity_type', 'invoice')
            ->where('entity_id', (string) $invoice->id)
            ->latest('id')
            ->firstOrFail();
        $this->assertStringContainsString(
            'MRP',
            (string) data_get($event->client_data, 'recalculation'),
            'an offline bill above MRP must reach the owner through the sync event'
        );
    }
}

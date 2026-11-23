<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The invoice API must book GST with the tax mode the store actually has
 * configured, otherwise the till charges one amount and the books record another.
 *
 * The billed line is 2 x 18.00 @ 12%. Inclusive that is 32.14 + 3.86; exclusive it
 * is 36.00 + 4.32. Payables then auto-round to the nearest rupee, which is why the
 * exclusive grand total is 40.00 with a -0.32 round_off.
 */
class StoreTaxModeTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Product $product;
    private ProductBatch $batch;

    protected function setUp(): void
    {
        parent::setUp();
        // G1-SEC: till routes need a claimed counter; this stands one in for the store each request names.
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Tax Mode Test Store',
            'code' => 'TMT01',
            'is_active' => true,
            'state_code' => '32',
        ]);

        Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Counter 01',
            'status' => 'active',
            'device_uuid' => 'uuid_tmt_c01',
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 500mg',
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
            'batch_no' => 'BCH-TMT-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 10,
            'mrp' => 20.00,
            'selling_rate' => 18.00,
        ]);
    }

    public function test_store_defaults_to_inclusive_when_nothing_is_configured(): void
    {
        $totals = $this->postInvoice();

        $this->assertEqualsWithDelta(32.14, $totals['taxable_subtotal'], 0.01);
        $this->assertEqualsWithDelta(3.86, $totals['tax_total'], 0.01);
        $this->assertEqualsWithDelta(0.00, $totals['round_off'], 0.01);
        $this->assertEqualsWithDelta(36.00, $totals['grand_total'], 0.01);
    }

    public function test_billing_setting_exclusive_is_booked_exclusive(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'billing',
            'value' => ['tax_mode' => 'exclusive', 'gst_type' => 'regular', 'allow_tax_override_per_bill' => false],
        ]);

        $totals = $this->postInvoice();

        $this->assertEqualsWithDelta(36.00, $totals['taxable_subtotal'], 0.01);
        $this->assertEqualsWithDelta(4.32, $totals['tax_total'], 0.01);
        $this->assertEqualsWithDelta(-0.32, $totals['round_off'], 0.01);
        $this->assertEqualsWithDelta(40.00, $totals['grand_total'], 0.01);
    }

    public function test_stores_tax_mode_column_is_used_when_there_is_no_billing_setting(): void
    {
        $this->store->forceFill(['tax_mode' => 'exclusive'])->save();

        $totals = $this->postInvoice();

        $this->assertEqualsWithDelta(36.00, $totals['taxable_subtotal'], 0.01);
        $this->assertEqualsWithDelta(4.32, $totals['tax_total'], 0.01);
        $this->assertEqualsWithDelta(40.00, $totals['grand_total'], 0.01);
    }

    public function test_client_tax_mode_is_only_an_override_when_the_store_allows_it(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'billing',
            'value' => ['tax_mode' => 'exclusive', 'allow_tax_override_per_bill' => true],
        ]);

        $override = $this->postInvoice(['tax_mode' => 'inclusive']);
        $this->assertEqualsWithDelta(32.14, $override['taxable_subtotal'], 0.01);
        $this->assertEqualsWithDelta(36.00, $override['grand_total'], 0.01);

        CompanySetting::where('store_id', $this->store->id)->where('key', 'billing')->first()
            ->forceFill(['value' => ['tax_mode' => 'exclusive', 'allow_tax_override_per_bill' => false]])
            ->save();

        $ignored = $this->postInvoice(['tax_mode' => 'inclusive']);
        $this->assertEqualsWithDelta(4.32, $ignored['tax_total'], 0.01);
        $this->assertEqualsWithDelta(40.00, $ignored['grand_total'], 0.01);
    }

    public function test_legacy_tax_settings_key_still_works(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'tax_settings',
            'value' => ['tax_mode' => 'exclusive'],
        ]);

        $totals = $this->postInvoice();

        $this->assertEqualsWithDelta(36.00, $totals['taxable_subtotal'], 0.01);
        $this->assertEqualsWithDelta(4.32, $totals['tax_total'], 0.01);
        $this->assertEqualsWithDelta(40.00, $totals['grand_total'], 0.01);
    }

    /**
     * @param array<string, mixed> $extra
     * @return array{taxable_subtotal: float, tax_total: float, round_off: float, grand_total: float}
     */
    private function postInvoice(array $extra = []): array
    {
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', array_merge([
                'counter_code' => 'C01',
                'customer_name' => 'Walk-in Customer',
                'payment_mode' => 'Cash',
                'items' => [
                    [
                        'product_id' => $this->product->id,
                        'batch_id' => $this->batch->id,
                        'batch_no' => 'BCH-TMT-1',
                        'qty' => 2,
                        'units_per_pack' => 1,
                        'unit_price' => 18.00,
                        'gst_percent' => 12.00,
                    ],
                ],
            ], $extra));

        $response->assertStatus(201)->assertJson(['success' => true]);

        $invoice = $response->json('invoice');

        return [
            'taxable_subtotal' => (float) $invoice['taxable_subtotal'],
            'tax_total' => (float) $invoice['tax_total'],
            'round_off' => (float) $invoice['round_off'],
            'grand_total' => (float) $invoice['grand_total'],
        ];
    }
}

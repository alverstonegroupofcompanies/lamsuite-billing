<?php

namespace Tests\Feature;

use App\Models\Store;
use App\Models\User;
use Illuminate\Support\Carbon;
use Tests\Support\BuildsG14Fixtures;
use Tests\Support\RefreshLegacySqlite;
use Tests\TestCase;

/**
 * RPT-04: money that leaves the API must already be rounded to paise. Slab
 * accumulation adds many two-decimal line amounts, and binary floats turn
 * 0.10 + 0.20 into 0.30000000000000004 in the JSON payload.
 */
class DashboardMetricsRoundingTest extends TestCase
{
    use RefreshLegacySqlite;
    use BuildsG14Fixtures;

    protected Store $store;
    protected User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = $this->g14Store(['timezone' => 'Asia/Kolkata']);
        $this->admin = $this->g14User($this->store);
        $this->actingAs($this->admin);
        Carbon::setTestNow(Carbon::parse('2026-11-15 12:00:00', 'Asia/Kolkata'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_money_values_serialize_with_two_decimals(): void
    {
        // Two bills whose 12% CGST lines land on 0.10 and 0.20.
        $this->g14Invoice($this->store, [
            'invoice_number' => 'G14-ROUND-A',
            'subtotal' => 1.87,
            'taxable_subtotal' => 1.67,
            'tax_total' => 0.20,
            'cgst_total' => 0.10,
            'sgst_total' => 0.10,
            'grand_total' => 1.87,
            'paid_amount' => 1.87,
        ], [[
            'product_name' => 'G14 Rounding A',
            'qty' => 1,
            'unit_price' => 1.87,
            'taxable_amount' => 1.67,
            'cgst_amount' => 0.10,
            'sgst_amount' => 0.10,
            'tax_amount' => 0.20,
            'total_amount' => 1.87,
        ]]);

        $this->g14Invoice($this->store, [
            'invoice_number' => 'G14-ROUND-B',
            'subtotal' => 3.74,
            'taxable_subtotal' => 3.34,
            'tax_total' => 0.40,
            'cgst_total' => 0.20,
            'sgst_total' => 0.20,
            'grand_total' => 3.74,
            'paid_amount' => 3.74,
        ], [[
            'product_name' => 'G14 Rounding B',
            'qty' => 1,
            'unit_price' => 3.74,
            'taxable_amount' => 3.34,
            'cgst_amount' => 0.20,
            'sgst_amount' => 0.20,
            'tax_amount' => 0.40,
            'total_amount' => 3.74,
        ]]);

        $res = $this->getJson(
            '/api/dashboard/metrics?store_id=' . $this->store->id
                . '&start_date=2026-11-15&end_date=2026-11-15'
        );
        $res->assertOk();

        $data = $res->json();
        $slab = collect($data['gst']['slabs'])->firstWhere('rate', 12);
        $this->assertNotNull($slab);
        $this->assertSame(0.3, $slab['cgst_amount']);
        $this->assertSame(0.3, $slab['sgst_amount']);
        $this->assertSame(0.6, $slab['total_tax']);

        $this->assertSame(0.3, $data['gst']['total_cgst']);
        $this->assertSame(0.3, $data['gst']['total_sgst']);
        $this->assertSame(0.6, $data['gst']['total_tax_accrued']);

        // No JSON number may carry more than two decimal places.
        $this->assertDoesNotMatchRegularExpression('/\d\.\d{3,}/', $res->getContent());
    }
}

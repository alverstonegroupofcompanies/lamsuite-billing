<?php

namespace Tests\Feature;

use App\Models\Store;
use App\Models\User;
use Illuminate\Support\Carbon;
use Tests\Support\BuildsG14Fixtures;
use Tests\Support\RefreshLegacySqlite;
use Tests\TestCase;

/**
 * RPT-03: Daily Collection must publish the same exclusive taxable/tax as the
 * dashboard GST view, and every cash figure must recognise only the amount
 * applied to the bill — never the change handed back from the tender.
 */
class DailyCollectionParityTest extends TestCase
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

    private function dailyCollection(): array
    {
        $res = $this->getJson(
            '/api/reports/daily-collection?store_id=' . $this->store->id
                . '&start_date=2026-11-15&end_date=2026-11-15'
        );
        $res->assertOk();

        return $res->json();
    }

    private function dashboardMetrics(): array
    {
        $res = $this->getJson(
            '/api/dashboard/metrics?store_id=' . $this->store->id
                . '&start_date=2026-11-15&end_date=2026-11-15'
        );
        $res->assertOk();

        return $res->json();
    }

    private function dailySummary(): array
    {
        $res = $this->getJson(
            '/api/reports/daily-summary?store_id=' . $this->store->id . '&date=2026-11-15'
        );
        $res->assertOk();

        return $res->json();
    }

    public function test_taxable_and_tax_match_dashboard_and_daily_summary(): void
    {
        $this->g14StandardDay($this->store);

        $collection = $this->dailyCollection();
        $this->assertEqualsWithDelta(1290.00, (float) $collection['gross_sales'], 0.001);
        $this->assertEqualsWithDelta(34.00, (float) $collection['total_returns'], 0.001);
        $this->assertEqualsWithDelta(1256.00, (float) $collection['net_sales'], 0.001);
        $this->assertSame(2, $collection['total_invoices_count']);
        $this->assertEqualsWithDelta(1121.79, (float) $collection['total_taxable'], 0.001);
        $this->assertEqualsWithDelta(134.61, (float) $collection['total_tax'], 0.001);

        $metrics = $this->dashboardMetrics();
        $this->assertEqualsWithDelta(1121.79, (float) $metrics['gst']['total_taxable'], 0.001);
        $this->assertEqualsWithDelta(134.61, (float) $metrics['gst']['total_tax_accrued'], 0.001);
        $this->assertEqualsWithDelta(67.31, (float) $metrics['gst']['total_cgst'], 0.001);
        $this->assertEqualsWithDelta(67.30, (float) $metrics['gst']['total_sgst'], 0.001);

        // The same exclusive base and tax on both read surfaces.
        $this->assertEqualsWithDelta(
            (float) $metrics['gst']['total_taxable'],
            (float) $collection['total_taxable'],
            0.001
        );
        $this->assertEqualsWithDelta(
            (float) $metrics['gst']['total_tax_accrued'],
            (float) $collection['total_tax'],
            0.001
        );

        $summary = $this->dailySummary();
        $this->assertEqualsWithDelta(1256.00, (float) $summary['total_sales'], 0.001);
        $this->assertSame(2, $summary['invoice_count']);
    }

    public function test_cash_tender_excludes_change_returned(): void
    {
        $this->g14StandardDay($this->store);

        // Applied cash: 210 on bill A (not the 500 note), 1080 on bill B, less
        // the 33.60 refunded on the credit note.
        $collection = $this->dailyCollection();
        $this->assertEqualsWithDelta(1256.40, (float) $collection['by_tender']['Cash'], 0.001);

        $summary = $this->dailySummary();
        $this->assertEqualsWithDelta(1256.40, (float) $summary['cash_collection'], 0.001);

        $metrics = $this->dashboardMetrics();
        $this->assertEqualsWithDelta(1256.40, (float) $metrics['payments']['cash'], 0.001);
        $this->assertEqualsWithDelta(1256.40, (float) $metrics['payments']['total_collected'], 0.001);
    }
}

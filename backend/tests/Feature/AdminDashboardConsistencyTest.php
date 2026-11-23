<?php

namespace Tests\Feature;

use App\Models\Purchase;
use App\Models\Store;
use App\Models\User;
use Illuminate\Support\Carbon;
use Tests\Support\BuildsG14Fixtures;
use Tests\Support\RefreshLegacySqlite;
use Tests\TestCase;

/**
 * RPT-02: the admin dashboard must report the same day as the store reports —
 * net of credit notes, receivables from open documents, and purchases counted
 * once per supplier bill with returns netted.
 */
class AdminDashboardConsistencyTest extends TestCase
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
        Carbon::setTestNow(Carbon::parse('2026-11-15 12:00:00', 'Asia/Kolkata'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function dashboard(): array
    {
        $res = $this->actingAs($this->admin)
            ->getJson('/api/admin/dashboard', ['X-Store-Id' => (string) $this->store->id]);
        $res->assertOk();

        return $res->json();
    }

    public function test_sales_today_is_net_of_credit_notes_and_matches_daily_summary(): void
    {
        $this->g14StandardDay($this->store);

        $dashboard = $this->dashboard();

        $this->assertEqualsWithDelta(1256.00, (float) $dashboard['sales']['today']['amount'], 0.001);
        $this->assertSame(2, $dashboard['sales']['today']['count']);
        $this->assertEqualsWithDelta(1256.00, (float) $dashboard['sales']['week']['amount'], 0.001);
        $this->assertEqualsWithDelta(1256.00, (float) $dashboard['sales']['month']['amount'], 0.001);

        // Top items must net the returned line too, not add it as a sale.
        $topItems = collect($dashboard['top_items']);
        $this->assertEqualsWithDelta(1256.00, (float) $topItems->sum('total_revenue'), 0.001);
        $this->assertEqualsWithDelta(1, (float) $topItems->sum('total_qty'), 0.001);

        $res = $this->getJson(
            '/api/reports/daily-summary?store_id=' . $this->store->id . '&date=2026-11-15'
        );
        $res->assertOk();
        $summary = $res->json();

        $this->assertEqualsWithDelta((float) $summary['total_sales'], (float) $dashboard['sales']['today']['amount'], 0.001);
        $this->assertSame((int) $summary['invoice_count'], (int) $dashboard['sales']['today']['count']);
    }

    public function test_receivables_tile_sums_open_document_balances(): void
    {
        // No Party rows at all: the tile must still see the 140 still owed.
        $this->g14Invoice($this->store, [
            'invoice_number' => 'G14-REC-1',
            'subtotal' => 90.00,
            'taxable_subtotal' => 90.00,
            'grand_total' => 90.00,
            'paid_amount' => 0.00,
            'payment_mode' => 'Credit',
        ]);

        $this->g14Invoice($this->store, [
            'invoice_number' => 'G14-REC-2',
            'subtotal' => 90.00,
            'taxable_subtotal' => 90.00,
            'grand_total' => 90.00,
            'paid_amount' => 40.00,
            'payment_mode' => 'Credit',
        ]);

        $dashboard = $this->dashboard();

        $this->assertEqualsWithDelta(140.00, (float) $dashboard['receivables']['total_outstanding'], 0.001);
    }

    public function test_purchases_tile_counts_each_supplier_bill_once_and_nets_returns(): void
    {
        $base = [
            'store_id' => $this->store->id,
            'supplier_name' => 'G14 Supplier',
            'invoice_date' => '2026-11-15',
            'subtotal' => 1000.00,
            'tax_total' => 0.00,
            'grand_total' => 1000.00,
            'paid_amount' => 1000.00,
            'status' => 'received',
        ];

        // The same supplier bill synced twice.
        Purchase::create(array_merge($base, [
            'module_key' => 'purchase',
            'invoice_number' => 'G14-PUR-DUP',
        ]));
        Purchase::create(array_merge($base, [
            'module_key' => 'purchase',
            'invoice_number' => 'G14-PUR-DUP',
        ]));

        // A return against that bill.
        Purchase::create([
            'store_id' => $this->store->id,
            'supplier_name' => 'G14 Supplier',
            'invoice_date' => '2026-11-15',
            'module_key' => 'purchase_return',
            'invoice_number' => 'G14-PUR-RET',
            'subtotal' => 200.00,
            'tax_total' => 0.00,
            'grand_total' => 200.00,
            'paid_amount' => 0.00,
            'status' => 'received',
        ]);

        $dashboard = $this->dashboard();

        $this->assertEqualsWithDelta(800.00, (float) $dashboard['purchases']['today'], 0.001);
        $this->assertEqualsWithDelta(800.00, (float) $dashboard['purchases']['week'], 0.001);
        $this->assertEqualsWithDelta(800.00, (float) $dashboard['purchases']['month'], 0.001);
    }
}

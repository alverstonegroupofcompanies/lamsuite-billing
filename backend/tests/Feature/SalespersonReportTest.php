<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Salesperson;
use App\Models\Store;
use App\Models\User;
use App\Services\Reports\OutwardSalesService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * GAP-01 / SPR-015 — the salesperson register.
 *
 * An owner reads a window as "who sold what": each person's own bills, returns,
 * discounts, average bill and lines. Nothing in the store is left out — a bill
 * with no person stands in its own row, so the rows always add up to what the
 * sales summary says for the same window. People are read per store and never
 * merged across one, and a person the master no longer holds is still reported
 * under the name their own bills carry.
 */
class SalespersonReportTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private User $owner;
    private Counter $counter;
    private Product $paracetamol;
    private Product $vrindaban;
    private Product $bhringraj;
    private Salesperson $rina;
    private Salesperson $abdul;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SPRA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SPRB', 'state_code' => '32', 'is_active' => true]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@sp-report.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->storeA->id,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C01',
            'counter_name' => 'Counter 01',
            'status' => Counter::STATUS_ACTIVE,
        ]);

        $this->paracetamol = $this->product($this->storeA, 'Paracetamol 500mg', 100.00);
        $this->vrindaban = $this->product($this->storeA, 'Vrindaban White Oil', 250.00);
        $this->bhringraj = $this->product($this->storeB, 'Bhringraj Oil', 100.00);

        $this->rina = Salesperson::create([
            'store_id' => $this->storeA->id,
            'name' => 'Rina Thomas',
            'code' => 'SP-01',
            'is_active' => true,
        ]);
        $this->abdul = Salesperson::create([
            'store_id' => $this->storeA->id,
            'name' => 'Abdul Samad',
            'code' => 'SP-02',
            'is_active' => true,
        ]);
    }

    private function product(Store $store, string $name, float $rate): Product
    {
        $product = Product::create([
            'store_id' => $store->id,
            'name' => $name,
            'current_stock' => 500,
            'mrp' => $rate,
            'sel_rate' => $rate,
            'gst_percent' => 0.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        ProductBatch::create([
            'store_id' => $store->id,
            'product_id' => $product->id,
            'batch_no' => 'REP-B1',
            'expiry_date' => '2028-12-31',
            'stock_qty' => 500,
            'mrp' => $rate,
            'selling_rate' => $rate,
        ]);

        return $product;
    }

    /**
     * A bill of one line. The header figures are what the store's own summary
     * reads; the line is what the "what did they sell" column reads.
     *
     * @param  array<string,mixed>  $overrides
     */
    private function bill(array $overrides = []): Invoice
    {
        $data = array_merge([
            'store_id' => $this->storeA->id,
            'counter_id' => $this->counter->id,
            'module_key' => 'invoice',
            'invoice_number' => 'REP-' . uniqid(),
            'invoice_date' => '2026-11-10',
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'tax_total' => 0.00,
            'status' => 'completed',
            'salesperson_id' => $this->rina->id,
            'product_id' => $this->paracetamol->id,
            'qty' => 1,
            'unit_price' => 100.00,
            'discount_total' => 0.00,
        ], $overrides);

        $person = $data['salesperson_id'] === null ? null : Salesperson::find($data['salesperson_id']);
        $net = round(((float) $data['qty'] * (float) $data['unit_price']) - (float) $data['discount_total'], 2);

        $invoice = Invoice::create([
            'store_id' => $data['store_id'],
            'counter_id' => $data['counter_id'],
            'module_key' => $data['module_key'],
            'invoice_number' => $data['invoice_number'],
            'invoice_date' => $data['invoice_date'],
            'customer_name' => $data['customer_name'],
            'payment_mode' => $data['payment_mode'],
            'status' => $data['status'],
            'salesperson_id' => $data['salesperson_id'],
            'salesperson_name' => $person?->name,
            'subtotal' => round((float) $data['qty'] * (float) $data['unit_price'], 2),
            'taxable_subtotal' => $net,
            'discount_total' => $data['discount_total'],
            'tax_total' => $data['tax_total'],
            'grand_total' => $net,
            'paid_amount' => $net,
        ]);

        InvoiceItem::create([
            'invoice_id' => $invoice->id,
            'product_id' => $data['product_id'],
            'product_name' => Product::find($data['product_id'])?->name ?? 'Unknown item',
            'batch_no' => 'REP-B1',
            'qty' => $data['qty'],
            'unit_price' => $data['unit_price'],
            'discount_amount' => $data['discount_total'],
            'taxable_amount' => $net,
            'gst_percent' => 0.00,
            'cgst_amount' => 0.00,
            'sgst_amount' => 0.00,
            'igst_amount' => 0.00,
            'cess_amount' => 0.00,
            'tax_amount' => 0.00,
            'total_amount' => $net,
        ]);

        return $invoice;
    }

    /** @return array<string,mixed> */
    private function report(?Store $store = null, string $scope = ''): array
    {
        $headers = $scope === 'all'
            ? ['X-Store-Scope' => 'all']
            : ['X-Store-Id' => (string) ($store ?? $this->storeA)->id];

        return (array) $this->actingAs($this->owner, 'sanctum')
            ->withHeaders($headers)
            ->getJson('/api/admin/reports/salesperson?start_date=2026-11-01&end_date=2026-11-30')
            ->assertOk()
            ->json();
    }

    /**
     * @param  array<int,array<string,mixed>>  $rows
     * @return array<string,mixed>
     */
    private function row(array $rows, string $name): array
    {
        foreach ($rows as $row) {
            if (($row['name'] ?? null) === $name) {
                return $row;
            }
        }

        $this->fail('no row for ' . $name . ' in ' . json_encode(array_column($rows, 'name')));
    }

    public function test_the_report_splits_a_stores_sales_by_salesperson(): void
    {
        // Rina: 550.00 of goods with a 50.00 discount, then a 120.00 return.
        $this->bill(['qty' => 5, 'unit_price' => 110.00, 'discount_total' => 50.00, 'invoice_number' => 'REP-R1']);
        $this->bill(['qty' => 1, 'unit_price' => 120.00, 'module_key' => 'sales_return', 'invoice_number' => 'REP-R2']);

        // Abdul: one plain bill.
        $this->bill(['unit_price' => 200.00, 'invoice_number' => 'REP-A1', 'salesperson_id' => $this->abdul->id]);

        $rows = (array) $this->report()['salespeople'];

        $rina = $this->row($rows, 'Rina Thomas');
        $this->assertSame($this->rina->id, (int) $rina['salesperson_id']);
        $this->assertSame('SP-01', $rina['code']);
        $this->assertSame($this->storeA->id, (int) $rina['store_id']);
        $this->assertFalse((bool) $rina['archived']);
        $this->assertSame(1, (int) $rina['bills']);
        $this->assertSame(1, (int) $rina['returns']);
        $this->assertSame(500.00, (float) $rina['gross_sales']);
        $this->assertSame(120.00, (float) $rina['returns_value']);
        $this->assertSame(380.00, (float) $rina['net_sales']);
        $this->assertSame(50.00, (float) $rina['discounts']);
        $this->assertSame(500.00, (float) $rina['average_bill']);
        $this->assertSame(380.00, (float) $rina['net_taxable_value']);

        $abdul = $this->row($rows, 'Abdul Samad');
        $this->assertSame(1, (int) $abdul['bills']);
        $this->assertSame(0, (int) $abdul['returns']);
        $this->assertSame(200.00, (float) $abdul['net_sales']);
        $this->assertSame(0.00, (float) $abdul['discounts']);
        $this->assertSame(200.00, (float) $abdul['average_bill']);
    }

    /** A person on the payroll with no bills in the window still reads as a row. */
    public function test_a_person_with_no_bills_in_the_window_shows_zeroes(): void
    {
        $this->bill(['invoice_number' => 'REP-ONE']);

        $abdul = $this->row((array) $this->report()['salespeople'], 'Abdul Samad');

        $this->assertSame(0, (int) $abdul['bills']);
        $this->assertSame(0.00, (float) $abdul['net_sales']);
        $this->assertSame(0.00, (float) $abdul['average_bill']);
        $this->assertSame([], $abdul['items']);
    }

    /**
     * SPR-015 QA check: the register adds up to the same window the sales
     * summary reads, so an owner is never shown a person's total that the
     * store's own turnover disagrees with.
     */
    public function test_the_report_totals_equal_the_stores_own_sales_summary(): void
    {
        $this->bill(['qty' => 3, 'unit_price' => 90.00, 'discount_total' => 20.00, 'invoice_number' => 'REP-T1']);
        $this->bill(['unit_price' => 200.00, 'invoice_number' => 'REP-T2', 'salesperson_id' => $this->abdul->id]);
        // Two bills nobody is named on — they must still reach the totals.
        $this->bill(['unit_price' => 75.00, 'invoice_number' => 'REP-T3', 'salesperson_id' => null]);
        $this->bill(['unit_price' => 100.00, 'module_key' => 'sales_return', 'invoice_number' => 'REP-T4', 'salesperson_id' => null]);

        $service = OutwardSalesService::forWindow($this->storeA->id, '2026-11-01', '2026-11-30');
        $json = $this->report();
        $totals = (array) $json['totals'];

        $this->assertSame((float) $service->grossSales(), (float) $totals['gross_sales']);
        $this->assertSame((float) $service->totalReturns(), (float) $totals['returns_value']);
        $this->assertSame((float) $service->netSales(), (float) $totals['net_sales']);
        $this->assertSame($service->billsCount(), (int) $totals['bills']);
        $this->assertSame($service->returnsCount(), (int) $totals['returns']);
        $this->assertSame(20.00, (float) $totals['discounts']);

        $unattributed = (array) $json['unattributed'];
        $this->assertSame(1, (int) $unattributed['bills']);
        $this->assertSame(1, (int) $unattributed['returns']);
        $this->assertSame(75.00, (float) $unattributed['gross_sales']);
        $this->assertSame(-25.00, (float) $unattributed['net_sales']);

        // Rows and totals are the same money seen twice, not two readings.
        $netPaise = (int) round(((float) $unattributed['net_sales']) * 100);
        foreach ((array) $json['salespeople'] as $row) {
            $netPaise += (int) round(((float) $row['net_sales']) * 100);
        }
        $this->assertSame((int) round(((float) $totals['net_sales']) * 100), $netPaise);
    }

    /** SPR-015: a person means one store. Two stores never share a row. */
    public function test_another_stores_people_do_not_join_the_window(): void
    {
        $other = Salesperson::create([
            'store_id' => $this->storeB->id,
            'name' => 'Rina Thomas',
            'code' => 'SP-01',
            'is_active' => true,
        ]);

        $this->bill(['invoice_number' => 'REP-A-ONLY', 'unit_price' => 100.00]);
        $this->bill([
            'invoice_number' => 'REP-B-ONLY',
            'store_id' => $this->storeB->id,
            'counter_id' => null,
            'unit_price' => 400.00,
            'product_id' => $this->bhringraj->id,
            'salesperson_id' => $other->id,
        ]);

        $scoped = $this->report($this->storeA);
        $rows = (array) $scoped['salespeople'];

        $this->assertSame([], array_filter(
            $rows,
            fn (array $row): bool => (int) $row['store_id'] !== $this->storeA->id
        ));
        $this->assertSame(100.00, (float) $scoped['totals']['gross_sales']);
        $this->assertSame($this->rina->id, (int) $this->row($rows, 'Rina Thomas')['salesperson_id']);

        // All-Stores scope keeps the two Rinas apart instead of merging them.
        $global = (array) $this->report(null, 'all')['salespeople'];
        $labels = array_map(
            fn (array $row): string => $row['store_name'] . '/' . $row['name'] . '/' . $row['code'],
            $global
        );
        $this->assertContains('Store A/Rina Thomas/SP-01', $labels);
        $this->assertContains('Store B/Rina Thomas/SP-01', $labels);
        $this->assertCount(2, $global);
    }

    /** The "what did they sell" column reads the lines, returns subtracted. */
    public function test_the_report_shows_what_each_person_sold(): void
    {
        $this->bill(['qty' => 2, 'unit_price' => 250.00, 'product_id' => $this->vrindaban->id, 'invoice_number' => 'REP-I1']);
        $this->bill(['qty' => 5, 'unit_price' => 20.00, 'invoice_number' => 'REP-I2']);
        $this->bill(['qty' => 1, 'unit_price' => 20.00, 'module_key' => 'sales_return', 'invoice_number' => 'REP-I3']);

        $items = (array) $this->row((array) $this->report()['salespeople'], 'Rina Thomas')['items'];

        $this->assertSame('Vrindaban White Oil', $items[0]['product_name']);
        $this->assertSame(2.0, (float) $items[0]['qty']);
        $this->assertSame(500.00, (float) $items[0]['net_value']);

        $this->assertSame('Paracetamol 500mg', $items[1]['product_name']);
        $this->assertSame(4.0, (float) $items[1]['qty']);
        $this->assertSame(80.00, (float) $items[1]['net_value']);
    }

    /** An archived person is off the till list but not out of the register. */
    public function test_an_archived_persons_window_is_still_reported(): void
    {
        $this->bill(['invoice_number' => 'REP-ARCH', 'unit_price' => 200.00, 'salesperson_id' => $this->abdul->id]);
        $this->abdul->update(['is_active' => false, 'archived_at' => now()]);

        $rows = (array) $this->report()['salespeople'];

        $abdul = $this->row($rows, 'Abdul Samad');
        $this->assertSame(200.00, (float) $abdul['net_sales']);
        $this->assertTrue((bool) $abdul['archived']);

        // Rina is still on the payroll, so she still reads as a zero row.
        $this->assertSame(0, (int) $this->row($rows, 'Rina Thomas')['bills']);
    }

    /**
     * A bill outlives the master row it was stamped from: the register reads
     * the name written on the bill rather than dropping the money.
     */
    public function test_a_removed_persons_bills_are_reported_under_the_name_on_them(): void
    {
        $ghost = Salesperson::create([
            'store_id' => $this->storeA->id,
            'name' => 'Gostha Bihari',
            'code' => 'SP-09',
            'is_active' => true,
        ]);
        $this->bill(['invoice_number' => 'REP-G1', 'salesperson_id' => $ghost->id]);
        $ghost->delete();

        $rows = (array) $this->report()['salespeople'];

        $this->assertSame(100.00, (float) $this->row($rows, 'Gostha Bihari')['net_sales']);
        $this->assertNull($this->row($rows, 'Gostha Bihari')['code']);
        $this->assertSame(100.00, (float) $this->report()['totals']['gross_sales']);
    }

    /** Cancelled bills are not sales, and a window edge is inside its own day. */
    public function test_cancelled_bills_do_not_appear_and_the_window_is_inclusive(): void
    {
        $this->bill(['invoice_number' => 'REP-C1', 'status' => 'cancelled']);
        $this->bill(['invoice_number' => 'REP-C2', 'invoice_date' => '2026-10-31', 'unit_price' => 999.00]);
        $this->bill(['invoice_number' => 'REP-C3', 'invoice_date' => '2026-11-01']);
        $this->bill(['invoice_number' => 'REP-C4', 'invoice_date' => '2026-11-30']);

        $json = $this->report();

        $this->assertSame(200.00, (float) $json['totals']['gross_sales']);
        $this->assertSame(2, (int) $json['totals']['bills']);
        $this->assertSame(2, (int) $this->row((array) $json['salespeople'], 'Rina Thomas')['bills']);
    }
}

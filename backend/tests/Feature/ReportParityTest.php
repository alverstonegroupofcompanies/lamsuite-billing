<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\InvoicePayment;
use App\Models\Party;
use App\Models\Purchase;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * G14-REPORTS: every report reads one store day the same way.
 *
 * Fixture (store-local day 2026-11-21, 12% GST, tax-inclusive prices):
 *   S1 walk-in  210.00  taxable 187.50  tax 22.50  Cash row 500 (legacy PAY-02 shape: tendered stored as amount)
 *   S2 walk-in   90.00  taxable  80.36  tax  9.64  UPI 90
 *   S3 customer  90.00  taxable  80.36  tax  9.64  on credit, nothing paid
 *   S4 walk-in   90.00  taxable  80.36  tax  9.64  Cash 40 of 90 (legacy PAY-03 shape)
 *   CN credit note 30.00 taxable 26.79 tax 3.21, refunded Cash 30
 *   cancelled bill 500, quotation 1000, purchase 1000 + 500, purchase return 200,
 *   cancelled purchase 300, purchase order 999.
 *
 * Oracle (hand-computed from the lines, in paise):
 *   gross 480.00 / 4 bills, returns 30.00, net 450.00
 *   taxable net 428.58 - 26.79 = 401.79, tax net 51.42 - 3.21 = 48.21
 *   cash 210 + 40 - 30 = 220, UPI 90, due/credit 90 + 50 = 140  (sum = net 450)
 *   receivables 90 (S3) + 50 (S4) = 140; the credit note was refunded, so it owes nothing
 *   purchases 1000 + 500 - 200 = 1300
 */
class ReportParityTest extends TestCase
{
    use RefreshDatabase;

    private const DAY = '2026-11-21';

    protected Store $store;
    protected User $admin;
    protected Party $customer;

    protected function setUp(): void
    {
        parent::setUp();

        // 12:00 IST on the fixture day.
        Carbon::setTestNow(Carbon::parse(self::DAY . ' 06:30:00', 'UTC'));

        $this->store = Store::create([
            'name' => 'Parity Pharmacy',
            'code' => 'PARITY',
            'state_code' => '32',
            'timezone' => 'Asia/Kolkata',
            'tax_mode' => 'inclusive',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'name' => 'Parity Owner',
            'email' => 'owner@parity.test',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
            'allowed_store_ids' => [$this->store->id],
            'is_active' => true,
        ]);

        $this->customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Credit Customer',
            // Stale header (PAY-01/PAY-05): reports must not read it.
            'current_balance' => 0,
            'is_active' => true,
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    // ---------------------------------------------------------------- fixture

    private function sale(string $number, array $line, array $header = [], array $payments = []): Invoice
    {
        $invoice = Invoice::create(array_merge([
            'store_id' => $this->store->id,
            'module_key' => 'invoice',
            'invoice_number' => $number,
            'invoice_date' => self::DAY,
            'customer_name' => 'Walk-in Customer',
            'place_of_supply' => '32',
            // Inclusive bills keep the gross line total in subtotal: the RPT-01 trap.
            'subtotal' => $line['total'],
            'taxable_subtotal' => $line['taxable'],
            'tax_total' => $line['cgst'] + $line['sgst'],
            'cgst_total' => $line['cgst'],
            'sgst_total' => $line['sgst'],
            'igst_total' => 0,
            'round_off' => 0,
            'grand_total' => $line['total'],
            'paid_amount' => $line['total'],
            'payment_mode' => 'Cash',
            'payment_status' => 'paid',
            'status' => 'issued',
        ], $header));

        InvoiceItem::create([
            'invoice_id' => $invoice->id,
            'product_name' => $line['name'] ?? 'Paracet 500',
            'hsn_code' => '30049099',
            'qty' => $line['qty'] ?? 1,
            'unit_price' => $line['total'],
            'taxable_amount' => $line['taxable'],
            'gst_percent' => 12,
            'cgst_amount' => $line['cgst'],
            'sgst_amount' => $line['sgst'],
            'igst_amount' => 0,
            'tax_amount' => $line['cgst'] + $line['sgst'],
            'total_amount' => $line['total'],
        ]);

        foreach ($payments as [$mode, $amount]) {
            InvoicePayment::create([
                'store_id' => $this->store->id,
                'invoice_id' => $invoice->id,
                'payment_mode' => $mode,
                'amount' => $amount,
                'status' => 'received',
            ]);
        }

        return $invoice;
    }

    private function purchase(string $number, string $module, float $total, string $status = 'received'): void
    {
        Purchase::create([
            'store_id' => $this->store->id,
            'supplier_name' => 'Parity Distributors',
            'invoice_number' => $number,
            'invoice_date' => self::DAY,
            'module_key' => $module,
            'subtotal' => $total,
            'tax_total' => 0,
            'grand_total' => $total,
            'paid_amount' => 0,
            'status' => $status,
        ]);
    }

    private function seedDay(): void
    {
        $line90 = ['taxable' => 80.36, 'cgst' => 4.82, 'sgst' => 4.82, 'total' => 90.00];

        $this->sale('PAR-S1', ['taxable' => 187.50, 'cgst' => 11.25, 'sgst' => 11.25, 'total' => 210.00, 'qty' => 35],
            ['paid_amount' => 500], [['Cash', 500]]);
        // Tills store place of supply as "32" or "32-Kerala": both are Kerala.
        $this->sale('PAR-S2', $line90, ['payment_mode' => 'UPI', 'place_of_supply' => '32-Kerala'], [['UPI', 90]]);
        $this->sale('PAR-S3', $line90, [
            'customer_id' => $this->customer->id,
            'customer_name' => $this->customer->name,
            'payment_mode' => 'Credit',
            'payment_status' => 'unpaid',
            'paid_amount' => 0,
        ]);
        $this->sale('PAR-S4', $line90, ['paid_amount' => 40, 'payment_status' => 'partially_paid'], [['Cash', 40]]);

        $this->sale('PAR-CN1', ['taxable' => 26.79, 'cgst' => 1.61, 'sgst' => 1.60, 'total' => 30.00, 'qty' => 5],
            ['module_key' => 'credit_note'], [['Cash', 30]]);

        $this->sale('PAR-X1', ['taxable' => 446.43, 'cgst' => 26.79, 'sgst' => 26.78, 'total' => 500.00],
            ['status' => 'cancelled', 'cancel_reason' => 'test'], [['Cash', 500]]);
        $this->sale('PAR-Q1', ['taxable' => 892.86, 'cgst' => 53.57, 'sgst' => 53.57, 'total' => 1000.00, 'name' => 'Quote Only Item'],
            ['module_key' => 'quotation', 'status' => 'draft', 'paid_amount' => 0]);

        $this->purchase('PB-1', 'purchase', 1000);
        $this->purchase('PB-2', 'purchase', 500);
        $this->purchase('PR-1', 'purchase_return', 200, 'returned');
        $this->purchase('PB-X', 'purchase', 300, 'cancelled');
        $this->purchase('PO-1', 'purchase_order', 999, 'ordered');
    }

    private function asOwner()
    {
        return $this->actingAs($this->admin)->withHeaders(['X-Store-Id' => (string) $this->store->id]);
    }

    private function day(): string
    {
        return 'store_id=' . $this->store->id . '&start_date=' . self::DAY . '&end_date=' . self::DAY;
    }

    // ---------------------------------------------------------------- RPT-01

    public function test_rpt01_admin_and_till_gstr1_equal_the_line_oracle_to_the_paisa(): void
    {
        $this->seedDay();

        $admin = $this->asOwner()->getJson('/api/admin/reports/gstr1?' . $this->day())->assertOk()->json();

        $this->assertSame(4, $admin['table_7_b2cs']['count'], 'credit note, cancelled bill and quotation are not B2CS sales');
        $this->assertEquals(428.58, $admin['table_7_b2cs']['taxable_value']);
        $this->assertEquals(51.42, $admin['table_7_b2cs']['tax_amount']);
        $this->assertEquals(480.00, $admin['table_7_b2cs']['invoice_value']);
        $this->assertSame(0, $admin['table_4_b2b']['count']);
        $this->assertSame(4, $admin['table_13_docs']['total_number']);

        $till = $this->asOwner()->getJson('/api/reports/gstr-1?' . $this->day())->assertOk()->json();

        $this->assertCount(1, $till['table_7_b2c_small'], 'one state, one B2CS row');
        $this->assertSame('32', $till['table_7_b2c_small'][0]['place_of_supply']);
        $this->assertEquals(428.58, $till['table_7_b2c_small'][0]['taxable_value']);
        $this->assertEquals(51.42, $till['table_7_b2c_small'][0]['tax_amount']);
        $this->assertCount(1, $till['table_9_credit_debit_notes']);
        $this->assertEquals(26.79, $till['table_9_credit_debit_notes'][0]['taxable_value']);

        // Both GSTR-1s carry the same credit-note figures.
        $adminNotes = $admin['table_9_cdn'] ?? $admin['table_9_credit_notes'] ?? null;
        $this->assertNotNull($adminNotes, 'admin GSTR-1 must report credit notes in Table 9');
        $this->assertEquals(26.79, $adminNotes['taxable_value']);
        $this->assertEquals(3.21, $adminNotes['tax_amount']);
    }

    public function test_rpt01_admin_gstr1_honours_from_and_to(): void
    {
        $this->seedDay();
        // A bill outside the window must not leak in through a month-to-date default.
        $this->sale('PAR-EARLY', ['taxable' => 80.36, 'cgst' => 4.82, 'sgst' => 4.82, 'total' => 90.00],
            ['invoice_date' => '2026-11-03']);

        $res = $this->asOwner()
            ->getJson('/api/admin/reports/gstr1?from=' . self::DAY . '&to=' . self::DAY)
            ->assertOk();

        $this->assertSame(self::DAY, $res->json('date_range.start_date'));
        $this->assertSame(4, $res->json('table_7_b2cs.count'));
    }

    // ---------------------------------------------------------------- RPT-02

    public function test_rpt02_admin_dashboard_equals_daily_summary_for_the_same_day(): void
    {
        $this->seedDay();

        $dash = $this->asOwner()->getJson('/api/admin/dashboard')->assertOk()->json();
        $summary = $this->asOwner()
            ->getJson('/api/reports/daily-summary?store_id=' . $this->store->id . '&date=' . self::DAY)
            ->assertOk()->json();

        $this->assertEquals(450.00, $summary['total_sales']);
        $this->assertSame(4, $summary['invoice_count']);
        $this->assertEquals($summary['total_sales'], $dash['sales']['today']['amount']);
        $this->assertSame($summary['invoice_count'], $dash['sales']['today']['count']);

        $comparison = collect($dash['store_comparison'])->firstWhere('store_id', $this->store->id);
        $this->assertEquals(450.00, $comparison['total_sales'], 'store comparison is month sales net of returns');
    }

    public function test_rpt02_receivables_come_from_open_document_balances(): void
    {
        $this->seedDay();

        $dash = $this->asOwner()->getJson('/api/admin/dashboard')->assertOk()->json();

        // S3 owes 90, S4 owes 50. The credit note was refunded in cash, so it
        // does not reduce what customers still owe.
        $this->assertEquals(140.00, $dash['receivables']['total_outstanding']);
    }

    public function test_rpt02_purchases_net_returns_and_skip_orders_and_cancelled(): void
    {
        $this->seedDay();

        $dash = $this->asOwner()->getJson('/api/admin/dashboard')->assertOk()->json();

        $this->assertEquals(1300.00, $dash['purchases']['today']);
    }

    public function test_rpt02_top_items_never_rank_a_quotation(): void
    {
        $this->seedDay();

        $dash = $this->asOwner()->getJson('/api/admin/dashboard')->assertOk()->json();
        $names = array_column($dash['top_items'], 'product_name');

        $this->assertNotContains('Quote Only Item', $names);
    }

    // ---------------------------------------------------------------- RPT-03

    public function test_rpt03_dashboard_daily_summary_daily_collection_and_gstr1_agree(): void
    {
        $this->seedDay();

        $collection = $this->asOwner()->getJson('/api/reports/daily-collection?' . $this->day())->assertOk()->json();
        $metrics = $this->asOwner()->getJson('/api/dashboard/metrics?' . $this->day())->assertOk()->json();
        $summary = $this->asOwner()
            ->getJson('/api/reports/daily-summary?store_id=' . $this->store->id . '&date=' . self::DAY)
            ->assertOk()->json();

        // Taxable and tax: net of the credit note, from the lines.
        $this->assertEquals(401.79, $collection['total_taxable']);
        $this->assertEquals(48.21, $collection['total_tax']);
        $this->assertEquals(401.79, $metrics['gst']['total_taxable']);
        $this->assertEquals(48.21, $metrics['gst']['total_tax_accrued']);

        // Sales: same net figure everywhere.
        foreach ([$collection['net_sales'], $metrics['net_sales'], $summary['total_sales']] as $net) {
            $this->assertEquals(450.00, $net);
        }

        // Tenders: money that stayed, change and refunds out, unpaid balance as credit.
        $this->assertEquals(220.00, $collection['by_tender']['Cash'], 'the 290 change on S1 is not takings');
        $this->assertEquals(90.00, $collection['by_tender']['UPI']);
        $this->assertEquals(140.00, $collection['by_tender']['Credit'], 'S3 on credit + S4 balance 50');
        $this->assertEquals(220.00, $summary['cash_collection']);
        $this->assertEquals(140.00, $summary['credit_collection']);
        $this->assertEquals(220.00, $metrics['payments']['cash']);
        $this->assertEquals(140.00, $metrics['payments']['credit']);
        $this->assertEquals(310.00, $metrics['payments']['total_collected'], 'collected is money received, not what is owed');

        $tenderSum = round(array_sum($collection['by_tender']), 2);
        $this->assertEquals($collection['net_sales'], $tenderSum, 'every rupee of net sales lands in exactly one tender');
    }

    public function test_rpt03_daily_reports_default_to_the_store_day_and_accept_date(): void
    {
        // 01:30 IST on the 22nd is still the 21st on a UTC server clock.
        Carbon::setTestNow(Carbon::parse('2026-11-21 20:00:00', 'UTC'));
        $this->sale('PAR-LATE', ['taxable' => 80.36, 'cgst' => 4.82, 'sgst' => 4.82, 'total' => 90.00],
            ['invoice_date' => '2026-11-22'], [['Cash', 90]]);

        $collection = $this->asOwner()->getJson('/api/reports/daily-collection?store_id=' . $this->store->id)->assertOk()->json();
        $this->assertEquals(90.00, $collection['net_sales']);

        $summary = $this->asOwner()->getJson('/api/reports/daily-summary?store_id=' . $this->store->id)->assertOk()->json();
        $this->assertEquals(90.00, $summary['total_sales']);

        // QA called daily-collection with ?date=; it must not be ignored.
        $byDate = $this->asOwner()
            ->getJson('/api/reports/daily-collection?store_id=' . $this->store->id . '&date=2026-11-21')
            ->assertOk()->json();
        $this->assertEquals(0.0, $byDate['net_sales']);
    }

    // ---------------------------------------------------------------- RPT-04

    public function test_rpt04_report_money_is_never_serialised_with_float_noise(): void
    {
        // 0.1 + 0.2 in floats is 0.30000000000000004.
        foreach (['PAR-N1' => 0.10, 'PAR-N2' => 0.20, 'PAR-N3' => 204.52] as $number => $cgst) {
            $this->sale($number, ['taxable' => 1.0 + $cgst * 20, 'cgst' => $cgst, 'sgst' => $cgst, 'total' => round(1.0 + $cgst * 22, 2)],
                [], [['Cash', round(1.0 + $cgst * 22, 2)]]);
        }

        foreach ([
            '/api/dashboard/metrics?' . $this->day(),
            '/api/reports/daily-collection?' . $this->day(),
            '/api/reports/daily-summary?store_id=' . $this->store->id . '&date=' . self::DAY,
            '/api/reports/gstr-1?' . $this->day(),
            '/api/admin/reports/gstr1?' . $this->day(),
            '/api/admin/dashboard',
        ] as $url) {
            $body = $this->asOwner()->getJson($url)->assertOk()->getContent();
            $this->assertDoesNotMatchRegularExpression('/\d\.\d{3,}/', $body, "float noise in {$url}");
        }

        $slab = collect($this->asOwner()->getJson('/api/dashboard/metrics?' . $this->day())->json('gst.slabs'))
            ->firstWhere('rate', 12);
        $this->assertEquals(204.82, $slab['cgst_amount']);
    }
}

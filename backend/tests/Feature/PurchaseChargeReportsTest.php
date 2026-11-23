<?php

namespace Tests\Feature;

use App\Models\Expense;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * CR-C Task 4.13 — the reading side of a charged supplier bill.
 *
 * A charge is only useful once it can be found again: the expense register has to show an
 * expensed charge beside a manual expense with the same tax columns (REP-008), the purchase
 * register has to split goods from charges (REP-007), the input-tax papers have to follow each
 * charge's own eligibility and flag a reverse-charge one for review, margin has to be priced on
 * landed cost, and the exports have to carry what the screens show (REP-009).
 */
class PurchaseChargeReportsTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Charge Reports Store',
            'code' => 'CRP01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Reports Owner',
            'email' => 'owner@charge-reports.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);

        Sanctum::actingAs($this->owner);
    }

    private function line(array $overrides = []): array
    {
        return array_merge([
            'product_name' => 'Amoxicillin 500mg',
            'batch_no' => 'B-1',
            'expiry_date' => '2027-12-31',
            'pack_qty' => 100,
            'loose_qty' => 0,
            'free_qty' => 0,
            'units_per_pack' => 1,
            'purchase_rate' => 100,
            'gst_percent' => 12,
            'hsn_code' => '30041090',
        ], $overrides);
    }

    private function charge(string $headCode, float $amount, array $overrides = []): array
    {
        return array_merge([
            'head_code' => $headCode,
            'amount' => $amount,
            'gst_percent' => 18,
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'itc_eligibility' => 'eligible',
        ], $overrides);
    }

    private function postBill(array $overrides = []): Purchase
    {
        $response = $this->postJson('/api/purchases', array_merge([
            'store_id' => $this->store->id,
            'supplier_name' => 'Report Distributors',
            'invoice_number' => 'CRP-' . substr(md5(uniqid('', true)), 0, 8),
            'invoice_date' => '2026-11-15',
            'lines' => [$this->line()],
            'charges' => [],
        ], $overrides));

        $response->assertCreated();

        return Purchase::with(['items', 'charges'])->findOrFail($response->json('purchase.id'));
    }

    /** @return array<string, mixed> */
    private function register(array $query = []): array
    {
        $response = $this->getJson('/api/reports/expense-register?' . http_build_query($query));
        $response->assertOk();

        return $response->json();
    }

    /**
     * @param  array<string, mixed>  $report
     * @return array<string, mixed>|null
     */
    private function rowFor(array $report, string $headCode): ?array
    {
        foreach ($report['rows'] as $row) {
            if (($row['head_code'] ?? null) === $headCode) {
                return $row;
            }
        }

        return null;
    }

    private function manualExpense(string $head, float $amount, string $date = '2026-11-10'): Expense
    {
        return Expense::create([
            'store_id' => $this->store->id,
            'expense_number' => 'EXP-' . strtoupper(substr(md5($head . $amount), 0, 8)),
            'expense_head' => $head,
            'amount' => $amount,
            'payment_mode' => 'Cash',
            'expense_date' => $date,
            'created_by' => $this->owner->id,
        ]);
    }

    // ---------------------------------------------------------------- REP-008

    public function test_register_shows_manual_expenses_and_expense_treated_charges_together(): void
    {
        $bill = $this->postBill([
            'charges' => [$this->charge('FREIGHT', 200, ['treatment' => 'expense'])],
        ]);
        $this->manualExpense('Shop Rent', 500);

        $report = $this->register(['start_date' => '2026-11-01', 'end_date' => '2026-11-30']);

        $this->assertSame(2, $report['totals']['rows']);
        $this->assertEqualsWithDelta(700.0, $report['totals']['postings'], 0.005);
        $this->assertEqualsWithDelta(200.0, $report['totals']['charge_postings'], 0.005);
        $this->assertEqualsWithDelta(500.0, $report['totals']['manual_postings'], 0.005);

        $freight = $this->rowFor($report, 'FREIGHT');
        $this->assertNotNull($freight, 'REP-008: an expense-treated charge must appear in the register');
        $this->assertSame('purchase_charge', $freight['source']);
        $this->assertSame('2026-11-15', $freight['date']);
        $this->assertSame('Freight', $freight['head']);
        $this->assertSame($bill->invoice_number, $freight['purchase_number'], 'REP-008: the row links to its bill');
        $this->assertEqualsWithDelta(200.0, $freight['taxable_amount'], 0.005);
        $this->assertEqualsWithDelta(18.0, $freight['cgst_amount'], 0.005);
        $this->assertEqualsWithDelta(18.0, $freight['sgst_amount'], 0.005);
        $this->assertEqualsWithDelta(36.0, $freight['tax_amount'], 0.005);
        // PUR-012: a creditable charge posts ex-tax, the GST rides the input-tax ledger instead.
        $this->assertEqualsWithDelta(200.0, $freight['amount'], 0.005);
        $this->assertTrue($freight['creditable']);
        $this->assertEqualsWithDelta(36.0, $freight['creditable_tax'], 0.005);
        $this->assertEqualsWithDelta(0.0, $freight['non_creditable_tax'], 0.005);
        $this->assertFalse($freight['paid_separately']);
        $this->assertTrue($freight['in_payable']);

        $rent = null;
        foreach ($report['rows'] as $row) {
            if ($row['source'] === 'manual') {
                $rent = $row;
            }
        }
        $this->assertNotNull($rent, 'REP-008: manual expenses stay in their own register');
        $this->assertSame('Shop Rent', $rent['head']);
        $this->assertEqualsWithDelta(500.0, $rent['amount'], 0.005);
        $this->assertEqualsWithDelta(0.0, $rent['tax_amount'], 0.005);
        $this->assertNull($rent['purchase_id']);
        $this->assertNotNull($rent['expense_id']);
    }

    public function test_blocked_charge_registers_the_tax_it_can_never_claim(): void
    {
        $this->postBill([
            'charges' => [$this->charge('INSURANCE', 200, [
                'treatment' => 'expense',
                'itc_eligibility' => 'blocked',
            ])],
        ]);

        $report = $this->register(['start_date' => '2026-11-01', 'end_date' => '2026-11-30']);
        $row = $this->rowFor($report, 'INSURANCE');

        $this->assertNotNull($row);
        $this->assertSame('blocked', $row['itc_eligibility']);
        $this->assertFalse($row['creditable']);
        $this->assertEqualsWithDelta(0.0, $row['creditable_tax'], 0.005);
        $this->assertEqualsWithDelta(36.0, $row['non_creditable_tax'], 0.005);
        // The 236 the store actually spent cannot be left unbooked.
        $this->assertEqualsWithDelta(236.0, $row['amount'], 0.005);
        $this->assertEqualsWithDelta(36.0, $report['totals']['non_creditable_tax'], 0.005);
        $this->assertTrue($report['reconciliation']['balanced']);
        $this->assertEqualsWithDelta(0.0, $report['reconciliation']['delta'], 0.005);
    }

    public function test_separately_paid_charge_registers_but_stays_out_of_the_payable(): void
    {
        $bill = $this->postBill([
            'charges' => [$this->charge('OTHER', 1000, [
                'treatment' => 'expense',
                'paid_separately' => true,
                'paid_to_label' => 'Transporter Co-op',
            ])],
        ]);

        // Goods 10,000 @12% = 11,200 payable; PUR-013 keeps the separately-paid 1,180 out of it.
        $this->assertEqualsWithDelta(11200.0, (float) $bill->grand_total, 0.005);

        $report = $this->register(['start_date' => '2026-11-01', 'end_date' => '2026-11-30']);
        $row = $this->rowFor($report, 'OTHER');

        $this->assertNotNull($row, 'REP-008: paying the carrier direct does not hide the cost');
        $this->assertTrue($row['paid_separately']);
        $this->assertFalse($row['in_payable']);
        $this->assertSame('Paid Separately', $row['payment_mode']);
        $this->assertSame('Transporter Co-op', $row['paid_to_label']);
        $this->assertEqualsWithDelta(1000.0, $row['amount'], 0.005);
        $this->assertEqualsWithDelta(1000.0, $report['totals']['separately_paid_postings'], 0.005);
    }

    public function test_register_filters_by_head_source_and_dates(): void
    {
        $this->postBill([
            'charges' => [
                $this->charge('FREIGHT', 200, ['treatment' => 'expense']),
                $this->charge('PACKING', 100, ['treatment' => 'add_to_cost']),
            ],
        ]);
        $this->manualExpense('Shop Rent', 500, '2026-11-10');

        $this->assertSame(1, $this->register(['head' => 'Freight'])['totals']['rows']);
        $this->assertSame(1, $this->register(['head' => 'RENT'])['totals']['rows']);
        $this->assertSame(0, $this->register(['head' => 'Packing'])['totals']['rows'],
            'an add-to-cost charge belongs to the goods, not to the expense register');
        $this->assertSame(1, $this->register(['source' => 'manual'])['totals']['rows']);
        $this->assertSame(1, $this->register(['source' => 'purchase_charge'])['totals']['rows']);
        $this->assertSame(1, $this->register(['start_date' => '2026-11-14'])['totals']['rows'],
            'the bill is on the 15th, the rent on the 10th');
        $this->assertSame(1, $this->register(['end_date' => '2026-11-12'])['totals']['rows']);
        $this->assertSame(0, $this->register(['start_date' => '2026-12-01'])['totals']['rows']);
    }

    public function test_cancelled_bill_leaves_the_register(): void
    {
        $bill = $this->postBill([
            'charges' => [$this->charge('FREIGHT', 200, ['treatment' => 'expense'])],
        ]);

        $this->assertSame(1, $this->register()['totals']['rows']);

        $bill->update(['status' => 'cancelled']);

        $report = $this->register();
        $this->assertSame(0, $report['totals']['rows']);
        $this->assertEqualsWithDelta(0.0, $report['totals']['charge_postings'], 0.005);
    }

    public function test_register_stays_inside_the_caller_store(): void
    {
        $other = Store::create([
            'name' => 'Other Reports Store',
            'code' => 'CRP02',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->manualExpense('Shop Rent', 500);
        $this->manualExpense('Other Rent', 900, '2026-11-10');
        Expense::where('expense_head', 'Other Rent')->update(['store_id' => $other->id]);

        $report = $this->register();

        $this->assertSame(1, $report['totals']['rows']);
        $this->assertEqualsWithDelta(500.0, $report['totals']['postings'], 0.005);
    }

    public function test_return_credit_shows_as_a_negative_register_row(): void
    {
        // A till files the debit note, so the reversal rows arrive through the sync aggregate
        // (SYNC-007): the note carries no charges of its own and the server derives its share.
        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Register Drug A',
            'current_stock' => 0,
            'mrp' => 200,
            'sel_rate' => 150,
            'gst_percent' => 12,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $goods = [
            'product_id' => (string) $product->id,
            'product_name' => $product->name,
            'batch_no' => 'BCH-REG-1',
            'expiry_date' => '2027-12-31',
            'pack_qty' => 100,
            'units_per_pack' => 1,
            'purchase_rate' => 100,
            'gst_percent' => 12,
            'taxable_amount' => 10000,
            'tax_amount' => 1200,
            'total_amount' => 11200,
        ];

        $this->postJson('/api/sync/push/purchases', ['purchases' => [[
            'id' => 'pur_reg_1',
            'invoice_number' => 'REG-SUP-0001',
            'purchase_number' => 'REG-PUR-0001',
            'supplier_name' => 'Report Distributors',
            'invoice_date' => '2026-11-10',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase',
            'subtotal' => 10000,
            'tax_total' => 1200,
            'cgst_total' => 600,
            'sgst_total' => 600,
            'round_off' => 0,
            'grand_total' => 11300,
            'status' => 'received',
            'items' => [$goods],
            'charges' => [[
                'external_id' => 'chg-ins-300',
                'head_code' => 'INSURANCE',
                'amount' => 300,
                'gst_percent' => 18,
                'treatment' => 'expense',
                'spread_method' => 'value',
                'itc_eligibility' => 'eligible',
            ]],
        ]]])->assertStatus(200);

        $this->assertEqualsWithDelta(300.0, $this->register()['totals']['charge_postings'], 0.005);

        $this->postJson('/api/sync/push/purchases', ['purchases' => [[
            'id' => 'pr_reg_1',
            'return_number' => 'REG-PR-0001',
            'invoice_number' => 'REG-PR-0001',
            'return_date' => '2026-11-20',
            'original_purchase_number' => 'REG-SUP-0001',
            'supplier_name' => 'Report Distributors',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase_return',
            'status' => 'completed',
            'subtotal' => 0,
            'tax_total' => 0,
            'round_off' => 0,
            'grand_total' => 0,
            'lines' => [array_merge($goods, ['pack_qty' => 50, 'return_qty' => 50, 'taxable_amount' => 5000])],
        ]]])->assertStatus(200);

        $report = $this->register();

        $this->assertSame(2, $report['totals']['rows'], 'PUR-003: the note registers its credit');
        $this->assertEqualsWithDelta(150.0, $report['totals']['charge_postings'], 0.005,
            'the returned half of an expensed charge comes back out of the register');

        $credit = null;
        foreach ($report['rows'] as $row) {
            if ($row['source'] === 'purchase_charge' && (float) $row['amount'] < 0) {
                $credit = $row;
            }
        }

        $this->assertNotNull($credit);
        $this->assertSame('return_reversal', $credit['origin']);
        $this->assertSame('REG-PR-0001', $credit['purchase_number']);
        $this->assertEqualsWithDelta(-150.0, $credit['amount'], 0.005);
        $this->assertEqualsWithDelta(-27.0, $credit['tax_amount'], 0.005);
        $this->assertTrue($report['reconciliation']['balanced']);
    }

    // ---------------------------------------------------------------- REP-007

    public function test_purchase_register_splits_goods_from_charges(): void
    {
        $admin = $this->adminUser();
        Sanctum::actingAs($admin);

        $bill = $this->postBill([
            'charges' => [
                $this->charge('FREIGHT', 200),
                $this->charge('PACKING', 100, ['treatment' => 'expense']),
                $this->charge('OTHER', 1000, ['paid_separately' => true, 'treatment' => 'expense']),
            ],
        ]);

        $list = $this->getJson('/api/admin/purchases?active_store_id=' . $this->store->id)
            ->assertOk()
            ->json('data');

        $row = null;
        foreach ($list as $item) {
            if ((int) $item['id'] === (int) $bill->id) {
                $row = $item['charge_register'] ?? null;
            }
        }

        $this->assertNotNull($row, 'REP-007: the register row must carry its own charges block');

        // Goods 10,000 @12%; freight 200 @18 into cost; packing 100 @18 expensed; 1,000 @18 paid direct.
        $this->assertEqualsWithDelta(10000.0, $row['goods_taxable'], 0.005);
        $this->assertEqualsWithDelta(1200.0, $row['goods_tax'], 0.005,
            'REP-007: the header tax mixes goods and charges, so the register splits it back out');
        $this->assertEqualsWithDelta(300.0, $row['charge_taxable'], 0.005);
        $this->assertEqualsWithDelta(54.0, $row['charge_tax'], 0.005);
        $this->assertEqualsWithDelta(354.0, $row['charge_total'], 0.005);
        $this->assertEqualsWithDelta(11554.0, $row['payable'], 0.005);
        $this->assertEqualsWithDelta(10200.0, $row['landed_value'], 0.005,
            'landed = goods taxable + what the add-to-cost charge actually spread');
        $this->assertEqualsWithDelta(1180.0, $row['separately_paid']['total'], 0.005);

        // The identity the totals row has to reconcile to: goods + supplier-borne charges = payable.
        $this->assertEqualsWithDelta(
            (float) $bill->grand_total,
            round($row['goods_taxable'] + $row['goods_tax'] + $row['charge_total'], 2),
            0.005
        );

        $heads = array_column($row['by_head'], null, 'head_code');
        $this->assertCount(3, $row['by_head']);
        $this->assertEqualsWithDelta(236.0, $heads['FREIGHT']['total'], 0.005);
        $this->assertSame('add_to_cost', $heads['FREIGHT']['treatment']);
        $this->assertTrue($heads['FREIGHT']['in_payable']);
        $this->assertFalse($heads['OTHER']['in_payable']);
        $this->assertSame('Paid Separately', $heads['OTHER']['payment']);
    }

    public function test_purchase_details_show_rate_allocation_and_landed_cost_as_three_columns(): void
    {
        $admin = $this->adminUser();
        Sanctum::actingAs($admin);

        $bill = $this->postBill([
            'charges' => [$this->charge('FREIGHT', 1500, ['spread_method' => 'value'])],
        ]);

        $detail = $this->getJson('/api/admin/purchases/' . $bill->id)->assertOk()->json();

        $item = $detail['items'][0];
        $this->assertEqualsWithDelta(100.0, (float) $item['purchase_rate'], 0.005,
            'PUR-011: the supplier rate stays visible');
        $this->assertEqualsWithDelta(1500.0, (float) $item['charge_allocation'], 0.005);
        $this->assertEqualsWithDelta(115.0, (float) $item['landed_unit_cost'], 0.005);

        $this->assertEqualsWithDelta(10000.0, $detail['charge_register']['goods_taxable'], 0.005);
        $this->assertEqualsWithDelta(1500.0, $detail['charge_register']['charge_taxable'], 0.005);
        $this->assertEqualsWithDelta(12970.0, $detail['charge_register']['payable'], 0.005);
    }

    // ---------------------------------------------------------------- REP-009 margin

    public function test_margin_is_bought_on_landed_cost_not_the_supplier_rate(): void
    {
        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Margin Tablet',
            'mrp' => 300,
            'sel_rate' => 200,
            'gst_percent' => 12,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $product->id,
            'batch_no' => 'B-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 0,
            'mrp' => 300,
            'purchase_rate' => 100,
            'selling_rate' => 200,
        ]);

        // Freight 200 into cost on 100 units = 102 landed; packing 100 expensed stays out of COGS.
        $this->postBill([
            'lines' => [$this->line(['product_id' => $product->id])],
            'charges' => [
                $this->charge('FREIGHT', 200),
                $this->charge('PACKING', 100, ['treatment' => 'expense']),
            ],
        ]);

        $invoice = Invoice::create([
            'store_id' => $this->store->id,
            'customer_name' => 'Walk-in',
            'invoice_number' => 'CRP-SALE-0001',
            'invoice_date' => '2026-11-18',
            'module_key' => 'invoice',
            'taxable_subtotal' => 2000,
            'cgst_total' => 120,
            'sgst_total' => 120,
            'tax_total' => 240,
            'round_off' => 0,
            'grand_total' => 2240,
            'paid_amount' => 2240,
            'payment_mode' => 'Cash',
            'status' => 'issued',
        ]);

        InvoiceItem::create([
            'invoice_id' => $invoice->id,
            'product_id' => $product->id,
            'product_name' => $product->name,
            'batch_no' => 'B-1',
            'qty' => 10,
            'units_per_pack' => 1,
            'unit_price' => 200,
            'taxable_amount' => 2000,
            'gst_percent' => 12,
            'tax_amount' => 240,
            'total_amount' => 2240,
        ]);

        $res = $this->getJson('/api/reports/profit?start_date=2026-11-01&end_date=2026-11-30')->assertOk();

        // Revenue stays what this report has always counted - the line's tax-inclusive total.
        $this->assertEqualsWithDelta(2240.0, (float) $res->json('total_revenue'), 0.005);
        $this->assertEqualsWithDelta(1020.0, (float) $res->json('total_cogs'), 0.005,
            'REP-009: the charge that joined the cost has to join the margin');
        $this->assertEqualsWithDelta(1220.0, (float) $res->json('gross_profit'), 0.005);
        $this->assertSame('landed_cost', $res->json('cost_basis'));

        // The expensed half is reported beside it, below the line, so the two treatments are
        // comparable without ever being added to COGS twice.
        $this->assertEqualsWithDelta(100.0, (float) $res->json('expense_charge_postings'), 0.005);

        $row = collect($res->json('breakdown'))->firstWhere('group_key', $product->name);
        $this->assertEqualsWithDelta(102.0, (float) $row['cost_per_unit'], 0.005);
        // PUR-011: the charge joined the landed rate, never the supplier rate on the batch.
        $this->assertEqualsWithDelta(100.0, (float) $row['supplier_cost_per_unit'], 0.005);
    }

    public function test_margin_falls_back_to_the_booked_rate_without_a_landed_batch(): void
    {
        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Uncharged Tablet',
            'mrp' => 300,
            'sel_rate' => 200,
            'ptr' => 80,
            'gst_percent' => 12,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $product->id,
            'batch_no' => 'B-9',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 50,
            'mrp' => 300,
            'purchase_rate' => 80,
            'selling_rate' => 200,
        ]);

        $invoice = Invoice::create([
            'store_id' => $this->store->id,
            'customer_name' => 'Walk-in',
            'invoice_number' => 'CRP-SALE-0002',
            'invoice_date' => '2026-11-18',
            'module_key' => 'invoice',
            'taxable_subtotal' => 400,
            'tax_total' => 0,
            'cgst_total' => 0,
            'sgst_total' => 0,
            'round_off' => 0,
            'grand_total' => 400,
            'paid_amount' => 400,
            'payment_mode' => 'Cash',
            'status' => 'issued',
        ]);

        InvoiceItem::create([
            'invoice_id' => $invoice->id,
            'product_id' => $product->id,
            'product_name' => $product->name,
            'batch_no' => 'B-9',
            'qty' => 2,
            'units_per_pack' => 1,
            'unit_price' => 200,
            'taxable_amount' => 400,
            'gst_percent' => 12,
            'tax_amount' => 0,
            'total_amount' => 400,
        ]);

        $res = $this->getJson('/api/reports/profit?start_date=2026-11-01&end_date=2026-11-30')->assertOk();

        $this->assertEqualsWithDelta(160.0, (float) $res->json('total_cogs'), 0.005,
            'a batch that never carried a charge still costs what it cost');
        $this->assertSame('purchase_rate', $res->json('cost_basis'));
        $this->assertEqualsWithDelta(0.0, (float) $res->json('expense_charge_postings'), 0.005);
    }

    private function adminUser(): User
    {
        return User::create([
            'name' => 'Reports Admin',
            'email' => 'admin@charge-reports.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
            'is_active' => true,
        ]);
    }
}

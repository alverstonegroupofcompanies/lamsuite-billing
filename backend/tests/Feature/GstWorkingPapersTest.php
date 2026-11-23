<?php

namespace Tests\Feature;

use App\Models\Gstr2bEntry;
use App\Models\Gstr2bImport;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\PurchaseItem;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class GstWorkingPapersTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private User $admin;
    private User $accountant;
    private User $otherManager;
    private Party $customer;
    private Party $supplier;
    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create(['name' => 'GST Store', 'code' => 'GST01', 'is_active' => true]);
        $this->otherStore = Store::create(['name' => 'Other GST Store', 'code' => 'GST02', 'is_active' => true]);

        $this->admin = User::create([
            'name' => 'GST Admin',
            'email' => 'gst-admin@test.local',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);

        $this->accountant = User::create([
            'name' => 'GST Accountant',
            'email' => 'gst-accountant@test.local',
            'password' => bcrypt('password123'),
            'role' => 'accountant',
            'store_id' => $this->store->id,
        ]);

        $this->otherManager = User::create([
            'name' => 'Other Manager',
            'email' => 'gst-other-manager@test.local',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'store_id' => $this->otherStore->id,
        ]);

        $this->customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'GST Customer',
            'phone' => '9876500011',
            'gstin' => '32ABCDE1234F1Z5',
            'opening_balance' => 0,
            'current_balance' => 0,
            'is_active' => true,
        ]);

        $this->supplier = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'name' => 'GST Supplier',
            'gstin' => '32ZYXWV9876A1Z2',
            'opening_balance' => 0,
            'current_balance' => 0,
            'is_active' => true,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Azithromycin 250mg',
            'hsn_sac_code' => '30049099',
            'gst_percent' => 12,
            'mrp' => 20,
            'is_active' => true,
        ]);
    }

    private function auth(?User $user = null)
    {
        return $this->actingAs($user ?? $this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id]);
    }

    private function makeInvoice(array $overrides = [], array $itemOverrides = [], ?int $storeId = null): Invoice
    {
        $invoice = Invoice::create(array_merge([
            'store_id' => $storeId ?? $this->store->id,
            'customer_id' => $this->customer->id,
            'customer_name' => 'GST Customer',
            'customer_gstin' => '32ABCDE1234F1Z5',
            'place_of_supply' => '32',
            'invoice_number' => 'INV-GST-' . uniqid(),
            'invoice_date' => '2026-11-05',
            'module_key' => 'invoice',
            'subtotal' => 200,
            'discount_total' => 0,
            'taxable_subtotal' => 200,
            'cgst_total' => 12,
            'sgst_total' => 12,
            'igst_total' => 0,
            'cess_total' => 0,
            'tax_total' => 24,
            'round_off' => 0,
            'grand_total' => 224,
            'paid_amount' => 224,
            'payment_mode' => 'Cash',
            'payment_status' => 'paid',
            'status' => 'issued',
        ], $overrides));

        InvoiceItem::create(array_merge([
            'invoice_id' => $invoice->id,
            'product_id' => $this->product->id,
            'product_name' => 'Azithromycin 250mg',
            'batch_no' => 'G101',
            'qty' => 20,
            'loose_qty' => 0,
            'units_per_pack' => 10,
            'unit_price' => 10,
            'mrp' => 20,
            'taxable_amount' => 200,
            'gst_percent' => 12,
            'cgst_amount' => 12,
            'sgst_amount' => 12,
            'igst_amount' => 0,
            'cess_amount' => 0,
            'tax_amount' => 24,
            'total_amount' => 224,
        ], $itemOverrides));

        return $invoice;
    }

    private function makePurchase(array $overrides = [], array $itemOverrides = [], ?int $storeId = null): Purchase
    {
        $purchase = Purchase::create(array_merge([
            'store_id' => $storeId ?? $this->store->id,
            'supplier_id' => $this->supplier->id,
            'supplier_name' => 'GST Supplier',
            'supplier_gstin' => '32ZYXWV9876A1Z2',
            'invoice_number' => 'PUR-GST-' . uniqid(),
            'invoice_date' => '2026-11-06',
            'module_key' => 'purchase',
            'subtotal' => 100,
            'tax_total' => 12,
            'cgst_total' => 6,
            'sgst_total' => 6,
            'igst_total' => 0,
            'cess_total' => 0,
            'grand_total' => 112,
            'paid_amount' => 112,
            'status' => 'received',
            'is_rcm' => false,
            'itc_eligibility' => 'eligible',
        ], $overrides));

        PurchaseItem::create(array_merge([
            'purchase_id' => $purchase->id,
            'product_id' => $this->product->id,
            'product_name' => 'Azithromycin 250mg',
            'hsn_code' => '30049099',
            'batch_no' => 'G201',
            'expiry_date' => '2027-12-31',
            'qty' => 10,
            'purchase_rate' => 10,
            'mrp' => 20,
            'gst_percent' => 12,
            'taxable_amount' => 100,
            'cgst_amount' => 6,
            'sgst_amount' => 6,
            'igst_amount' => 0,
            'cess_amount' => 0,
            'tax_amount' => 12,
            'total_amount' => 112,
        ], $itemOverrides));

        return $purchase;
    }

    public function test_gstr3b_computes_rate_wise_outward_and_eligible_itc(): void
    {
        $this->makeInvoice();

        $this->makeInvoice([
            'invoice_number' => 'POS-GST-1',
            'module_key' => 'pos',
            'subtotal' => 100,
            'taxable_subtotal' => 100,
            'cgst_total' => 2.5,
            'sgst_total' => 2.5,
            'tax_total' => 5,
            'grand_total' => 105,
            'paid_amount' => 105,
        ], [
            'taxable_amount' => 100,
            'gst_percent' => 5,
            'cgst_amount' => 2.5,
            'sgst_amount' => 2.5,
            'tax_amount' => 5,
            'total_amount' => 105,
        ]);

        $this->makeInvoice([
            'invoice_number' => 'CN-GST-1',
            'module_key' => 'credit_note',
            'subtotal' => 50,
            'taxable_subtotal' => 50,
            'cgst_total' => 3,
            'sgst_total' => 3,
            'tax_total' => 6,
            'grand_total' => 56,
            'paid_amount' => 0,
        ], [
            'taxable_amount' => 50,
            'gst_percent' => 12,
            'cgst_amount' => 3,
            'sgst_amount' => 3,
            'tax_amount' => 6,
            'total_amount' => 56,
        ]);

        $this->makePurchase();
        $this->makePurchase([
            'invoice_number' => 'PUR-RCM-1',
            'is_rcm' => true,
            'subtotal' => 200,
            'tax_total' => 24,
            'cgst_total' => 12,
            'sgst_total' => 12,
            'grand_total' => 224,
        ]);
        $this->makePurchase([
            'invoice_number' => 'PUR-INELIGIBLE-1',
            'itc_eligibility' => 'ineligible',
            'subtotal' => 100,
            'tax_total' => 12,
            'cgst_total' => 6,
            'sgst_total' => 6,
            'grand_total' => 112,
        ]);

        $res = $this->auth()->getJson('/api/admin/reports/gstr3b?start_date=2026-11-01&end_date=2026-11-30');

        $res->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('outward.total_taxable', 250)
            ->assertJsonPath('outward.total_tax', 23)
            ->assertJsonPath('outward.total_cgst', 11.5)
            ->assertJsonPath('outward.nil_rated_taxable', 0)
            ->assertJsonPath('itc.total_itc', 12)
            ->assertJsonPath('itc.ineligible_itc', 12)
            ->assertJsonPath('itc.rcm_tax', 24)
            ->assertJsonPath('net_payable.cgst', 5.5)
            ->assertJsonPath('net_payable.sgst', 5.5)
            ->assertJsonPath('net_payable.total', 11);

        $rates = collect($res->json('outward.rate_wise'))->keyBy('rate');
        $this->assertSame(150.0, (float) $rates[12]['taxable_value']);
        $this->assertSame(18.0, (float) $rates[12]['tax_amount']);
        $this->assertSame(100.0, (float) $rates[5]['taxable_value']);
    }

    public function test_gstr3b_groups_invoices_without_line_tax_under_header_only(): void
    {
        Invoice::create([
            'store_id' => $this->store->id,
            'customer_name' => 'Walk-in',
            'invoice_number' => 'POS-HEADER-1',
            'invoice_date' => '2026-11-08',
            'module_key' => 'pos',
            'subtotal' => 1000,
            'taxable_subtotal' => 0,
            'cgst_total' => 0,
            'sgst_total' => 0,
            'igst_total' => 0,
            'cess_total' => 0,
            'tax_total' => 90,
            'grand_total' => 1090,
            'paid_amount' => 1090,
            'payment_mode' => 'Cash',
            'payment_status' => 'paid',
            'status' => 'issued',
        ]);

        $res = $this->auth()->getJson('/api/admin/reports/gstr3b?start_date=2026-11-01&end_date=2026-11-30');

        $res->assertOk()
            ->assertJsonPath('outward.total_taxable', 1000)
            ->assertJsonPath('outward.total_tax', 90)
            ->assertJsonPath('outward.total_cgst', 45)
            ->assertJsonPath('outward.total_sgst', 45);

        $header = collect($res->json('outward.rate_wise'))->firstWhere('rate', null);

        $this->assertNotNull($header);
        $this->assertSame('Header only', $header['rate_label']);
        $this->assertSame(1000.0, (float) $header['taxable_value']);

        $csv = $this->auth()->get('/api/admin/reports/gstr3b/export?start_date=2026-11-01&end_date=2026-11-30');
        $this->assertStringContainsString('Header only', $csv->getContent());
    }

    public function test_gstr3b_itc_follows_each_charge_own_eligibility(): void
    {
        // REP-009: a supplier bill's charge GST is input tax only where that charge is
        // creditable, a blocked head is shown as non-creditable, and a reverse-charge one is
        // listed for review instead of being quietly claimed.
        $freight = $this->makeCharge($this->makePurchase(), 'FREIGHT', 'Freight', 200);
        $this->makeCharge($this->makePurchase(['invoice_number' => 'PUR-GST-BLOCKED']),
            'INSURANCE', 'Insurance', 100, ['itc_eligibility' => 'blocked']);
        $this->makeCharge($this->makePurchase(['invoice_number' => 'PUR-GST-SEPARATE']),
            'OTHER', 'Other', 100, ['paid_separately' => true]);
        $rcm = $this->makeCharge($this->makePurchase(['invoice_number' => 'PUR-GST-RCM']),
            'FREIGHT', 'Freight', 200, ['is_rcm' => true]);

        $res = $this->auth()->getJson('/api/admin/reports/gstr3b?start_date=2026-11-01&end_date=2026-11-30');
        $res->assertOk();

        // Goods: four bills of 12% on 100 = 48. Charges: 36 + 18 claimable, 18 blocked, 36 RCM.
        $this->assertEqualsWithDelta(102.0, (float) $res->json('itc.total_itc'), 0.005);
        $this->assertEqualsWithDelta(18.0, (float) $res->json('itc.ineligible_itc'), 0.005);
        $this->assertEqualsWithDelta(36.0, (float) $res->json('itc.rcm_tax'), 0.005);
        $this->assertEqualsWithDelta(200.0, (float) $res->json('itc.rcm_taxable'), 0.005);

        $rates = collect($res->json('itc.rate_wise'))->keyBy('rate');
        $this->assertEqualsWithDelta(300.0, (float) $rates[18]['taxable_value'], 0.005);
        $this->assertEqualsWithDelta(54.0, (float) $rates[18]['tax_amount'], 0.005);
        $this->assertEqualsWithDelta(400.0, (float) $rates[12]['taxable_value'], 0.005);
        $this->assertEqualsWithDelta(48.0, (float) $rates[12]['tax_amount'], 0.005);

        $charges = $res->json('itc.charges');
        $this->assertEqualsWithDelta(600.0, (float) $charges['total_taxable'], 0.005);
        $this->assertEqualsWithDelta(108.0, (float) $charges['total_tax'], 0.005);
        $this->assertEqualsWithDelta(54.0, (float) $charges['creditable_tax'], 0.005);
        $this->assertEqualsWithDelta(18.0, (float) $charges['non_creditable_tax'], 0.005);
        $this->assertEqualsWithDelta(36.0, (float) $charges['rcm_tax'], 0.005);
        $this->assertTrue($charges['reconciles'], 'creditable + non-creditable + RCM = every charge rupee of tax');

        $byHead = collect($charges['by_head'])->keyBy(fn ($r) => $r['head_code'] . '|' . $r['itc_eligibility']
            . '|' . ($r['is_rcm'] ? 'rcm' : 'normal') . '|' . ($r['paid_separately'] ? 'sep' : 'bill'));
        $this->assertCount(4, $byHead);
        $this->assertEqualsWithDelta(36.0, (float) $byHead['FREIGHT|eligible|normal|bill']['creditable_tax'], 0.005);
        $this->assertEqualsWithDelta(0.0, (float) $byHead['INSURANCE|blocked|normal|bill']['creditable_tax'], 0.005);
        $this->assertEqualsWithDelta(18.0, (float) $byHead['INSURANCE|blocked|normal|bill']['tax'], 0.005);
        $this->assertTrue($byHead['OTHER|eligible|normal|sep']['paid_separately']);
        $this->assertTrue($byHead['FREIGHT|eligible|rcm|bill']['is_rcm']);

        $review = collect($res->json('itc.rcm_review.rows'));
        $this->assertCount(1, $review);
        $row = $review->first();
        $this->assertSame('PUR-GST-RCM', $row['invoice_number']);
        $this->assertSame('Freight', $row['head_name']);
        $this->assertSame('GST Supplier', $row['supplier_name']);
        $this->assertEqualsWithDelta(200.0, (float) $row['taxable_amount'], 0.005);
        $this->assertEqualsWithDelta(36.0, (float) $row['self_paid_tax'], 0.005);
        $this->assertEqualsWithDelta(996731.0, (float) $row['sac_code'], 1.0);

        // The ordinary input-tax table must not be the place a reverse-charge line hides.
        $this->assertNotSame($freight->id, $rcm->id);
        $this->assertEqualsWithDelta(36.0, (float) $res->json('itc.rcm_review.total_tax'), 0.005);
    }

    public function test_header_only_bill_counts_its_charge_tax_once(): void
    {
        // A till bill can arrive without usable item rows, so the paper reads the header, which
        // already carries the supplier-borne charge GST (PUR-001). Adding the charge rows on top
        // would claim the same paisa twice; the separately-paid tax is the part missing.
        $bill = $this->makePurchase([
            'invoice_number' => 'PUR-GST-HEADER',
            'subtotal' => 1000,
            'tax_total' => 156,
            'cgst_total' => 78,
            'sgst_total' => 78,
            'grand_total' => 1356,
            'paid_amount' => 1356,
        ]);
        $bill->items()->delete();
        $this->makeCharge($bill, 'FREIGHT', 'Freight', 200, ['place_of_supply' => '32']);
        $this->makeCharge($bill, 'OTHER', 'Other', 100, ['paid_separately' => true]);

        $res = $this->auth()->getJson('/api/admin/reports/gstr3b?start_date=2026-11-01&end_date=2026-11-30');
        $res->assertOk();

        $header = collect($res->json('itc.rate_wise'))->firstWhere('rate', null);
        $this->assertNotNull($header);
        $this->assertEqualsWithDelta(1000.0, (float) $header['taxable_value'], 0.005);
        $this->assertEqualsWithDelta(156.0, (float) $header['tax_amount'], 0.005);

        $igst = collect($res->json('itc.rate_wise'))->firstWhere('rate', 18);
        $this->assertEqualsWithDelta(18.0, (float) $igst['tax_amount'], 0.005,
            'REP-009: only the tax the header never carried is added');

        $this->assertEqualsWithDelta(174.0, (float) $res->json('itc.total_itc'), 0.005);
        $this->assertEqualsWithDelta(54.0, (float) $res->json('itc.charges.total_tax'), 0.005);
        $this->assertEqualsWithDelta(54.0, (float) $res->json('itc.charges.creditable_tax'), 0.005);
    }

    public function test_header_only_bill_keeps_reverse_charge_tax_out_of_ordinary_itc(): void
    {
        // PUR-001 puts a supplier-borne charge's GST in the header, and the paper reads that
        // header when no item lines answer. A reverse-charge head is tax the store pays itself, so
        // it has to leave the creditable slab — otherwise the same ₹36 is claimed and flagged.
        $bill = $this->makePurchase([
            'invoice_number' => 'PUR-GST-RCM-HEADER',
            'subtotal' => 1000,
            'tax_total' => 156,
            'cgst_total' => 78,
            'sgst_total' => 78,
            'grand_total' => 1356,
            'paid_amount' => 1356,
        ]);
        $bill->items()->delete();
        $this->makeCharge($bill, 'FREIGHT', 'Freight', 200, ['is_rcm' => true, 'place_of_supply' => '32']);

        $res = $this->auth()->getJson('/api/admin/reports/gstr3b?start_date=2026-11-01&end_date=2026-11-30');
        $res->assertOk();

        $this->assertEqualsWithDelta(120.0, (float) $res->json('itc.total_itc'), 0.005,
            'REP-009: the header tax is credited only after the reverse-charge half leaves it');
        $this->assertEqualsWithDelta(36.0, (float) $res->json('itc.rcm_tax'), 0.005);
        $this->assertEqualsWithDelta(200.0, (float) $res->json('itc.rcm_taxable'), 0.005);
        $this->assertEqualsWithDelta(36.0, (float) $res->json('itc.charges.rcm_tax'), 0.005);
        $this->assertEqualsWithDelta(0.0, (float) $res->json('itc.charges.creditable_tax'), 0.005);
        $this->assertTrue($res->json('itc.charges.reconciles'));
        $this->assertCount(1, $res->json('itc.rcm_review.rows'));
    }

    public function test_gstr9_annual_paper_carries_charge_itc_and_reverse_charge(): void
    {
        $this->makeCharge($this->makePurchase(), 'FREIGHT', 'Freight', 200, ['is_rcm' => true]);

        $res = $this->auth()->getJson('/api/admin/reports/gstr9?start_date=2026-04-01&end_date=2027-03-31');
        $res->assertOk();

        // The single bill's goods tax is claimable; its reverse-charge freight is not.
        $this->assertEqualsWithDelta(12.0, (float) $res->json('reconciliation.itc_availed'), 0.005);
        $this->assertEqualsWithDelta(36.0, (float) $res->json('itc.reverse_charge_tax'), 0.005);
        $this->assertEqualsWithDelta(36.0, (float) $res->json('itc.charges.rcm_tax'), 0.005);
        $this->assertCount(1, $res->json('itc.rcm_review.rows'));
    }

    private function makeCharge(
        Purchase $purchase,
        string $headCode,
        string $headName,
        float $taxable,
        array $overrides = []
    ): PurchaseCharge {
        $percent = $overrides['gst_percent'] ?? 18;
        unset($overrides['gst_percent']);
        $tax = round($taxable * $percent / 100, 2);

        return PurchaseCharge::create(array_merge([
            'store_id' => $purchase->store_id,
            'purchase_id' => $purchase->id,
            'external_id' => 'gst-' . $purchase->id . '-' . $headCode,
            'seq' => 1,
            'head_code' => $headCode,
            'head_name' => $headName,
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'itc_eligibility' => 'eligible',
            'is_rcm' => false,
            'paid_separately' => false,
            'sac_code' => $headCode === 'FREIGHT' ? '996731' : null,
            'place_of_supply' => '32',
            'amount' => $taxable,
            'gst_percent' => $percent,
            'taxable_amount' => $taxable,
            'cgst_amount' => round($tax / 2, 2),
            'sgst_amount' => round($tax - round($tax / 2, 2), 2),
            'igst_amount' => 0,
            'cess_amount' => 0,
            'total_amount' => round($taxable + $tax, 2),
            'source' => 'manual',
        ], $overrides));
    }

    public function test_gstr3b_export_returns_csv(): void
    {
        $this->makeInvoice();

        $res = $this->auth()->get('/api/admin/reports/gstr3b/export?start_date=2026-11-01&end_date=2026-11-30');

        $res->assertOk();
        $this->assertStringContainsString('text/csv', (string) $res->headers->get('Content-Type'));
        $this->assertStringContainsString('attachment; filename="gstr3b-working-2026-11-01_to_2026-11-30.csv"', (string) $res->headers->get('Content-Disposition'));

        $body = $res->getContent();
        $this->assertStringContainsString('Section,Rate,"Taxable Value",CGST,SGST,IGST,Cess,"Tax Total"', $body);
        $this->assertStringContainsString('3.1 Outward total', $body);
        $this->assertStringContainsString('4 ITC total', $body);
        $this->assertStringContainsString('6.1 Net tax payable', $body);
    }

    public function test_gstr3b_rejects_inverted_date_range(): void
    {
        $this->auth()
            ->getJson('/api/admin/reports/gstr3b?start_date=2026-11-30&end_date=2026-11-01')
            ->assertStatus(422);
    }

    public function test_gstr2b_entry_shows_the_charge_split_behind_a_matched_bill(): void
    {
        // The supplier shows freight on their own invoice, so 2B and the bill header agree at 138.
        // What the store may actually claim is less, and the reconciliation has to say so (REP-009).
        $bill = $this->makePurchase([
            'invoice_number' => 'SUP-INV-CHARGE',
            'subtotal' => 1000,
            'tax_total' => 138,
            'cgst_total' => 69,
            'sgst_total' => 69,
            'grand_total' => 1218,
        ]);
        $this->makeCharge($bill, 'FREIGHT', 'Freight', 100, ['itc_eligibility' => 'blocked']);

        $import = $this->auth()->postJson('/api/admin/reports/gstr2b/import', [
            'period' => '2026-11',
            'file_name' => '2b-charges.json',
            'rows' => [[
                'supplier_gstin' => '32ZYXWV9876A1Z2',
                'supplier_name' => 'GST Supplier',
                'invoice_number' => 'SUP-INV-CHARGE',
                'invoice_date' => '2026-11-06',
                'taxable_value' => 1100,
                'cgst_amount' => 69,
                'sgst_amount' => 69,
                'total_value' => 1218,
            ]],
        ]);
        $import->assertCreated();

        $report = $this->auth()->getJson('/api/admin/reports/gstr2b/imports/' . $import->json('import.id'));
        $report->assertOk();

        $entry = collect($report->json('entries'))->firstWhere('invoice_number', 'SUP-INV-CHARGE');
        $this->assertSame('matched', $entry['match_status']);
        $this->assertEqualsWithDelta(138.0, (float) $entry['matched_purchase']['tax_total'], 0.005);
        $this->assertEqualsWithDelta(0.0, (float) $entry['tax_difference'], 0.005);

        $charges = $entry['matched_purchase']['charges'];
        $this->assertEqualsWithDelta(100.0, (float) $charges['taxable'], 0.005);
        $this->assertEqualsWithDelta(18.0, (float) $charges['tax'], 0.005);
        $this->assertEqualsWithDelta(0.0, (float) $charges['creditable_tax'], 0.005);
        $this->assertEqualsWithDelta(18.0, (float) $charges['non_creditable_tax'], 0.005);
        $this->assertEqualsWithDelta(120.0, (float) $entry['matched_purchase']['itc_claimable'], 0.005);

        $csv = $this->auth()->get('/api/admin/reports/gstr2b/imports/' . $import->json('import.id') . '/export');
        $this->assertStringContainsString('Charge Tax', $csv->getContent());
        $this->assertStringContainsString('Claimable ITC', $csv->getContent());
    }

    public function test_gstr2b_import_matches_mismatches_and_reports_itc(): void
    {
        $matchedPurchase = $this->makePurchase([
            'invoice_number' => 'SUP-INV-100',
            'subtotal' => 100,
            'tax_total' => 12,
            'cgst_total' => 6,
            'sgst_total' => 6,
            'grand_total' => 112,
        ]);

        $mismatchPurchase = $this->makePurchase([
            'invoice_number' => 'SUP-INV-200',
            'subtotal' => 200,
            'tax_total' => 24,
            'cgst_total' => 12,
            'sgst_total' => 12,
            'grand_total' => 224,
        ]);

        $res = $this->auth()->postJson('/api/admin/reports/gstr2b/import', [
            'period' => '2026-11',
            'file_name' => '2b-nov-2026.json',
            'rows' => [
                [
                    'supplier_gstin' => '32ZYXWV9876A1Z2',
                    'supplier_name' => 'GST Supplier',
                    'invoice_number' => 'SUP-INV-100',
                    'invoice_date' => '2026-11-06',
                    'taxable_value' => 100,
                    'cgst_amount' => 6,
                    'sgst_amount' => 6,
                    'total_value' => 112,
                ],
                [
                    'supplier_gstin' => '32ZYXWV9876A1Z2',
                    'invoice_number' => 'SUP-INV-200',
                    'invoice_date' => '2026-11-06',
                    'taxable_value' => 250,
                    'cgst_amount' => 15,
                    'sgst_amount' => 15,
                    'total_value' => 280,
                ],
                [
                    'supplier_gstin' => '27AAAAA0000A1Z5',
                    'invoice_number' => 'UNKNOWN-1',
                    'invoice_date' => '2026-11-07',
                    'taxable_value' => 150,
                    'igst_amount' => 27,
                    'total_value' => 177,
                ],
            ],
        ]);

        $res->assertCreated()
            ->assertJsonPath('success', true)
            ->assertJsonPath('import.total_entries', 3)
            ->assertJsonPath('import.matched_count', 1)
            ->assertJsonPath('import.mismatch_count', 1)
            ->assertJsonPath('import.unmatched_count', 1)
            ->assertJsonPath('import.itc_available', 69);

        $importId = $res->json('import.id');
        $this->assertDatabaseHas('gstr2b_entries', [
            'gstr2b_import_id' => $importId,
            'invoice_number' => 'SUP-INV-100',
            'match_status' => Gstr2bEntry::MATCH_MATCHED,
            'matched_purchase_id' => $matchedPurchase->id,
        ]);
        $this->assertDatabaseHas('gstr2b_entries', [
            'gstr2b_import_id' => $importId,
            'invoice_number' => 'SUP-INV-200',
            'match_status' => Gstr2bEntry::MATCH_MISMATCH,
            'matched_purchase_id' => $mismatchPurchase->id,
        ]);

        $report = $this->auth()->getJson("/api/admin/reports/gstr2b/imports/{$importId}");

        $report->assertOk()
            ->assertJsonPath('summary.matched', 1)
            ->assertJsonPath('summary.mismatch', 1)
            ->assertJsonPath('summary.unmatched', 1)
            ->assertJsonPath('summary.itc_eligible_value', 69);

        $entries = collect($report->json('entries'))->keyBy('invoice_number');
        $this->assertSame(6.0, (float) $entries['SUP-INV-200']['tax_difference']);
        $this->assertSame($mismatchPurchase->id, $entries['SUP-INV-200']['matched_purchase']['id']);

        $csv = $this->auth()->get("/api/admin/reports/gstr2b/imports/{$importId}/export");
        $csv->assertOk();
        $this->assertStringContainsString('"Supplier GSTIN",Supplier,"Invoice Number"', $csv->getContent());
        $this->assertStringContainsString('SUP-INV-100', $csv->getContent());

        $list = $this->auth()->getJson('/api/admin/reports/gstr2b/imports');
        $list->assertOk()->assertJsonPath('imports.0.id', $importId);

        $this->auth()->deleteJson("/api/admin/reports/gstr2b/imports/{$importId}")
            ->assertOk()
            ->assertJsonPath('success', true);

        $this->assertDatabaseMissing('gstr2b_entries', ['gstr2b_import_id' => $importId]);
    }

    public function test_gstr2b_import_rejects_missing_invoice_number(): void
    {
        $this->auth()->postJson('/api/admin/reports/gstr2b/import', [
            'period' => '2026-11',
            'rows' => [
                ['taxable_value' => 100],
            ],
        ])->assertStatus(422)->assertJsonValidationErrors(['rows.0.invoice_number']);
    }

    public function test_gstr2b_enforces_store_isolation(): void
    {
        $this->auth($this->otherManager)
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/admin/reports/gstr2b/import', [
                'period' => '2026-11',
                'rows' => [
                    ['invoice_number' => 'X-1', 'taxable_value' => 10],
                ],
            ])
            ->assertStatus(403);

        $import = Gstr2bImport::create([
            'store_id' => $this->store->id,
            'period' => '2026-11',
            'total_entries' => 0,
            'itc_available' => 0,
        ]);

        $this->auth($this->otherManager)
            ->withHeaders(['X-Store-Id' => (string) $this->otherStore->id])
            ->getJson("/api/admin/reports/gstr2b/imports/{$import->id}")
            ->assertStatus(403);
    }

    public function test_gstr9_annual_working_paper_and_export(): void
    {
        $this->makeInvoice(['invoice_date' => '2026-05-10']);
        $this->makeInvoice(['invoice_date' => '2027-03-20']);
        $this->makeInvoice([
            'invoice_date' => '2026-06-01',
            'module_key' => 'credit_note',
            'grand_total' => 56,
            'tax_total' => 6,
            'cgst_total' => 3,
            'sgst_total' => 3,
        ], [
            'taxable_amount' => 50,
            'cgst_amount' => 3,
            'sgst_amount' => 3,
            'tax_amount' => 6,
        ]);
        $this->makeInvoice(['invoice_date' => '2026-02-15']);

        $this->makePurchase(['invoice_date' => '2026-07-01']);

        $res = $this->auth()->getJson('/api/admin/reports/gstr9?fy=2026-27');

        $res->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('fiscal_year', '2026-27')
            ->assertJsonPath('period.from', '2026-04-01')
            ->assertJsonPath('period.to', '2027-03-31')
            ->assertJsonPath('turnover.gross_sales', 448)
            ->assertJsonPath('turnover.returns', 56)
            ->assertJsonPath('turnover.net_turnover', 392)
            ->assertJsonPath('turnover.taxable_turnover', 350)
            ->assertJsonPath('turnover.tax_on_outward', 42)
            ->assertJsonPath('itc.total_itc', 12)
            ->assertJsonPath('documents.invoices', 2)
            ->assertJsonPath('documents.credit_notes', 1)
            ->assertJsonPath('documents.purchase_bills', 1);

        $csv = $this->auth()->get('/api/admin/reports/gstr9/export?fy=2026-27');
        $csv->assertOk();
        $this->assertStringContainsString('attachment; filename="gstr9-working-2026-27.csv"', (string) $csv->headers->get('Content-Disposition'));
        $this->assertStringContainsString('Net turnover', $csv->getContent());
        $this->assertStringContainsString('Total ITC availed', $csv->getContent());
    }

    public function test_accountant_can_view_and_export_but_not_import(): void
    {
        $this->auth($this->accountant)->getJson('/api/admin/reports/gstr3b')->assertOk();
        $this->auth($this->accountant)->get('/api/admin/reports/gstr9/export?fy=2026-27')->assertOk();

        $this->auth($this->accountant)->postJson('/api/admin/reports/gstr2b/import', [
            'period' => '2026-11',
            'rows' => [
                ['invoice_number' => 'ACC-1', 'taxable_value' => 10],
            ],
        ])->assertStatus(403);
    }

    public function test_all_stores_scope_consolidates_outward_supplies(): void
    {
        $this->makeInvoice();
        $this->makeInvoice([], [], $this->otherStore->id);

        $res = $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->getJson('/api/admin/reports/gstr3b?start_date=2026-11-01&end_date=2026-11-30');

        $res->assertOk()->assertJsonPath('outward.total_taxable', 400);
    }
}

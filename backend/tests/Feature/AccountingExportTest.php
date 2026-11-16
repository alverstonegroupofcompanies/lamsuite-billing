<?php

namespace Tests\Feature;

use App\Models\Expense;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\MasterLookup;
use App\Models\Party;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AccountingExportTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private User $admin;
    private User $cashier;
    private Party $customer;
    private Party $supplier;
    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create(['name' => 'Export Store', 'code' => 'EXP01', 'is_active' => true]);
        $this->otherStore = Store::create(['name' => 'Other Export Store', 'code' => 'EXP02', 'is_active' => true]);

        $this->admin = User::create([
            'name' => 'Export Admin',
            'email' => 'export-admin@test.local',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);

        $this->cashier = User::create([
            'name' => 'Export Cashier',
            'email' => 'export-cashier@test.local',
            'password' => bcrypt('password123'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);

        $this->customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Acme Traders',
            'phone' => '9876543210',
            'gstin' => '32ABCDE1234F1Z5',
            'state_code' => '32',
            'opening_balance' => 100,
            'current_balance' => 250,
            'is_active' => true,
        ]);

        $this->supplier = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'name' => 'Medi Distributors',
            'gstin' => '32ZYXWV9876A1Z2',
            'opening_balance' => 50,
            'is_active' => true,
        ]);

        $category = MasterLookup::create([
            'store_id' => $this->store->id,
            'type' => 'categories',
            'name' => 'Analgesics',
            'is_active' => true,
        ]);
        $unit = MasterLookup::create([
            'store_id' => $this->store->id,
            'type' => 'units',
            'name' => 'Strip',
            'is_active' => true,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 500mg',
            'hsn_sac_code' => '30049099',
            'category_id' => (string) $category->id,
            'unit_id' => (string) $unit->id,
            'mrp' => 12,
            'sel_rate' => 10,
            'gst_percent' => 12,
            'units_per_pack' => 10,
            'current_stock' => 40,
            'reorder_level' => 5,
            'is_active' => true,
        ]);
    }

    private function auth(?User $user = null)
    {
        return $this->actingAs($user ?? $this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id]);
    }

    private function makeInvoice(array $overrides = [], ?int $storeId = null): Invoice
    {
        $invoice = Invoice::create(array_merge([
            'store_id' => $storeId ?? $this->store->id,
            'customer_id' => $this->customer->id,
            'customer_name' => 'Acme Traders',
            'customer_gstin' => '32ABCDE1234F1Z5',
            'place_of_supply' => '32',
            'invoice_number' => 'INV-EXP-001',
            'invoice_date' => '2026-03-15',
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

        InvoiceItem::create([
            'invoice_id' => $invoice->id,
            'product_id' => $this->product->id,
            'product_name' => 'Paracetamol 500mg',
            'batch_no' => 'B101',
            'qty' => 20,
            'loose_qty' => 0,
            'units_per_pack' => 10,
            'unit_price' => 10,
            'mrp' => 12,
            'taxable_amount' => 200,
            'gst_percent' => 12,
            'cgst_amount' => 12,
            'sgst_amount' => 12,
            'igst_amount' => 0,
            'cess_amount' => 0,
            'tax_amount' => 24,
            'total_amount' => 224,
        ]);

        return $invoice;
    }

    private function makePurchase(array $overrides = [], ?int $storeId = null): Purchase
    {
        $purchase = Purchase::create(array_merge([
            'store_id' => $storeId ?? $this->store->id,
            'supplier_id' => $this->supplier->id,
            'supplier_name' => 'Medi Distributors',
            'supplier_gstin' => '32ZYXWV9876A1Z2',
            'invoice_number' => 'PUR-EXP-001',
            'invoice_date' => '2026-03-16',
            'module_key' => 'purchase',
            'subtotal' => 1000,
            'tax_total' => 120,
            'cgst_total' => 60,
            'sgst_total' => 60,
            'igst_total' => 0,
            'cess_total' => 0,
            'grand_total' => 1120,
            'paid_amount' => 500,
            'status' => 'received',
        ], $overrides));

        PurchaseItem::create([
            'purchase_id' => $purchase->id,
            'product_id' => $this->product->id,
            'product_name' => 'Paracetamol 500mg',
            'hsn_code' => '30049099',
            'batch_no' => 'B205',
            'expiry_date' => '2027-12-31',
            'qty' => 100,
            'purchase_rate' => 10,
            'mrp' => 12,
            'gst_percent' => 12,
            'taxable_amount' => 1000,
            'cgst_amount' => 60,
            'sgst_amount' => 60,
            'igst_amount' => 0,
            'cess_amount' => 0,
            'tax_amount' => 120,
            'total_amount' => 1120,
        ]);

        return $purchase;
    }

    private function url(string $type, string $format, string $extra = ''): string
    {
        return "/api/admin/accounting/exports/{$type}/{$format}?from=2026-03-01&to=2026-03-31{$extra}";
    }

    public function test_catalog_lists_export_types_and_formats(): void
    {
        $res = $this->auth()->getJson('/api/admin/accounting/exports');
        $res->assertOk();
        $res->assertJsonPath('success', true);

        $types = collect($res->json('types'))->keyBy('type');
        $this->assertSame(['tally', 'busy', 'csv'], $types['sales']['formats']);
        $this->assertSame(['csv'], $types['gst-summary']['formats']);
        $this->assertTrue($types['party-statement']['requires_party']);
        $this->assertCount(8, $types);
    }

    public function test_export_parties_endpoint_is_scoped(): void
    {
        Party::create([
            'store_id' => $this->otherStore->id,
            'type' => 'customer',
            'name' => 'Foreign Customer',
            'is_active' => true,
        ]);

        $res = $this->auth()->getJson('/api/admin/accounting/export-parties');
        $res->assertOk();

        $names = collect($res->json('parties'))->pluck('name');
        $this->assertTrue($names->contains('Acme Traders'));
        $this->assertTrue($names->contains('Medi Distributors'));
        $this->assertFalse($names->contains('Foreign Customer'));
    }

    public function test_sales_csv_is_scoped_and_skips_cancelled_documents(): void
    {
        $this->makeInvoice();
        $this->makeInvoice(['invoice_number' => 'INV-CANCELLED', 'status' => 'cancelled'], $this->store->id);
        $this->makeInvoice(['invoice_number' => 'INV-OTHER-STORE'], $this->otherStore->id);
        $this->makeInvoice(['invoice_number' => 'INV-OUTSIDE', 'invoice_date' => '2026-01-10']);

        $res = $this->auth()->get($this->url('sales', 'csv'));
        $res->assertOk();
        $this->assertStringContainsString('text/csv', (string) $res->headers->get('content-type'));
        $this->assertStringContainsString('attachment; filename="sales-2026-03-01_to_2026-03-31.csv"', (string) $res->headers->get('content-disposition'));

        $content = $res->getContent();
        $this->assertStringContainsString('Invoice No', $content);
        $this->assertStringContainsString('INV-EXP-001', $content);
        $this->assertStringContainsString('Acme Traders', $content);
        $this->assertStringContainsString('224.00', $content);
        $this->assertStringNotContainsString('INV-CANCELLED', $content);
        $this->assertStringNotContainsString('INV-OTHER-STORE', $content);
        $this->assertStringNotContainsString('INV-OUTSIDE', $content);
    }

    public function test_sales_tally_xml_is_well_formed_and_balanced(): void
    {
        $this->makeInvoice();

        $res = $this->auth()->get($this->url('sales', 'tally'));
        $res->assertOk();
        $this->assertStringContainsString('application/xml', (string) $res->headers->get('content-type'));

        $xml = simplexml_load_string($res->getContent());
        $this->assertNotFalse($xml);

        $vouchers = $xml->BODY->IMPORTDATA->REQUESTDATA->TALLYMESSAGE;
        $this->assertCount(1, $vouchers);
        $voucher = $vouchers[0]->VOUCHER;
        $this->assertSame('Sales', (string) $voucher->VOUCHERTYPENAME);
        $this->assertSame('INV-EXP-001', (string) $voucher->VOUCHERNUMBER);
        $this->assertSame('Acme Traders', (string) $voucher->PARTYLEDGERNAME);

        $sum = 0.0;
        foreach ($voucher->{'ALLLEDGERENTRIES.LIST'} as $entry) {
            $sum += (float) $entry->AMOUNT;
        }
        $this->assertEqualsWithDelta(0.0, $sum, 0.01, 'Tally voucher ledger entries must balance');

        $this->assertSame('Paracetamol 500mg', (string) $voucher->{'INVENTORYENTRIES.LIST'}[0]->STOCKITEMNAME);
    }

    public function test_sales_busy_xml_contains_voucher_and_items(): void
    {
        $this->makeInvoice();

        $res = $this->auth()->get($this->url('sales', 'busy'));
        $res->assertOk();

        $xml = simplexml_load_string($res->getContent());
        $this->assertNotFalse($xml);
        $this->assertSame('Export Store', (string) $xml->CompanyName);

        $voucher = $xml->Vouchers->Voucher[0];
        $this->assertSame('INV-EXP-001', (string) $voucher->VchNo);
        $this->assertSame('Acme Traders', (string) $voucher->PartyName);
        $this->assertSame('Paracetamol 500mg', (string) $voucher->Items->Item[0]['Name']);
        $this->assertSame('224.00', (string) $voucher->Totals['GrandTotal']);
    }

    public function test_purchase_exports_cover_csv_tally_and_busy(): void
    {
        $this->makePurchase();

        $csv = $this->auth()->get($this->url('purchases', 'csv'));
        $csv->assertOk();
        $this->assertStringContainsString('PUR-EXP-001', $csv->getContent());
        $this->assertStringContainsString('Medi Distributors', $csv->getContent());

        $tally = $this->auth()->get($this->url('purchases', 'tally'));
        $tally->assertOk();
        $xml = simplexml_load_string($tally->getContent());
        $this->assertNotFalse($xml);
        $voucher = $xml->BODY->IMPORTDATA->REQUESTDATA->TALLYMESSAGE[0]->VOUCHER;
        $this->assertSame('Purchase', (string) $voucher->VOUCHERTYPENAME);
        $this->assertSame('PUR-EXP-001', (string) $voucher->VOUCHERNUMBER);

        $sum = 0.0;
        foreach ($voucher->{'ALLLEDGERENTRIES.LIST'} as $entry) {
            $sum += (float) $entry->AMOUNT;
        }
        $this->assertEqualsWithDelta(0.0, $sum, 0.01, 'Purchase voucher ledger entries must balance');

        $busy = $this->auth()->get($this->url('purchases', 'busy'));
        $busy->assertOk();
        $this->assertSame('Purchase', (string) simplexml_load_string($busy->getContent())->ExportType);
    }

    public function test_customer_and_supplier_tally_masters_use_correct_parent(): void
    {
        $customers = $this->auth()->get($this->url('customers', 'tally'));
        $customers->assertOk();
        $xml = simplexml_load_string($customers->getContent());
        $this->assertNotFalse($xml);
        $ledger = $xml->BODY->IMPORTDATA->REQUESTDATA->TALLYMESSAGE[0]->LEDGER;
        $this->assertSame('Acme Traders', (string) $ledger['NAME']);
        $this->assertSame('Sundry Debtors', (string) $ledger->PARENT);
        $this->assertSame('100.00', (string) $ledger->OPENINGBALANCE);
        $this->assertSame('32ABCDE1234F1Z5', (string) $ledger->GSTIN);

        $suppliers = $this->auth()->get($this->url('suppliers', 'tally'));
        $suppliers->assertOk();
        $xml = simplexml_load_string($suppliers->getContent());
        $ledger = $xml->BODY->IMPORTDATA->REQUESTDATA->TALLYMESSAGE[0]->LEDGER;
        $this->assertSame('Medi Distributors', (string) $ledger['NAME']);
        $this->assertSame('Sundry Creditors', (string) $ledger->PARENT);
        $this->assertSame('-50.00', (string) $ledger->OPENINGBALANCE);

        $supplierCsv = $this->auth()->get($this->url('suppliers', 'csv'));
        $this->assertStringContainsString('Medi Distributors', $supplierCsv->getContent());
    }

    public function test_product_exports_include_lookup_names_and_tally_stock_items(): void
    {
        $csv = $this->auth()->get($this->url('products', 'csv'));
        $csv->assertOk();
        $this->assertStringContainsString('Paracetamol 500mg', $csv->getContent());
        $this->assertStringContainsString('Analgesics', $csv->getContent());
        $this->assertStringContainsString('Strip', $csv->getContent());

        $tally = $this->auth()->get($this->url('products', 'tally'));
        $tally->assertOk();
        $xml = simplexml_load_string($tally->getContent());
        $this->assertNotFalse($xml);
        $item = $xml->BODY->IMPORTDATA->REQUESTDATA->TALLYMESSAGE[0]->STOCKITEM;
        $this->assertSame('Paracetamol 500mg', (string) $item['NAME']);
        $this->assertSame('GST 12.00%', (string) $item->GSTAPPLICABLE);
        $this->assertSame('30049099', (string) $item->HSNCODE);
    }

    public function test_gst_summary_groups_sales_and_purchase_lines(): void
    {
        $this->makeInvoice();
        $this->makePurchase();

        $res = $this->auth()->get($this->url('gst-summary', 'csv'));
        $res->assertOk();
        $content = $res->getContent();

        $this->assertStringContainsString('Source', $content);
        $this->assertStringContainsString('sales,30049099,12.00,200.00,12.00,12.00,0.00,0.00,24.00,224.00,1,1', $content);
        $this->assertStringContainsString('purchase,30049099,12.00,1000.00,60.00,60.00,0.00,0.00,120.00,1120.00,1,1', $content);
    }

    public function test_daybook_combines_sales_purchases_and_expenses_chronologically(): void
    {
        $this->makeInvoice();
        $this->makePurchase();
        Expense::create([
            'store_id' => $this->store->id,
            'expense_number' => 'EXP-001',
            'expense_head' => 'Electricity',
            'amount' => 350,
            'payment_mode' => 'Cash',
            'expense_date' => '2026-03-17',
        ]);

        $res = $this->auth()->get($this->url('daybook', 'csv'));
        $res->assertOk();
        $content = $res->getContent();

        $salesPos = strpos($content, 'INV-EXP-001');
        $purchasePos = strpos($content, 'PUR-EXP-001');
        $expensePos = strpos($content, 'Electricity');

        $this->assertNotFalse($salesPos);
        $this->assertNotFalse($purchasePos);
        $this->assertNotFalse($expensePos);
        $this->assertTrue($salesPos < $purchasePos && $purchasePos < $expensePos, 'Day book rows must be date ordered');
    }

    public function test_party_statement_requires_party_and_tracks_running_balance(): void
    {
        $this->makeInvoice();

        $this->auth()->get($this->url('party-statement', 'csv'))
            ->assertStatus(422);

        $this->auth()->get($this->url('party-statement', 'csv', '&party_id=' . $this->customer->id))
            ->assertOk()
            ->assertSee('INV-EXP-001')
            ->assertSee('Closing Balance');

        $otherParty = Party::create([
            'store_id' => $this->otherStore->id,
            'type' => 'customer',
            'name' => 'Foreign Customer',
            'is_active' => true,
        ]);

        $this->auth()->get($this->url('party-statement', 'csv', '&party_id=' . $otherParty->id))
            ->assertStatus(404);
    }

    public function test_unsupported_format_and_unknown_type_are_rejected(): void
    {
        $this->auth()->get($this->url('sales', 'pdf'))->assertStatus(422);
        $this->auth()->get($this->url('gst-summary', 'tally'))->assertStatus(422);
        $this->auth()->get($this->url('unknown', 'csv'))->assertStatus(404);
    }

    public function test_invalid_date_range_is_rejected(): void
    {
        $this->auth()->getJson('/api/admin/accounting/exports/sales/csv?from=2026-03-31&to=2026-03-01')
            ->assertStatus(422);

        $this->auth()->getJson('/api/admin/accounting/exports/sales/csv?from=31-03-2026')
            ->assertStatus(422);
    }

    public function test_cashier_is_forbidden_and_accountant_can_export(): void
    {
        $this->makeInvoice();

        $this->auth($this->cashier)->getJson('/api/admin/accounting/exports')->assertStatus(403);
        $this->auth($this->cashier)->get($this->url('sales', 'csv'))->assertStatus(403);

        $accountant = User::create([
            'name' => 'Export Accountant',
            'email' => 'export-accountant@test.local',
            'password' => bcrypt('password123'),
            'role' => 'accountant',
            'store_id' => $this->store->id,
        ]);

        $this->auth($accountant)->getJson('/api/admin/accounting/exports')->assertOk();
        $this->auth($accountant)->get($this->url('sales', 'csv'))->assertOk();
    }

    public function test_all_stores_scope_exports_every_store(): void
    {
        $this->makeInvoice();
        $this->makeInvoice(['invoice_number' => 'INV-OTHER-STORE'], $this->otherStore->id);

        $res = $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->get($this->url('sales', 'csv'));

        $res->assertOk();
        $content = $res->getContent();
        $this->assertStringContainsString('INV-EXP-001', $content);
        $this->assertStringContainsString('INV-OTHER-STORE', $content);
    }

    public function test_credit_note_reverses_sales_tally_signs(): void
    {
        $this->makeInvoice([
            'invoice_number' => 'CN-001',
            'module_key' => 'credit_note',
        ]);

        $res = $this->auth()->get($this->url('sales', 'tally'));
        $res->assertOk();
        $xml = simplexml_load_string($res->getContent());
        $voucher = $xml->BODY->IMPORTDATA->REQUESTDATA->TALLYMESSAGE[0]->VOUCHER;

        $this->assertSame('Credit Note', (string) $voucher->VOUCHERTYPENAME);

        $sum = 0.0;
        foreach ($voucher->{'ALLLEDGERENTRIES.LIST'} as $entry) {
            $sum += (float) $entry->AMOUNT;
        }
        $this->assertEqualsWithDelta(0.0, $sum, 0.01);
    }
}

<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\MigrationRun;
use App\Models\MigrationUnresolvedItem;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\Store;
use App\Services\Migration\MigrationDiagnosticsService;
use App\Services\Migration\MigrationPipelineRunner;
use App\Services\Migration\MigrationReconciliationService;
use App\Services\Tax\StoreTaxPolicy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * MIG-03 — a real legacy bundle against the current data types.
 *
 * A production migration reported every one of its 88 bills as "tax variance: stored ₹X vs
 * authoritative TaxEngine ₹0" while its turnover matched to the paisa, imported 0 of its
 * purchase bills, and opened with 0 units on hand. None of that was a pricing disagreement: the
 * importer read one key per field, and the source spelled them differently. These tests hold the
 * shapes that were lost, including the credit bills the pipeline never read at all.
 */
class MigrationLegacyShapesTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Lamstone Legacy Pharmacy',
            'code' => 'STR-LEG',
            'gstin' => '32ABCDE1234F1Z5',
            'state_code' => '32',
            'tax_mode' => 'exclusive',
        ]);
    }

    private function migrate(array $source, bool $dryRun = false): MigrationRun
    {
        $migration = MigrationRun::create([
            'store_id' => $this->store->id,
            'run_uuid' => (string) Str::uuid(),
            'source_type' => 'file',
            'status' => 'running',
        ]);

        (new MigrationPipelineRunner())->execute($migration, $source, $dryRun);

        return $migration;
    }

    /**
     * The shapes the legacy panel actually exports: `tax_percent` on a line, `bill_no` on a
     * header, `stock` and `ptr` on a batch row, and returns kept in their own table.
     */
    private function legacySource(): array
    {
        return [
            'store_profile' => [
                'name' => 'Lamstone Legacy Pharmacy',
                'phone' => '9847000000',
                'state_code' => '32',
                'gstin' => '32ABCDE1234F1Z5',
                // Spelled the legacy way, and nowhere near the v2 `tax_mode` column name.
                'tax_type' => 'exclusive',
                'enabled_menu_items' => [],
            ],
            'products' => [
                ['id' => 701, 'name' => 'Dolo 650 Tablet', 'barcode' => '8901111222233',
                    'hsn_sac_code' => '30049099', 'mrp' => 35, 'sel_rate' => 30, 'ptr' => 22,
                    'gst_percent' => 12, 'units_per_pack' => 10],
            ],
            'product_batches' => [
                // `stock` instead of `stock_qty`, `ptr` instead of `purchase_rate`,
                // a day-first `exp` instead of `expiry_date`.
                ['id' => 801, 'product_id' => 701, 'batch' => 'DL-2401', 'exp' => '30/6/2028',
                    'stock' => '1,200', 'mrp' => 35, 'ptr' => 20],
            ],
            'customers' => [
                ['id' => 401, 'name' => 'Vipin Kumar', 'phone' => '9876543210'],
            ],
            'suppliers' => [
                ['id' => 501, 'name' => 'Central Med Distributors', 'gstin' => '32CMDDE1234F1Z8'],
            ],
            'invoices' => [
                ['id' => 901, 'bill_no' => 'ADH-SAL-0001', 'bill_date' => '10/10/2026',
                    'customer_id' => 401, 'customer' => ['name' => 'Vipin Kumar'],
                    'basic_amount' => 60.00, 'gst_total' => 7.20, 'bill_amount' => 67.20,
                    'amount_paid' => 67.20, 'tender_mode' => 'UPI',
                    'items' => [
                        ['product_id' => 701, 'name' => 'Dolo 650 Tablet', 'batch' => 'DL-2401',
                            'quantity' => 2, 'rate' => 30.00, 'tax_percent' => 12.00,
                            'tax_amount' => 7.20, 'total_amount' => 67.20],
                    ]],
            ],
            // The credit bills the pipeline used to ignore entirely.
            'sales_returns' => [
                ['id' => 951, 'return_no' => 'ADH-CN26-27-0040', 'bill_date' => '12/10/2026',
                    'original_bill_number' => 'ADH-SAL-0001',
                    'basic_amount' => -120.00, 'gst_total' => -14.43, 'bill_amount' => -134.43,
                    'items' => [
                        ['product_id' => 701, 'name' => 'Dolo 650 Tablet', 'batch' => 'DL-2401',
                            'quantity' => -4, 'rate' => 30.00, 'cgst_percent' => 6, 'sgst_percent' => 6,
                            'tax_amount' => -14.43, 'total_amount' => -134.43],
                    ]],
            ],
            'purchases' => [
                ['id' => 1001, 'bill_no' => 'PB-9948', 'bill_date' => '01/10/2026',
                    'supplier_id' => 501, 'basic_amount' => 2000.00, 'gst_total' => 240.00,
                    'bill_amount' => 2240.00, 'amount_paid' => 2240.00,
                    'items' => [
                        ['product_id' => 701, 'name' => 'Dolo 650 Tablet', 'batch' => 'DL-2401',
                            'exp' => '30-06-2028', 'qty' => 100, 'ptr' => 20.00,
                            'tax_percent' => 12.00, 'tax_amount' => 240.00, 'total_amount' => 2240.00],
                    ]],
                // A bill the old importer dropped without a word: its only number spelling is
                // `voucher_no`, which it did not read.
                ['id' => 1002, 'voucher_no' => 'X-1', 'bill_date' => '03/10/2026', 'basic_amount' => 500.00],
            ],
        ];
    }

    public function test_a_legacy_rate_spelling_reaches_the_line_and_the_tax_slab_report(): void
    {
        $migration = $this->migrate($this->legacySource());
        $this->runLegacyReconcile($migration, $this->legacySource());

        $line = InvoiceItem::query()->firstOrFail();
        $this->assertEquals(12.00, (float) $line->gst_percent, 'tax_percent never became gst_percent');
        $this->assertEquals('DL-2401', $line->batch_no);
        $this->assertNotNull($line->product_id);

        $report = $migration->reconciliationReport;
        $this->assertGreaterThan(0.0, $report->tax_slab_comparison[12]['target_tax'],
            'the taxed year was filed under the 0% slab');
        $this->assertSame(0.0, (float) $report->tax_slab_comparison[0]['target_tax']);
    }

    public function test_a_credit_bill_is_filed_against_the_invoice_table_as_a_credit_note(): void
    {
        $this->migrate($this->legacySource());

        $note = Invoice::where('invoice_number', 'ADH-CN26-27-0040')->first();
        $this->assertNotNull($note, 'the credit bill never reached the document table');
        $this->assertEquals('credit_note', $note->module_key);
        // v2 keeps one sign convention and applies the reversal where it reads the row.
        $this->assertEquals('134.43', (string) $note->grand_total);
        $this->assertEquals('14.43', (string) $note->tax_total);
        $this->assertEquals('ADH-SAL-0001', $note->original_invoice_number);

        $noteLine = $note->items()->firstOrFail();
        $this->assertEquals(4.0, (float) $noteLine->qty);
        // cgst_percent + sgst_percent is a rate the source stated in two pieces.
        $this->assertEquals(12.00, (float) $noteLine->gst_percent);
        $this->assertEquals(7.22, (float) $noteLine->cgst_amount);
    }

    public function test_credit_bills_net_off_turnover_on_both_sides_of_the_comparison(): void
    {
        $migration = $this->migrate($this->legacySource());
        $report = $this->runLegacyReconcile($migration, $this->legacySource());

        // 67.20 sold, 134.43 returned.
        $this->assertEquals(-67.23, $report->financial_comparison['sales']['source']);
        $this->assertEquals(-67.23, $report->financial_comparison['sales']['target']);
        $this->assertEquals(0.00, $report->financial_comparison['sales']['diff']);
        $this->assertSame(1, $report->counts_comparison['source']['credit_notes']);
        $this->assertSame(1, $report->counts_comparison['target']['credit_notes']);
    }

    public function test_a_purchase_bill_under_legacy_keys_is_imported_rather_than_dropped(): void
    {
        $stats = (new MigrationPipelineRunner())->execute(
            MigrationRun::create([
                'store_id' => $this->store->id,
                'run_uuid' => (string) Str::uuid(),
                'source_type' => 'file',
                'status' => 'running',
            ]),
            $this->legacySource(),
            false
        );

        // Both legacy purchase rows carry a number the normalizer reads.
        $this->assertEquals(2, $stats['purchases']);
        $this->assertEquals(1, $stats['credit_notes']);

        $purchase = Purchase::where('invoice_number', 'PB-9948')->first();
        $this->assertNotNull($purchase, 'bill_no was never read as an invoice number');
        $this->assertEquals('received', $purchase->status);
        $this->assertEquals('32', $purchase->place_of_supply);
        $this->assertFalse((bool) $purchase->is_interstate);

        $line = PurchaseItem::where('purchase_id', $purchase->id)->firstOrFail();
        $this->assertEquals(20.00, (float) $line->purchase_rate, 'ptr never became the purchase rate');
        $this->assertEquals(12.00, (float) $line->gst_percent);
        $this->assertEquals('2028-06-30', $line->expiry_date->format('Y-m-d'));
    }

    public function test_a_bill_with_no_number_anywhere_becomes_a_review_item(): void
    {
        $source = $this->legacySource();
        unset($source['purchases'][1]['voucher_no']);

        $this->migrate($source);

        $review = MigrationUnresolvedItem::where('entity_type', 'document_number')
            ->where('old_id', '1002')
            ->firstOrFail();
        $this->assertStringContainsString('filed as MIGPUR-1002', $review->reason);

        // The bill's money, date and stock are real; only its number is ours. It is kept under a
        // number that announces itself as a migration's, not deleted for want of a label.
        $renumbered = Purchase::where('invoice_number', 'MIGPUR-1002')->first();
        $this->assertNotNull($renumbered, 'the unnumbered bill was thrown away instead of renumbered');
        $this->assertEquals(2, Purchase::count());
    }

    public function test_a_batch_stored_as_stock_and_ptr_opens_with_units_and_valuation(): void
    {
        $migration = $this->migrate($this->legacySource());
        $report = $this->runLegacyReconcile($migration, $this->legacySource());

        $batch = ProductBatch::firstOrFail();
        $this->assertEquals(1200.0, (float) $batch->stock_qty, 'the "1,200" quantity was never parsed');
        $this->assertEquals(20.00, (float) $batch->purchase_rate);
        $this->assertEquals('2028-06-30', $batch->expiry_date->format('Y-m-d'));
        $this->assertEquals(1200.0, $report->stock_comparison['total_stock_qty']);
        $this->assertEquals(24000.00, $report->stock_comparison['valuation']);
    }

    public function test_the_stated_tax_mode_is_written_where_the_till_actually_reads_it(): void
    {
        $this->migrate($this->legacySource());

        $billing = CompanySetting::where('store_id', $this->store->id)->where('key', 'billing')->first();
        $this->assertNotNull($billing, 'the billing section was never written');
        $this->assertEquals('exclusive', $billing->value['tax_mode']);
        $this->assertEquals('exclusive', $this->store->fresh()->tax_mode);
        $this->assertEquals('exclusive', (new StoreTaxPolicy())->forStore($this->store->id)['tax_mode']);
    }

    public function test_the_legacy_feature_menu_does_not_switch_off_the_v2_screens(): void
    {
        $this->store->update(['enabled_menu_items' => ['pos' => true, 'purchases' => true]]);

        $this->migrate($this->legacySource());

        $this->assertEquals(['pos' => true, 'purchases' => true], $this->store->fresh()->enabled_menu_items,
            'an empty legacy menu list overwrote the store\'s own feature flags');
    }

    public function test_a_source_that_names_no_quantity_column_is_blocked_before_it_is_imported(): void
    {
        $source = $this->legacySource();
        $source['product_batches'] = [['id' => 801, 'product_id' => 701, 'batch' => 'DL-2401', 'mrp' => 35]];

        $report = (new MigrationDiagnosticsService())->runPrecheck($source);

        $this->assertFalse($report['can_proceed']);
        $this->assertNotEmpty(array_filter(
            $report['issues'],
            fn ($i) => $i['type'] === 'error' && str_contains($i['message'], 'carries a quantity under any known key')
        ));
    }

    public function test_a_well_formed_legacy_export_passes_the_precheck(): void
    {
        $report = (new MigrationDiagnosticsService())->runPrecheck($this->legacySource());
        $messages = implode(' | ', array_column($report['issues'], 'message'));

        $this->assertTrue($report['can_proceed'], 'the reference export is blocked: ' . $messages);
        $this->assertSame([], array_values(array_filter(
            $report['issues'],
            fn ($i) => $i['type'] === 'error'
        )), 'errors on a clean export: ' . $messages);
        $this->assertSame([], array_values(array_filter(
            $report['issues'],
            fn ($i) => str_contains($i['message'], 'total variance')
        )), 'a tax-exclusive export was read as a missing line: ' . $messages);
    }

    public function test_a_line_states_tax_but_nothing_states_a_rate_is_blocked(): void
    {
        $source = $this->legacySource();
        // No taxable value on the line, no rate the bill's own totals imply, no catalog entry.
        $source['invoices'][0] = [
            'id' => 901, 'bill_no' => 'ADH-SAL-0001', 'bill_date' => '10/10/2026',
            'gst_total' => 7.20, 'bill_amount' => 67.20,
            'items' => [['product_id' => 799, 'name' => 'Unlisted Loose Strip', 'tax_amount' => 7.20]],
        ];

        $report = (new MigrationDiagnosticsService())->runPrecheck($source);
        $messages = implode(' | ', array_column($report['issues'], 'message'));

        $this->assertFalse($report['can_proceed'], 'pre-check let an unrateable taxed line through: ' . $messages);
        $this->assertNotEmpty(array_filter(
            $report['issues'],
            fn ($i) => $i['type'] === 'error' && str_contains($i['message'], 'no rate can be found')
        ), 'the unrateable line was not reported: ' . $messages);
    }

    public function test_a_line_naming_only_its_product_gets_its_rate_from_the_catalog(): void
    {
        $source = $this->legacySource();
        $source['invoices'][0]['items'][0] = [
            'product_id' => 701, 'name' => 'Dolo 650 Tablet', 'batch' => 'DL-2401',
            'quantity' => 2, 'rate' => 30.00,
        ];

        $report = (new MigrationDiagnosticsService())->runPrecheck($source);
        $messages = implode(' | ', array_column($report['issues'], 'message'));

        $this->assertTrue($report['can_proceed'], 'a rate the catalog can supply should not block: ' . $messages);
        $this->assertNotEmpty(array_filter(
            $report['issues'],
            fn ($i) => $i['type'] === 'warning' && str_contains($i['message'], 'taken from the product catalog')
        ), 'the recovered rate was never mentioned: ' . $messages);

        $this->migrate($source);
        $this->assertEquals(12.0, (float) InvoiceItem::where('qty', 2.0)->value('gst_percent'));
    }

    public function test_a_line_the_catalog_cannot_answer_is_filed_at_the_bills_own_average(): void
    {
        $source = $this->legacySource();
        $source['invoices'][0]['items'][0] = [
            'product_id' => 799, 'name' => 'Unlisted Loose Strip', 'quantity' => 2, 'rate' => 30.00,
        ];

        $report = (new MigrationDiagnosticsService())->runPrecheck($source);
        $messages = implode(' | ', array_column($report['issues'], 'message'));

        $this->assertTrue($report['can_proceed'], 'a rate the bill implies should not block: ' . $messages);
        $this->assertNotEmpty(array_filter(
            $report['issues'],
            fn ($i) => $i['type'] === 'warning' && str_contains($i['message'], 'average slab the bill itself implies')
        ), 'the averaged rate was never mentioned: ' . $messages);

        $this->migrate($source);
        $this->assertEquals(12.0, (float) InvoiceItem::where('qty', 2.0)->value('gst_percent'));
    }

    public function test_a_line_without_a_stated_total_derives_its_rate_from_the_net_figure(): void
    {
        $source = $this->legacySource();
        // 2 × 30 = 60 with 7.20 of tax on top: 12%. Reading the net figure as gross would give
        // 7.20 / 52.80 = 13.64%, a slab no item in the country is filed under.
        $source['invoices'][0]['items'][0] = [
            'product_id' => 799, 'name' => 'Unlisted Loose Strip', 'quantity' => 2,
            'rate' => 30.00, 'tax_amount' => 7.20,
        ];

        $this->migrate($source);
        $this->assertEquals(12.0, (float) InvoiceItem::where('qty', 2.0)->value('gst_percent'));
    }

    public function test_an_unnumbered_bill_is_named_at_precheck_instead_of_vanishing_after_run(): void
    {
        $source = $this->legacySource();
        unset($source['purchases'][1]['voucher_no']);

        $report = (new MigrationDiagnosticsService())->runPrecheck($source);

        // A bill that can still be traced to its old row is imported under a derived number, so
        // the pre-check warns and names that number instead of stopping the migration.
        $this->assertTrue($report['can_proceed']);
        $issues = array_values(array_filter(
            $report['issues'],
            fn ($i) => $i['type'] === 'warning' && str_contains($i['message'], 'no bill number')
        ));
        $this->assertCount(1, $issues);
        $this->assertStringContainsString('MIGPUR-1002', implode(', ', $issues[0]['details']));
    }

    public function test_a_bill_with_neither_a_number_nor_a_row_identity_blocks_precheck(): void
    {
        $source = $this->legacySource();
        unset($source['purchases'][1]['voucher_no'], $source['purchases'][1]['id']);

        $report = (new MigrationDiagnosticsService())->runPrecheck($source);

        $this->assertFalse($report['can_proceed']);
        $this->assertNotEmpty(array_filter(
            $report['issues'],
            fn ($i) => $i['type'] === 'error' && str_contains($i['message'], 'neither a bill number nor a row identity')
        ));
    }

    public function test_a_credit_bill_listed_in_both_tables_is_imported_once(): void
    {
        $source = $this->legacySource();
        $note = $source['sales_returns'][0];
        $note['id'] = 9999;
        $source['invoices'][] = $note;

        $this->migrate($source);

        $this->assertEquals(1, Invoice::where('invoice_number', 'ADH-CN26-27-0040')->count());
        $this->assertEquals(1, Invoice::where('module_key', 'credit_note')->count());
    }

    public function test_a_legacy_rounding_difference_is_reviewed_rather_than_blocking_cutover(): void
    {
        $source = $this->legacySource();
        // Priced inclusive, reported as if exclusive: the rupees are what the shop filed.
        $source['store_profile']['tax_type'] = 'inclusive';
        $migration = $this->migrate($source);

        $report = $this->runLegacyReconcile($migration, $source);

        $variances = array_filter($report->discrepancies, fn ($d) => $d['category'] === 'tax_engine_variance');
        $this->assertNotEmpty($variances, 'the audit stopped noticing a different tax basis');
        $this->assertEquals('warning', reset($variances)['severity']);
        $this->assertTrue($report->is_passed, 'a rounding disagreement held the cutover');
        $this->assertStringContainsString('inclusive mode', reset($variances)['message']);
    }

    public function test_a_dry_run_leaves_nothing_behind(): void
    {
        $this->migrate($this->legacySource(), true);

        $this->assertEquals(0, Invoice::count());
        $this->assertEquals(0, Purchase::count());
        $this->assertEquals(0, Product::count());
        $this->assertEquals(0, MigrationUnresolvedItem::count());
    }

    /**
     * The exact shape the running legacy panel answers with — batches nested inside each product,
     * a return kept as an invoice row tagged `sales_module_key`, purchase bills under
     * `purchase_documents` numbered `reference_no`, and lines carrying a percent but never a rupee
     * tax figure. It was reported live as "Batches & Stocks 0, Purchases 0" because each of those
     * spellings was read by a different name.
     */
    public function test_the_panels_own_pull_shape_reports_its_stocks_credit_bills_and_purchases(): void
    {
        $source = $this->panelPullShape();

        $report = (new MigrationDiagnosticsService())->runPrecheck($source, ['tax_mode' => 'exclusive']);

        $this->assertTrue($report['can_proceed'], print_r($report['issues'], true));
        $this->assertSame(1, $report['record_counts']['product_batches']);
        $this->assertSame(1, $report['record_counts']['purchases']);
        $this->assertSame(2, $report['record_counts']['sales_invoices']);
        $this->assertSame(1, $report['record_counts']['credit_bills']);

        $this->migrate($source);

        $batch = ProductBatch::firstOrFail();
        $this->assertEquals(34.00, (float) $batch->stock_qty, 'packs × units_per_pack + loose was never totalled');
        $this->assertEquals('2027-10-31', $batch->expiry_date->format('Y-m-d'));
        $this->assertEquals(118.00, (float) $batch->mrp);

        $note = Invoice::where('invoice_number', 'CN-26-0007')->firstOrFail();
        $this->assertSame('credit_note', $note->module_key);

        $purchase = Purchase::where('invoice_number', 'PUR-26-0031')->first();
        $this->assertNotNull($purchase, 'reference_no is still not being read as a purchase bill number');

        $line = PurchaseItem::where('purchase_id', $purchase->id)->firstOrFail();
        $this->assertEquals(88.00, (float) $line->purchase_rate);
        $this->assertEquals(12.00, (float) $line->gst_percent, 'a line stating gst_pct as a percent never became a slab');
        $this->assertEquals('Zerodol SP Tablet', $line->product_name, 'the item name lives in description');
    }

    /**
     * @return array<string, mixed>
     */
    private function panelPullShape(): array
    {
        return [
            'generated_at' => '2026-11-26 09:00:00',
            // The panel answers with one flat settings object, not v2's {key, value} rows — and it
            // holds no pricing switch at all, only a default rate, which is not an answer.
            'store_settings' => ['sync_mode' => 'hybrid', 'default_tax_rate' => 12.0],
            'products' => [[
                'id' => 901, 'external_id' => 'P-901', 'name' => 'Zerodol SP Tablet',
                'hsn_sac_code' => '30049099', 'mrp' => 118.00, 'selling_rate' => 106.00,
                'purchase_rate' => 88.00, 'cgst_percent' => 6.0, 'sgst_percent' => 6.0,
                'igst_percent' => 0.0, 'stock' => 40,
                'batches' => [[
                    'id' => 9101, 'external_id' => 'B-9101', 'batch_no' => 'ZD-2410',
                    'expiry_date' => '2027-10-31', 'packs' => 3, 'units_per_pack' => 10,
                    'loose_qty' => 4, 'mrp' => 118.00, 'purchase_rate' => 88.00, 'selling_rate' => 106.00,
                ]],
            ]],
            'customers' => [['id' => 911, 'external_id' => 'C-911', 'name' => 'Residency Apartments', 'current_balance' => 354.00]],
            'suppliers' => [['id' => 921, 'external_id' => 'S-921', 'name' => 'Central Distributors', 'current_balance' => 9856.00]],
            'invoices' => [
                [
                    'id' => 9201, 'external_id' => 'I-9201', 'invoice_number' => 'SAL-26-0001',
                    'invoice_date' => '2026-04-12', 'sales_module_key' => 'invoice',
                    'subtotal' => 318.00, 'tax_total' => 36.00, 'grand_total' => 354.00,
                    'paid_amount' => 354.00, 'payment_mode' => 'CASH', 'status' => 'posted',
                    'customer_id' => 911,
                    'items' => [[
                        'product_external_id' => 'P-901', 'batch_no' => 'ZD-2410', 'quantity' => 3,
                        'unit_price' => 106.00, 'tax_pct' => 12.000, 'tax_amount' => 36.00,
                        'line_total' => 354.00, 'hsn_code' => '30049099',
                    ]],
                ],
                [
                    'id' => 9202, 'external_id' => 'I-9202', 'invoice_number' => 'CN-26-0007',
                    'invoice_date' => '2026-05-02', 'sales_module_key' => 'credit-note',
                    'subtotal' => 106.00, 'tax_total' => 12.00, 'grand_total' => 118.00,
                    'status' => 'posted', 'customer_id' => 911,
                    'items' => [[
                        'product_external_id' => 'P-901', 'batch_no' => 'ZD-2410', 'quantity' => 1,
                        'unit_price' => 106.00, 'gst_percent' => 12.000, 'line_total' => 118.00,
                        'hsn_code' => '00000000',
                    ]],
                ],
            ],
            'purchase_documents' => [
                [
                    'id' => 9301, 'external_id' => 'PD-9301', 'reference_no' => 'PUR-26-0031',
                    'supplier_invoice_no' => 'CD/2026/8891', 'date' => '2026-03-20',
                    'module_key' => 'purchase-bill', 'subtotal' => 8800.00, 'tax_total' => 1056.00,
                    'discount_amount' => 0.00, 'round_off' => 0.00, 'grand_total' => 9856.00,
                    'amount_paid' => 9856.00, 'status' => 'received', 'payment_mode' => 'UPI',
                    'origin' => 'manual', 'supplier_id' => 921,
                    'items' => [[
                        'product_external_id' => 'P-901', 'description' => 'Zerodol SP Tablet',
                        'qty' => 100, 'unit_price' => 88.00, 'gst_pct' => 12.000, 'cess_pct' => 0.000,
                        'line_total' => 9856.00, 'batch_no' => 'ZD-2410', 'expiry_date' => '2027-10-31',
                        'packs' => 10, 'units_per_pack' => 10, 'mrp' => 118.00, 'sale_price' => 106.00,
                    ]],
                ],
            ],
        ];
    }

    private function runLegacyReconcile(MigrationRun $migration, array $source)
    {
        return (new MigrationReconciliationService())->reconcile($migration, $source);
    }
}

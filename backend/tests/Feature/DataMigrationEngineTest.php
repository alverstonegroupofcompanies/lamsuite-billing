<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\MasterLookup;
use App\Models\MigrationRun;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\User;
use App\Services\Migration\MigrationDiagnosticsService;
use App\Services\Migration\MigrationPipelineRunner;
use App\Services\Migration\MigrationReconciliationService;
use App\Services\Migration\MigrationRollbackService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class DataMigrationEngineTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private array $sampleSource;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Alverstone Test Pharmacy',
            'code' => 'STR-TEST',
            'gstin' => '32ABCDE1234F1Z5',
            'state_code' => '32',
        ]);

        $this->sampleSource = [
            'store_profile' => [
                'name' => 'Alverstone Test Pharmacy',
                'phone' => '9847000000',
                'email' => 'store@alverstone.test',
                'address' => 'Main Road, Ernakulam, Kerala',
                'gstin' => '32ABCDE1234F1Z5',
                'state_code' => '32',
                'tax_mode' => 'inclusive',
            ],
            'groups' => [
                ['id' => 101, 'name' => 'Analgesics', 'code' => 'GRP-ANA'],
            ],
            'brands' => [
                ['id' => 201, 'name' => 'GSK Pharma'],
            ],
            'units' => [
                ['id' => 301, 'name' => 'STRIP', 'code' => 'STP', 'units_per_pack' => 10],
            ],
            'customers' => [
                [
                    'id' => 401,
                    'name' => 'Vipin Kumar',
                    'phone' => '9876543210',
                    'gstin' => '32VABCD1234F1Z1',
                    'opening_balance' => 500.00,
                    'current_balance' => 500.00,
                ],
            ],
            'suppliers' => [
                [
                    'id' => 501,
                    'name' => 'Central Med Distributors',
                    'gstin' => '32CMDDE1234F1Z8',
                    'phone' => '9847111222',
                    'opening_balance' => 12000.00,
                ],
            ],
            'users' => [
                [
                    'id' => 601,
                    'name' => 'Manager John',
                    'email' => 'john.manager@store.test',
                    'role' => 'manager',
                    'password' => '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // valid bcrypt
                ],
            ],
            'products' => [
                [
                    'id' => 701,
                    'name' => 'Crocin 650 Tablet',
                    'barcode' => '8901234567890',
                    'category_id' => 101,
                    'brand_id' => 201,
                    'unit_id' => 301,
                    'hsn_sac_code' => '30049099',
                    'mrp' => 35.00,
                    'sel_rate' => 30.00,
                    'ptr' => 22.00,
                    'gst_percent' => 12.00,
                    'units_per_pack' => 10,
                ],
            ],
            'product_batches' => [
                [
                    'id' => 801,
                    'product_id' => 701,
                    'batch_no' => 'CR-BATCH-01',
                    'expiry_date' => '2028-06-30',
                    'stock_qty' => 150,
                    'mrp' => 35.00,
                    'purchase_rate' => 20.00,
                    'selling_rate' => 30.00,
                ],
                [
                    'id' => 802,
                    'product_id' => 701,
                    'batch_no' => 'CR-NEG-01',
                    'expiry_date' => '2027-12-31',
                    'stock_qty' => -5, // Negative stock test case
                    'mrp' => 35.00,
                    'purchase_rate' => 20.00,
                    'selling_rate' => 30.00,
                ],
            ],
            'invoices' => [
                [
                    'id' => 901,
                    'invoice_number' => 'INV-2026-001',
                    'invoice_date' => '2026-10-10',
                    'customer_id' => 401,
                    'subtotal' => 60.00,
                    'tax_total' => 7.20,
                    'round_off' => 0.00,
                    'grand_total' => 67.20,
                    'paid_amount' => 67.20,
                    'payment_mode' => 'UPI',
                    'status' => 'issued',
                    'items' => [
                        [
                            'product_id' => 701,
                            'product_name' => 'Crocin 650 Tablet',
                            'batch_no' => 'CR-BATCH-01',
                            'qty' => 2,
                            'unit_price' => 30.00,
                            'gst_percent' => 12.00,
                            'tax_amount' => 7.20,
                            'total_amount' => 67.20,
                        ],
                    ],
                ],
            ],
            'purchases' => [
                [
                    'id' => 1001,
                    'invoice_number' => 'PB-9948',
                    'invoice_date' => '2026-10-01',
                    'supplier_id' => 501,
                    'subtotal' => 2000.00,
                    'tax_total' => 240.00,
                    'round_off' => 0.00,
                    'grand_total' => 2240.00,
                    'paid_amount' => 2240.00,
                    'items' => [
                        [
                            'product_id' => 701,
                            'product_name' => 'Crocin 650 Tablet',
                            'batch_no' => 'CR-BATCH-01',
                            'qty' => 100,
                            'purchase_rate' => 20.00,
                            'gst_percent' => 12.00,
                            'tax_amount' => 240.00,
                            'total_amount' => 2240.00,
                        ],
                    ],
                ],
            ],
            'device_holds' => [
                [
                    'id' => 'hold-xyz-1',
                    'label' => 'Held POS Customer A',
                    'payload' => [
                        'customerName' => 'Walk-in Held',
                        'items' => [
                            ['name' => 'Crocin 650 Tablet', 'qty' => 1, 'unitPrice' => 30.00],
                        ],
                    ],
                ],
            ],
        ];
    }

    public function test_precheck_detects_counts_and_negative_stock(): void
    {
        $diagnostics = new MigrationDiagnosticsService();
        $report = $diagnostics->runPrecheck($this->sampleSource);

        $this->assertTrue($report['can_proceed']);
        $this->assertEquals(1, $report['record_counts']['products']);
        $this->assertEquals(2, $report['record_counts']['product_batches']);
        $this->assertEquals(1, $report['record_counts']['invoices']);

        // Check that negative stock was flagged as warning
        $warnings = array_filter($report['issues'], fn($i) => $i['category'] === 'inventory');
        $this->assertNotEmpty($warnings);
    }

    public function test_pipeline_executes_dependency_order_and_idempotent(): void
    {
        $runner = new MigrationPipelineRunner();
        $run = MigrationRun::create([
            'store_id' => $this->store->id,
            'run_uuid' => (string)Str::uuid(),
            'source_type' => 'file',
            'status' => 'running',
        ]);

        $stats = $runner->execute($run, $this->sampleSource, false);

        $this->assertEquals(1, $stats['products']);
        $this->assertEquals(2, $stats['batches']);
        $this->assertEquals(1, $stats['invoices']);
        $this->assertEquals(1, $stats['purchases']);
        $this->assertEquals(1, $stats['held_bills']);

        // Verify entities created in database
        $product = Product::where('store_id', $this->store->id)->where('barcode', '8901234567890')->first();
        $this->assertNotNull($product);
        $this->assertEquals('Crocin 650 Tablet', $product->name);

        $batches = ProductBatch::where('product_id', $product->id)->get();
        $this->assertCount(2, $batches);

        $invoice = Invoice::where('store_id', $this->store->id)->where('invoice_number', 'INV-2026-001')->first();
        $this->assertNotNull($invoice);
        $this->assertEquals('67.20', (string)$invoice->grand_total);
        $this->assertEquals(1, $invoice->items()->count());

        // Verify held bill converted to draft invoice
        $draftInvoice = Invoice::where('store_id', $this->store->id)->where('status', 'draft')->first();
        $this->assertNotNull($draftInvoice);

        // IDEMPOTENCY TEST: Run execution second time with same run UUID
        $statsSecond = $runner->execute($run, $this->sampleSource, false);
        $this->assertEquals(1, Product::where('store_id', $this->store->id)->count());
        $this->assertEquals(2, ProductBatch::where('product_id', $product->id)->count());
        $this->assertEquals(1, Invoice::where('invoice_number', 'INV-2026-001')->count());
    }

    public function test_reconciliation_verifies_financials_to_paisa(): void
    {
        $runner = new MigrationPipelineRunner();
        $run = MigrationRun::create([
            'store_id' => $this->store->id,
            'run_uuid' => (string)Str::uuid(),
            'source_type' => 'file',
            'status' => 'running',
        ]);
        $runner->execute($run, $this->sampleSource, false);

        $reconciler = new MigrationReconciliationService();
        $report = $reconciler->reconcile($run, $this->sampleSource);

        $this->assertTrue($report->is_passed);
        $fin = $report->financial_comparison;
        $this->assertEquals(67.20, $fin['sales']['source']);
        $this->assertEquals(67.20, $fin['sales']['target']);
        $this->assertEquals(0.00, $fin['sales']['diff']);

        $this->assertEquals(2240.00, $fin['purchases']['source']);
        $this->assertEquals(2240.00, $fin['purchases']['target']);
        $this->assertEquals(0.00, $fin['purchases']['diff']);
    }

    public function test_rollback_undoes_all_migrated_entities(): void
    {
        $runner = new MigrationPipelineRunner();
        $run = MigrationRun::create([
            'store_id' => $this->store->id,
            'run_uuid' => (string)Str::uuid(),
            'source_type' => 'file',
            'status' => 'running',
        ]);
        $runner->execute($run, $this->sampleSource, false);

        $this->assertGreaterThan(0, Product::where('store_id', $this->store->id)->count());
        $this->assertGreaterThan(0, Invoice::where('store_id', $this->store->id)->count());

        $rollbackService = new MigrationRollbackService();
        $res = $rollbackService->rollback($run);

        $this->assertGreaterThan(0, $res['invoices_deleted']);
        $this->assertGreaterThan(0, $res['products_deleted']);

        $this->assertEquals(0, Product::where('store_id', $this->store->id)->count());
        $this->assertEquals(0, Invoice::where('store_id', $this->store->id)->count());
        $this->assertEquals('rolled_back', $run->fresh()->status);
    }
}

<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * UI-03 (G8-UI) backfill: expiries that return round trips stored one or more days early.
 */
class ExpiryDateRepairCommandTest extends TestCase
{
    use RefreshDatabase;

    private ?string $journalBackup = null;

    private int $saleItem;
    private int $saleTimestampItem;
    private int $saleOddItem;
    private int $creditTimestampItem;
    private int $creditTruncatedItem;
    private int $purchaseItem;
    private int $debitItem;

    private function journalPath(): string
    {
        return storage_path('app/expiry-date-repair.json');
    }

    protected function setUp(): void
    {
        parent::setUp();

        $journal = $this->journalPath();
        if (file_exists($journal)) {
            $this->journalBackup = (string) file_get_contents($journal);
            unlink($journal);
        }

        $store = Store::create(['name' => 'Repair Pharmacy', 'code' => 'REP-1', 'state_code' => '32', 'is_active' => true]);
        $product = Product::create([
            'store_id' => $store->id, 'name' => 'Cetirizine 10mg', 'mrp' => 50, 'sel_rate' => 45,
            'gst_percent' => 12, 'units_per_pack' => 10, 'current_stock' => 0, 'is_active' => true,
        ]);
        foreach (['B1' => '2027-03-31', 'B2' => '2026-12-31'] as $batchNo => $expiry) {
            ProductBatch::create([
                'store_id' => $store->id, 'product_id' => $product->id, 'batch_no' => $batchNo,
                'expiry_date' => $expiry, 'stock_qty' => 0, 'mrp' => 50, 'selling_rate' => 45,
            ]);
        }

        $invoice = fn (string $number, string $module, ?string $original = null) => DB::table('invoices')->insertGetId([
            'store_id' => $store->id, 'module_key' => $module, 'invoice_number' => $number,
            'invoice_date' => '2026-11-20', 'customer_name' => 'Walk-in Customer', 'status' => 'issued',
            'original_invoice_number' => $original, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $line = fn (int $invoiceId, string $batchNo, string $expiry) => DB::table('invoice_items')->insertGetId([
            'invoice_id' => $invoiceId, 'product_id' => $product->id, 'product_name' => $product->name,
            'batch_no' => $batchNo, 'expiry_date' => $expiry, 'qty' => 1, 'unit_price' => 45,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $sale = $invoice('INV-REP-1', 'invoice');
        $this->saleItem = $line($sale, 'B1', '2027-03-31 00:00:00');
        // A sale line that disagrees with today's batch is history, not damage: reported only.
        $this->saleOddItem = $line($sale, 'B2', '2026-11-30');
        $otherSale = $invoice('INV-REP-2', 'invoice');
        $this->saleTimestampItem = $line($otherSale, 'B1', '2027-03-30 18:30:00');

        $creditNote = $invoice('CN-REP-1', 'credit_note', 'INV-REP-1');
        // SQLite kept the UTC instant; MySQL truncated a second round trip to a bare, earlier day.
        $this->creditTimestampItem = $line($creditNote, 'B1', '2027-03-30 18:30:00');
        $secondCreditNote = $invoice('CN-REP-2', 'credit_note', 'INV-REP-1');
        $this->creditTruncatedItem = $line($secondCreditNote, 'B1', '2027-03-29');

        $purchase = fn (string $module) => DB::table('purchases')->insertGetId([
            'store_id' => $store->id, 'supplier_name' => 'QA Distributors', 'invoice_number' => 'PB-' . $module,
            'invoice_date' => '2026-11-01', 'module_key' => $module, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $purchaseLine = fn (int $purchaseId, string $expiry, ?int $original = null) => DB::table('purchase_items')->insertGetId([
            'purchase_id' => $purchaseId, 'product_id' => $product->id, 'product_name' => $product->name,
            'batch_no' => 'B1', 'expiry_date' => $expiry, 'original_purchase_item_id' => $original,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->purchaseItem = $purchaseLine($purchase('purchase'), '2027-03-31');
        $this->debitItem = $purchaseLine($purchase('debit_note'), '2027-03-30', $this->purchaseItem);
    }

    protected function tearDown(): void
    {
        $journal = $this->journalPath();
        if (file_exists($journal)) {
            unlink($journal);
        }
        if ($this->journalBackup !== null) {
            file_put_contents($journal, $this->journalBackup);
        }

        parent::tearDown();
    }

    private function raw(string $table, int $id): string
    {
        return (string) DB::table($table)->where('id', $id)->value('expiry_date');
    }

    public function test_dry_run_reports_without_writing(): void
    {
        $this->artisan('lamsuite:expiry-date-repair', ['--dry-run' => true])
            ->expectsOutputToContain('Dry run: would repair 2 return lines and 2 timestamped expiries (nothing written)')
            ->assertSuccessful();

        $this->assertSame('2027-03-30 18:30:00', $this->raw('invoice_items', $this->creditTimestampItem));
        $this->assertSame('2027-03-29', $this->raw('invoice_items', $this->creditTruncatedItem));
        $this->assertFileDoesNotExist($this->journalPath());
    }

    public function test_apply_restores_return_lines_and_normalises_timestamps_only(): void
    {
        $this->artisan('lamsuite:expiry-date-repair', ['--apply' => true])->assertSuccessful();

        $this->assertSame('2027-03-31', $this->raw('invoice_items', $this->creditTimestampItem));
        $this->assertSame('2027-03-31', $this->raw('invoice_items', $this->creditTruncatedItem));
        $this->assertSame('2027-03-31', $this->raw('invoice_items', $this->saleTimestampItem));
        $this->assertSame('2027-03-31', $this->raw('purchase_items', $this->debitItem));

        // Untouched: an already-correct day, and a sale line that only differs from today's batch.
        $this->assertSame('2027-03-31 00:00:00', $this->raw('invoice_items', $this->saleItem));
        $this->assertSame('2026-11-30', $this->raw('invoice_items', $this->saleOddItem));
        $this->assertSame('2027-03-31', $this->raw('purchase_items', $this->purchaseItem));

        $this->assertFileExists($this->journalPath());
    }

    public function test_a_second_apply_finds_nothing(): void
    {
        $this->artisan('lamsuite:expiry-date-repair', ['--apply' => true])->assertSuccessful();

        $this->artisan('lamsuite:expiry-date-repair', ['--apply' => true])
            ->expectsOutputToContain('Repaired 0 return lines and 0 timestamped expiries')
            ->assertSuccessful();
    }

    public function test_rollback_restores_the_original_values(): void
    {
        $this->artisan('lamsuite:expiry-date-repair', ['--apply' => true])->assertSuccessful();
        $this->artisan('lamsuite:expiry-date-repair', ['--rollback' => true])->assertSuccessful();

        $this->assertSame('2027-03-30 18:30:00', $this->raw('invoice_items', $this->creditTimestampItem));
        $this->assertSame('2027-03-29', $this->raw('invoice_items', $this->creditTruncatedItem));
        $this->assertSame('2027-03-30 18:30:00', $this->raw('invoice_items', $this->saleTimestampItem));
        $this->assertSame('2027-03-30', $this->raw('purchase_items', $this->debitItem));
    }
}

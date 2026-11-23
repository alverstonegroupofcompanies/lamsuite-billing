<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use App\Models\TransferProductMapping;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

/**
 * G2-STOCK repair paths. These three commands clean the data STK-01, STK-02 and
 * PRD-01 already wrote into live databases, so every one of them must show its
 * work before it writes anything.
 */
class StockBackfillCommandTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Backfill Store',
            'code' => 'BF01',
            'gst_type' => 'regular',
            'tax_mode' => 'exclusive',
            'state_code' => '32',
            'is_active' => true,
        ]);
    }

    private function product(array $overrides = []): Product
    {
        return Product::create(array_merge([
            'store_id' => $this->store->id,
            'name' => 'Backfill Tablet',
            'hsn_sac_code' => '30049099',
            'current_stock' => 0,
            'mrp' => 100.00,
            'sel_rate' => 90.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 10,
            'is_active' => true,
        ], $overrides));
    }

    private function batch(Product $product, array $overrides = []): ProductBatch
    {
        return ProductBatch::create(array_merge([
            'store_id' => $product->store_id,
            'product_id' => $product->id,
            'batch_no' => 'BATCH-1',
            'expiry_date' => '2029-01-31',
            'stock_qty' => 0,
            'mrp' => 100.00,
            'selling_rate' => 90.00,
        ], $overrides));
    }

    /** Mark the product as created in Masters, the way AdminMasterController logs it. */
    private function createdInMasters(Product $product): Product
    {
        \App\Models\AuditLog::create([
            'store_id' => $product->store_id,
            'action' => 'create_product',
            'entity_type' => 'Product',
            'entity_id' => (string) $product->id,
        ]);

        return $product;
    }

    private function artisanOutput(string $command, array $args = []): string
    {
        Artisan::call($command, $args);

        return Artisan::output();
    }

    public function test_opening_backfill_dry_run_writes_nothing(): void
    {
        $product = $this->createdInMasters($this->product(['current_stock' => 0]));
        $this->batch($product, ['stock_qty' => 40]);

        $output = $this->artisanOutput('stock:backfill-opening');

        $this->assertStringContainsString('Dry run: 1 product(s) would change', $output);
        $this->assertSame(0, StockLedgerEntry::count(), 'A dry run may not post ledger rows');
        $this->assertEquals(0.0, (float) $product->fresh()->current_stock, 'A dry run may not move stock');
    }

    public function test_opening_backfill_reconciles_stock_and_posts_the_missing_ledger_row(): void
    {
        $product = $this->createdInMasters($this->product(['current_stock' => 0]));
        $batch = $this->batch($product, ['batch_no' => 'CS-A1', 'stock_qty' => 40]);

        $output = $this->artisanOutput('stock:backfill-opening', ['--apply' => true]);

        $this->assertStringContainsString('Reconciled 1 product(s)', $output);
        $this->assertEquals(40.0, (float) $product->fresh()->current_stock);

        $entry = StockLedgerEntry::where('batch_id', $batch->id)->sole();
        $this->assertSame('OPENING_STOCK', $entry->event_type);
        $this->assertEquals(40.0, (float) $entry->qty_delta);
        $this->assertSame("opening_stock_batch_{$batch->id}", $entry->idempotency_key);

        $repeat = $this->artisanOutput('stock:backfill-opening', ['--apply' => true]);

        $this->assertStringContainsString('Nothing to backfill', $repeat);
        $this->assertSame(1, StockLedgerEntry::where('batch_id', $batch->id)->count(), 'A second run must not double-post');
        $this->assertEquals(40.0, (float) $product->fresh()->current_stock);
    }

    public function test_opening_backfill_never_zeroes_stock_it_cannot_explain(): void
    {
        $product = $this->product(['name' => 'Loose Stock Product', 'current_stock' => 12]);

        $output = $this->artisanOutput('stock:backfill-opening', ['--apply' => true]);

        $this->assertStringContainsString('hold stock with no batch', $output);
        $this->assertEquals(12.0, (float) $product->fresh()->current_stock, 'Stock without a batch is reported, not erased');
        $this->assertSame(0, StockLedgerEntry::count());
    }

    public function test_opening_backfill_fills_the_gap_on_a_batch_that_has_since_sold(): void
    {
        $product = $this->createdInMasters($this->product(['current_stock' => 0]));
        $batch = $this->batch($product, ['batch_no' => 'CS-A1', 'stock_qty' => 35]);
        StockLedgerEntry::create([
            'store_id' => $product->store_id,
            'product_id' => $product->id,
            'batch_id' => $batch->id,
            'event_type' => 'SALE',
            'qty_delta' => -5,
            'balance_after' => 35,
        ]);

        $this->artisanOutput('stock:backfill-opening', ['--apply' => true]);

        $opening = StockLedgerEntry::where('batch_id', $batch->id)->where('event_type', 'OPENING_STOCK')->sole();
        $this->assertEquals(40.0, (float) $opening->qty_delta, 'Opening = what the batch holds + what it has sold');
        $this->assertEquals(35.0, (float) StockLedgerEntry::where('batch_id', $batch->id)->sum('qty_delta'));
        $this->assertEquals(35.0, (float) $product->fresh()->current_stock);
    }

    public function test_opening_backfill_only_reports_gaps_it_cannot_prove_were_opening_stock(): void
    {
        // A batch nobody created in Masters (e.g. a purchase that skipped the ledger).
        $product = $this->product(['current_stock' => 20]);
        $batch = $this->batch($product, ['batch_no' => 'PUR-1', 'stock_qty' => 20]);

        $output = $this->artisanOutput('stock:backfill-opening', ['--apply' => true]);

        $this->assertStringContainsString('reported only', $output);
        $this->assertStringContainsString('PUR-1', $output);
        $this->assertSame(0, StockLedgerEntry::where('batch_id', $batch->id)->count(), 'No invented opening row');
    }

    public function test_phantom_prune_keeps_a_batch_a_bill_names(): void
    {
        $product = $this->product(['name' => 'Billed Phantom']);
        $batch = $this->phantomBatch($product);
        // The test transaction is rolled back, so a deferred invoice FK is never checked.
        \Illuminate\Support\Facades\DB::statement('PRAGMA defer_foreign_keys = ON');
        \Illuminate\Support\Facades\DB::table('invoice_items')->insert($this->invoiceItemRow($product, $batch->batch_no));

        $this->artisanOutput('stock:prune-phantom-batches', ['--apply' => true]);

        $this->assertDatabaseHas('product_batches', ['id' => $batch->id]);
    }

    /** The smallest invoice_items row this schema accepts, filled from its columns. */
    private function invoiceItemRow(Product $product, string $batchNo): array
    {
        $row = [];
        foreach (\Illuminate\Support\Facades\Schema::getColumns('invoice_items') as $column) {
            $name = $column['name'];
            if ($name === 'id' || $column['nullable'] || $column['default'] !== null) {
                continue;
            }
            $row[$name] = str_contains($column['type_name'], 'char') || str_contains($column['type_name'], 'text') ? 'x' : 1;
        }

        return array_merge($row, [
            'product_id' => $product->id,
            'batch_no' => $batchNo,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_phantom_prune_dry_run_keeps_the_batch(): void
    {
        $product = $this->product(['name' => 'Phantom Host']);
        $this->phantomBatch($product);

        $output = $this->artisanOutput('stock:prune-phantom-batches');

        $this->assertStringContainsString('Dry run: 1 phantom batch(es) would be deleted', $output);
        $this->assertSame(1, ProductBatch::count());
    }

    public function test_phantom_prune_deletes_only_the_invented_opening_batch(): void
    {
        $phantom = $this->product(['name' => 'Phantom Host', 'barcode' => '8901000000017']);
        $phantomBatch = $this->phantomBatch($phantom);

        // Same batch number and no stock, but a real expiry the owner typed.
        $kept = $this->product(['name' => 'Named Expiry', 'barcode' => '8901000000024']);
        $this->batch($kept, ['batch_no' => 'B1', 'stock_qty' => 0, 'expiry_date' => '2029-06-30']);

        // A batch that the ledger has already touched is part of the history.
        $tracked = $this->product(['name' => 'Tracked Batch', 'barcode' => '8901000000031']);
        $trackedBatch = $this->phantomBatch($tracked);
        StockLedgerEntry::create([
            'store_id' => $tracked->store_id,
            'product_id' => $tracked->id,
            'batch_id' => $trackedBatch->id,
            'event_type' => 'SALE',
            'qty_delta' => -5,
            'balance_after' => 0,
        ]);

        $output = $this->artisanOutput('stock:prune-phantom-batches', ['--apply' => true]);

        $this->assertStringContainsString('Deleted 1 phantom batch(es)', $output);
        $this->assertDatabaseMissing('product_batches', ['id' => $phantomBatch->id]);
        $this->assertDatabaseHas('product_batches', ['id' => ProductBatch::where('product_id', $kept->id)->value('id')]);
        $this->assertDatabaseHas('product_batches', ['id' => $trackedBatch->id]);
    }

    public function test_transfer_mapping_audit_reports_the_bad_pair_before_deleting_it(): void
    {
        $sender = $this->product(['name' => 'QA Paracet 500', 'barcode' => '8909000000011']);
        $otherSender = $this->product(['name' => 'QA Zinc Syrup', 'barcode' => '8909000000099']);
        $receiverStore = Store::create([
            'name' => 'Mapping Store',
            'code' => 'BF02',
            'gst_type' => 'regular',
            'tax_mode' => 'exclusive',
            'state_code' => '32',
            'is_active' => true,
        ]);
        $wrong = $this->product([
            'store_id' => $receiverStore->id,
            'name' => 'QA Glow Face Cream',
            'barcode' => '8909000000011',
            'hsn_sac_code' => '33049999',
            'units_per_pack' => 1,
        ]);
        $right = $this->product([
            'store_id' => $receiverStore->id,
            'name' => 'QA Paracet 500 (branch)',
            'barcode' => '8909000000028',
        ]);

        $bad = TransferProductMapping::create([
            'from_store_id' => $this->store->id,
            'to_store_id' => $receiverStore->id,
            'source_product_id' => $sender->id,
            'dest_product_id' => $wrong->id,
            'matched_by' => 'barcode',
        ]);
        $good = TransferProductMapping::create([
            'from_store_id' => $this->store->id,
            'to_store_id' => $receiverStore->id,
            'source_product_id' => $otherSender->id,
            'dest_product_id' => $right->id,
            'matched_by' => 'manual',
        ]);

        StockLedgerEntry::create([
            'store_id' => $receiverStore->id,
            'product_id' => $wrong->id,
            'event_type' => 'TRANSFER_IN',
            'qty_delta' => 30,
            'reference_type' => 'STOCK_TRANSFER',
            'reference_id' => 'TR-1',
            'balance_after' => 30,
        ]);

        // A pairing an owner chose on purpose also disagrees, but receive honours it.
        $chosenByHand = TransferProductMapping::create([
            'from_store_id' => $this->store->id,
            'to_store_id' => $receiverStore->id,
            'source_product_id' => $this->product(['name' => 'QA Third Sender', 'barcode' => '8909000000073'])->id,
            'dest_product_id' => $wrong->id,
            'matched_by' => 'manual',
        ]);

        $output = $this->artisanOutput('stock:audit-transfer-mappings');

        $this->assertStringContainsString('QA Glow Face Cream', $output);
        $this->assertStringContainsString('HSN/SAC 30049099 vs 33049999', $output);
        $this->assertStringContainsString('30.000', $output);
        $this->assertStringContainsString('Dry run: 2 mapping(s) pair different articles, 1 of them machine-remembered', $output);
        $this->assertSame(3, TransferProductMapping::count());

        $output = $this->artisanOutput('stock:audit-transfer-mappings', ['--delete-mappings' => true]);

        $this->assertStringContainsString('Forgot 1 machine-remembered mapping(s)', $output);
        $this->assertStringContainsString('1 mapping(s) a person chose also disagree and were kept', $output);
        $this->assertDatabaseMissing('transfer_product_mappings', ['id' => $bad->id]);
        $this->assertDatabaseHas('transfer_product_mappings', ['id' => $good->id]);
        $this->assertDatabaseHas('transfer_product_mappings', ['id' => $chosenByHand->id]);
        $this->assertSame(1, StockLedgerEntry::count(), 'Auditing a mapping never moves stock');
    }

    private function phantomBatch(Product $product): ProductBatch
    {
        $batch = $this->batch($product, [
            'batch_no' => 'B1',
            'stock_qty' => 0,
            'expiry_date' => '2027-11-22',
        ]);

        ProductBatch::where('id', $batch->id)->update(['created_at' => '2026-11-22 09:00:00']);

        return $batch->fresh();
    }
}

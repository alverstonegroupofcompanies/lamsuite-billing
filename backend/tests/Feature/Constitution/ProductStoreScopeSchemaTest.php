<?php

namespace Tests\Feature\Constitution;

use App\Models\Product;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * P-STORE-SCOPE constitution guard — see specs/constitution.md.
 * Fails CI when the schema drifts away from per-store product ownership.
 */
class ProductStoreScopeSchemaTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SB', 'state_code' => '32', 'is_active' => true]);
    }

    /** R1: products.store_id is NOT NULL, FK to stores. */
    public function test_products_have_mandatory_store_id(): void
    {
        $this->assertTrue(Schema::hasColumn('products', 'store_id'));

        $indexes = $this->indexMap('products');
        $this->assertArrayHasKey('products_store_id_barcode_unique', $indexes, 'R2: per-store barcode unique index missing');

        // NOT NULL enforcement: inserting without store_id must fail.
        $this->expectException(\Throwable::class);
        DB::table('products')->insert([
            'name' => 'Orphan Product',
            'barcode' => 'ORPHAN-1',
            'mrp' => 10,
            'sel_rate' => 8,
            'gst_percent' => 12,
        ]);
    }

    /** R2: barcode unique within store, but the same barcode may exist in another store. */
    public function test_barcode_unique_within_store_only(): void
    {
        $productA = Product::create([
            'store_id' => $this->storeA->id,
            'name' => 'Paracetamol 500',
            'barcode' => '8901234567890',
            'mrp' => 20,
            'sel_rate' => 18,
            'gst_percent' => 12,
        ]);
        $this->assertNotNull($productA->id);

        // Same barcode in another store is legal — two independent products.
        $productB = Product::create([
            'store_id' => $this->storeB->id,
            'name' => 'Paracetamol 500 (Store B)',
            'barcode' => '8901234567890',
            'mrp' => 22,
            'sel_rate' => 19,
            'gst_percent' => 12,
        ]);
        $this->assertNotNull($productB->id);

        // Duplicate barcode in the SAME store must be impossible at the data layer.
        $this->expectException(\Throwable::class);
        Product::create([
            'store_id' => $this->storeA->id,
            'name' => 'Paracetamol 500 Duplicate',
            'barcode' => '8901234567890',
            'mrp' => 20,
            'sel_rate' => 18,
            'gst_percent' => 12,
        ]);
    }

    /** R5: no central-catalogue linkage columns survive. */
    public function test_no_publication_linkage_columns(): void
    {
        $this->assertFalse(
            Schema::hasColumn('products', 'product_family_id'),
            'product_family_id (central catalogue family link) must not exist'
        );
        $this->assertFalse(
            Schema::hasColumn('products', 'source_product_id'),
            'source_product_id (publish parent link) must not exist'
        );
    }

    /** R3: a batch cannot belong to a different store than its product. */
    public function test_cross_store_batch_is_impossible(): void
    {
        $productA = Product::create([
            'store_id' => $this->storeA->id,
            'name' => 'Store A Item',
            'barcode' => 'A-BATCH-1',
            'gst_percent' => 12,
        ]);

        $this->expectException(\Throwable::class);
        DB::table('product_batches')->insert([
            'store_id' => $this->storeB->id,
            'product_id' => $productA->id,
            'batch_no' => 'B-1',
            'expiry_date' => '2030-01-01',
            'stock_qty' => 10,
        ]);
    }

    /** R4: transfer items are store-scoped to the sending store's product. */
    public function test_transfer_items_store_scoped(): void
    {
        $this->assertTrue(Schema::hasColumn('stock_transfer_items', 'store_id'), 'stock_transfer_items must carry store_id');
        $this->assertTrue(Schema::hasColumn('price_list_items', 'store_id'), 'price_list_items must carry store_id');

        $productA = Product::create([
            'store_id' => $this->storeA->id,
            'name' => 'Store A Transfer Item',
            'barcode' => 'A-TR-1',
            'gst_percent' => 12,
        ]);
        $transferId = DB::table('stock_transfers')->insertGetId([
            'from_store_id' => $this->storeA->id,
            'to_store_id' => $this->storeB->id,
            'transfer_number' => 'TR-1',
            'status' => 'dispatched',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->expectException(\Throwable::class);
        DB::table('stock_transfer_items')->insert([
            'stock_transfer_id' => $transferId,
            'store_id' => $this->storeB->id,
            'product_id' => $productA->id,
            'batch_no' => 'B-1',
            'qty' => 1,
        ]);
    }

    /** R4: ledger rows are store-scoped (column present, FK to stores). */
    public function test_ledger_entries_store_scoped(): void
    {
        $this->assertTrue(Schema::hasColumn('stock_ledger_entries', 'store_id'));

        $indexes = $this->indexMap('stock_ledger_entries');
        $this->assertTrue(
            isset($indexes['stock_ledger_entries_store_id_product_id_index'])
                || isset($indexes['stock_ledger_entries_store_id_index']),
            'stock_ledger_entries should be queryable per store+product'
        );
    }

    /** The units carve-out: common lookups may be shared (nullable store_id). */
    public function test_common_lookups_can_be_shared(): void
    {
        $columns = $this->columnMap('master_lookups');
        $this->assertArrayHasKey('store_id', $columns);

        $sharedUnitId = DB::table('master_lookups')->insertGetId([
            'type' => 'unit',
            'name' => 'Tablet',
            'code' => 'TAB',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->assertNotNull($sharedUnitId, 'A shared (store_id NULL) lookup like a unit must be insertable');
    }

    private function indexMap(string $table): array
    {
        $map = [];
        foreach (Schema::getIndexes($table) as $index) {
            $map[$index['name']] = $index;
        }
        return $map;
    }

    private function columnMap(string $table): array
    {
        $map = [];
        foreach (Schema::getColumns($table) as $column) {
            $map[$column['name']] = $column;
        }
        return $map;
    }
}

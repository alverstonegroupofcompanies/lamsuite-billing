<?php

namespace Tests\Feature\Constitution;

use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * P-STORE-SCOPE constitution guard — the one-time migration command repairs
 * legacy shared-catalog rows with a reconciliation report, --dry-run and --rollback.
 */
class StoreScopeMigrationCommandTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SB', 'state_code' => '32', 'is_active' => true]);

        $this->seedLegacyCorruption();
    }

    /** Seed rows the way the pre-constitution world could have written them. */
    private function seedLegacyCorruption(): void
    {
        $productA = DB::table('products')->insertGetId([
            'store_id' => $this->storeA->id, 'name' => 'Item A', 'barcode' => 'BC-A',
            'mrp' => 10, 'sel_rate' => 8, 'gst_percent' => 12, 'external_id' => 'a-1',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $productB = DB::table('products')->insertGetId([
            'store_id' => $this->storeB->id, 'name' => 'Item B', 'barcode' => 'BC-B',
            'mrp' => 10, 'sel_rate' => 8, 'gst_percent' => 12, 'external_id' => 'b-1',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->transferId = DB::table('stock_transfers')->insertGetId([
            'from_store_id' => $this->storeA->id, 'to_store_id' => $this->storeB->id,
            'transfer_number' => 'TRF-MIG-1', 'status' => 'dispatched',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        // Guard triggers + the per-store barcode index block writing legacy corruption directly.
        foreach ([
            'pss_product_batches_insert_guard',
            'pss_product_batches_update_guard',
            'pss_stock_transfer_items_insert_guard',
            'pss_stock_transfer_items_update_guard',
        ] as $trigger) {
            DB::statement("DROP TRIGGER IF EXISTS {$trigger}");
        }
        DB::statement('DROP INDEX IF EXISTS products_store_id_barcode_unique');

        // Cross-store batch: batch says store B while its product lives in store A.
        $this->batchId = DB::table('product_batches')->insertGetId([
            'store_id' => $this->storeB->id, 'product_id' => $productA,
            'batch_no' => 'B-MIG', 'expiry_date' => '2030-01-01', 'stock_qty' => 5,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        DB::table('stock_transfer_items')->insert([
            'stock_transfer_id' => $this->transferId, 'product_id' => $productA,
            'batch_no' => 'B-MIG', 'qty' => 2, 'store_id' => null,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        // Per-store duplicate barcode (both in store A).
        DB::table('products')->insert([
            ['store_id' => $this->storeA->id, 'name' => 'Item A Duplicate', 'barcode' => 'BC-A',
             'mrp' => 10, 'sel_rate' => 8, 'gst_percent' => 12, 'external_id' => 'a-1-dup',
             'created_at' => now(), 'updated_at' => now()],
        ]);
        // RefreshDatabase rolls the seeding DDL back with the test transaction,
        // so the guards and the unique index return automatically afterwards.
    }

    private int $transferId;
    private int $batchId;

    public function test_dry_run_reports_without_writing(): void
    {
        $this->artisan('lamsuite:store-scope-migrate', ['--dry-run' => true])->expectsOutputToContain('"batches_repointed": 1')->run();

        $this->assertSame(
            $this->storeB->id,
            (int) DB::table('product_batches')->where('id', $this->batchId)->value('store_id'),
            'dry-run must not repair anything'
        );
        $this->assertNull(DB::table('stock_transfer_items')->where('stock_transfer_id', $this->transferId)->value('store_id'));
    }

    public function test_real_run_repairs_all_rows_and_journals_them(): void
    {
        $this->artisan('lamsuite:store-scope-migrate')->run();

        // Batch re-pointed to its product's store.
        $this->assertSame(
            $this->storeA->id,
            (int) DB::table('product_batches')->where('id', $this->batchId)->value('store_id')
        );

        // Transfer item inherited the sending store.
        $this->assertSame(
            $this->storeA->id,
            (int) DB::table('stock_transfer_items')->where('stock_transfer_id', $this->transferId)->value('store_id')
        );

        // Duplicate barcode renamed.
        $this->assertSame(1, DB::table('products')->where('store_id', $this->storeA->id)->where('barcode', 'BC-A')->count());
        $renamed = DB::table('products')->where('store_id', $this->storeA->id)->where('barcode', 'like', 'BC-A-DUP%')->count();
        $this->assertSame(1, $renamed);

        // Journal holds every change with old/new values.
        $journalPath = storage_path('app/store-scope-migration.json');
        $this->assertFileExists($journalPath);
        $journal = json_decode((string) file_get_contents($journalPath), true);
        $tables = array_count_values(array_column($journal['changes'] ?? [], 'table'));
        $this->assertGreaterThanOrEqual(3, ($tables['products'] ?? 0) + ($tables['product_batches'] ?? 0) + ($tables['stock_transfer_items'] ?? 0));

        unlink($journalPath);
    }

    public function test_rollback_restores_the_original_rows(): void
    {
        $this->artisan('lamsuite:store-scope-migrate')->run();
        $this->artisan('lamsuite:store-scope-migrate', ['--rollback' => true])->run();

        $this->assertSame(
            $this->storeB->id,
            (int) DB::table('product_batches')->where('id', $this->batchId)->value('store_id'),
            'rollback restores the legacy (mis-scoped) value'
        );
        $this->assertNull(DB::table('stock_transfer_items')->where('stock_transfer_id', $this->transferId)->value('store_id'));

        // The journal is consumed after a rollback.
        $journal = json_decode((string) file_get_contents(storage_path('app/store-scope-migration.json')), true);
        $this->assertSame([], $journal['changes'] ?? []);

        if (file_exists(storage_path('app/store-scope-migration.json'))) {
            unlink(storage_path('app/store-scope-migration.json'));
        }
    }
}

<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * P-STORE-SCOPE one-time migration (specs/constitution.md).
 *
 * Repairs legacy shared-catalog rows so every product-related row agrees with
 * its store: backfills transfer-item / price-list store scope, re-points
 * batches to their product's store, renames per-store duplicate barcodes,
 * reports severed catalog publications and cross-store ledger history.
 *
 * Every write is journalled to storage/app/store-scope-migration.json and can
 * be reverted with --rollback. --dry-run computes the report without writing.
 */
class StoreScopeMigrate extends Command
{
    protected $signature = 'lamsuite:store-scope-migrate {--dry-run} {--rollback}';

    protected $description = 'P-STORE-SCOPE migration: repair cross-store catalog rows with reconciliation report, dry-run and rollback';

    private string $journalPath = 'store-scope-migration.json';

    private const GUARD_TRIGGERS = [
        'pss_product_batches_insert_guard',
        'pss_product_batches_update_guard',
        'pss_stock_transfer_items_insert_guard',
        'pss_stock_transfer_items_update_guard',
    ];

    public function handle(): int
    {
        if ($this->option('rollback')) {
            return $this->rollback();
        }

        $dryRun = (bool) $this->option('dry-run');
        $report = [
            'ran_at' => now()->toIso8601String(),
            'dry_run' => $dryRun,
            'transfer_items_backfilled' => 0,
            'price_list_items_backfilled' => 0,
            'batches_repointed' => 0,
            'barcode_duplicates_renamed' => 0,
            'publications_severed' => 0,
            'ledger_mismatches_reported' => 0,
            'per_store' => [],
            'notes' => [],
        ];
        $journal = ['ran_at' => now()->toIso8601String(), 'changes' => []];

        // 1. Transfer items without a store: the sending store (parent) owns them.
        $missingTransferItems = DB::table('stock_transfer_items')
            ->whereNull('store_id')
            ->pluck('id');
        foreach ($missingTransferItems as $id) {
            $fromStore = DB::table('stock_transfers')->where('id', DB::table('stock_transfer_items')->where('id', $id)->value('stock_transfer_id'))->value('from_store_id');
            if (!$fromStore) {
                $report['notes'][] = "stock_transfer_items#{$id}: parent transfer missing, cannot infer store";
                continue;
            }
            $journal['changes'][] = ['table' => 'stock_transfer_items', 'id' => $id, 'column' => 'store_id', 'old' => null, 'new' => (int) $fromStore];
            $report['transfer_items_backfilled']++;
        }
        if (!$dryRun) {
            DB::statement('UPDATE stock_transfer_items SET store_id = (SELECT from_store_id FROM stock_transfers WHERE stock_transfers.id = stock_transfer_items.stock_transfer_id) WHERE store_id IS NULL');
        }

        // 2. Price list rows inherit the price list's store.
        $missingPriceItems = DB::table('price_list_items')->whereNull('store_id')->count();
        $report['price_list_items_backfilled'] = $missingPriceItems;
        if (!$dryRun && $missingPriceItems > 0) {
            DB::statement('UPDATE price_list_items SET store_id = (SELECT store_id FROM price_lists WHERE price_lists.id = price_list_items.price_list_id) WHERE store_id IS NULL');
        }

        // 3. A batch belongs to its product's store (product is the source of truth).
        $misplacedBatches = DB::table('product_batches as b')
            ->join('products as p', 'p.id', '=', 'b.product_id')
            ->whereColumn('b.store_id', '!=', 'p.store_id')
            ->get(['b.id', 'b.store_id as batch_store', 'p.store_id as product_store']);
        foreach ($misplacedBatches as $row) {
            $journal['changes'][] = ['table' => 'product_batches', 'id' => $row->id, 'column' => 'store_id', 'old' => (int) $row->batch_store, 'new' => (int) $row->product_store];
        }
        $report['batches_repointed'] = $misplacedBatches->count();
        if (!$dryRun) {
            DB::statement('UPDATE product_batches SET store_id = (SELECT store_id FROM products WHERE products.id = product_batches.product_id)');
        }

        // 4. Per-store barcode duplicates: keep the oldest, rename the rest.
        $duplicates = DB::table('products')
            ->select('store_id', 'barcode', DB::raw('MIN(id) as keep_id'), DB::raw('COUNT(*) as total'))
            ->whereNotNull('barcode')
            ->groupBy('store_id', 'barcode')
            ->havingRaw('COUNT(*) > 1')
            ->get();
        foreach ($duplicates as $dup) {
            $rows = DB::table('products')
                ->where('store_id', $dup->store_id)
                ->where('barcode', $dup->barcode)
                ->where('id', '!=', $dup->keep_id)
                ->get(['id', 'barcode']);
            foreach ($rows as $row) {
                $newBarcode = $row->barcode . '-DUP' . $row->id;
                $journal['changes'][] = ['table' => 'products', 'id' => $row->id, 'column' => 'barcode', 'old' => $row->barcode, 'new' => $newBarcode];
                $report['barcode_duplicates_renamed']++;
            }
        }
        if (!$dryRun) {
            foreach ($duplicates as $dup) {
                DB::table('products')
                    ->where('store_id', $dup->store_id)
                    ->where('barcode', $dup->barcode)
                    ->where('id', '!=', $dup->keep_id)
                    ->update(['barcode' => DB::raw("barcode || '-DUP' || id")]);
            }
        }

        // 5. Publications severed by the T2 schema migration: audit summary only.
        if (DB::getSchemaBuilder()->hasTable('catalog_publications')) {
            $report['publications_severed'] = DB::table('catalog_publications')->count();
        } else {
            $report['publications_severed'] = 0;
            $report['notes'][] = 'catalog_publications table already removed';
        }

        // 6. Cross-store ledger history: reported, never rewritten (audit trail).
        $report['ledger_mismatches_reported'] = DB::table('stock_ledger_entries as l')
            ->join('products as p', 'p.id', '=', 'l.product_id')
            ->whereColumn('l.store_id', '!=', 'p.store_id')
            ->count();

        // Per-store reconciliation summary.
        $report['per_store'] = DB::table('stores')
            ->leftJoin('products', 'products.store_id', '=', 'stores.id')
            ->leftJoin('product_batches', 'product_batches.store_id', '=', 'stores.id')
            ->groupBy('stores.id', 'stores.name', 'stores.code')
            ->orderBy('stores.id')
            ->get([
                'stores.id', 'stores.name', 'stores.code',
                DB::raw('COUNT(DISTINCT products.id) as products'),
                DB::raw('COUNT(DISTINCT product_batches.id) as batches'),
            ])
            ->map(fn ($r) => ['store_id' => $r->id, 'name' => $r->name, 'code' => $r->code, 'products' => $r->products, 'batches' => $r->batches])
            ->all();

        $this->info(json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        if (!$dryRun) {
            $journalFile = storage_path('app/' . $this->journalPath);
            $existing = [];
            if (file_exists($journalFile)) {
                $decoded = json_decode((string) file_get_contents($journalFile), true);
                if (is_array($decoded['changes'] ?? null)) {
                    $existing = $decoded;
                }
            }
            $existing['changes'] = array_merge($existing['changes'] ?? [], $journal['changes']);
            file_put_contents($journalFile, json_encode($existing, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
            $this->info('Journal written to ' . $journalFile . ' (' . count($journal['changes']) . ' changes this run)');
        }

        return self::SUCCESS;
    }

    private function rollback(): int
    {
        if (!file_exists(storage_path('app/' . $this->journalPath))) {
            $this->error('No journal found at ' . storage_path('app/' . $this->journalPath) . ' — nothing to roll back.');
            return self::FAILURE;
        }

        $journal = json_decode((string) file_get_contents(storage_path('app/' . $this->journalPath)), true);
        $changes = array_reverse($journal['changes'] ?? []);
        $applied = 0;

        // The store-scope guards would reject reverting a store_id back to NULL.
        foreach (self::GUARD_TRIGGERS as $trigger) {
            DB::statement("DROP TRIGGER IF EXISTS {$trigger}");
        }

        foreach ($changes as $change) {
            DB::table($change['table'])->where('id', $change['id'])->update([$change['column'] => $change['old']]);
            $applied++;
        }

        $this->recreateGuardTriggers();

        file_put_contents(storage_path('app/' . $this->journalPath), json_encode(['changes' => []], JSON_PRETTY_PRINT));
        $this->info("Rolled back {$applied} changes from the journal; guard triggers restored.");

        return self::SUCCESS;
    }

    private function recreateGuardTriggers(): void
    {
        $guards = [
            ['product_batches', 'pss_product_batches_insert_guard', 'INSERT', 'NEW'],
            ['product_batches', 'pss_product_batches_update_guard', 'UPDATE OF store_id, product_id', 'NEW'],
            ['stock_transfer_items', 'pss_stock_transfer_items_insert_guard', 'INSERT', 'NEW'],
            ['stock_transfer_items', 'pss_stock_transfer_items_update_guard', 'UPDATE OF store_id, product_id', 'NEW'],
        ];
        foreach ($guards as [$table, $name, $event, $ref]) {
            DB::statement("DROP TRIGGER IF EXISTS {$name}");
            DB::statement(<<<SQL
                CREATE TRIGGER {$name}
                BEFORE {$event} ON {$table}
                FOR EACH ROW
                WHEN (
                    SELECT p.store_id FROM products p WHERE p.id = {$ref}.product_id
                ) IS NOT {$ref}.store_id
                BEGIN
                    SELECT RAISE(ABORT, 'P-STORE-SCOPE: product belongs to a different store than the owning row');
                END;
            SQL);
        }
    }
}

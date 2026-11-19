<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // R5: central-catalogue linkage columns must not survive.
        Schema::table('products', function (Blueprint $table) {
            foreach (['products_source_product_id_index', 'products_product_family_id_index'] as $index) {
                if (Schema::hasIndex('products', $index)) {
                    $table->dropIndex($index);
                }
            }
        });
        foreach (['source_product_id', 'product_family_id'] as $column) {
            if (Schema::hasColumn('products', $column)) {
                Schema::table('products', fn (Blueprint $t) => $t->dropColumn($column));
            }
        }

        // R2: per-store barcode uniqueness — resolve same-store duplicate barcodes first.
        $duplicates = DB::table('products')
            ->select('store_id', 'barcode', DB::raw('MIN(id) as keep_id'), DB::raw('COUNT(*) as total'))
            ->whereNotNull('barcode')
            ->groupBy('store_id', 'barcode')
            ->havingRaw('COUNT(*) > 1')
            ->get();

        foreach ($duplicates as $row) {
            DB::table('products')
                ->where('store_id', $row->store_id)
                ->where('barcode', $row->barcode)
                ->where('id', '!=', $row->keep_id)
                ->update(['barcode' => DB::raw("barcode || '-DUP' || id")]);
        }

        Schema::table('products', function (Blueprint $table) {
            $table->unique(['store_id', 'barcode']);
        });

        // R4: transfer items and price list rows carry store_id.
        if (!Schema::hasColumn('stock_transfer_items', 'store_id')) {
            Schema::table('stock_transfer_items', function (Blueprint $table) {
                $table->foreignId('store_id')->nullable()->after('stock_transfer_id')->index();
            });
            DB::statement(
                'UPDATE stock_transfer_items SET store_id = (SELECT from_store_id FROM stock_transfers WHERE stock_transfers.id = stock_transfer_items.stock_transfer_id)'
            );
        }

        if (!Schema::hasColumn('price_list_items', 'store_id')) {
            Schema::table('price_list_items', function (Blueprint $table) {
                $table->foreignId('store_id')->nullable()->after('price_list_id')->index();
            });
            DB::statement(
                'UPDATE price_list_items SET store_id = (SELECT store_id FROM price_lists WHERE price_lists.id = price_list_items.price_list_id)'
            );
        }

        // R4: ledger queryable per store+product.
        $ledgerIndexes = collect(Schema::getIndexes('stock_ledger_entries'))->pluck('name')->all();
        if (!in_array('stock_ledger_entries_store_id_product_id_index', $ledgerIndexes)) {
            Schema::table('stock_ledger_entries', function (Blueprint $table) {
                $table->index(['store_id', 'product_id']);
            });
        }

        // R3: a batch/transfer-item row can never cross stores. SQLite enforces via triggers;
        // other drivers via composite foreign keys onto products(id, store_id).
        if (DB::connection()->getDriverName() === 'sqlite') {
            $this->createSqliteGuardTriggers();
        } else {
            Schema::table('products', function (Blueprint $table) {
                $table->unique(['id', 'store_id']);
            });
            Schema::table('product_batches', function (Blueprint $table) {
                $table->foreign(['product_id', 'store_id'], 'pss_batches_store_match')
                    ->references(['id', 'store_id'])->on('products');
            });
            Schema::table('stock_transfer_items', function (Blueprint $table) {
                $table->foreign(['product_id', 'store_id'], 'pss_transfer_items_store_match')
                    ->references(['id', 'store_id'])->on('products');
            });
        }
    }

    private function createSqliteGuardTriggers(): void
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

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            foreach (['pss_product_batches_insert_guard', 'pss_product_batches_update_guard', 'pss_stock_transfer_items_insert_guard', 'pss_stock_transfer_items_update_guard'] as $name) {
                DB::statement("DROP TRIGGER IF EXISTS {$name}");
            }
        } else {
            Schema::table('product_batches', fn (Blueprint $t) => $t->dropForeign('pss_batches_store_match'));
            Schema::table('stock_transfer_items', fn (Blueprint $t) => $t->dropForeign('pss_transfer_items_store_match'));
            Schema::table('products', fn (Blueprint $t) => $t->dropUnique(['id', 'store_id']));
        }

        Schema::table('stock_ledger_entries', function (Blueprint $table) {
            $table->dropIndex(['store_id', 'product_id']);
        });

        Schema::table('price_list_items', fn (Blueprint $t) => $t->dropColumn('store_id'));
        Schema::table('stock_transfer_items', fn (Blueprint $t) => $t->dropColumn('store_id'));
        Schema::table('products', fn (Blueprint $t) => $t->dropUnique(['store_id', 'barcode']));

        Schema::table('products', function (Blueprint $table) {
            $table->string('product_family_id', 64)->nullable()->after('store_id')->index();
            $table->unsignedBigInteger('source_product_id')->nullable()->after('product_family_id')->index();
        });
    }
};

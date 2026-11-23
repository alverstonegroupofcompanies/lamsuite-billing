<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A purchase bill has three names, not one: the till's own running number, the
     * supplier's bill number, and whichever of them the store has always filed under
     * (`invoice_number`). Keeping only the last one loses the trail an owner needs to
     * match a shelf receipt against the paper bill, so the other two are stored beside
     * it and the counter that took it is recorded with them.
     */
    public function up(): void
    {
        $isSqlite = DB::connection()->getDriverName() === 'sqlite';

        // SQLite gains a column in place, but a foreign key inside Schema::table forces a full
        // table rebuild — and a rebuild of `purchases` breaks the store-guard triggers that
        // `purchase_charges` already points at it. The key is declared in the ADD COLUMN, which
        // SQLite accepts because the column defaults to NULL.
        foreach ([
            'document_number' => "ALTER TABLE purchases ADD COLUMN document_number VARCHAR(50) NULL",
            'supplier_invoice_no' => "ALTER TABLE purchases ADD COLUMN supplier_invoice_no VARCHAR(50) NULL",
            'counter_id' => "ALTER TABLE purchases ADD COLUMN counter_id INTEGER NULL REFERENCES counters(id) ON DELETE SET NULL",
            'counter_code' => "ALTER TABLE purchases ADD COLUMN counter_code VARCHAR(20) NULL",
        ] as $column => $sql) {
            if (Schema::hasColumn('purchases', $column)) {
                continue;
            }

            if ($isSqlite) {
                DB::statement($sql);
            } elseif ($column === 'counter_id') {
                Schema::table('purchases', fn (Blueprint $table) => $table
                    ->foreignId('counter_id')->nullable()->constrained('counters')->nullOnDelete());
            } else {
                Schema::table('purchases', fn (Blueprint $table) => $table->string($column, $column === 'counter_code' ? 20 : 50)->nullable());
            }
        }

        Schema::table('purchases', function (Blueprint $table) {
            $table->index(['store_id', 'document_number']);
            $table->index(['store_id', 'supplier_invoice_no']);
        });
    }

    public function down(): void
    {
        Schema::table('purchases', function (Blueprint $table) {
            $table->dropIndex(['store_id', 'document_number']);
            $table->dropIndex(['store_id', 'supplier_invoice_no']);
        });

        // Dropping a column rebuilds the table on SQLite, which the same store-guard triggers
        // forbid; the columns are additive and harmless, so only non-SQLite takes them away.
        if (DB::connection()->getDriverName() !== 'sqlite') {
            Schema::table('purchases', function (Blueprint $table) {
                $table->dropConstrainedForeignId('counter_id');
                $table->dropColumn(['document_number', 'supplier_invoice_no', 'counter_code']);
            });
        }
    }
};

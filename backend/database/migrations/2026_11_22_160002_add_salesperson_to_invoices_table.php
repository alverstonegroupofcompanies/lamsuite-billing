<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * SPR-010 — a bill names the person who sold it, and remembers the name they
 * carried that day. The snapshot survives a later rename or archive, which is
 * what a printed bill and an incentive statement are measured against.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            if (!Schema::hasColumn('invoices', 'salesperson_id')) {
                $table->unsignedBigInteger('salesperson_id')->nullable()->index();
            }

            if (!Schema::hasColumn('invoices', 'salesperson_name')) {
                $table->string('salesperson_name', 191)->nullable();
            }
        });
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            // The columns are additive and harmless; SQLite would rebuild the
            // table to drop them.
            return;
        }

        Schema::table('invoices', function (Blueprint $table) {
            foreach (['salesperson_id', 'salesperson_name'] as $column) {
                if (Schema::hasColumn('invoices', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};

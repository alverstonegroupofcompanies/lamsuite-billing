<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * GAP-02 / PHR-001 — a product carries the drug schedule it belongs to.
 *
 * The till has drawn a "Rx Sch-H1" badge for years from a field the server
 * never stored, so nothing could tell a restricted medicine from an ordinary
 * one. `drug_schedule_id` is the owner's live answer — moving a schedule off
 * the restricted list changes the next bill — and `schedule_code` is the stamp
 * the item was sold under, which a later rename of the list must not rewrite.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'drug_schedule_id')) {
                $table->unsignedBigInteger('drug_schedule_id')->nullable()->index();
            }

            if (!Schema::hasColumn('products', 'schedule_code')) {
                $table->string('schedule_code', 20)->nullable()->index();
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

        Schema::table('products', function (Blueprint $table) {
            foreach (['drug_schedule_id', 'schedule_code'] as $column) {
                if (Schema::hasColumn('products', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};

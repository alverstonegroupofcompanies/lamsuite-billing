<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * PHR-002 — the pharmacist half of a staff record.
 *
 * A pharmacist is not a new kind of account: it is the salesperson the council
 * has registered, wearing a second hat. The four columns say who signed the
 * restricted-drug bill and for how long that signature was worth, and the PIN
 * that will release the bill is the same personal credential the salesperson
 * master already keeps — the only change is which policy judges it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('salespeople', function (Blueprint $table) {
            if (!Schema::hasColumn('salespeople', 'is_pharmacist')) {
                $table->boolean('is_pharmacist')->default(false)->index();
            }

            if (!Schema::hasColumn('salespeople', 'reg_no')) {
                $table->string('reg_no', 60)->nullable();
            }

            if (!Schema::hasColumn('salespeople', 'reg_valid_from')) {
                $table->date('reg_valid_from')->nullable();
            }

            if (!Schema::hasColumn('salespeople', 'reg_valid_until')) {
                $table->date('reg_valid_until')->nullable();
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

        Schema::table('salespeople', function (Blueprint $table) {
            foreach (['is_pharmacist', 'reg_no', 'reg_valid_from', 'reg_valid_until'] as $column) {
                if (Schema::hasColumn('salespeople', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};

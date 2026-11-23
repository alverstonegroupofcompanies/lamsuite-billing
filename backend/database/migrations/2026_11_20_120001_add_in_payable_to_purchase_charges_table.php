<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CR-C-11: whether a charge line was inside what the supplier is owed is a fact about the bill
 * the moment it is posted, not something a report can re-derive later — the store's
 * `separately_paid_in_payable` policy is allowed to change, and a policy change must never
 * restate a bill that has already been printed (PUR-016).
 *
 * Existing rows are backfilled from the rule in force when they were written: a charge paid to
 * someone other than the supplier sat outside the payable.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('purchase_charges', 'in_payable')) {
            Schema::table('purchase_charges', function (Blueprint $table) {
                $table->boolean('in_payable')->default(true)->after('paid_separately');
            });

            DB::table('purchase_charges')->where('paid_separately', true)->update(['in_payable' => false]);
        }
    }

    public function down(): void
    {
        // Non-destructive down; SQLite rebuilds are avoided once data exists.
    }
};

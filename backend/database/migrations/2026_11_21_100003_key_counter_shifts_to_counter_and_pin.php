<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PRF-007 / B9 — a shift is the counter's, and the drawer says how it was opened.
 *
 * `counter_shifts.counter_id` already keyed the row; what was missing is the
 * authority behind it. A till has no signed-in person, so `opened_by_user_id`
 * was null on every shift the POS opened and the money trail had no author at
 * all. The `*_via` columns now name the credential that moved the drawer — the
 * counter's own PIN at the till, an owner in the panel, or the device token of a
 * till that was offline and never got the chance to prove a PIN.
 *
 * `cash_in`, `expected_cash` and `reconciliation_json` are what closing needs to
 * reconcile to the paisa: the drawer's components, the figure the counter
 * counted against, and the server's own tally for the same window side by side.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('counter_shifts', function (Blueprint $table) {
            if (!Schema::hasColumn('counter_shifts', 'cash_in')) {
                $table->decimal('cash_in', 12, 2)->default(0.00)->after('cash_drops');
            }
            if (!Schema::hasColumn('counter_shifts', 'expected_cash')) {
                $table->decimal('expected_cash', 12, 2)->nullable()->after('closing_cash_actual');
            }
            if (!Schema::hasColumn('counter_shifts', 'opened_via')) {
                $table->string('opened_via', 20)->nullable()->after('closed_by_user_id');
            }
            if (!Schema::hasColumn('counter_shifts', 'closed_via')) {
                $table->string('closed_via', 20)->nullable()->after('opened_via');
            }
            if (!Schema::hasColumn('counter_shifts', 'reconciliation_json')) {
                $table->json('reconciliation_json')->nullable()->after('notes');
            }
            // A till that opened its drawer while the cloud was down pushes that
            // same shift later; the key it gave the row is what makes the replay
            // land on the record instead of standing next to it.
            if (!Schema::hasColumn('counter_shifts', 'external_id')) {
                $table->string('external_id', 64)->nullable()->after('counter_id');
                $table->index(['counter_id', 'external_id']);
            }
        });
    }

    public function down(): void
    {
        Schema::table('counter_shifts', function (Blueprint $table) {
            foreach (['cash_in', 'expected_cash', 'opened_via', 'closed_via', 'reconciliation_json', 'external_id'] as $column) {
                if (Schema::hasColumn('counter_shifts', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};

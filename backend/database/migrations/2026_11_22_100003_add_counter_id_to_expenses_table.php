<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * EXP-01 — a cash expense paid out of a counter's drawer has to name that
 * counter, otherwise a shift close cannot tell whose cash left the till.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('expenses', function (Blueprint $table) {
            if (!Schema::hasColumn('expenses', 'counter_id')) {
                $table->string('counter_id', 50)->nullable()->index()->after('store_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('expenses', function (Blueprint $table) {
            if (Schema::hasColumn('expenses', 'counter_id')) {
                $table->dropColumn('counter_id');
            }
        });
    }
};

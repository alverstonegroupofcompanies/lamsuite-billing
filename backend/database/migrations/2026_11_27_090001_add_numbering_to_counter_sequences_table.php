<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CNT-014/TALLY-01: a counter's series may render its serial its own way — a suffix, a digit width
 * and zero filling. Null means the counter inherits the store's numbering default, which is what
 * every existing row is, so no issued number changes spelling when this column arrives.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('counter_sequences', function (Blueprint $table) {
            if (!Schema::hasColumn('counter_sequences', 'numbering')) {
                $table->json('numbering')->nullable()->after('prefix');
            }
        });
    }

    public function down(): void
    {
        Schema::table('counter_sequences', function (Blueprint $table) {
            if (Schema::hasColumn('counter_sequences', 'numbering')) {
                $table->dropColumn('numbering');
            }
        });
    }
};

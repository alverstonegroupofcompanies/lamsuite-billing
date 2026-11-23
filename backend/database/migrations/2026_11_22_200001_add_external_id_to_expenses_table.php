<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * EXP-01 — an expense booked at a till is replayed by the till's own document
 * id, not by the EXP-0000N it numbered from its local row count: a second till,
 * or one whose local book was reset, reuses that number for a different
 * expense, and keying on it rewrote the first expense with the second.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('expenses', 'external_id')) {
            Schema::table('expenses', function (Blueprint $table) {
                $table->string('external_id', 64)->nullable()->after('expense_number');
                $table->unique(['store_id', 'external_id'], 'expenses_store_external_unique');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('expenses', 'external_id')) {
            Schema::table('expenses', function (Blueprint $table) {
                $table->dropUnique('expenses_store_external_unique');
                $table->dropColumn('external_id');
            });
        }
    }
};

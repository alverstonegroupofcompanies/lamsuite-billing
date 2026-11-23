<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADJ-01 — the daily adjustment rule belongs to whoever is posting. At a till
 * that is the counter, so a document has to remember which counter posted it
 * even though no person signed in.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_adjustment_documents', function (Blueprint $table) {
            if (!Schema::hasColumn('stock_adjustment_documents', 'counter_id')) {
                $table->unsignedBigInteger('counter_id')->nullable()->index()->after('store_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('stock_adjustment_documents', function (Blueprint $table) {
            if (Schema::hasColumn('stock_adjustment_documents', 'counter_id')) {
                $table->dropColumn('counter_id');
            }
        });
    }
};

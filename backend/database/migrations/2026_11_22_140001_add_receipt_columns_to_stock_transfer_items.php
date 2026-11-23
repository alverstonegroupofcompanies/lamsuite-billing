<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * STK-03: a receipt reports what actually arrived. Dispatch already removed the
 * full quantity from the sender, so the receiving side must be able to record
 * the accepted quantity and the shortfall — with a reason — per line.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_transfer_items', function (Blueprint $table) {
            if (!Schema::hasColumn('stock_transfer_items', 'received_qty')) {
                $table->decimal('received_qty', 12, 2)->nullable();
            }
            if (!Schema::hasColumn('stock_transfer_items', 'short_qty')) {
                $table->decimal('short_qty', 12, 2)->nullable();
            }
            if (!Schema::hasColumn('stock_transfer_items', 'shortage_reason')) {
                $table->string('shortage_reason', 255)->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('stock_transfer_items', function (Blueprint $table) {
            $table->dropColumn(['received_qty', 'short_qty', 'shortage_reason']);
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchases', function (Blueprint $table) {
            if (!Schema::hasColumn('purchases', 'freight_charges')) {
                $table->decimal('freight_charges', 12, 2)->default(0);
            }
            if (!Schema::hasColumn('purchases', 'bill_discount_type')) {
                $table->string('bill_discount_type', 10)->default('amount');
            }
            if (!Schema::hasColumn('purchases', 'bill_discount')) {
                $table->decimal('bill_discount', 12, 2)->default(0);
            }
        });

        Schema::table('purchase_items', function (Blueprint $table) {
            if (!Schema::hasColumn('purchase_items', 'hsn_code')) {
                $table->string('hsn_code', 20)->nullable();
            }
            if (!Schema::hasColumn('purchase_items', 'mfg_date')) {
                $table->date('mfg_date')->nullable();
            }
            if (!Schema::hasColumn('purchase_items', 'selling_rate')) {
                $table->decimal('selling_rate', 10, 2)->nullable();
            }
            if (!Schema::hasColumn('purchase_items', 'free_loose_qty')) {
                $table->decimal('free_loose_qty', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('purchase_items', 'discount_type')) {
                $table->string('discount_type', 10)->default('percent');
            }
            if (!Schema::hasColumn('purchase_items', 'ptr')) {
                $table->decimal('ptr', 10, 2)->nullable();
            }
            if (!Schema::hasColumn('purchase_items', 'pts')) {
                $table->decimal('pts', 10, 2)->nullable();
            }
            if (!Schema::hasColumn('purchase_items', 'ptss')) {
                $table->decimal('ptss', 10, 2)->nullable();
            }
        });

        // Non-pharmacy stores may inward receipts without batch/expiry.
        Schema::table('purchase_items', function (Blueprint $table) {
            $table->string('batch_no', 50)->nullable()->change();
            $table->date('expiry_date')->nullable()->change();
        });
    }

    public function down(): void
    {
        // Non-destructive down; SQLite rebuilds are avoided once data exists.
    }
};

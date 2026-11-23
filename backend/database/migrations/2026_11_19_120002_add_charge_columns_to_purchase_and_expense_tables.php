<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CR-C landed cost: goods lines remember the charge share they absorbed, batches carry
 * the landed rate that prices stock, the bill stores the place of supply that decided
 * intra vs inter for its charges, and an expensed charge is traceable to its register row.
 * `purchase_items.purchase_rate` is never rewritten by an allocation (PUR-011).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchase_items', function (Blueprint $table) {
            if (!Schema::hasColumn('purchase_items', 'gross_weight_kg')) {
                $table->decimal('gross_weight_kg', 12, 3)->nullable();
            }
            if (!Schema::hasColumn('purchase_items', 'charge_allocation')) {
                $table->decimal('charge_allocation', 12, 2)->default(0);
            }
            if (!Schema::hasColumn('purchase_items', 'landed_unit_cost')) {
                $table->decimal('landed_unit_cost', 12, 4)->nullable();
            }
            // The line a return came from, so a reversal can find its charges again (PUR-015).
            if (!Schema::hasColumn('purchase_items', 'original_purchase_item_id')) {
                $table->foreignId('original_purchase_item_id')->nullable()->index();
            }
        });

        Schema::table('product_batches', function (Blueprint $table) {
            if (!Schema::hasColumn('product_batches', 'landed_cost_rate')) {
                $table->decimal('landed_cost_rate', 12, 4)->nullable();
            }
        });

        Schema::table('purchases', function (Blueprint $table) {
            if (!Schema::hasColumn('purchases', 'place_of_supply')) {
                $table->string('place_of_supply', 10)->nullable();
            }
        });

        Schema::table('expenses', function (Blueprint $table) {
            foreach ([
                'purchase_id' => fn (Blueprint $t) => $t->foreignId('purchase_id')->nullable()->constrained('purchases')->nullOnDelete(),
                'purchase_charge_id' => fn (Blueprint $t) => $t->foreignId('purchase_charge_id')->nullable()->constrained('purchase_charges')->nullOnDelete(),
                'gst_percent' => fn (Blueprint $t) => $t->decimal('gst_percent', 5, 2)->default(0),
                'cgst_amount' => fn (Blueprint $t) => $t->decimal('cgst_amount', 12, 2)->default(0),
                'sgst_amount' => fn (Blueprint $t) => $t->decimal('sgst_amount', 12, 2)->default(0),
                'igst_amount' => fn (Blueprint $t) => $t->decimal('igst_amount', 12, 2)->default(0),
                'itc_eligibility' => fn (Blueprint $t) => $t->string('itc_eligibility', 20)->default('eligible'),
                'paid_separately' => fn (Blueprint $t) => $t->boolean('paid_separately')->default(false),
            ] as $column => $define) {
                if (!Schema::hasColumn('expenses', $column)) {
                    Schema::table('expenses', fn (Blueprint $t) => $define($t));
                }
            }
        });
    }

    public function down(): void
    {
        // Non-destructive down; SQLite rebuilds are avoided once data exists.
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            if (!Schema::hasColumn('invoices', 'taxable_subtotal')) {
                $table->decimal('taxable_subtotal', 12, 2)->default(0);
            }
            if (!Schema::hasColumn('invoices', 'cgst_total')) {
                $table->decimal('cgst_total', 12, 2)->default(0);
            }
            if (!Schema::hasColumn('invoices', 'sgst_total')) {
                $table->decimal('sgst_total', 12, 2)->default(0);
            }
            if (!Schema::hasColumn('invoices', 'igst_total')) {
                $table->decimal('igst_total', 12, 2)->default(0);
            }
            if (!Schema::hasColumn('invoices', 'cess_total')) {
                $table->decimal('cess_total', 12, 2)->default(0);
            }
            if (!Schema::hasColumn('invoices', 'store_state_code')) {
                $table->string('store_state_code', 10)->default('32');
            }
        });

        Schema::table('invoice_items', function (Blueprint $table) {
            if (!Schema::hasColumn('invoice_items', 'taxable_amount')) {
                $table->decimal('taxable_amount', 12, 2)->default(0);
            }
            if (!Schema::hasColumn('invoice_items', 'cgst_amount')) {
                $table->decimal('cgst_amount', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('invoice_items', 'sgst_amount')) {
                $table->decimal('sgst_amount', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('invoice_items', 'igst_amount')) {
                $table->decimal('igst_amount', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('invoice_items', 'cess_rate')) {
                $table->decimal('cess_rate', 5, 2)->default(0);
            }
            if (!Schema::hasColumn('invoice_items', 'cess_amount')) {
                $table->decimal('cess_amount', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('invoice_items', 'allocated_discount')) {
                $table->decimal('allocated_discount', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('invoice_items', 'loose_qty')) {
                $table->decimal('loose_qty', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('invoice_items', 'units_per_pack')) {
                $table->unsignedInteger('units_per_pack')->default(1);
            }
            if (!Schema::hasColumn('invoice_items', 'mrp')) {
                $table->decimal('mrp', 10, 2)->nullable();
            }
        });

        Schema::table('purchases', function (Blueprint $table) {
            if (!Schema::hasColumn('purchases', 'cgst_total')) {
                $table->decimal('cgst_total', 12, 2)->default(0);
            }
            if (!Schema::hasColumn('purchases', 'sgst_total')) {
                $table->decimal('sgst_total', 12, 2)->default(0);
            }
            if (!Schema::hasColumn('purchases', 'igst_total')) {
                $table->decimal('igst_total', 12, 2)->default(0);
            }
            if (!Schema::hasColumn('purchases', 'cess_total')) {
                $table->decimal('cess_total', 12, 2)->default(0);
            }
            if (!Schema::hasColumn('purchases', 'is_interstate')) {
                $table->boolean('is_interstate')->default(false);
            }
            if (!Schema::hasColumn('purchases', 'is_rcm')) {
                $table->boolean('is_rcm')->default(false);
            }
            if (!Schema::hasColumn('purchases', 'itc_eligibility')) {
                $table->string('itc_eligibility', 30)->default('eligible');
            }
        });

        Schema::table('purchase_items', function (Blueprint $table) {
            if (!Schema::hasColumn('purchase_items', 'taxable_amount')) {
                $table->decimal('taxable_amount', 12, 2)->default(0);
            }
            if (!Schema::hasColumn('purchase_items', 'cgst_amount')) {
                $table->decimal('cgst_amount', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('purchase_items', 'sgst_amount')) {
                $table->decimal('sgst_amount', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('purchase_items', 'igst_amount')) {
                $table->decimal('igst_amount', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('purchase_items', 'cess_amount')) {
                $table->decimal('cess_amount', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('purchase_items', 'pack_qty')) {
                $table->decimal('pack_qty', 10, 2)->default(1);
            }
            if (!Schema::hasColumn('purchase_items', 'loose_qty')) {
                $table->decimal('loose_qty', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('purchase_items', 'free_qty')) {
                $table->decimal('free_qty', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('purchase_items', 'units_per_pack')) {
                $table->unsignedInteger('units_per_pack')->default(1);
            }
            if (!Schema::hasColumn('purchase_items', 'discount_percent')) {
                $table->decimal('discount_percent', 5, 2)->default(0);
            }
            if (!Schema::hasColumn('purchase_items', 'discount_amount')) {
                $table->decimal('discount_amount', 10, 2)->default(0);
            }
            if (!Schema::hasColumn('purchase_items', 'effective_unit_cost')) {
                $table->decimal('effective_unit_cost', 10, 2)->default(0);
            }
        });
    }

    public function down(): void
    {
        // Non-destructive down in SQLite
    }
};

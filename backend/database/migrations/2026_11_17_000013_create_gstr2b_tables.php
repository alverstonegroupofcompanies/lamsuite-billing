<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('gstr2b_imports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->nullable()->constrained()->nullOnDelete();
            $table->string('period', 7);
            $table->string('file_name')->nullable();
            $table->string('source', 40)->default('upload');
            $table->unsignedInteger('total_entries')->default(0);
            $table->unsignedInteger('matched_count')->default(0);
            $table->unsignedInteger('mismatch_count')->default(0);
            $table->unsignedInteger('unmatched_count')->default(0);
            $table->decimal('itc_available', 14, 2)->default(0);
            $table->foreignId('imported_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['store_id', 'period']);
        });

        Schema::create('gstr2b_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('gstr2b_import_id')->constrained('gstr2b_imports')->cascadeOnDelete();
            $table->string('supplier_gstin', 15)->nullable();
            $table->string('supplier_name')->nullable();
            $table->string('invoice_number');
            $table->date('invoice_date')->nullable();
            $table->decimal('taxable_value', 14, 2)->default(0);
            $table->decimal('igst_amount', 14, 2)->default(0);
            $table->decimal('cgst_amount', 14, 2)->default(0);
            $table->decimal('sgst_amount', 14, 2)->default(0);
            $table->decimal('cess_amount', 14, 2)->default(0);
            $table->decimal('total_value', 14, 2)->default(0);
            $table->boolean('itc_eligible')->default(true);
            $table->string('match_status', 20)->default('unmatched');
            $table->foreignId('matched_purchase_id')->nullable()->constrained('purchases')->nullOnDelete();
            $table->string('notes')->nullable();
            $table->timestamps();

            $table->index(['supplier_gstin', 'invoice_number']);
            $table->index(['gstr2b_import_id', 'match_status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('gstr2b_entries');
        Schema::dropIfExists('gstr2b_imports');
    }
};

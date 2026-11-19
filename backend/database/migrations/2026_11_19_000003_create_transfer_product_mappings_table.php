<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P-STORE-SCOPE: transfers move stock between stores whose product catalogs
 * are independent. This table remembers, per (from_store, to_store, source
 * product) pair, which destination-store product receives the goods, so the
 * next transfer auto-matches without re-asking.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('transfer_product_mappings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('from_store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignId('to_store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignId('source_product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignId('dest_product_id')->constrained('products')->cascadeOnDelete();
            $table->string('matched_by', 20)->default('manual');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['from_store_id', 'to_store_id', 'source_product_id'], 'tpm_store_pair_source_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('transfer_product_mappings');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_lookups', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->nullable()->constrained('stores')->cascadeOnDelete();
            $table->string('type', 40); // group, brand, manufacturer, unit, bank, expense_head, discount_schema
            $table->string('code', 50)->nullable();
            $table->string('name');
            $table->text('description')->nullable();
            $table->json('config')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['store_id', 'type']);
        });

        Schema::create('parties', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->string('type', 20); // customer, supplier, doctor, patient
            $table->string('name');
            $table->string('phone', 20)->nullable();
            $table->string('email', 100)->nullable();
            $table->string('gstin', 20)->nullable();
            $table->string('pan', 20)->nullable();
            $table->text('address')->nullable();
            $table->string('state_code', 10)->default('32');
            $table->decimal('credit_limit', 12, 2)->default(0);
            $table->decimal('opening_balance', 12, 2)->default(0);
            $table->decimal('current_balance', 12, 2)->default(0);
            $table->string('reg_no', 50)->nullable(); // Doctor registration no or patient MRN
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->string('external_id')->nullable()->index();
            $table->timestamps();

            $table->index(['store_id', 'type']);
            $table->index(['store_id', 'phone']);
        });

        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->string('barcode')->nullable()->index();
            $table->string('name')->index();
            $table->string('print_name')->nullable();
            $table->string('generic_name')->nullable()->index();
            $table->string('hsn_sac_code', 20)->nullable()->index();
            $table->string('category_id')->nullable();
            $table->string('brand_id')->nullable();
            $table->string('manufacturer_id')->nullable();
            $table->string('unit_id')->nullable();
            $table->decimal('mrp', 10, 2)->default(0);
            $table->decimal('sel_rate', 10, 2)->default(0);
            $table->decimal('ptr', 10, 2)->default(0);
            $table->decimal('pts', 10, 2)->default(0);
            $table->decimal('gst_percent', 5, 2)->default(0);
            $table->unsignedInteger('units_per_pack')->default(1);
            $table->string('rack_location', 50)->nullable();
            $table->string('shelf_location', 50)->nullable();
            $table->decimal('reorder_level', 10, 2)->default(10);
            $table->decimal('current_stock', 12, 2)->default(0);
            $table->boolean('is_active')->default(true)->index();
            $table->string('external_id')->nullable()->index();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->index(['store_id', 'name']);
            $table->index(['store_id', 'barcode']);
        });

        Schema::create('product_batches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('batch_no', 50)->index();
            $table->date('mfg_date')->nullable();
            $table->date('expiry_date')->index();
            $table->decimal('stock_qty', 12, 2)->default(0);
            $table->decimal('mrp', 10, 2)->default(0);
            $table->decimal('purchase_rate', 10, 2)->default(0);
            $table->decimal('selling_rate', 10, 2)->default(0);
            $table->string('rack_location', 50)->nullable();
            $table->string('shelf_location', 50)->nullable();
            $table->string('external_id')->nullable()->index();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->index(['store_id', 'expiry_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_batches');
        Schema::dropIfExists('products');
        Schema::dropIfExists('parties');
        Schema::dropIfExists('master_lookups');
    }
};

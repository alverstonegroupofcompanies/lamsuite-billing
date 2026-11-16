<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'product_family_id')) {
                $table->string('product_family_id', 64)->nullable()->after('store_id')->index();
            }
            if (!Schema::hasColumn('products', 'source_product_id')) {
                $table->unsignedBigInteger('source_product_id')->nullable()->after('product_family_id')->index();
            }
        });

        if (!Schema::hasTable('catalog_publications')) {
            Schema::create('catalog_publications', function (Blueprint $table) {
                $table->id();
                $table->foreignId('source_product_id')->constrained('products')->cascadeOnDelete();
                $table->foreignId('target_store_id')->constrained('stores')->cascadeOnDelete();
                $table->unsignedBigInteger('target_product_id')->nullable()->index();
                $table->string('family_id', 64);
                $table->string('status', 20)->default('published');
                $table->json('snapshot')->nullable();
                $table->foreignId('published_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamp('published_at')->nullable();
                $table->timestamps();

                $table->unique(['source_product_id', 'target_store_id'], 'catalog_pub_source_store_unique');
                $table->index(['target_store_id', 'status']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('catalog_publications');

        Schema::table('products', function (Blueprint $table) {
            if (Schema::hasColumn('products', 'source_product_id')) {
                $table->dropColumn('source_product_id');
            }
            if (Schema::hasColumn('products', 'product_family_id')) {
                $table->dropColumn('product_family_id');
            }
        });
    }
};

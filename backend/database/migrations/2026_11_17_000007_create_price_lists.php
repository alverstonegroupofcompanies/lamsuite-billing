<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('price_lists', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            $table->text('description')->nullable();
            $table->boolean('is_active')->default(true);
            $table->date('valid_from')->nullable();
            $table->date('valid_to')->nullable();
            $table->integer('priority')->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['store_id', 'name']);
            $table->index(['store_id', 'is_active', 'priority']);
        });

        Schema::create('price_list_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('price_list_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->decimal('rate', 12, 2);
            $table->decimal('discount_percent', 5, 2)->default(0);
            $table->integer('min_qty')->default(1);
            $table->timestamps();

            $table->unique(['price_list_id', 'product_id']);
        });

        Schema::table('parties', function (Blueprint $table) {
            $table->foreignId('price_list_id')->nullable()->after('gstin')->constrained('price_lists')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('parties', function (Blueprint $table) {
            $table->dropConstrainedForeignId('price_list_id');
        });
        Schema::dropIfExists('price_list_items');
        Schema::dropIfExists('price_lists');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_copy_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('source_store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignId('target_store_id')->constrained('stores')->cascadeOnDelete();
            $table->json('product_map'); // source_product_id => {target_product_id, status, conflict_with?}
            $table->unsignedInteger('copied_count')->default(0);
            $table->unsignedInteger('skipped_count')->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reversed_at')->nullable();
            $table->foreignId('reversed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['source_store_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_copy_runs');
    }
};

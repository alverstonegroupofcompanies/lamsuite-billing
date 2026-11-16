<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('stock_adjustment_documents')) {
            Schema::create('stock_adjustment_documents', function (Blueprint $table) {
                $table->id();
                $table->string('document_id')->unique();
                $table->unsignedBigInteger('store_id');
                $table->string('mode', 24)->default('adjustment'); // adjustment | physical_count
                $table->string('reason')->nullable();
                $table->text('notes')->nullable();
                $table->string('document_date', 10)->nullable();
                $table->string('status', 24)->default('posted'); // posted | pending_approval | approved | rejected
                $table->boolean('requires_approval')->default(false);
                $table->text('blocking_rule')->nullable();
                $table->unsignedInteger('lines_count')->default(0);
                $table->decimal('total_qty', 14, 3)->default(0);
                $table->decimal('total_value', 14, 2)->default(0);
                $table->json('metadata')->nullable();
                $table->unsignedBigInteger('created_by')->nullable();
                $table->unsignedBigInteger('approved_by')->nullable();
                $table->timestamp('approved_at')->nullable();
                $table->timestamps();

                $table->index(['store_id', 'status']);
                $table->index(['store_id', 'created_at']);
            });
        }

        if (!Schema::hasTable('stock_adjustment_lines')) {
            Schema::create('stock_adjustment_lines', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('stock_adjustment_document_id');
                $table->unsignedBigInteger('product_id');
                $table->unsignedBigInteger('batch_id')->nullable();
                $table->string('batch_no')->nullable();
                $table->string('product_name')->nullable();
                $table->decimal('system_qty', 14, 3)->default(0);
                $table->decimal('counted_qty', 14, 3)->nullable();
                $table->decimal('adjustment_qty', 14, 3)->default(0);
                $table->decimal('unit_cost', 14, 2)->nullable();
                $table->string('reason')->nullable();
                $table->text('notes')->nullable();
                $table->timestamps();

                $table->index('stock_adjustment_document_id', 'sadj_lines_doc_idx');
                $table->index('product_id');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_adjustment_lines');
        Schema::dropIfExists('stock_adjustment_documents');
    }
};

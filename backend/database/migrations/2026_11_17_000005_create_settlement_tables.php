<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('settlement_batches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained()->cascadeOnDelete();
            $table->string('source', 32)->default('bank'); // bank, upi, card, manual
            $table->string('file_name')->nullable();
            $table->date('period_start')->nullable();
            $table->date('period_end')->nullable();
            $table->decimal('total_amount', 14, 2)->default(0);
            $table->unsignedInteger('line_count')->default(0);
            $table->unsignedInteger('matched_count')->default(0);
            $table->unsignedInteger('exception_count')->default(0);
            $table->string('status', 16)->default('imported'); // imported, partial, reconciled
            $table->foreignId('imported_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['store_id', 'status']);
        });

        Schema::create('settlement_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('settlement_batch_id')->constrained()->cascadeOnDelete();
            $table->foreignId('store_id')->constrained()->cascadeOnDelete();
            $table->date('txn_date')->nullable();
            $table->string('reference', 128);
            $table->decimal('amount', 12, 2);
            $table->string('mode', 32)->nullable();
            $table->string('payer_ref')->nullable();
            $table->string('status', 16)->default('unmatched'); // matched, unmatched, exception, ignored, resolved
            $table->string('match_type', 32)->nullable(); // invoice_payment, customer_payment, manual
            $table->unsignedBigInteger('match_id')->nullable();
            $table->string('invoice_number', 64)->nullable();
            $table->text('note')->nullable();
            $table->timestamps();

            $table->index(['store_id', 'status']);
            $table->index('reference');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('settlement_lines');
        Schema::dropIfExists('settlement_batches');
    }
};

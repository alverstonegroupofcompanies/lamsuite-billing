<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PAY-05 — a receipt is money, but unless it names a document it settles
 * nothing. Every rupee of a customer receipt or supplier payment that is
 * applied to an invoice or purchase leaves a row here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_allocations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->string('payment_type', 30)->index();
            $table->unsignedBigInteger('payment_id')->index();
            $table->string('document_type', 30)->index();
            $table->unsignedBigInteger('document_id')->index();
            $table->decimal('amount', 12, 2)->default(0);
            $table->timestamps();

            $table->unique(
                ['payment_type', 'payment_id', 'document_type', 'document_id'],
                'payment_allocations_unique_document'
            );
            $table->index(['store_id', 'document_type', 'document_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_allocations');
    }
};

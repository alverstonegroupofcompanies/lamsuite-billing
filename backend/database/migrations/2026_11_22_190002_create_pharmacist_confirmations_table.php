<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * PHR-004, PHR-005 — the register of pharmacist confirmations.
 *
 * A bill's own pharmacist columns say who stood behind the sale. This table
 * says who stood behind every act a restricted bill can take part in after
 * that: its return, its cancellation, and the same document arriving from a
 * till that worked in the dark. Those acts do not rewrite the bill — the sale
 * keeps the registration it was written under — so they need a row of their
 * own, and an owner reviewing an inspection needs the sequence, not just the
 * last word.
 *
 * The PIN itself is never stored: a confirmation records that a named
 * pharmacist's own credential was verified, and when.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pharmacist_confirmations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->unsignedBigInteger('counter_id')->nullable()->index();

            // invoice | sales_return | invoice_cancel — the act, not the module.
            $table->string('document_type', 40);
            $table->string('document_id', 64)->nullable();
            $table->string('document_reference', 120)->nullable();

            $table->unsignedBigInteger('pharmacist_id')->nullable()->index();
            $table->string('pharmacist_name', 191);
            $table->string('pharmacist_reg_no', 60);
            $table->json('restricted_items')->nullable();

            // pharmacist_pin today; offline_cached arrives with the offline work.
            $table->string('mode', 30)->default('pharmacist_pin');
            $table->string('reason', 1000)->nullable();
            $table->timestamp('confirmed_at');
            $table->timestamps();

            $table->index(['store_id', 'confirmed_at']);
            $table->index(['document_type', 'document_id']);
        });
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            return;
        }

        Schema::dropIfExists('pharmacist_confirmations');
    }
};

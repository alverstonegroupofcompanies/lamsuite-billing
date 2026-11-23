<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * SPR-001..003, 005 — the salespeople master.
 *
 * A person belongs to one store, their code is unique only inside it, the
 * counters they may be selected at restrict the till's list, and a person with
 * bills is archived rather than deleted so the history still names them. The
 * optional personal PIN is a credential of its own domain, stored hashed.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('salespeople')) {
            return;
        }

        Schema::create('salespeople', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->string('name', 191);
            $table->string('code', 40);
            $table->string('phone', 20)->nullable();
            $table->json('counter_ids')->nullable();
            $table->string('pin_hash')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamp('archived_at')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['store_id', 'code']);
            $table->index(['store_id', 'is_active']);
            $table->index(['store_id', 'archived_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('salespeople');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Q1 (b) — the register of offline documents a counter was not holding.
 *
 * A till that worked in the dark cannot be asked to obey a rule it never
 * received, and the store cannot be made to lose a bill it genuinely sold, so
 * sync ingest accepts the document and files what it broke here instead of
 * refusing it. `profile_version` is the watermark the till stamped when the
 * document was made; `profile_version_at_review` is the one in force when this
 * row was written. When they differ the rule may simply be newer than the
 * bill, which is the first thing an owner needs to know before acting.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('counter_profile_exceptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignId('counter_id')->constrained('counters')->cascadeOnDelete();
            $table->string('document_type', 40);
            $table->string('document_id', 64)->nullable();
            $table->string('document_reference', 120)->nullable();
            $table->unsignedInteger('profile_version')->nullable();
            $table->unsignedInteger('profile_version_at_review');
            $table->json('violations');
            $table->string('status', 20)->default('open');
            $table->unsignedInteger('times_filed')->default(1);
            $table->timestamp('detected_at');
            $table->timestamp('reviewed_at')->nullable();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('note', 500)->nullable();
            $table->timestamps();

            $table->index(['store_id', 'status', 'detected_at']);
            $table->index(['counter_id', 'document_type', 'document_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('counter_profile_exceptions');
    }
};

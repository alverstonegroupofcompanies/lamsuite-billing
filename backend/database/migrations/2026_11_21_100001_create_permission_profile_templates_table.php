<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PRF-002 — a named profile an owner can hand to more than one counter.
 *
 * The template holds the same document a counter does, so applying one is a
 * save like any other: the counter's version bumps and the audit records the
 * diff. Nothing here is a permission by itself.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('permission_profile_templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->string('name', 100);
            $table->json('profile');
            $table->boolean('is_default')->default(false);
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['store_id', 'name']);
            $table->index(['store_id', 'is_default']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('permission_profile_templates');
    }
};

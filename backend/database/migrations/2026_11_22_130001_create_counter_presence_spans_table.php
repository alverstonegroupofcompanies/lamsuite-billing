<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CNT-01 — a counter's offline periods cannot be read back from a session row,
 * because a heartbeat only ever keeps the latest one. This table keeps the
 * stretches of time a counter was actually heard from, so the admin list can
 * show the gaps between them.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('counter_presence_spans')) {
            return;
        }

        Schema::create('counter_presence_spans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignId('counter_id')->constrained('counters')->cascadeOnDelete();
            $table->timestamp('started_at');
            $table->timestamp('last_beat_at');
            $table->timestamps();

            $table->index(['counter_id', 'last_beat_at']);
            $table->index(['store_id', 'started_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('counter_presence_spans');
    }
};

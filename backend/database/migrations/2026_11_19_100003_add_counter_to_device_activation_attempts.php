<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CNT-005 — an activation attempt is recorded against the counter it targeted,
 * so the owner alert can name the counter and the code lifecycle stays auditable.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device_activation_attempts', function (Blueprint $table) {
            if (!Schema::hasColumn('device_activation_attempts', 'counter_id')) {
                $table->foreignId('counter_id')->nullable()->constrained('counters')->nullOnDelete();
            }
            if (!Schema::hasColumn('device_activation_attempts', 'activation_key_id')) {
                $table->foreignId('activation_key_id')->nullable()->constrained('activation_keys')->nullOnDelete();
            }

            $table->index(['store_id', 'counter_id', 'created_at'], 'device_attempts_store_counter_created_index');
        });
    }

    public function down(): void
    {
        Schema::table('device_activation_attempts', function (Blueprint $table) {
            $table->dropIndex('device_attempts_store_counter_created_index');

            foreach (['activation_key_id', 'counter_id'] as $column) {
                if (Schema::hasColumn('device_activation_attempts', $column)) {
                    $table->dropConstrainedForeignId($column);
                }
            }
        });
    }
};

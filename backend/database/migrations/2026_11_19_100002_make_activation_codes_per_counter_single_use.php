<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CNT-003 / CNT-005 / CNT-011 — activation codes become per-counter, single-use
 * and expiring. The old store-wide key stays readable until its routes are retired,
 * but nothing new is written into it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('activation_keys', function (Blueprint $table) {
            if (!Schema::hasColumn('activation_keys', 'counter_id')) {
                $table->foreignId('counter_id')
                    ->nullable()
                    ->constrained('counters')
                    ->cascadeOnDelete();
            }
            if (!Schema::hasColumn('activation_keys', 'label')) {
                $table->string('label')->nullable();
            }
            if (!Schema::hasColumn('activation_keys', 'ttl_hours')) {
                $table->integer('ttl_hours')->nullable();
            }
            if (!Schema::hasColumn('activation_keys', 'consumed_at')) {
                $table->timestamp('consumed_at')->nullable();
            }
            if (!Schema::hasColumn('activation_keys', 'consumed_device_uuid')) {
                $table->string('consumed_device_uuid', 100)->nullable();
            }

            $table->index(['store_id', 'counter_id', 'is_revoked'], 'activation_keys_store_counter_revoked_index');
        });

        // A revoked counter wiping its device is a counter decision, not a store one.
        Schema::table('counters', function (Blueprint $table) {
            if (!Schema::hasColumn('counters', 'wipe_on_revocation')) {
                $table->boolean('wipe_on_revocation')->default(false);
            }
        });

        DB::statement('UPDATE counters SET wipe_on_revocation = (
            SELECT COALESCE(stores.wipe_on_revocation, 0) FROM stores WHERE stores.id = counters.store_id
        )');

        // Codes are one-use by design now; legacy store-wide keys keep their own history.
        DB::statement('UPDATE activation_keys SET is_single_use = 1 WHERE counter_id IS NOT NULL');
    }

    public function down(): void
    {
        Schema::table('activation_keys', function (Blueprint $table) {
            $table->dropIndex('activation_keys_store_counter_revoked_index');

            foreach (['consumed_device_uuid', 'consumed_at', 'ttl_hours', 'label'] as $column) {
                if (Schema::hasColumn('activation_keys', $column)) {
                    $table->dropColumn($column);
                }
            }

            if (Schema::hasColumn('activation_keys', 'counter_id')) {
                $table->dropConstrainedForeignId('counter_id');
            }
        });

        Schema::table('counters', function (Blueprint $table) {
            if (Schema::hasColumn('counters', 'wipe_on_revocation')) {
                $table->dropColumn('wipe_on_revocation');
            }
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CNT-013 — one shared key for a whole store was the door this CR closes. The
 * columns go, and any store-scope code still in the table is revoked so an old
 * build cannot pick up a live one; a counter activation code is the only way
 * onto a till now.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("UPDATE activation_keys
                       SET is_revoked = 1,
                           revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
                           revoke_reason = COALESCE(revoke_reason, 'Retired with the store-wide key')
                       WHERE counter_id IS NULL AND is_revoked = 0");

        // The shared key carried a unique index; MySQL and SQLite name it differently.
        foreach (Schema::getIndexes('stores') as $index) {
            if (in_array('activation_key', $index['columns'] ?? [], true)) {
                Schema::table('stores', fn (Blueprint $table) => $table->dropIndex($index['name']));
            }
        }

        Schema::table('stores', function (Blueprint $table) {
            foreach (['activation_key', 'activation_key_hash', 'require_device_approval'] as $column) {
                if (Schema::hasColumn('stores', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }

    public function down(): void
    {
        Schema::table('stores', function (Blueprint $table) {
            if (!Schema::hasColumn('stores', 'activation_key')) {
                $table->string('activation_key', 64)->nullable()->after('code');
            }
            if (!Schema::hasColumn('stores', 'activation_key_hash')) {
                $table->string('activation_key_hash', 64)->nullable()->after('activation_key');
            }
            if (!Schema::hasColumn('stores', 'require_device_approval')) {
                $table->boolean('require_device_approval')->default(false)->after('is_active');
            }
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * SYNC-02 — when a workstation was retired. A till re-issued while it was
 * offline still holds bills it sold before that moment; this column is what
 * lets the server take those and refuse anything written afterwards.
 *
 * Rows revoked before this column existed are filled in by
 * `php artisan devices:backfill-revoked-at` (dry run by default).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('devices', 'revoked_at')) {
            Schema::table('devices', function (Blueprint $table) {
                $table->timestamp('revoked_at')->nullable()->after('revoke_reason');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('devices', 'revoked_at')) {
            Schema::table('devices', function (Blueprint $table) {
                $table->dropColumn('revoked_at');
            });
        }
    }
};

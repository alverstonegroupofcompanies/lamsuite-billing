<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('device_sessions', function (Blueprint $table) {
            if (!Schema::hasColumn('device_sessions', 'app_version')) {
                $table->string('app_version', 30)->nullable()->after('status');
            }
            if (!Schema::hasColumn('device_sessions', 'unsynced_items_count')) {
                $table->unsignedInteger('unsynced_items_count')->default(0)->after('app_version');
            }
            if (!Schema::hasColumn('device_sessions', 'user_role')) {
                $table->string('user_role', 50)->nullable()->after('user_id');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('device_sessions', function (Blueprint $table) {
            $table->dropColumn(['app_version', 'unsynced_items_count', 'user_role']);
        });
    }
};

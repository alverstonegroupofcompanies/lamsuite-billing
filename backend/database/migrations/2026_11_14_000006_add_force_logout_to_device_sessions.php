<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device_sessions', function (Blueprint $table) {
            if (!Schema::hasColumn('device_sessions', 'force_logged_out_at')) {
                $table->timestamp('force_logged_out_at')->nullable();
            }
            if (!Schema::hasColumn('device_sessions', 'force_logout_reason')) {
                $table->string('force_logout_reason', 255)->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('device_sessions', function (Blueprint $table) {
            if (Schema::hasColumn('device_sessions', 'force_logout_reason')) {
                $table->dropColumn('force_logout_reason');
            }
            if (Schema::hasColumn('device_sessions', 'force_logged_out_at')) {
                $table->dropColumn('force_logged_out_at');
            }
        });
    }
};

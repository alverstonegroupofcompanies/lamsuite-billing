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
            if (!Schema::hasColumn('device_sessions', 'public_ip')) {
                $table->string('public_ip', 45)->nullable()->after('ip_address');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('device_sessions', function (Blueprint $table) {
            if (Schema::hasColumn('device_sessions', 'public_ip')) {
                $table->dropColumn('public_ip');
            }
        });
    }
};

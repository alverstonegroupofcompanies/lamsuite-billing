<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('counters', function (Blueprint $table) {
            $table->string('pairing_code', 10)->nullable()->after('device_uuid');
            $table->timestamp('pairing_expires_at')->nullable()->after('pairing_code');
            $table->string('device_token', 64)->nullable()->after('pairing_expires_at');
            $table->string('device_token_hash', 64)->nullable()->after('device_token');
            $table->timestamp('approved_at')->nullable()->after('status');
            $table->foreignId('approved_by')->nullable()->after('approved_at')->constrained('users')->nullOnDelete();
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('username', 50)->nullable()->after('email');
            $table->string('pin_hash', 255)->nullable()->after('password');
            $table->boolean('must_change_password')->default(false)->after('password');
            $table->json('enabled_menus')->nullable()->after('permissions');
        });
    }

    public function down(): void
    {
        Schema::table('counters', function (Blueprint $table) {
            $table->dropForeign(['approved_by']);
            $table->dropColumn([
                'pairing_code',
                'pairing_expires_at',
                'device_token',
                'device_token_hash',
                'approved_at',
                'approved_by',
            ]);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn([
                'username',
                'pin_hash',
                'must_change_password',
                'enabled_menus',
            ]);
        });
    }
};

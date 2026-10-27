<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('activation_keys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->onDelete('cascade');
            $table->string('key_hash', 64)->unique();
            $table->string('key_prefix', 24);
            $table->integer('max_devices')->nullable()->default(1);
            $table->integer('devices_activated_count')->default(0);
            $table->boolean('is_single_use')->default(false);
            $table->timestamp('expires_at')->nullable();
            $table->boolean('is_revoked')->default(false);
            $table->timestamp('revoked_at')->nullable();
            $table->string('revoke_reason')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['store_id', 'is_revoked']);
        });

        Schema::table('stores', function (Blueprint $table) {
            $table->string('activation_key_hash', 64)->nullable()->after('activation_key');
            $table->boolean('require_device_approval')->default(false)->after('is_active');
            $table->boolean('wipe_on_revocation')->default(false)->after('require_device_approval');
        });

        Schema::table('devices', function (Blueprint $table) {
            $table->string('device_token', 80)->nullable()->after('device_uuid');
            $table->string('device_token_hash', 64)->nullable()->after('device_token')->index();
            $table->string('counter_id', 64)->nullable()->after('device_token_hash');
            $table->string('registered_via', 32)->default('activation_key')->after('counter_id');
            $table->foreignId('activation_key_id')->nullable()->after('registered_via')->constrained('activation_keys')->nullOnDelete();
            $table->timestamp('approved_at')->nullable()->after('status');
            $table->foreignId('approved_by')->nullable()->after('approved_at')->constrained('users')->nullOnDelete();
        });

        Schema::create('device_activation_attempts', function (Blueprint $table) {
            $table->id();
            $table->string('ip_address', 45);
            $table->string('device_uuid', 80)->nullable();
            $table->string('device_name', 100)->nullable();
            $table->string('attempted_key_prefix', 24)->nullable();
            $table->foreignId('store_id')->nullable()->constrained('stores')->nullOnDelete();
            $table->boolean('success')->default(false);
            $table->string('failure_reason', 150)->nullable();
            $table->timestamps();

            $table->index(['ip_address', 'created_at']);
            $table->index(['device_uuid', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_activation_attempts');

        Schema::table('devices', function (Blueprint $table) {
            $table->dropForeign(['activation_key_id']);
            $table->dropForeign(['approved_by']);
            $table->dropColumn([
                'device_token',
                'device_token_hash',
                'counter_id',
                'registered_via',
                'activation_key_id',
                'approved_at',
                'approved_by',
            ]);
        });

        Schema::table('stores', function (Blueprint $table) {
            $table->dropColumn([
                'activation_key_hash',
                'require_device_approval',
                'wipe_on_revocation',
            ]);
        });

        Schema::dropIfExists('activation_keys');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stores', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('code')->unique();
            $table->string('phone')->nullable();
            $table->string('email')->nullable();
            $table->text('address')->nullable();
            $table->string('state_code', 10)->default('32');
            $table->string('gstin', 20)->nullable();
            $table->json('drug_license_numbers')->nullable();
            $table->string('fssai_no', 30)->nullable();
            $table->string('tax_mode', 20)->default('inclusive');
            $table->string('invoice_prefix', 20)->default('INV');
            $table->boolean('is_active')->default(true);
            $table->string('license_plan')->default('Professional');
            $table->date('license_expires_at')->nullable();
            $table->json('enabled_menu_items')->nullable();
            $table->json('feature_flags')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
        });

        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->nullable()->constrained('stores')->nullOnDelete();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('password');
            $table->string('role', 30)->default('manager'); // super_admin, store_owner, manager, accountant, support
            $table->json('permissions')->nullable();
            $table->json('allowed_store_ids')->nullable(); // For multi-store access
            $table->string('totp_secret')->nullable();
            $table->boolean('totp_enabled')->default(false);
            $table->boolean('is_biometric_enabled')->default(true);
            $table->unsignedInteger('idle_timeout_minutes')->default(15);
            $table->unsignedInteger('max_failed_logins')->default(5);
            $table->unsignedInteger('failed_login_attempts')->default(0);
            $table->timestamp('locked_until')->nullable();
            $table->text('ip_allowlist')->nullable();
            $table->rememberToken();
            $table->timestamps();
        });

        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('personal_access_tokens', function (Blueprint $table) {
            $table->id();
            $table->morphs('tokenable');
            $table->string('name');
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });

        Schema::create('user_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->timestamp('last_activity')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('devices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->string('device_name');
            $table->string('device_uuid')->unique();
            $table->string('app_version')->default('2.0.0');
            $table->string('status', 20)->default('active'); // active, revoked, pending
            $table->string('ip_address', 45)->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('last_sync_at')->nullable();
            $table->boolean('force_resync')->default(false);
            $table->string('revoke_reason')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('devices');
        Schema::dropIfExists('user_sessions');
        Schema::dropIfExists('personal_access_tokens');
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('users');
        Schema::dropIfExists('stores');
    }
};

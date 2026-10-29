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
        if (!Schema::hasTable('device_sessions')) {
            Schema::create('device_sessions', function (Blueprint $table) {
                $table->id();
                $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
                $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->foreignId('counter_id')->nullable()->constrained('counters')->nullOnDelete();
                $table->string('device_uuid', 100)->index();
                $table->string('session_id', 100)->unique();
                $table->string('device_name', 100)->nullable();
                $table->string('counter_name', 100)->nullable();
                $table->string('counter_code', 30)->nullable();
                $table->string('ip_address', 45)->nullable();
                $table->string('location', 150)->nullable();
                $table->timestamp('login_time')->nullable();
                $table->timestamp('last_active_at')->nullable();
                $table->string('status', 30)->default('online'); // online, offline, expired, revoked
                $table->boolean('is_active')->default(true);
                $table->text('user_agent')->nullable();
                $table->timestamps();

                $table->index(['store_id', 'is_active']);
                $table->index(['device_uuid', 'is_active']);
                $table->index(['last_active_at']);
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('device_sessions');
    }
};

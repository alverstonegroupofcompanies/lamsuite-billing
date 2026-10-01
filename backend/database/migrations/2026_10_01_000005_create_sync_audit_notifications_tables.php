<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignId('device_id')->nullable()->constrained('devices')->nullOnDelete();
            $table->string('entity_type', 40); // invoice, product, batch, customer, stock_adjustment
            $table->string('entity_id', 100);
            $table->string('action', 20); // create, update, delete
            $table->unsignedInteger('client_version')->default(1);
            $table->unsignedInteger('server_version')->default(1);
            $table->json('client_data')->nullable();
            $table->json('server_data')->nullable();
            $table->string('status', 20)->default('pending'); // pending, resolved, conflict, failed
            $table->text('conflict_reason')->nullable();
            $table->string('resolution', 30)->nullable(); // keep_cloud, keep_local, merge
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('error_message')->nullable();
            $table->timestamps();

            $table->index(['store_id', 'status']);
        });

        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->nullable()->constrained('stores')->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('impersonator_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('action', 50); // login, impersonate, update_store, cancel_invoice, reset_store, etc.
            $table->string('entity_type', 50)->nullable();
            $table->string('entity_id', 50)->nullable();
            $table->json('old_values')->nullable();
            $table->json('new_values')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['store_id', 'created_at']);
            $table->index(['user_id', 'action']);
        });

        Schema::create('notifications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->nullable()->constrained('stores')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->string('title');
            $table->text('message');
            $table->string('type', 40); // stock_low, expiry, store_offline, sync_failure, license_expiry
            $table->boolean('is_read')->default(false);
            $table->json('data')->nullable();
            $table->timestamps();

            $table->index(['store_id', 'is_read']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('sync_events');
    }
};

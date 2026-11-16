<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoice_approvals', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('store_id')->index();
            $table->unsignedBigInteger('invoice_id')->index();
            // edit | cancel
            $table->string('action', 16);
            // manager | one_time_pin
            $table->string('mode', 24);
            // pending | approved | used | revoked | expired
            $table->string('status', 16)->default('pending')->index();

            $table->unsignedBigInteger('requested_by_user_id')->nullable()->index();
            $table->string('requested_by_name')->nullable();
            $table->string('requested_by_counter')->nullable();

            $table->unsignedBigInteger('approved_by_user_id')->nullable()->index();
            $table->string('approved_by_name')->nullable();

            // Only ever the hash of the admin-issued one-time PIN / grant token.
            $table->string('pin_hash')->nullable();
            $table->string('token_hash')->nullable();

            $table->text('reason')->nullable();
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamp('used_at')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_approvals');
    }
};

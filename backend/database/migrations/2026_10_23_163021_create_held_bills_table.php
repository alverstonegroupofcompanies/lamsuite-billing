<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('held_bills', function (Blueprint $table) {
            $table->string('id', 64)->primary();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->string('held_by_counter_id', 50)->nullable();
            $table->string('held_by_counter_name', 100)->nullable();
            $table->string('held_by_user_name', 100)->nullable();
            $table->string('customer_name', 150)->default('Walk-in Customer');
            $table->integer('items_count')->default(0);
            $table->decimal('grand_total', 12, 2)->default(0.00);
            $table->unsignedBigInteger('held_at');
            $table->json('cart_payload');
            $table->string('status', 20)->default('held'); // held, claimed, cancelled
            $table->string('claimed_by_counter_id', 50)->nullable();
            $table->unsignedBigInteger('claimed_at')->nullable();
            $table->timestamps();

            $table->index(['store_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('held_bills');
    }
};

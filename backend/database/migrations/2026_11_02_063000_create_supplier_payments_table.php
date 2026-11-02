<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('supplier_payments')) {
            Schema::create('supplier_payments', function (Blueprint $table) {
                $table->id();
                $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
                $table->foreignId('supplier_id')->constrained('parties')->cascadeOnDelete();
                $table->decimal('amount', 12, 2);
                $table->string('payment_mode', 30)->default('Bank Transfer');
                $table->string('reference_no', 50)->nullable();
                $table->text('notes')->nullable();
                $table->date('payment_date');
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('supplier_payments');
    }
};

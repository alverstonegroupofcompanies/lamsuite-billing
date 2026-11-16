<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('store_day_closes', function (Blueprint $table) {
            $table->json('tender_totals')->nullable();
            $table->decimal('opening_cash', 14, 2)->default(0);
            $table->decimal('expected_cash', 14, 2)->default(0);
            $table->decimal('counted_cash', 14, 2)->nullable();
            $table->decimal('cash_variance', 14, 2)->default(0);
            $table->decimal('cash_expenses', 14, 2)->default(0);
            $table->string('status', 20)->default('open');
            $table->timestamp('locked_at')->nullable();
            $table->index(['store_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('store_day_closes', function (Blueprint $table) {
            $table->dropIndex(['store_id', 'status']);
            $table->dropColumn([
                'tender_totals',
                'opening_cash',
                'expected_cash',
                'counted_cash',
                'cash_variance',
                'cash_expenses',
                'status',
                'locked_at',
            ]);
        });
    }
};

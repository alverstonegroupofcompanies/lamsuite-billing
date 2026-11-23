<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PAY-02 — the money a customer handed over is not the money the bill kept.
 *
 * `amount` stays the applied amount (what the sale actually took), while
 * `tendered_amount` and `change_amount` preserve the drawer side of the story:
 * a ₹500 note on a ₹210 bill is 210 applied, 500 tendered, 290 change.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoice_payments', function (Blueprint $table) {
            if (!Schema::hasColumn('invoice_payments', 'tendered_amount')) {
                $table->decimal('tendered_amount', 12, 2)->nullable()->after('amount');
            }
            if (!Schema::hasColumn('invoice_payments', 'change_amount')) {
                $table->decimal('change_amount', 12, 2)->nullable()->after('tendered_amount');
            }
        });
    }

    public function down(): void
    {
        Schema::table('invoice_payments', function (Blueprint $table) {
            if (Schema::hasColumn('invoice_payments', 'change_amount')) {
                $table->dropColumn('change_amount');
            }
            if (Schema::hasColumn('invoice_payments', 'tendered_amount')) {
                $table->dropColumn('tendered_amount');
            }
        });
    }
};

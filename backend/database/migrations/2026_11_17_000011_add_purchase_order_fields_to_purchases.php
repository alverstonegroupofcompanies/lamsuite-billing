<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchases', function (Blueprint $table) {
            if (!Schema::hasColumn('purchases', 'expected_delivery_date')) {
                $table->date('expected_delivery_date')->nullable()->after('invoice_date');
            }
            if (!Schema::hasColumn('purchases', 'notes')) {
                $table->text('notes')->nullable()->after('cancel_reason');
            }
        });

        Schema::table('purchase_items', function (Blueprint $table) {
            if (!Schema::hasColumn('purchase_items', 'received_qty')) {
                $table->decimal('received_qty', 10, 2)->default(0)->after('qty');
            }
        });
    }

    public function down(): void
    {
        Schema::table('purchases', function (Blueprint $table) {
            $table->dropColumn(['expected_delivery_date', 'notes']);
        });

        Schema::table('purchase_items', function (Blueprint $table) {
            $table->dropColumn('received_qty');
        });
    }
};

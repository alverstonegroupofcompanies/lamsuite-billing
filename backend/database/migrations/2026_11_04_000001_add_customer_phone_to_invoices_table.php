<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('invoices') && !Schema::hasColumn('invoices', 'customer_phone')) {
            Schema::table('invoices', function (Blueprint $table) {
                $table->string('customer_phone', 25)->nullable()->after('customer_name')->index();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('invoices') && Schema::hasColumn('invoices', 'customer_phone')) {
            Schema::table('invoices', function (Blueprint $table) {
                $table->dropColumn('customer_phone');
            });
        }
    }
};

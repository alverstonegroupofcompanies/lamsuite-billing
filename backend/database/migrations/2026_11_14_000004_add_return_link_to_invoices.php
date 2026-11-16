<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            if (!Schema::hasColumn('invoices', 'original_invoice_id')) {
                $table->string('original_invoice_id', 100)->nullable()->index();
            }
            if (!Schema::hasColumn('invoices', 'original_invoice_number')) {
                $table->string('original_invoice_number', 50)->nullable()->index();
            }
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            if (Schema::hasColumn('invoices', 'original_invoice_number')) {
                $table->dropColumn('original_invoice_number');
            }
            if (Schema::hasColumn('invoices', 'original_invoice_id')) {
                $table->dropColumn('original_invoice_id');
            }
        });
    }
};

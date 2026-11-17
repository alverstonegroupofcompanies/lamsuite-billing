<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoice_items', function (Blueprint $table) {
            $table->decimal('free_qty', 10, 2)->default(0)->after('loose_qty');
            $table->decimal('free_loose_qty', 10, 2)->default(0)->after('free_qty');
        });
    }

    public function down(): void
    {
        Schema::table('invoice_items', function (Blueprint $table) {
            $table->dropColumn(['free_qty', 'free_loose_qty']);
        });
    }
};

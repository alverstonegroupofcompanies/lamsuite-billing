<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stores', function (Blueprint $table) {
            if (!Schema::hasColumn('stores', 'store_type')) {
                $table->string('store_type', 40)->default('pharmacy')->after('tax_mode');
            }
            if (!Schema::hasColumn('stores', 'gst_type')) {
                $table->string('gst_type', 30)->default('regular')->after('store_type');
            }
        });
    }

    public function down(): void
    {
        Schema::table('stores', function (Blueprint $table) {
            if (Schema::hasColumn('stores', 'store_type')) {
                $table->dropColumn('store_type');
            }
            if (Schema::hasColumn('stores', 'gst_type')) {
                $table->dropColumn('gst_type');
            }
        });
    }
};

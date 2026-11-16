<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            // Mirrors the desktop master flag so the server can reject loose
            // quantities for sealed products instead of trusting the client.
            $table->boolean('allow_loose_sale')->default(true)->after('units_per_pack');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('allow_loose_sale');
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoice_approvals', function (Blueprint $table) {
            // G12: verify() mints the grant; this column records that the grant
            // was actually redeemed by the cancellation it approved.
            $table->timestamp('consumed_at')->nullable()->after('used_at')->index();
        });
    }

    public function down(): void
    {
        Schema::table('invoice_approvals', function (Blueprint $table) {
            $table->dropColumn('consumed_at');
        });
    }
};

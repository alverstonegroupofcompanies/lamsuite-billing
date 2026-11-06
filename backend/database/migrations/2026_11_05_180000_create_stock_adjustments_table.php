<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('stock_adjustments')) {
            Schema::create('stock_adjustments', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('store_id');
                $table->foreign('store_id')->references('id')->on('stores')->onDelete('cascade');
                $table->string('type')->nullable(); // e.g., 'physical_count', 'correction'
                $table->text('reason')->nullable();
                $table->json('metadata')->nullable(); // extra data such as CSV preview
                $table->timestamps();
            });
        } else {
            Schema::table('stock_adjustments', function (Blueprint $table) {
                if (!Schema::hasColumn('stock_adjustments', 'type')) {
                    $table->string('type')->nullable();
                }
                if (!Schema::hasColumn('stock_adjustments', 'metadata')) {
                    $table->json('metadata')->nullable();
                }
            });
        }
    }
    public function down(): void {
        if (Schema::hasTable('stock_adjustments')) {
            Schema::table('stock_adjustments', function (Blueprint $table) {
                if (Schema::hasColumn('stock_adjustments', 'metadata')) {
                    $table->dropColumn('metadata');
                }
                if (Schema::hasColumn('stock_adjustments', 'type')) {
                    $table->dropColumn('type');
                }
            });
        }
    }
};

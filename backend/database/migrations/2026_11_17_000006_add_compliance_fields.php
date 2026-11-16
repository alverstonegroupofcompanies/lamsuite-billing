<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->string('irn', 64)->nullable();
            $table->string('irn_ack_no', 32)->nullable();
            $table->timestampTz('irn_ack_date')->nullable();
            $table->text('irn_qr')->nullable();
            $table->string('irn_status', 20)->nullable();
            $table->timestampTz('irn_cancelled_at')->nullable();
            $table->string('irn_cancel_reason', 255)->nullable();
            $table->text('irn_error')->nullable();
            $table->string('ewb_number', 16)->nullable();
            $table->timestampTz('ewb_date')->nullable();
            $table->timestampTz('ewb_valid_until')->nullable();
            $table->string('ewb_status', 20)->nullable();
            $table->json('ewb_part_a')->nullable();
            $table->json('ewb_part_b')->nullable();
            $table->index('irn_status');
            $table->index('ewb_number');
        });

        Schema::create('compliance_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->nullable()->constrained()->nullOnDelete();
            $table->string('entity_type', 32);
            $table->string('entity_id', 64);
            $table->string('event', 32);
            $table->string('status', 20)->nullable();
            $table->json('payload')->nullable();
            $table->text('message')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['store_id', 'entity_type', 'entity_id']);
            $table->index(['event', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('compliance_events');

        Schema::table('invoices', function (Blueprint $table) {
            $table->dropIndex(['irn_status']);
            $table->dropIndex(['ewb_number']);
            $table->dropColumn([
                'irn', 'irn_ack_no', 'irn_ack_date', 'irn_qr', 'irn_status',
                'irn_cancelled_at', 'irn_cancel_reason', 'irn_error',
                'ewb_number', 'ewb_date', 'ewb_valid_until', 'ewb_status',
                'ewb_part_a', 'ewb_part_b',
            ]);
        });
    }
};

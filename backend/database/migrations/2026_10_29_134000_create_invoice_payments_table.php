<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('invoices', 'payment_status')) {
            Schema::table('invoices', function (Blueprint $table) {
                $table->string('payment_status', 20)->default('paid')->after('payment_mode');
            });
        }

        Schema::create('invoice_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignId('invoice_id')->constrained('invoices')->cascadeOnDelete();
            $table->string('counter_id', 50)->nullable()->index();
            $table->string('counter_code', 20)->nullable();
            $table->string('payment_mode', 40)->default('Cash')->index();
            $table->decimal('amount', 12, 2)->default(0);
            $table->string('reference_no', 100)->nullable()->index();
            $table->string('status', 30)->default('received')->index(); // received, pending_clearance, cleared, bounced, refunded
            $table->json('extra_fields')->nullable();
            $table->text('notes')->nullable();
            $table->string('received_by', 100)->nullable();
            $table->timestamps();

            $table->index(['store_id', 'payment_mode']);
            $table->index(['store_id', 'status']);
        });

        // Migrate existing legacy invoices into invoice_payments
        $existingInvoices = DB::table('invoices')->select('id', 'store_id', 'counter_id', 'counter_code', 'paid_amount', 'grand_total', 'payment_mode', 'created_at', 'updated_at')->get();
        foreach ($existingInvoices as $inv) {
            $mode = $inv->payment_mode ?: 'Cash';
            $amount = (float)($inv->paid_amount ?: $inv->grand_total);
            
            // Derive payment status
            $status = 'paid';
            if ($amount <= 0.001) {
                $status = 'unpaid';
            } elseif ($amount < ((float)$inv->grand_total - 0.01)) {
                $status = 'partially_paid';
            }
            
            DB::table('invoices')->where('id', $inv->id)->update(['payment_status' => $status]);

            if ($amount > 0) {
                DB::table('invoice_payments')->insert([
                    'store_id' => $inv->store_id,
                    'invoice_id' => $inv->id,
                    'counter_id' => $inv->counter_id,
                    'counter_code' => $inv->counter_code,
                    'payment_mode' => $mode,
                    'amount' => $amount,
                    'reference_no' => null,
                    'status' => 'received',
                    'extra_fields' => null,
                    'notes' => 'Migrated from single-mode invoice record',
                    'received_by' => 'System Migration',
                    'created_at' => $inv->created_at ?: now(),
                    'updated_at' => $inv->updated_at ?: now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_payments');
        if (Schema::hasColumn('invoices', 'payment_status')) {
            Schema::table('invoices', function (Blueprint $table) {
                $table->dropColumn('payment_status');
            });
        }
    }
};

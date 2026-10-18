<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 1. Counters table (represents physical/remote counters in stores)
        if (!Schema::hasTable('counters')) {
            Schema::create('counters', function (Blueprint $table) {
                $table->id();
                $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
                $table->string('counter_code', 20); // e.g. C01, C02, C03
                $table->string('counter_name');
                $table->string('location_name')->default('Main Shop'); // e.g. "Shop Floor", "Owner Home", "Warehouse"
                $table->boolean('is_remote')->default(false);
                $table->boolean('is_hub')->default(false);
                $table->boolean('is_digital_only')->default(false);
                $table->string('status', 20)->default('pending_approval'); // pending_approval, active, revoked, locked
                $table->string('device_uuid')->nullable()->unique();
                $table->string('mac_address')->nullable();
                $table->string('ip_address', 45)->nullable();
                $table->json('role_profile')->nullable(); // permissions: allow_cancel, allow_price_change, allow_stock_adj, require_manager_pin
                $table->string('manager_pin', 64)->nullable();
                $table->json('allowed_user_ids')->nullable(); // optional staff allow-list
                $table->json('printer_profile')->nullable(); // layout, printer name, paper size, direct print
                $table->json('receipt_customization')->nullable(); // header, footer, tax summary flag
                $table->json('visible_menus')->nullable(); // navigation menu filters
                $table->timestamp('last_seen_at')->nullable();
                $table->timestamp('last_sync_at')->nullable();
                $table->unsignedBigInteger('last_synced_watermark')->default(0);
                $table->string('revoke_reason')->nullable();
                $table->timestamps();

                $table->unique(['store_id', 'counter_code']);
            });
        }

        // 2. Counter Leased Number Series (prefix per counter or leased block ranges)
        if (!Schema::hasTable('counter_sequences')) {
            Schema::create('counter_sequences', function (Blueprint $table) {
                $table->id();
                $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
                $table->foreignId('counter_id')->constrained('counters')->cascadeOnDelete();
                $table->string('doc_type', 30); // invoice, sales_return, receipt, stock_transfer
                $table->string('financial_year', 15); // e.g. 2026-27
                $table->string('prefix', 30); // e.g. C03-INV
                $table->unsignedBigInteger('range_start')->nullable();
                $table->unsignedBigInteger('range_end')->nullable();
                $table->unsignedBigInteger('next_number')->default(1001);
                $table->timestamps();

                $table->unique(['counter_id', 'doc_type', 'financial_year'], 'counter_doc_fy_unique');
            });
        }

        // 3. Counter Shifts & Cash Drawer Closures
        if (!Schema::hasTable('counter_shifts')) {
            Schema::create('counter_shifts', function (Blueprint $table) {
                $table->id();
                $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
                $table->foreignId('counter_id')->constrained('counters')->cascadeOnDelete();
                $table->foreignId('opened_by_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->foreignId('closed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->decimal('opening_float', 12, 2)->default(0.00);
                $table->decimal('cash_sales', 12, 2)->default(0.00);
                $table->decimal('digital_sales', 12, 2)->default(0.00);
                $table->decimal('cash_refunds', 12, 2)->default(0.00);
                $table->decimal('cash_drops', 12, 2)->default(0.00);
                $table->decimal('closing_cash_actual', 12, 2)->nullable();
                $table->decimal('closing_discrepancy', 12, 2)->nullable();
                $table->string('status', 20)->default('open'); // open, closed
                $table->timestamp('opened_at')->useCurrent();
                $table->timestamp('closed_at')->nullable();
                $table->text('notes')->nullable();
                $table->timestamps();
            });
        }

        // 4. Day Close Consolidation (Store-wide)
        if (!Schema::hasTable('store_day_closes')) {
            Schema::create('store_day_closes', function (Blueprint $table) {
                $table->id();
                $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
                $table->date('close_date');
                $table->decimal('total_gross_sales', 14, 2)->default(0.00);
                $table->decimal('total_tax_collected', 14, 2)->default(0.00);
                $table->decimal('total_cash_collected', 14, 2)->default(0.00);
                $table->decimal('total_digital_collected', 14, 2)->default(0.00);
                $table->decimal('total_refunds', 14, 2)->default(0.00);
                $table->decimal('net_cash_in_hand', 14, 2)->default(0.00);
                $table->integer('total_bills_count')->default(0);
                $table->json('counter_breakdowns')->nullable();
                $table->foreignId('closed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->text('reconciliation_notes')->nullable();
                $table->timestamps();

                $table->unique(['store_id', 'close_date']);
            });
        }

        // 5. Enhance Invoices table with remote counter identification & lock mechanism
        Schema::table('invoices', function (Blueprint $table) {
            if (!Schema::hasColumn('invoices', 'counter_id')) {
                $table->foreignId('counter_id')->nullable()->constrained('counters')->nullOnDelete();
            }
            if (!Schema::hasColumn('invoices', 'counter_code')) {
                $table->string('counter_code', 20)->nullable();
            }
            if (!Schema::hasColumn('invoices', 'location_name')) {
                $table->string('location_name', 100)->nullable();
            }
            if (!Schema::hasColumn('invoices', 'locked_by_counter_id')) {
                $table->foreignId('locked_by_counter_id')->nullable()->constrained('counters')->nullOnDelete();
            }
            if (!Schema::hasColumn('invoices', 'locked_until')) {
                $table->timestamp('locked_until')->nullable();
            }
        });

        // 6. Enhance Stock ledger entries table with counter tagging & negative stock flags
        if (!Schema::hasTable('stock_ledger_entries')) {
            Schema::create('stock_ledger_entries', function (Blueprint $table) {
                $table->id();
                $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
                $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
                $table->foreignId('batch_id')->nullable()->constrained('product_batches')->nullOnDelete();
                $table->foreignId('counter_id')->nullable()->constrained('counters')->nullOnDelete();
                $table->string('counter_code', 20)->nullable();
                $table->string('location_name', 100)->nullable();
                $table->string('event_type', 30); // SALE, RETURN, PURCHASE, PURCHASE_RETURN, ADJUSTMENT, TRANSFER_IN, TRANSFER_OUT
                $table->decimal('qty_delta', 12, 3);
                $table->string('reference_type', 50)->nullable(); // invoice, sales_return, purchase, stock_adjustment
                $table->string('reference_id', 100)->nullable();
                $table->boolean('is_reconciled_negative')->default(false);
                $table->decimal('balance_after', 12, 3)->nullable();
                $table->string('idempotency_key', 100)->nullable()->unique();
                $table->foreignId('staff_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_ledger_entries');

        Schema::table('invoices', function (Blueprint $table) {
            $table->dropForeign(['counter_id']);
            $table->dropForeign(['locked_by_counter_id']);
            $table->dropColumn(['counter_id', 'counter_code', 'location_name', 'locked_by_counter_id', 'locked_until']);
        });

        Schema::dropIfExists('store_day_closes');
        Schema::dropIfExists('counter_shifts');
        Schema::dropIfExists('counter_sequences');
        Schema::dropIfExists('counters');
    }
};

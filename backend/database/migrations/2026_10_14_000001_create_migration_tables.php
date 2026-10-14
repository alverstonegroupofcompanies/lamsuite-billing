<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('migration_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('run_uuid', 64)->unique();
            $table->string('source_type', 30); // api, file, device
            $table->string('source_reference')->nullable(); // API URL or filename
            $table->string('status', 30)->default('pending'); // pending, prechecking, running, paused, completed, failed, rolled_back
            $table->boolean('is_dry_run')->default(false);
            $table->json('source_manifest')->nullable();
            $table->json('precheck_results')->nullable();
            $table->json('mapping_config')->nullable();
            $table->json('progress_stats')->nullable(); // per-entity counts, speed, eta
            $table->json('reconciliation_summary')->nullable();
            $table->string('cutover_confirmation')->nullable();
            $table->timestamp('cutover_at')->nullable();
            $table->string('backup_path')->nullable();
            $table->text('error_message')->nullable();
            $table->timestamps();

            $table->index(['store_id', 'status']);
        });

        Schema::create('migration_id_maps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->string('migration_run_uuid', 64)->index();
            $table->string('entity_type', 40); // store, lookup, party, user, product, batch, invoice, purchase, stock_adj, expense, payment
            $table->string('old_id', 100);
            $table->string('new_id', 100);
            $table->string('old_uuid', 100)->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->unique(['store_id', 'entity_type', 'old_id']);
            $table->index(['store_id', 'entity_type', 'new_id']);
        });

        Schema::create('migration_unresolved_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->string('migration_run_uuid', 64)->index();
            $table->string('entity_type', 40);
            $table->string('old_id', 100)->nullable();
            $table->string('reason');
            $table->json('raw_payload')->nullable();
            $table->string('resolution_status', 30)->default('unresolved'); // unresolved, ignored, fixed, migrated
            $table->timestamps();

            $table->index(['store_id', 'resolution_status']);
        });

        Schema::create('migration_reconciliation_reports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->string('migration_run_uuid', 64)->unique();
            $table->boolean('is_passed')->default(false);
            $table->json('counts_comparison')->nullable();
            $table->json('financial_comparison')->nullable(); // sales, purchases, taxes to the paisa
            $table->json('tax_slab_comparison')->nullable(); // 0, 5, 12, 18, 28%
            $table->json('stock_comparison')->nullable(); // qty and valuation
            $table->json('balance_comparison')->nullable(); // customer and supplier balances
            $table->json('discrepancies')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('migration_reconciliation_reports');
        Schema::dropIfExists('migration_unresolved_items');
        Schema::dropIfExists('migration_id_maps');
        Schema::dropIfExists('migration_runs');
    }
};

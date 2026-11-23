<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CR-C supplier bill charges: the charge lines of a supplier bill and the paisa-exact
 * share each line of goods absorbed. Both are children of the purchase aggregate and are
 * store-scoped (rule R12 / R6), so a charge can never point at another store's bill.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_charges', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignId('purchase_id')->constrained('purchases')->cascadeOnDelete();
            $table->string('external_id', 64);
            $table->unsignedInteger('seq')->default(1);

            // Denormalised head identity: a posted charge survives the deletion of its head.
            $table->string('head_code', 40);
            $table->string('head_name', 100);
            $table->text('note')->nullable();

            $table->string('treatment', 20)->default('add_to_cost');
            $table->string('spread_method', 20)->default('value');
            $table->string('spread_basis_used', 20)->default('value');
            $table->string('itc_eligibility', 20)->default('eligible');
            $table->boolean('is_rcm')->default(false);
            $table->boolean('paid_separately')->default(false);
            $table->string('paid_to_label', 120)->nullable();
            $table->string('place_of_supply', 10)->nullable();
            $table->string('sac_code', 20)->nullable();

            // Signed: a negative charge is a cash discount, round-off or TCS on the bill.
            $table->decimal('amount', 12, 2);
            $table->decimal('gst_percent', 5, 2)->default(0);
            $table->decimal('taxable_amount', 12, 2)->default(0);
            $table->decimal('cgst_amount', 12, 2)->default(0);
            $table->decimal('sgst_amount', 12, 2)->default(0);
            $table->decimal('igst_amount', 12, 2)->default(0);
            $table->decimal('cess_amount', 12, 2)->default(0);
            $table->decimal('total_amount', 12, 2)->default(0);

            // == taxable_amount for an add_to_cost charge, 0 for an expensed one.
            $table->decimal('allocated_amount', 12, 2)->default(0);
            $table->string('source', 20)->default('manual');
            $table->foreignId('expense_id')->nullable()->constrained('expenses')->nullOnDelete();
            $table->decimal('reversed_amount', 12, 2)->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['store_id', 'external_id']);
            $table->index('purchase_id');
            $table->index(['store_id', 'head_code']);
        });

        Schema::create('purchase_charge_allocations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignId('purchase_charge_id')->constrained('purchase_charges')->cascadeOnDelete();
            $table->foreignId('purchase_item_id')->constrained('purchase_items')->cascadeOnDelete();
            $table->foreignId('batch_id')->nullable()->constrained('product_batches')->nullOnDelete();
            $table->decimal('basis_amount', 14, 4)->default(0);
            $table->decimal('basis_share', 9, 6)->default(0);
            $table->decimal('allocated_amount', 12, 2)->default(0);
            $table->boolean('is_remainder_paisa')->default(false);
            $table->timestamps();

            $table->unique(['purchase_charge_id', 'purchase_item_id'], 'purchase_charge_alloc_charge_line_unique');
            $table->index(['store_id', 'purchase_item_id']);
        });

        if (DB::connection()->getDriverName() === 'sqlite') {
            $this->createSqliteStoreGuards();
        } else {
            Schema::table('purchases', fn (Blueprint $t) => $t->unique(['id', 'store_id'], 'purchases_id_store_unique'));
            Schema::table('purchase_charges', fn (Blueprint $t) => $t->unique(['id', 'store_id'], 'purchase_charges_id_store_unique'));

            Schema::table('purchase_charges', function (Blueprint $table) {
                $table->foreign(['purchase_id', 'store_id'], 'crcc_charge_store_match')
                    ->references(['id', 'store_id'])->on('purchases');
            });
            Schema::table('purchase_charge_allocations', function (Blueprint $table) {
                $table->foreign(['purchase_charge_id', 'store_id'], 'crcc_allocation_store_match')
                    ->references(['id', 'store_id'])->on('purchase_charges');
            });
        }
    }

    private function createSqliteStoreGuards(): void
    {
        $guards = [
            [
                'name' => 'crcc_purchase_charges_insert_guard',
                'event' => 'INSERT',
                'table' => 'purchase_charges',
                'when' => '(SELECT p.store_id FROM purchases p WHERE p.id = NEW.purchase_id) IS NOT NEW.store_id',
            ],
            [
                'name' => 'crcc_purchase_charges_update_guard',
                'event' => 'UPDATE OF store_id, purchase_id',
                'table' => 'purchase_charges',
                'when' => '(SELECT p.store_id FROM purchases p WHERE p.id = NEW.purchase_id) IS NOT NEW.store_id',
            ],
            [
                'name' => 'crcc_charge_allocations_insert_guard',
                'event' => 'INSERT',
                'table' => 'purchase_charge_allocations',
                'when' => '(SELECT c.store_id FROM purchase_charges c WHERE c.id = NEW.purchase_charge_id) IS NOT NEW.store_id
                        OR (SELECT p.store_id FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id WHERE i.id = NEW.purchase_item_id) IS NOT NEW.store_id',
            ],
            [
                'name' => 'crcc_charge_allocations_update_guard',
                'event' => 'UPDATE OF store_id, purchase_charge_id, purchase_item_id',
                'table' => 'purchase_charge_allocations',
                'when' => '(SELECT c.store_id FROM purchase_charges c WHERE c.id = NEW.purchase_charge_id) IS NOT NEW.store_id
                        OR (SELECT p.store_id FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id WHERE i.id = NEW.purchase_item_id) IS NOT NEW.store_id',
            ],
        ];

        foreach ($guards as $guard) {
            DB::statement("DROP TRIGGER IF EXISTS {$guard['name']}");
            DB::statement(<<<SQL
                CREATE TRIGGER {$guard['name']}
                BEFORE {$guard['event']} ON {$guard['table']}
                FOR EACH ROW
                WHEN {$guard['when']}
                BEGIN
                    SELECT RAISE(ABORT, 'CR-C: a charge or allocation cannot cross the store of its purchase');
                END;
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            foreach ([
                'crcc_purchase_charges_insert_guard',
                'crcc_purchase_charges_update_guard',
                'crcc_charge_allocations_insert_guard',
                'crcc_charge_allocations_update_guard',
            ] as $name) {
                DB::statement("DROP TRIGGER IF EXISTS {$name}");
            }
        } else {
            Schema::table('purchase_charge_allocations', fn (Blueprint $t) => $t->dropForeign('crcc_allocation_store_match'));
            Schema::table('purchase_charges', fn (Blueprint $t) => $t->dropForeign('crcc_charge_store_match'));
            Schema::table('purchase_charges', fn (Blueprint $t) => $t->dropUnique('purchase_charges_id_store_unique'));
            Schema::table('purchases', fn (Blueprint $t) => $t->dropUnique('purchases_id_store_unique'));
        }

        Schema::dropIfExists('purchase_charge_allocations');
        Schema::dropIfExists('purchase_charges');
    }
};

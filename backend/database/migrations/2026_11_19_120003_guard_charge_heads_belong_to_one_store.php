<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Rule R12: a charge head belongs to exactly one store. Unlike the legacy shared
 * lookups (group, brand, bank…) a `charge_head` row may never be store-less, because
 * another store's freight defaults must not appear in this store's charges grid.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            foreach ([
                ['crcc_charge_head_insert_guard', 'INSERT'],
                ['crcc_charge_head_update_guard', 'UPDATE OF store_id, type'],
            ] as [$name, $event]) {
                DB::statement("DROP TRIGGER IF EXISTS {$name}");
                DB::statement(<<<SQL
                    CREATE TRIGGER {$name}
                    BEFORE {$event} ON master_lookups
                    FOR EACH ROW
                    WHEN NEW.type = 'charge_head' AND NEW.store_id IS NULL
                    BEGIN
                        SELECT RAISE(ABORT, 'R12: a charge head must belong to one store');
                    END;
                SQL);
            }

            return;
        }

        DB::statement(<<<'SQL'
            ALTER TABLE master_lookups
            ADD CONSTRAINT crcc_charge_head_store_required
            CHECK (type <> 'charge_head' OR store_id IS NOT NULL)
        SQL);
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            foreach (['crcc_charge_head_insert_guard', 'crcc_charge_head_update_guard'] as $name) {
                DB::statement("DROP TRIGGER IF EXISTS {$name}");
            }

            return;
        }

        DB::statement('ALTER TABLE master_lookups DROP CONSTRAINT crcc_charge_head_store_required');
    }
};

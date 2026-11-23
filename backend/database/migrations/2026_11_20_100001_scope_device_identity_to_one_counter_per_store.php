<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * CNT-008 — a workstation's identity is per store, not per machine.
 *
 * `devices.device_uuid` and `counters.device_uuid` were globally unique, so one
 * laptop could only ever exist in one store and could only ever sit on one
 * counter anywhere. Both keys become store-scoped: the same machine may hold one
 * claimed counter in each store it works, and never two live counters inside the
 * same store (CounterClaimService refuses that, and this index backs it).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'sqlite') {
            return; // Application-level claim guard covers other drivers.
        }

        DB::statement('DROP INDEX IF EXISTS devices_device_uuid_unique');
        DB::statement(
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_store_device_uuid
             ON devices (store_id, device_uuid)'
        );

        DB::statement('DROP INDEX IF EXISTS counters_device_uuid_unique');
        DB::statement(
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_counters_store_device_uuid
             ON counters (store_id, device_uuid)
             WHERE device_uuid IS NOT NULL'
        );
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'sqlite') {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS idx_devices_store_device_uuid');
        DB::statement('DROP INDEX IF EXISTS idx_counters_store_device_uuid');

        // A machine working two stores cannot fit back into one global key. The
        // oldest claim keeps its identity and the rest are released by name, so
        // no row is lost and the old index can be rebuilt (same treatment the
        // duplicate counter-name migration used).
        foreach (['counters' => 'id', 'devices' => 'id'] as $table => $order) {
            $shared = DB::table($table)
                ->select('device_uuid')
                ->whereNotNull('device_uuid')
                ->groupBy('device_uuid')
                ->havingRaw('COUNT(*) > 1')
                ->pluck('device_uuid');

            foreach ($shared as $uuid) {
                $release = DB::table($table)
                    ->where('device_uuid', $uuid)
                    ->orderBy($order)
                    ->pluck('id')
                    ->slice(1);

                foreach ($release as $id) {
                    DB::table($table)->where('id', $id)->update([
                        'device_uuid' => $uuid . '#store-released-' . $id,
                    ]);
                }
            }
        }

        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS devices_device_uuid_unique ON devices (device_uuid)');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS counters_device_uuid_unique ON counters (device_uuid)');
    }
};

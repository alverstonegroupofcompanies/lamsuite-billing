<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Enforce store-scoped unique counter names for live counters.
     * Revoked counters release their name for replacement workstations.
     */
    public function up(): void
    {
        if (DB::getDriverName() !== 'sqlite') {
            return; // Application-level transactional checks cover other drivers.
        }

        // Rename pre-existing duplicates (keep the oldest counter) so the index
        // can be created without failing on legacy data.
        $duplicates = DB::table('counters')
            ->select('store_id', 'counter_name', DB::raw('COUNT(*) as total'))
            ->whereIn('status', ['active', 'locked', 'pending_approval'])
            ->whereNotNull('counter_name')
            ->groupBy('store_id', 'counter_name')
            ->having('total', '>', 1)
            ->get();

        foreach ($duplicates as $duplicate) {
            $ids = DB::table('counters')
                ->where('store_id', $duplicate->store_id)
                ->where('counter_name', $duplicate->counter_name)
                ->whereIn('status', ['active', 'locked', 'pending_approval'])
                ->orderBy('id')
                ->pluck('id');

            foreach ($ids->slice(1) as $id) {
                DB::table('counters')
                    ->where('id', $id)
                    ->update(['counter_name' => $duplicate->counter_name . ' (' . $id . ')']);
            }
        }

        DB::statement(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_counters_store_live_name
             ON counters (store_id, counter_name COLLATE NOCASE)
             WHERE status IN ('active', 'locked', 'pending_approval')"
        );
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'sqlite') {
            DB::statement('DROP INDEX IF EXISTS idx_counters_store_live_name');
        }
    }
};

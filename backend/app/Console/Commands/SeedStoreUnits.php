<?php

namespace App\Console\Commands;

use App\Models\Store;
use App\Services\Masters\UnitDefaultsService;
use Illuminate\Console\Command;

class SeedStoreUnits extends Command
{
    protected $signature = 'units:seed-store-defaults
        {--store= : Seed only this store id (default: every store)}
        {--dry-run : Report what would be seeded without writing}';

    protected $description = 'Seed per-store default units and remove legacy shared unit rows (units are store-scoped)';

    public function handle(UnitDefaultsService $units): int
    {
        $dryRun = (bool) $this->option('dry-run');

        $storeId = $this->option('store');
        $stores = $storeId
            ? Store::where('id', (int) $storeId)->get()
            : Store::orderBy('id')->get();

        if ($stores->isEmpty()) {
            $this->warn('No stores found.');
            return self::SUCCESS;
        }

        foreach ($stores as $store) {
            $missing = $units->missingDefaultsForStore($store->id);
            if ($dryRun) {
                $this->line(sprintf(
                    '[dry] Store #%d %s: would seed %d unit(s)%s',
                    $store->id,
                    $store->name,
                    count($missing),
                    $missing === [] ? '' : ': ' . implode(', ', $missing)
                ));
                continue;
            }

            $seeded = $units->seedDefaultsForStore($store->id);
            $this->line(sprintf(
                'Store #%d %s: %s',
                $store->id,
                $store->name,
                $seeded === []
                    ? 'default units already complete'
                    : 'seeded ' . count($seeded) . ' unit(s): ' . implode(', ', $seeded)
            ));
        }

        if ($dryRun) {
            $this->line('[dry] legacy shared unit rows left in place');
            return self::SUCCESS;
        }

        $purged = $units->purgeSharedUnitRows();
        $this->line($purged === 0
            ? 'No legacy shared (NULL-store) unit rows to remove.'
            : "Removed {$purged} legacy shared (NULL-store) unit row(s) — units are store-scoped now.");

        return self::SUCCESS;
    }
}

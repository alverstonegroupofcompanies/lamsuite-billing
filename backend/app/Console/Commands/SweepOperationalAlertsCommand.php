<?php

namespace App\Console\Commands;

use App\Services\Alerts\OperationalAlertService;
use Illuminate\Console\Command;

class SweepOperationalAlertsCommand extends Command
{
    protected $signature = 'alerts:sweep {--store= : Limit the sweep to one store id}';
    protected $description = 'Raise low-stock, expiry, offline-device, offline-counter and sync-failure alerts';

    public function handle(OperationalAlertService $alerts): int
    {
        $storeId = $this->option('store');
        $created = $alerts->sweep($storeId ? (int) $storeId : null);

        $this->info("Operational alert sweep complete: {$created} alert(s) raised.");

        return self::SUCCESS;
    }
}

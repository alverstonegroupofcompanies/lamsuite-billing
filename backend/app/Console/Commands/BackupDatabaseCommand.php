<?php

namespace App\Console\Commands;

use App\Services\Backup\DatabaseBackupService;
use Illuminate\Console\Command;

class BackupDatabaseCommand extends Command
{
    protected $signature = 'backup:database
                            {--kind=scheduled : Backup kind label (scheduled, manual, pre_restore)}
                            {--no-prune : Skip retention pruning after the snapshot}';

    protected $description = 'Create a compressed database snapshot and prune expired backups.';

    public function handle(DatabaseBackupService $service): int
    {
        if (! $service->supportsSnapshots()) {
            $this->error("Snapshots are not configured for the {$service->driver()} driver.");

            return self::FAILURE;
        }

        try {
            $run = $service->create((string) $this->option('kind'));
        } catch (\Throwable $e) {
            $this->error('Backup failed: ' . $e->getMessage());

            return self::FAILURE;
        }

        $this->info(sprintf(
            'Backup #%d created: %s (%s MB, sha256 %s)',
            $run->id,
            $run->filename,
            number_format($run->size_bytes / 1048576, 2),
            substr((string) $run->sha256, 0, 12)
        ));

        if (! $this->option('no-prune')) {
            $pruned = $service->prune();
            $this->line("Retention pruned {$pruned['deleted']} snapshot(s); {$pruned['kept']} remain.");
        }

        return self::SUCCESS;
    }
}

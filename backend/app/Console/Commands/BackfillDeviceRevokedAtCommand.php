<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\Device;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * SYNC-02 backfill. Devices revoked before `devices.revoked_at` existed carry no
 * revocation time, so the stranded-bill door cannot tell what such a till sold
 * before it was retired. The best record of that moment is the row's last
 * update, which is when its status became "revoked" unless something touched
 * it afterwards; the command prints every candidate and writes nothing until
 * --apply.
 */
class BackfillDeviceRevokedAtCommand extends Command
{
    protected $signature = 'devices:backfill-revoked-at
        {--apply : Write the changes (default is a dry run)}
        {--store= : Limit to one store id}';

    protected $description = 'Stamp revoked_at on devices revoked before the column existed (SYNC-02)';

    public function handle(): int
    {
        $query = Device::query()
            ->where('status', 'revoked')
            ->whereNull('revoked_at')
            ->orderBy('id');

        if ($this->option('store') !== null) {
            $query->where('store_id', (int) $this->option('store'));
        }

        $rows = $query->get(['id', 'store_id', 'device_uuid', 'counter_id', 'revoke_reason', 'updated_at']);

        if ($rows->isEmpty()) {
            $this->info('No revoked device is missing its revocation time.');

            return self::SUCCESS;
        }

        $this->table(
            ['device', 'store', 'uuid', 'counter', 'reason', 'revoked_at (from updated_at)'],
            $rows->map(fn (Device $d) => [
                $d->id,
                $d->store_id,
                $d->device_uuid,
                $d->counter_id,
                $d->revoke_reason,
                $d->updated_at?->toDateTimeString() ?? '(none: left empty)',
            ])->all()
        );

        if (!$this->option('apply')) {
            $this->warn(sprintf('Dry run: %d device(s) would be stamped. Run again with --apply to write.', $rows->count()));

            return self::SUCCESS;
        }

        $stamped = 0;
        DB::transaction(function () use ($rows, &$stamped) {
            foreach ($rows as $device) {
                if (!$device->updated_at) {
                    continue;
                }
                // A query update: the model hook stamps "now", which is not when it happened.
                $stamped += Device::whereKey($device->id)
                    ->whereNull('revoked_at')
                    ->update(['revoked_at' => $device->updated_at]);
            }
        });

        AuditLog::log('devices_revoked_at_backfilled', 'Device', null, null, ['stamped' => $stamped]);

        $this->info("Stamped {$stamped} device(s).");

        return self::SUCCESS;
    }
}

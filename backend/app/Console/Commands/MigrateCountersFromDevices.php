<?php

namespace App\Console\Commands;

use App\Models\Counter;
use App\Models\Device;
use App\Models\Store;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * CNT-012 — one-time conversion of the workstations a store registered under the
 * old device-key flow into counters the owner owns.
 *
 * A customer may already hold a bill printed with a number and a counter on it, so
 * the move preserves three things exactly: the name the operator sees, the numbers
 * already issued on each counter, and which counter issued each old bill. Nothing
 * is guessed: a bill no counter can be held for is reported, never assigned.
 *
 * Every write is journalled into the manifest so --rollback can undo it, a second
 * run changes nothing, and --dry-run computes the same report without writing.
 */
class MigrateCountersFromDevices extends Command
{
    protected $signature = 'counters:migrate-from-devices {--dry-run} {--rollback}';

    protected $description = 'CNT-012: convert registered POS devices into counters, preserving names, issued numbers and bill history, with a JSON manifest, --dry-run and --rollback';

    private const MANIFEST = 'counters-migrate-from-devices.json';

    /** The series every counter must hold, matching CounterSequenceService. */
    private const DOC_TAILS = ['invoice' => 'INV', 'sales_return' => 'SR', 'receipt' => 'REC'];

    private bool $dryRun = false;

    private array $journal = ['changes' => [], 'created' => []];

    private array $notes = [];

    private int $fakeId = -1;

    public function handle(): int
    {
        if ($this->option('rollback')) {
            return $this->rollback();
        }

        $this->dryRun = (bool) $this->option('dry-run');
        $this->journal = ['changes' => [], 'created' => []];
        $this->notes = [];
        $this->fakeId = -1;

        $summary = [
            'counters_created' => 0,
            'counters_linked' => 0,
            'devices_skipped' => 0,
            'series_seeded' => 0,
            'series_adopted' => 0,
            'history_attributed' => 0,
        ];
        $perStore = [];

        foreach (Store::orderBy('id')->get() as $store) {
            $report = $this->migrateStore($store);
            if ($report['devices_scanned'] === 0) {
                continue;
            }

            foreach ($summary as $key => $value) {
                $summary[$key] = $value + $report[$key];
            }

            $perStore[] = [
                'store_id' => (int) $store->id,
                'name' => $store->name,
                'code' => $store->code,
                'devices_scanned' => $report['devices_scanned'],
                'counters_created' => $report['counters_created'],
                'counters_linked' => $report['counters_linked'],
                'series_seeded' => $report['series_seeded'],
                'history_attributed' => $report['history_attributed'],
            ];
        }

        $manifest = array_merge(
            ['ran_at' => now()->toIso8601String(), 'dry_run' => $this->dryRun],
            $summary,
            ['per_store' => $perStore, 'notes' => $this->notes],
            $this->journal
        );

        $this->line(json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        if ($this->dryRun) {
            $this->info('Dry run: nothing was written and no manifest was left to roll back.');

            return self::SUCCESS;
        }

        $path = $this->manifestPath();
        file_put_contents($path, json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        $this->info('Manifest and rollback journal written to ' . $path
            . ' (' . count($this->journal['changes']) . ' changes, ' . count($this->journal['created']) . ' rows created)');

        return self::SUCCESS;
    }

    private function migrateStore(Store $store): array
    {
        $devices = Device::where('store_id', $store->id)->orderBy('id')->get();

        $report = [
            'devices_scanned' => $devices->count(),
            'devices_skipped' => 0,
            'counters_created' => 0,
            'counters_linked' => 0,
            'series_seeded' => 0,
            'series_adopted' => 0,
            'history_attributed' => 0,
        ];

        if ($devices->isEmpty()) {
            return $report;
        }

        $counters = [];
        foreach (Counter::where('store_id', $store->id)->orderBy('id')->get() as $counter) {
            $counters[(int) $counter->id] = $counter;
        }

        $takenNames = $this->liveNames($store->id);
        $bindings = [];
        $deviceCount = [];

        foreach ($devices as $device) {
            if ($device->status !== 'active') {
                $report['devices_skipped']++;
                $this->notes[] = "device#{$device->id} ('{$device->device_name}') has status '{$device->status}'; it was not converted and needs a counter code.";
                continue;
            }

            $counter = $this->resolveLinkedCounter($store, $device, $counters);

            if (!$counter) {
                $code = $this->nextCode($counters);
                $name = $this->uniqueName($device->device_name ?: "Counter {$code}", $takenNames);

                $id = $this->insert('counters', [
                    'store_id' => $store->id,
                    'counter_code' => $code,
                    'counter_name' => $name,
                    'status' => Counter::STATUS_ACTIVE,
                    'device_uuid' => $device->device_uuid,
                    'current_device_id' => $device->id,
                    'is_remote' => false,
                    'is_hub' => false,
                    'permission_profile_version' => 1,
                    'ip_address' => $device->ip_address,
                    'last_seen_at' => $device->last_seen_at,
                    'last_sync_at' => $device->last_sync_at,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                $counters[$id] = (new Counter())->forceFill([
                    'id' => $id,
                    'store_id' => $store->id,
                    'counter_code' => $code,
                    'counter_name' => $name,
                    'status' => Counter::STATUS_ACTIVE,
                    'device_uuid' => $device->device_uuid,
                    'current_device_id' => $device->id,
                ]);

                $this->set('devices', (int) $device->id, ['counter_id' => [$device->counter_id, (string) $id]]);
                $report['counters_created']++;
                $this->notes[] = "device#{$device->id} became counter {$code} ('{$name}').";
                continue;
            }

            if ($counter->status === Counter::STATUS_REVOKED) {
                $this->notes[] = "counter {$counter->counter_code} is revoked; device#{$device->id} still points at it and needs a re-issued code.";
                continue;
            }

            $id = (int) $counter->id;
            $deviceCount[$id] = ($deviceCount[$id] ?? 0) + 1;

            // CNT-011: the counter is the principal, so its binding follows the
            // workstation actually in use. The others keep their own tokens.
            $previous = $bindings[$id] ?? null;
            $seen = strtotime((string) ($device->last_seen_at ?: '1970-01-01'));
            if (!$previous || $seen >= strtotime((string) ($previous->last_seen_at ?: '1970-01-01'))) {
                $bindings[$id] = $device;
            }
        }

        $changes = [];

        foreach ($bindings as $id => $device) {
            $counter = $counters[$id];

            if ($counter->status === Counter::STATUS_UNCLAIMED) {
                $changes[$id]['status'] = [Counter::STATUS_UNCLAIMED, Counter::STATUS_ACTIVE];
            }
            if (!$counter->device_uuid && $device->device_uuid) {
                $changes[$id]['device_uuid'] = [$counter->device_uuid, $device->device_uuid];
            }
            if ((int) $counter->current_device_id !== (int) $device->id) {
                $changes[$id]['current_device_id'] = [$counter->current_device_id, (int) $device->id];
            }

            if (($deviceCount[$id] ?? 0) > 1) {
                $this->notes[] = "counter {$counter->counter_code} has {$deviceCount[$id]} devices registered; '{$device->device_name}' holds the binding and the others keep working.";
            }
        }

        foreach ($changes as $id => $columns) {
            $this->set('counters', (int) $id, $columns);
            $counters[$id]->forceFill(array_map(fn ($pair) => $pair[1], $columns))->syncOriginal();
            $report['counters_linked']++;
        }

        $report['history_attributed'] = $this->attributeHistory($store, $counters);
        [$report['series_seeded'], $report['series_adopted']] = $this->ensureSeries($store, $counters);

        return $report;
    }

    /**
     * The device row already named a counter. A pointer that does not resolve
     * inside this store is never followed: no migration may attach one tenant's
     * workstation to another tenant's counter, so the device gets its own.
     */
    private function resolveLinkedCounter(Store $store, Device $device, array $counters): ?Counter
    {
        $claimed = trim((string) $device->counter_id);

        if ($claimed === '') {
            return null;
        }

        if (ctype_digit($claimed) && isset($counters[(int) $claimed])) {
            return $counters[(int) $claimed];
        }

        $foreign = ctype_digit($claimed)
            ? Counter::where('store_id', '!=', $store->id)->where('id', (int) $claimed)->exists()
            : false;

        $this->notes[] = $foreign
            ? "device#{$device->id} pointed at counter #{$claimed} in another store; it was given a counter of its own in store {$store->code}."
            : "device#{$device->id} pointed at '{$claimed}', which is not a counter of this store; it was given a counter of its own.";

        return null;
    }

    /** Old bills keep their issuer: the number printed on them first, then its code. */
    private function attributeHistory(Store $store, array $counters): int
    {
        $byCode = [];
        foreach ($counters as $counter) {
            $byCode[strtoupper((string) $counter->counter_code)] = $counter;
        }

        $only = count($byCode) === 1 ? reset($byCode) : null;
        $attributed = 0;

        $orphans = DB::table('invoices')
            ->where('store_id', $store->id)
            ->where(function ($query) {
                $query->whereNull('counter_id')->orWhere('counter_id', '');
            })
            ->orderBy('id')
            ->get(['id', 'counter_id', 'invoice_number', 'counter_code']);

        foreach ($orphans as $invoice) {
            $target = null;

            if (preg_match('/^([a-z0-9]+)-(?:' . implode('|', self::DOC_TAILS) . ')-\d+$/i', (string) $invoice->invoice_number, $m)) {
                $target = $byCode[strtoupper($m[1])] ?? null;
            }

            if (!$target && ($code = strtoupper(trim((string) $invoice->counter_code))) && isset($byCode[$code])) {
                $target = $byCode[$code];
            }

            if (!$target && $only) {
                $target = $only;
            }

            if (!$target) {
                $this->notes[] = "invoice#{$invoice->id} ('{$invoice->invoice_number}') is ambiguous: store {$store->code} has "
                    . count($byCode) . ' counters and the bill names neither, so it was left unattributed rather than guessed.';
                continue;
            }

            $this->set('invoices', (int) $invoice->id, ['counter_id' => [$invoice->counter_id, (string) $target->id]]);
            $attributed++;
        }

        return $attributed;
    }

    /**
     * Every counter gets the series it must have, and a series never points back at
     * a number a customer already holds: the highest number already issued on that
     * counter in a financial year wins over a stale counter.
     *
     * @return array{0:int, 1:int} seeded and adopted counts
     */
    private function ensureSeries(Store $store, array $counters): array
    {
        $fy = $this->financialYear();
        $seeded = 0;
        $adopted = 0;

        foreach ($counters as $counter) {
            $issued = $this->issuedByFinancialYear($counter);

            foreach (self::DOC_TAILS as $docType => $tail) {
                $prefix = "{$counter->counter_code}-{$tail}";
                $years = $issued[$docType] ?? [];
                $counterId = (int) $counter->id;

                if (!$this->sequenceExists($counterId, $docType, $fy)) {
                    $next = isset($years[$fy]) ? $years[$fy] + 1 : 1001;
                    $this->insert('counter_sequences', [
                        'store_id' => $store->id,
                        'counter_id' => $counterId,
                        'doc_type' => $docType,
                        'financial_year' => $fy,
                        'prefix' => $prefix,
                        'next_number' => $next,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                    $seeded++;
                    $adopted += $next !== 1001 ? 1 : 0;
                } elseif (isset($years[$fy])) {
                    $adopted += $this->raiseSequence($counterId, $docType, $fy, $years[$fy]);
                }

                foreach ($years as $year => $max) {
                    if ($year === $fy) {
                        continue;
                    }

                    if (!$this->sequenceExists($counterId, $docType, $year)) {
                        $this->insert('counter_sequences', [
                            'store_id' => $store->id,
                            'counter_id' => $counterId,
                            'doc_type' => $docType,
                            'financial_year' => $year,
                            'prefix' => $prefix,
                            'next_number' => $max + 1,
                            'created_at' => now(),
                            'updated_at' => now(),
                        ]);
                        $adopted++;
                        continue;
                    }

                    $adopted += $this->raiseSequence($counterId, $docType, $year, $max);
                }
            }
        }

        return [$seeded, $adopted];
    }

    /** Highest number already printed, per doc type and financial year, on this counter. */
    private function issuedByFinancialYear(Counter $counter): array
    {
        $issued = [];

        $rows = DB::table('invoices')
            ->where('store_id', $counter->store_id)
            ->where('counter_id', (string) $counter->id)
            ->orderBy('id')
            ->get(['invoice_number', 'invoice_date']);

        foreach ($rows as $row) {
            foreach (self::DOC_TAILS as $docType => $tail) {
                $pattern = '/^' . preg_quote(strtoupper((string) $counter->counter_code), '/') . '-' . $tail . '-(\d+)$/i';
                if (preg_match($pattern, strtoupper((string) $row->invoice_number), $m)) {
                    $year = $this->financialYear($row->invoice_date);
                    $issued[$docType][$year] = max($issued[$docType][$year] ?? 0, (int) $m[1]);
                }
            }
        }

        return $issued;
    }

    private function sequenceExists(int $counterId, string $docType, string $fy): bool
    {
        return DB::table('counter_sequences')
            ->where('counter_id', $counterId)
            ->where('doc_type', $docType)
            ->where('financial_year', $fy)
            ->exists();
    }

    /** @return int 1 when a printed number had to be passed, 0 when the counter already was ahead */
    private function raiseSequence(int $counterId, string $docType, string $fy, int $highestIssued): int
    {
        $row = DB::table('counter_sequences')
            ->where('counter_id', $counterId)
            ->where('doc_type', $docType)
            ->where('financial_year', $fy)
            ->first(['id', 'next_number']);

        if (!$row || (int) $row->next_number > $highestIssued) {
            return 0;
        }

        $this->set('counter_sequences', (int) $row->id, ['next_number' => [(int) $row->next_number, $highestIssued + 1]]);

        return 1;
    }

    private function liveNames(int $storeId): array
    {
        return Counter::where('store_id', $storeId)
            ->whereIn('status', Counter::LIVE_STATUSES)
            ->pluck('counter_name')
            ->map(fn ($name) => mb_strtolower(trim((string) $name)))
            ->all();
    }

    private function nextCode(array $counters): string
    {
        $used = array_map(fn (Counter $counter) => strtoupper((string) $counter->counter_code), array_values($counters));

        for ($n = 1; $n <= 999; $n++) {
            $code = sprintf('C%02d', $n);
            if (!in_array($code, $used, true)) {
                return $code;
            }
        }

        return 'C' . substr((string) microtime(true), -4);
    }

    private function uniqueName(string $desired, array &$taken): string
    {
        $base = trim($desired) ?: 'Counter';
        $name = $base;

        for ($suffix = 2; in_array(mb_strtolower($name), $taken, true) && $suffix <= 99; $suffix++) {
            $name = "{$base} ({$suffix})";
        }

        $taken[] = mb_strtolower($name);

        return $name;
    }

    private function financialYear(?string $date = null): string
    {
        $stamp = $date ? strtotime((string) $date) : time();
        $month = (int) date('n', $stamp);
        $year = (int) date('Y', $stamp);

        return $month >= 4
            ? $year . '-' . substr((string) ($year + 1), -2)
            : ($year - 1) . '-' . substr((string) $year, -2);
    }

    private function set(string $table, int $id, array $changes): void
    {
        $fields = [];

        foreach ($changes as $column => [$old, $new]) {
            $this->journal['changes'][] = [
                'table' => $table,
                'id' => $id,
                'column' => $column,
                'old' => $old,
                'new' => $new,
            ];
            $fields[$column] = $new;
        }

        if (!$this->dryRun && $fields) {
            DB::table($table)->where('id', $id)->update($fields);
        }
    }

    private function insert(string $table, array $fields): int
    {
        if ($this->dryRun) {
            return $this->fakeId--;
        }

        $id = (int) DB::table($table)->insertGetId($fields);
        $this->journal['created'][] = ['table' => $table, 'id' => $id];

        return $id;
    }

    private function rollback(): int
    {
        $path = $this->manifestPath();

        if (!file_exists($path)) {
            $this->error('No manifest at ' . $path . ' — nothing to roll back.');

            return self::FAILURE;
        }

        $manifest = json_decode((string) file_get_contents($path), true);
        $changes = array_reverse($manifest['changes'] ?? []);
        $created = array_reverse($manifest['created'] ?? []);

        if (!$changes && !$created) {
            $this->info('The manifest holds no writes, so there is nothing to roll back.');

            return self::SUCCESS;
        }

        foreach ($changes as $change) {
            DB::table($change['table'])->where('id', $change['id'])->update([$change['column'] => $change['old']]);
        }

        // Newest first, so the series under a created counter go before the counter.
        foreach ($created as $row) {
            DB::table($row['table'])->where('id', $row['id'])->delete();
        }

        file_put_contents($path, json_encode([
            'ran_at' => now()->toIso8601String(),
            'dry_run' => false,
            'counters_created' => 0,
            'counters_linked' => 0,
            'devices_skipped' => 0,
            'series_seeded' => 0,
            'series_adopted' => 0,
            'history_attributed' => 0,
            'per_store' => [],
            'notes' => ['Rolled back ' . count($changes) . ' column changes and removed ' . count($created) . ' rows created by counters:migrate-from-devices.'],
            'changes' => [],
            'created' => [],
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        $this->info('Rolled back ' . count($changes) . ' changes and removed ' . count($created) . ' rows; the manifest journal is now empty.');

        return self::SUCCESS;
    }

    private function manifestPath(): string
    {
        return storage_path('app/' . self::MANIFEST);
    }
}

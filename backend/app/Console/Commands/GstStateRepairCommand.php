<?php

namespace App\Console\Commands;

use App\Support\GstStateCodes;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * G6/MST-01 one-time repair: rows written before party state validation landed
 * carry '32' (or arbitrary text) regardless of their GSTIN or store.
 *
 * Every write is journalled to storage/app/gst-state-repair.json and can be
 * reverted with --rollback. A run is a dry run (report only) unless --apply is
 * passed; --dry-run is accepted and wins over --apply. Historical
 * invoice/purchase tax splits are reported, never rewritten.
 */
class GstStateRepairCommand extends Command
{
    protected $signature = 'lamsuite:gst-state-repair {--apply : Write the repairs (without it the command only reports)} {--dry-run : Report only (the default)} {--rollback} {--only-invalid : Repair only states that are not valid GST codes}';

    protected $description = 'Repair party/store GST state codes from GSTIN or store, with report, dry-run and rollback';

    private string $journalPath = 'gst-state-repair.json';

    public function handle(): int
    {
        if ($this->option('rollback')) {
            return $this->rollback();
        }

        $dryRun = (bool) $this->option('dry-run') || !(bool) $this->option('apply');
        $onlyInvalid = (bool) $this->option('only-invalid');

        $report = [
            'ran_at' => now()->toIso8601String(),
            'dry_run' => $dryRun,
            'parties_repaired' => 0,
            'stores_repaired' => 0,
            'reported' => [
                'stores_with_unrepairable_state' => [],
                'stores_with_gstin_state_conflict' => [],
                'invoices_pointing_at_a_repaired_party' => [],
                'duplicate_parties' => [],
                'settings_sequence_mirrors' => [],
            ],
            'notes' => [],
        ];
        $changes = [];

        $stores = DB::table('stores')->orderBy('id')->get()->keyBy('id');
        $validStoreId = [];

        foreach ($stores as $store) {
            $state = GstStateCodes::normalize($store->state_code);
            $gstinPrefix = GstStateCodes::fromGstin($store->gstin);
            $validStoreId[$store->id] = $state;

            if (GstStateCodes::isValid($state)) {
                if ($gstinPrefix !== null && $gstinPrefix !== $state) {
                    $report['reported']['stores_with_gstin_state_conflict'][] = [
                        'store_id' => $store->id,
                        'code' => $store->code,
                        'state_code' => $state,
                        'gstin_state' => $gstinPrefix,
                    ];
                }
                continue;
            }

            if ($gstinPrefix !== null) {
                $changes[] = ['table' => 'stores', 'id' => $store->id, 'column' => 'state_code', 'old' => $state, 'new' => $gstinPrefix, 'reason' => 'gstin'];
                $validStoreId[$store->id] = $gstinPrefix;
                $report['stores_repaired']++;
            } else {
                $report['reported']['stores_with_unrepairable_state'][] = [
                    'store_id' => $store->id,
                    'code' => $store->code,
                    'state_code' => $store->state_code,
                ];
            }
        }

        DB::table('parties')->orderBy('id')->chunkById(500, function ($parties) use (&$changes, &$report, $stores, $validStoreId, $onlyInvalid) {
            foreach ($parties as $party) {
                $current = GstStateCodes::normalize($party->state_code);
                $target = null;
                $reason = null;

                $gstinPrefix = GstStateCodes::fromGstin($party->gstin);
                if ($gstinPrefix !== null) {
                    if ($gstinPrefix !== $current) {
                        $target = $gstinPrefix;
                        $reason = 'gstin';
                    }
                } elseif (!GstStateCodes::isValid($current)) {
                    $storeState = $validStoreId[$party->store_id] ?? null;
                    if (GstStateCodes::isValid($storeState)) {
                        $target = $storeState;
                        $reason = 'store';
                    }
                } elseif (!$onlyInvalid && $current === '32') {
                    // The pre-fix writers never chose 32 deliberately: the till
                    // had no state field and the server had a default.
                    $storeState = $validStoreId[$party->store_id] ?? null;
                    if (GstStateCodes::isValid($storeState) && $storeState !== '32') {
                        $target = $storeState;
                        $reason = 'store-default';
                    }
                }

                if ($target !== null) {
                    $changes[] = ['table' => 'parties', 'id' => $party->id, 'column' => 'state_code', 'old' => $party->state_code, 'new' => $target, 'reason' => $reason];
                    $report['parties_repaired']++;

                    $invoiceCount = DB::table('invoices')->where('customer_id', $party->id)->count();
                    if ($invoiceCount > 0) {
                        $report['reported']['invoices_pointing_at_a_repaired_party'][] = [
                            'party_id' => $party->id,
                            'party_name' => $party->name,
                            'invoices' => $invoiceCount,
                            'old_state' => $party->state_code,
                            'new_state' => $target,
                        ];
                    }
                }
            }
        });

        // Duplicate party groups (MST-02 ghosts): reported, never merged.
        $duplicates = DB::table('parties')
            ->select('store_id', 'type', 'name', DB::raw('COUNT(*) as total'))
            ->groupBy('store_id', 'type', 'name')
            ->havingRaw('COUNT(*) > 1')
            ->limit(50)
            ->get();
        foreach ($duplicates as $dup) {
            $report['reported']['duplicate_parties'][] = [
                'store_id' => $dup->store_id,
                'type' => $dup->type,
                'name' => $dup->name,
                'count' => $dup->total,
            ];
        }

        // The legacy sequences mirror is a settings section the till used to
        // overwrite; the counter's own series is authoritative. Report it.
        if (DB::getSchemaBuilder()->hasTable('company_settings')) {
            $mirrors = DB::table('company_settings')->where('key', 'sequences')->get(['store_id']);
            foreach ($mirrors as $mirror) {
                $report['reported']['settings_sequence_mirrors'][] = ['store_id' => $mirror->store_id];
            }
        }

        $this->info(json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        if (!$dryRun && $changes !== []) {
            $foreign = $this->foreignJournal();
            if ($foreign !== null) {
                $this->error("The journal at {$foreign} holds un-rolled-back changes for another database. Roll those back there (or move the file) before repairing this one.");
                return self::FAILURE;
            }

            foreach ($changes as $change) {
                DB::table($change['table'])->where('id', $change['id'])->update([$change['column'] => $change['new']]);
            }
            $this->writeJournal($changes);
        }

        $this->info(sprintf(
            '%s%d party rows, %d store rows%s',
            $dryRun ? 'Dry run: would repair ' : 'Repaired ',
            $report['parties_repaired'],
            $report['stores_repaired'],
            $dryRun ? ' (nothing written)' : ''
        ));

        return self::SUCCESS;
    }

    private function writeJournal(array $changes): void
    {
        $file = storage_path('app/' . $this->journalPath);
        $existing = [];
        if (file_exists($file)) {
            $decoded = json_decode((string) file_get_contents($file), true);
            if (is_array($decoded['changes'] ?? null)) {
                $existing = $decoded;
            }
        }

        $existing['database'] = $this->databaseIdentity();
        $existing['changes'] = array_merge($existing['changes'] ?? [], $changes);

        file_put_contents($file, json_encode($existing, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        $this->info('Journal written to ' . $file . ' (' . count($changes) . ' changes this run)');
    }

    /**
     * Which database a journal belongs to. Row ids only mean something in the
     * database they were read from, so a journal is never applied elsewhere.
     */
    private function databaseIdentity(): string
    {
        $connection = DB::connection();
        $host = (string) ($connection->getConfig('host') ?? '');

        return $connection->getDriverName() . ':' . ($host !== '' ? $host . '/' : '') . $connection->getDatabaseName();
    }

    /** The journal path when it holds pending changes recorded against another database, else null. */
    private function foreignJournal(): ?string
    {
        $file = storage_path('app/' . $this->journalPath);
        if (!file_exists($file)) {
            return null;
        }

        $journal = json_decode((string) file_get_contents($file), true);
        $owner = $journal['database'] ?? null;

        return ($journal['changes'] ?? []) !== [] && $owner !== null && $owner !== $this->databaseIdentity()
            ? $file
            : null;
    }

    private function rollback(): int
    {
        $file = storage_path('app/' . $this->journalPath);
        if (!file_exists($file)) {
            $this->error('No journal found at ' . $file . ' — nothing to roll back.');
            return self::FAILURE;
        }

        $journal = json_decode((string) file_get_contents($file), true);
        $owner = $journal['database'] ?? null;
        if ($owner !== null && $owner !== $this->databaseIdentity()) {
            $this->error("This journal was written for {$owner}, not {$this->databaseIdentity()}. Refusing to roll it back here.");
            return self::FAILURE;
        }
        $changes = array_reverse($journal['changes'] ?? []);
        $applied = 0;

        foreach ($changes as $change) {
            DB::table($change['table'])->where('id', $change['id'])->update([$change['column'] => $change['old']]);
            $applied++;
        }

        file_put_contents($file, json_encode(['changes' => []], JSON_PRETTY_PRINT));
        $this->info("Rolled back {$applied} changes from the journal.");

        return self::SUCCESS;
    }
}

<?php

namespace App\Console\Commands;

use App\Casts\CalendarDate;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * G8-UI / UI-03 one-time repair: batch expiries written a day (or more) early.
 *
 * Before CalendarDate, invoice and purchase lines sent their expiry as
 * "2027-03-30T18:30:00.000000Z" for 31-03-2027. A return posted that string back, and it was
 * stored as "2027-03-30 18:30:00". On MySQL the time part was dropped, leaving "2027-03-30".
 * Every later round trip took off another day.
 *
 * Two kinds of row are repaired:
 * - A return line (credit note item, or debit note / purchase return item) whose expiry is
 *   earlier than its source. The source is the line it was returned against, or failing that
 *   the store's batch with the same product and batch number. It is set to that source date.
 * - Any line still holding a time of day. It becomes the calendar day that instant falls on
 *   in the store's time zone.
 *
 * Other disagreements, such as a sale line that differs from today's batch expiry, are
 * reported and never rewritten. A run only reports unless --apply is passed, and --dry-run
 * wins over --apply. Every write is journalled to storage/app/expiry-date-repair.json and
 * can be reverted with --rollback.
 */
class ExpiryDateRepairCommand extends Command
{
    protected $signature = 'lamsuite:expiry-date-repair {--apply : Write the repairs (without it the command only reports)} {--dry-run : Report only (the default)} {--rollback}';

    protected $description = 'Repair batch expiry dates that return round trips stored one or more days early (UI-03), with dry-run and rollback';

    private string $journalPath = 'expiry-date-repair.json';

    /** @var array<string, ?string> */
    private array $batchExpiry = [];

    public function handle(): int
    {
        if ($this->option('rollback')) {
            return $this->rollback();
        }

        $dryRun = (bool) $this->option('dry-run') || !(bool) $this->option('apply');

        $report = [
            'ran_at' => now()->toIso8601String(),
            'dry_run' => $dryRun,
            'return_lines_restored' => 0,
            'timestamps_normalised' => 0,
            'reported' => [
                'lines_disagreeing_with_their_source' => [],
            ],
        ];
        $changes = [];

        $this->scanInvoiceItems($changes, $report);
        $this->scanPurchaseItems($changes, $report);

        $this->info(json_encode(['changes' => $changes] + $report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        if (!$dryRun && $changes !== []) {
            $foreign = $this->foreignJournal();
            if ($foreign !== null) {
                $this->error("The journal at {$foreign} holds un-rolled-back changes for another database. Roll those back there (or move the file) before repairing this one.");
                return self::FAILURE;
            }

            DB::transaction(function () use ($changes) {
                foreach ($changes as $change) {
                    DB::table($change['table'])->where('id', $change['id'])->update([$change['column'] => $change['new']]);
                }
            });
            $this->writeJournal($changes);
        }

        $this->info(sprintf(
            '%s%d return lines and %d timestamped expiries%s',
            $dryRun ? 'Dry run: would repair ' : 'Repaired ',
            $report['return_lines_restored'],
            $report['timestamps_normalised'],
            $dryRun ? ' (nothing written)' : ''
        ));

        return self::SUCCESS;
    }

    private function scanInvoiceItems(array &$changes, array &$report): void
    {
        $headers = [];

        DB::table('invoice_items')->whereNotNull('expiry_date')->orderBy('id')
            ->chunkById(500, function ($items) use (&$changes, &$report, &$headers) {
                foreach ($items as $item) {
                    $header = $headers[$item->invoice_id] ??= DB::table('invoices')->where('id', $item->invoice_id)
                        ->first(['id', 'store_id', 'module_key', 'original_invoice_id', 'original_invoice_number']);
                    if (!$header) {
                        continue;
                    }

                    $isReturn = $header->module_key === 'credit_note';
                    $source = $isReturn ? $this->originalSaleExpiry($header, $item) : null;
                    $source ??= $isReturn ? $this->batchExpiry($header->store_id, $item->product_id, $item->batch_no) : null;

                    $this->judge('invoice_items', $item, $isReturn, $source, $changes, $report);
                }
            });
    }

    private function scanPurchaseItems(array &$changes, array &$report): void
    {
        $headers = [];

        DB::table('purchase_items')->whereNotNull('expiry_date')->orderBy('id')
            ->chunkById(500, function ($items) use (&$changes, &$report, &$headers) {
                foreach ($items as $item) {
                    $header = $headers[$item->purchase_id] ??= DB::table('purchases')->where('id', $item->purchase_id)
                        ->first(['id', 'store_id', 'module_key']);
                    if (!$header) {
                        continue;
                    }

                    $originalId = $item->original_purchase_item_id ?? null;
                    $isReturn = $header->module_key === 'debit_note' || $originalId !== null;

                    $source = null;
                    if ($isReturn && $originalId !== null) {
                        $source = CalendarDate::toDay(DB::table('purchase_items')->where('id', $originalId)->value('expiry_date'));
                    }
                    $source ??= $isReturn ? $this->batchExpiry($header->store_id, $item->product_id, $item->batch_no) : null;

                    $this->judge('purchase_items', $item, $isReturn, $source, $changes, $report);
                }
            });
    }

    /** Decide whether one line's stored expiry was written wrongly, and what it should be. */
    private function judge(string $table, object $item, bool $isReturn, ?string $source, array &$changes, array &$report): void
    {
        $raw = (string) $item->expiry_date;
        $day = CalendarDate::toDay($raw);
        $hasTime = (bool) preg_match('/\d{2}:\d{2}/', $raw) && !preg_match('/00:00(:00(\.0+)?)?$/', $raw);

        if ($isReturn && $source !== null && $day !== null && $day < $source) {
            $changes[] = ['table' => $table, 'id' => $item->id, 'column' => 'expiry_date', 'old' => $raw, 'new' => $source, 'reason' => 'return_line_drifted_early'];
            $report['return_lines_restored']++;
            return;
        }

        if ($hasTime && $day !== null) {
            $changes[] = ['table' => $table, 'id' => $item->id, 'column' => 'expiry_date', 'old' => $raw, 'new' => $day, 'reason' => 'timestamp_to_calendar_day'];
            $report['timestamps_normalised']++;
            return;
        }

        if ($isReturn && $source !== null && $day !== null && $day !== $source) {
            $report['reported']['lines_disagreeing_with_their_source'][] = [
                'table' => $table, 'id' => $item->id, 'expiry_date' => $raw, 'source' => $source,
            ];
        }
    }

    /** Expiry on the sale line a credit note line was returned against. */
    private function originalSaleExpiry(object $header, object $item): ?string
    {
        $original = null;
        if (!empty($header->original_invoice_id) && ctype_digit((string) $header->original_invoice_id)) {
            $original = DB::table('invoices')->where('id', (int) $header->original_invoice_id)
                ->where('store_id', $header->store_id)->value('id');
        }
        if (!$original && !empty($header->original_invoice_number)) {
            $original = DB::table('invoices')->where('invoice_number', $header->original_invoice_number)
                ->where('store_id', $header->store_id)->value('id');
        }
        if (!$original) {
            return null;
        }

        $raw = DB::table('invoice_items')->where('invoice_id', $original)
            ->where('product_id', $item->product_id)
            ->where('batch_no', $item->batch_no)
            ->whereNotNull('expiry_date')
            ->value('expiry_date');

        return CalendarDate::toDay($raw);
    }

    private function batchExpiry($storeId, $productId, $batchNo): ?string
    {
        if ($batchNo === null || $batchNo === '') {
            return null;
        }
        $key = "{$storeId}|{$productId}|{$batchNo}";
        if (!array_key_exists($key, $this->batchExpiry)) {
            $this->batchExpiry[$key] = CalendarDate::toDay(DB::table('product_batches')
                ->where('store_id', $storeId)
                ->where('product_id', $productId)
                ->where('batch_no', $batchNo)
                ->value('expiry_date'));
        }

        return $this->batchExpiry[$key];
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

    /** Row ids only mean something in the database they were read from. */
    private function databaseIdentity(): string
    {
        $connection = DB::connection();
        $host = (string) ($connection->getConfig('host') ?? '');

        return $connection->getDriverName() . ':' . ($host !== '' ? $host . '/' : '') . $connection->getDatabaseName();
    }

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

        $applied = 0;
        DB::transaction(function () use ($journal, &$applied) {
            foreach (array_reverse($journal['changes'] ?? []) as $change) {
                DB::table($change['table'])->where('id', $change['id'])->update([$change['column'] => $change['old']]);
                $applied++;
            }
        });

        file_put_contents($file, json_encode(['changes' => []], JSON_PRETTY_PRINT));
        $this->info("Rolled back {$applied} changes from the journal.");

        return self::SUCCESS;
    }
}

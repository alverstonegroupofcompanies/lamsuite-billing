<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\StoreDayClose;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * G12: two kinds of history the pre-fix code could write wrongly.
 *
 *  - `reopen()` used to save status 'closed', so a day that was reopened still
 *    reads closed. Once closed blocks cancellation that is a live trap, and the
 *    audit trail is the only place that remembers the reopen.
 *  - A cancellation on a day that is now closed/reconciled may have been taken
 *    without approval. Nothing can invent a grant after the fact, so this half
 *    is a review list for the owner, never an automatic reversal.
 *
 *  - APR-01: cancellations before G12 left `cancelled_by` empty. Where exactly
 *    one cancel grant for that bill was verified before the cancel, its
 *    requester (else approver) is the person; everything else is listed as
 *    "cancelled without a recorded approval" for the owner.
 *
 * Dry-run by default; `--repair-reopened` and `--backfill-cancelled-by` apply
 * only those two safe fixes. Nothing is ever un-cancelled.
 */
class AuditDayCloseCommand extends Command
{
    protected $signature = 'day-close:audit
        {--store= : Limit the report to one store id}
        {--repair-reopened : Set reopened days that still read closed back to open}
        {--backfill-cancelled-by : Stamp cancelled_by from the single grant that approved the cancel}';

    protected $description = 'Report cancellations on closed days and repair day-close rows left closed after a reopen';

    public function handle(): int
    {
        $storeId = $this->option('store');
        $limited = is_numeric($storeId);

        $reopened = $this->reopenedButClosed($limited ? (int) $storeId : null);

        $this->info('--- Days reopened but still stored as closed ---');
        if ($reopened === []) {
            $this->comment('None.');
        } else {
            $this->table(
                ['Close ID', 'Store', 'Date', 'Status', 'Latest audit'],
                array_map(fn (array $row) => [
                    $row['close']->id,
                    $row['close']->store_id,
                    $row['close']->close_date?->toDateString(),
                    $row['close']->status,
                    $row['latest'],
                ], $reopened)
            );

            if ($this->option('repair-reopened')) {
                foreach ($reopened as $row) {
                    $row['close']->update(['status' => 'open', 'locked_at' => null]);

                    AuditLog::log('day_close_status_repaired', 'StoreDayClose', (string) $row['close']->id, null, [
                        'close_date' => $row['close']->close_date?->toDateString(),
                        'from' => 'closed',
                        'to' => 'open',
                        'reason' => 'Latest audit event was reopen_store_day',
                    ], (int) $row['close']->store_id);
                }
                $this->info('Repaired ' . count($reopened) . ' day(s) to open.');
            } else {
                $this->comment('Dry run. Re-run with --repair-reopened to apply.');
            }
        }

        $this->newLine();
        $this->info('--- Bills cancelled on a day that is now closed/reconciled ---');
        $cancelled = $this->cancelledOnClosedDays($limited ? (int) $storeId : null);

        if ($cancelled->isEmpty()) {
            $this->comment('None.');
        } else {
            $this->table(
                ['Store', 'Invoice', 'Invoice date', 'Cancelled at', 'Cancelled by', 'Day status', 'After close?'],
                $cancelled->map(fn ($row) => [
                    $row->store_id,
                    $row->invoice_number,
                    $row->invoice_date,
                    $row->cancelled_at,
                    $row->cancelled_by ?? '-',
                    $row->day_status,
                    // The close row's last write is when its totals were counted.
                    ($row->cancelled_at && $row->day_written_at && $row->cancelled_at > $row->day_written_at) ? 'YES' : 'no',
                ])->all()
            );
            $this->comment('Review only: a bill cancelled before the close is legitimate, so no row is reverted automatically.');
        }

        $this->newLine();
        $this->info('--- Cancelled bills with no cancelled_by (APR-01) ---');
        $this->reportUnstampedCancellations($limited ? (int) $storeId : null);

        return self::SUCCESS;
    }

    private function reportUnstampedCancellations(?int $storeId): void
    {
        $rows = DB::table('invoices')
            ->where('status', 'cancelled')
            ->whereNull('cancelled_by')
            ->when($storeId !== null, fn ($q) => $q->where('store_id', $storeId))
            ->orderBy('store_id')
            ->orderBy('id')
            ->get(['id', 'store_id', 'invoice_number', 'invoice_date', 'cancelled_at']);

        if ($rows->isEmpty()) {
            $this->comment('None.');

            return;
        }

        $fillable = [];
        $table = [];

        foreach ($rows as $row) {
            $grants = DB::table('invoice_approvals')
                ->where('invoice_id', $row->id)
                ->where('store_id', $row->store_id)
                ->where('action', 'cancel')
                ->where('status', 'used')
                ->when($row->cancelled_at, fn ($q) => $q->where('used_at', '<=', $row->cancelled_at))
                ->get(['id', 'requested_by_user_id', 'approved_by_user_id']);

            $person = $grants->count() === 1
                ? ($grants[0]->requested_by_user_id ?? $grants[0]->approved_by_user_id)
                : null;

            if ($person !== null) {
                $fillable[] = ['invoice_id' => $row->id, 'store_id' => $row->store_id, 'user_id' => (int) $person, 'approval_id' => $grants[0]->id];
            }

            $table[] = [
                $row->store_id,
                $row->invoice_number,
                $row->invoice_date,
                $row->cancelled_at,
                $person !== null ? "user {$person} (grant {$grants[0]->id})" : 'cancelled without a recorded approval',
            ];
        }

        $this->table(['Store', 'Invoice', 'Invoice date', 'Cancelled at', 'Backfill'], $table);

        if (! $this->option('backfill-cancelled-by')) {
            $this->comment(count($fillable) . ' row(s) can be stamped. Dry run. Re-run with --backfill-cancelled-by to apply.');

            return;
        }

        foreach ($fillable as $fill) {
            DB::table('invoices')
                ->where('id', $fill['invoice_id'])
                ->whereNull('cancelled_by')
                ->update(['cancelled_by' => $fill['user_id']]);

            AuditLog::log('invoice_cancelled_by_backfilled', 'Invoice', (string) $fill['invoice_id'], null, [
                'cancelled_by' => $fill['user_id'],
                'approval_id' => $fill['approval_id'],
                'source' => 'day-close:audit --backfill-cancelled-by',
            ], (int) $fill['store_id']);
        }

        $this->info('Stamped ' . count($fillable) . ' cancellation(s).');
    }

    /**
     * @return list<array{close: StoreDayClose, latest: string}>
     */
    private function reopenedButClosed(?int $storeId): array
    {
        $rows = StoreDayClose::query()
            ->where('status', 'closed')
            ->when($storeId !== null, fn ($q) => $q->where('store_id', $storeId))
            ->orderBy('store_id')
            ->orderBy('close_date')
            ->get();

        $matches = [];

        foreach ($rows as $close) {
            $latest = AuditLog::query()
                ->where('entity_type', 'StoreDayClose')
                ->where('entity_id', (string) $close->id)
                ->orderByDesc('id')
                ->value('action');

            if ($latest === 'reopen_store_day') {
                $matches[] = ['close' => $close, 'latest' => (string) $latest];
            }
        }

        return $matches;
    }

    private function cancelledOnClosedDays(?int $storeId): \Illuminate\Support\Collection
    {
        return DB::table('invoices as i')
            ->join('store_day_closes as d', function ($join) {
                $join->on('d.store_id', '=', 'i.store_id')
                    ->whereRaw('DATE(d.close_date) = DATE(i.invoice_date)');
            })
            ->where('i.status', 'cancelled')
            ->whereIn('d.status', ['closed', 'reconciled'])
            ->when($storeId !== null, fn ($q) => $q->where('i.store_id', $storeId))
            ->orderBy('i.store_id')
            ->orderBy('i.invoice_date')
            ->select([
                'i.store_id',
                'i.invoice_number',
                'i.invoice_date',
                'i.cancelled_at',
                'i.cancelled_by',
                'd.status as day_status',
                'd.updated_at as day_written_at',
            ])
            ->get();
    }
}

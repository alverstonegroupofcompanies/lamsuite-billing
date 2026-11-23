<?php

namespace App\Services\DayClose;

use App\Exceptions\BusinessRuleException;
use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\CounterShift;
use App\Models\Expense;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Store;
use App\Models\StoreDayClose;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class StoreDayCloseService
{
    public const TENDERS = ['cash', 'card', 'upi', 'credit', 'wallet', 'gift_card', 'bank', 'other'];

    private static int $lockBypass = 0;

    public static function withoutLock(callable $callback): mixed
    {
        static::$lockBypass++;

        try {
            return $callback();
        } finally {
            static::$lockBypass--;
        }
    }

    public static function normalizeTender(?string $mode): string
    {
        $value = strtolower(trim((string) $mode));

        return match (true) {
            $value === '' => 'other',
            str_contains($value, 'cash') => 'cash',
            str_contains($value, 'upi') => 'upi',
            str_contains($value, 'card') => 'card',
            str_contains($value, 'credit'), str_contains($value, 'khata') => 'credit',
            str_contains($value, 'wallet') => 'wallet',
            str_contains($value, 'gift') => 'gift_card',
            str_contains($value, 'bank'), str_contains($value, 'neft'), str_contains($value, 'imps'), str_contains($value, 'cheque') => 'bank',
            default => 'other',
        };
    }

    public function summary(int $storeId, string $date): array
    {
        $store = Store::find($storeId);
        $day = Carbon::parse($date)->toDateString();

        $invoices = Invoice::query()
            ->where('store_id', $storeId)
            ->whereDate('invoice_date', $day)
            ->where('status', '!=', 'cancelled')
            ->where('module_key', '!=', 'quotation')
            ->get();

        $sales = $invoices->reject(fn (Invoice $inv) => in_array($inv->module_key, ['credit_note', 'sales_return'], true));
        $returns = $invoices->filter(fn (Invoice $inv) => in_array($inv->module_key, ['credit_note', 'sales_return'], true));

        $tenders = [];
        foreach (self::TENDERS as $tender) {
            $tenders[$tender] = ['collected' => 0.0, 'refunded' => 0.0, 'net' => 0.0, 'pending' => 0.0, 'receipts' => 0];
        }

        $payments = InvoicePayment::query()
            ->where('store_id', $storeId)
            ->whereDate('created_at', $day)
            ->get();

        foreach ($payments as $payment) {
            $tender = self::normalizeTender($payment->payment_mode);
            $amount = (float) $payment->amount;

            if (in_array($payment->status, ['bounced', 'refunded', 'cancelled'], true)) {
                continue;
            }

            if ($payment->status === 'pending_clearance') {
                $tenders[$tender]['pending'] += $amount;
                continue;
            }

            $tenders[$tender]['collected'] += $amount;
            $tenders[$tender]['receipts']++;
        }

        foreach ($returns as $return) {
            $tender = self::normalizeTender($return->payment_mode);
            $tenders[$tender]['refunded'] += (float) $return->grand_total;
        }

        foreach ($tenders as $tender => $values) {
            $tenders[$tender]['collected'] = round($values['collected'], 2);
            $tenders[$tender]['refunded'] = round($values['refunded'], 2);
            $tenders[$tender]['pending'] = round($values['pending'], 2);
            $tenders[$tender]['net'] = round($values['collected'] - $values['refunded'], 2);
        }

        $openingFloat = (float) CounterShift::query()
            ->where('store_id', $storeId)
            ->whereDate('opened_at', $day)
            ->sum('opening_float');

        $cashDrops = (float) CounterShift::query()
            ->where('store_id', $storeId)
            ->whereDate('opened_at', $day)
            ->sum('cash_drops');

        $cashExpenses = (float) Expense::query()
            ->where('store_id', $storeId)
            ->whereDate('expense_date', $day)
            ->where('payment_mode', 'like', '%cash%')
            ->sum('amount');

        $cashSales = $tenders['cash']['collected'];
        $cashRefunds = $tenders['cash']['refunded'];
        $expectedCash = round($openingFloat + $cashSales - $cashRefunds - $cashExpenses - $cashDrops, 2);

        $digitalCollected = 0.0;
        foreach (['card', 'upi', 'wallet', 'gift_card', 'bank'] as $tender) {
            $digitalCollected += $tenders[$tender]['net'];
        }

        $counters = $this->counterBreakdown($storeId, $sales, $returns, $payments);

        $shifts = CounterShift::query()
            ->where('store_id', $storeId)
            ->whereDate('opened_at', $day)
            ->orderBy('opened_at')
            ->get()
            ->map(function (CounterShift $shift) {
                $shiftExpected = round(
                    (float) $shift->opening_float + (float) $shift->cash_sales - (float) $shift->cash_refunds - (float) $shift->cash_drops,
                    2
                );
                $variance = $shift->closing_cash_actual === null
                    ? null
                    : round((float) $shift->closing_cash_actual - $shiftExpected, 2);

                return [
                    'id' => $shift->id,
                    'counter_id' => $shift->counter_id,
                    'status' => $shift->status,
                    'opening_float' => (float) $shift->opening_float,
                    'cash_sales' => (float) $shift->cash_sales,
                    'digital_sales' => (float) $shift->digital_sales,
                    'cash_refunds' => (float) $shift->cash_refunds,
                    'cash_drops' => (float) $shift->cash_drops,
                    'expected_cash' => $shiftExpected,
                    'counted_cash' => $shift->closing_cash_actual === null ? null : (float) $shift->closing_cash_actual,
                    'variance' => $variance,
                    'opened_at' => $shift->opened_at?->toIso8601String(),
                    'closed_at' => $shift->closed_at?->toIso8601String(),
                ];
            })
            ->values()
            ->all();

        $saved = StoreDayClose::query()
            ->where('store_id', $storeId)
            ->whereDate('close_date', $day)
            ->first();

        return [
            'store_id' => $storeId,
            'store_name' => $store?->name,
            'close_date' => $day,
            'sales' => [
                'gross_total' => round((float) $sales->sum('grand_total'), 2),
                'tax_total' => round((float) $sales->sum('tax_total'), 2),
                'discount_total' => round((float) $sales->sum('discount_total'), 2),
                'bills_count' => $sales->count(),
            ],
            'returns' => [
                'count' => $returns->count(),
                'total' => round((float) $returns->sum('grand_total'), 2),
            ],
            'tenders' => $tenders,
            'cash' => [
                'opening_float' => round($openingFloat, 2),
                'cash_sales' => round($cashSales, 2),
                'cash_refunds' => round($cashRefunds, 2),
                'cash_expenses' => round($cashExpenses, 2),
                'cash_drops' => round($cashDrops, 2),
                'expected' => $expectedCash,
            ],
            'totals' => [
                'cash_collected' => round($cashSales - $cashRefunds, 2),
                'digital_collected' => round($digitalCollected, 2),
                'credit_sales' => $tenders['credit']['net'],
                'refunds' => round((float) $returns->sum('grand_total'), 2),
                'pending_clearance' => round(array_sum(array_column($tenders, 'pending')), 2),
            ],
            'counters' => $counters,
            'shifts' => $shifts,
            'saved' => $saved ? [
                'id' => $saved->id,
                'status' => $saved->status ?: 'open',
                'counted_cash' => $saved->counted_cash === null ? null : (float) $saved->counted_cash,
                'cash_variance' => (float) $saved->cash_variance,
                'locked_at' => $saved->locked_at?->toIso8601String(),
                'reconciliation_notes' => $saved->reconciliation_notes,
                'closed_by_user_id' => $saved->closed_by_user_id,
            ] : null,
        ];
    }

    public function close(int $storeId, string $date, ?int $userId = null, ?string $notes = null): StoreDayClose
    {
        $summary = $this->summary($storeId, $date);
        $day = $summary['close_date'];

        $close = StoreDayClose::query()
            ->where('store_id', $storeId)
            ->whereDate('close_date', $day)
            ->first() ?? new StoreDayClose(['store_id' => $storeId, 'close_date' => $day]);

        if ($close->status === 'reconciled') {
            throw new BusinessRuleException(
                'DAY_ALREADY_RECONCILED',
                "Day close for {$day} is already reconciled and locked.",
                'day_close',
                null,
                'close_date',
                'Reopen the day first if a correction is genuinely required.'
            );
        }

        $close->fill([
            'total_gross_sales' => $summary['sales']['gross_total'],
            'total_tax_collected' => $summary['sales']['tax_total'],
            'total_cash_collected' => $summary['totals']['cash_collected'],
            'total_digital_collected' => $summary['totals']['digital_collected'],
            'total_refunds' => $summary['totals']['refunds'],
            'net_cash_in_hand' => $summary['cash']['expected'],
            'total_bills_count' => $summary['sales']['bills_count'],
            'counter_breakdowns' => $summary['counters'],
            'tender_totals' => $summary['tenders'],
            'opening_cash' => $summary['cash']['opening_float'],
            'expected_cash' => $summary['cash']['expected'],
            'cash_expenses' => $summary['cash']['cash_expenses'],
            'closed_by_user_id' => $userId,
            'reconciliation_notes' => $notes,
            'status' => 'closed',
        ]);

        $close->save();

        return $close->fresh();
    }

    public function reconcile(StoreDayClose $close, float $countedCash, ?int $userId = null, ?string $notes = null): StoreDayClose
    {
        if ($close->status === 'reconciled') {
            throw new BusinessRuleException(
                'DAY_ALREADY_RECONCILED',
                "Day close for {$close->close_date?->toDateString()} is already reconciled.",
                'day_close'
            );
        }

        $expected = (float) $close->expected_cash;

        $close->fill([
            'counted_cash' => round($countedCash, 2),
            'cash_variance' => round($countedCash - $expected, 2),
            'status' => 'reconciled',
            'locked_at' => now(),
            'closed_by_user_id' => $userId ?? $close->closed_by_user_id,
            'reconciliation_notes' => $notes ?? $close->reconciliation_notes,
        ]);
        $close->save();

        return $close->fresh();
    }

    public function reopen(StoreDayClose $close, ?string $reason = null): StoreDayClose
    {
        $close->fill([
            // Reopening must actually un-close the day: since G12 a closed day
            // blocks cancellation, so writing 'closed' here would leave the
            // reopened day silently locked for the thing it was reopened for.
            'status' => 'open',
            'locked_at' => null,
            'reconciliation_notes' => trim(($close->reconciliation_notes ?? '') . ($reason ? " | Reopened: {$reason}" : ' | Reopened')),
        ]);
        $close->save();

        return $close->fresh();
    }

    public function assertDayOpen(int $storeId, ?string $date): void
    {
        if (static::$lockBypass > 0 || ! $date) {
            return;
        }

        $day = Carbon::parse($date)->toDateString();

        $locked = $this->lockedDay($storeId, $day, ['reconciled']);

        if (! $locked) {
            return;
        }

        if ($this->overrideRequested($locked, 'invoice_write')) {
            return;
        }

        throw new BusinessRuleException(
            'DAY_CLOSED_LOCKED',
            "Day {$day} is closed and reconciled. New or changed bills are blocked for this date.",
            'day_close',
            null,
            'invoice_date',
            'Ask a super administrator to reopen the day from Admin > Day Close if this is a genuine backdated entry.'
        );
    }

    /**
     * A closed day still accepts new bills (a till may sync what it rang before
     * the close), but it must not accept a cancellation: that reverses money and
     * stock out of a day the owner has already counted.
     */
    public function assertDayNotClosed(int $storeId, ?string $date, string $context = 'cancellation'): void
    {
        if (static::$lockBypass > 0 || ! $date) {
            return;
        }

        $day = Carbon::parse($date)->toDateString();

        $locked = $this->lockedDay($storeId, $day, ['closed', 'reconciled']);

        if (! $locked) {
            return;
        }

        if ($this->overrideRequested($locked, $context)) {
            return;
        }

        throw new BusinessRuleException(
            'DAY_CLOSED_LOCKED',
            "Day {$day} is {$locked->status}. Cancellations and bill changes are blocked for this date.",
            'day_close',
            null,
            'invoice_date',
            'Reopen the day from Admin > Day Close before changing a bill dated to it (a reconciled day needs a super administrator).',
            409
        );
    }

    /**
     * @param  list<string>  $statuses
     */
    private function lockedDay(int $storeId, string $day, array $statuses): ?StoreDayClose
    {
        return StoreDayClose::query()
            ->where('store_id', $storeId)
            ->whereDate('close_date', $day)
            ->whereIn('status', $statuses)
            ->first();
    }

    /**
     * The one deliberate way past a day lock, and it leaves a trace. Rubbish in
     * the audit trail beats a silent bypass.
     */
    private function overrideRequested(StoreDayClose $close, string $context): bool
    {
        $request = request();
        $user = $request->user();

        if (! $user?->isSuperAdmin() || ! $request->boolean('override_day_close_lock')) {
            return false;
        }

        // G12: an override without a stated reason is not an audited override.
        $reason = trim((string) $request->input('override_reason', ''));
        if ($reason === '') {
            throw new BusinessRuleException(
                'DAY_CLOSE_OVERRIDE_REASON_REQUIRED',
                'Overriding a closed day needs a reason.',
                'day_close',
                null,
                'override_reason',
                'Send override_reason explaining why this closed day must change.',
                422
            );
        }

        AuditLog::log('day_close_lock_overridden', 'StoreDayClose', (string) $close->id, null, [
            'close_date' => $close->close_date?->toDateString(),
            'status' => $close->status,
            'context' => $context,
            'reason' => mb_substr($reason, 0, 500),
        ], $close->store_id, $user->id);

        return true;
    }

    private function counterBreakdown(int $storeId, $sales, $returns, $payments): array
    {
        $rows = [];

        $ensure = function (?string $code, ?int $counterId = null) use (&$rows, $storeId) {
            $key = $code ?: 'UNASSIGNED';
            if (! isset($rows[$key])) {
                $counter = $counterId
                    ? Counter::find($counterId)
                    : Counter::query()->where('store_id', $storeId)->where('counter_code', $code)->first();
                $rows[$key] = [
                    'counter_code' => $code,
                    'counter_id' => $counter?->id,
                    'counter_name' => $counter?->counter_name ?? $key,
                    'location_name' => $counter?->location_name,
                    'bills_count' => 0,
                    'gross_total' => 0.0,
                    'tax_total' => 0.0,
                    'cash_net' => 0.0,
                    'digital_net' => 0.0,
                    'refunds' => 0.0,
                ];
            }

            return $key;
        };

        foreach ($sales as $invoice) {
            $key = $ensure($invoice->counter_code, $invoice->counter_id);
            $rows[$key]['bills_count']++;
            $rows[$key]['gross_total'] += (float) $invoice->grand_total;
            $rows[$key]['tax_total'] += (float) $invoice->tax_total;
        }

        foreach ($returns as $return) {
            $key = $ensure($return->counter_code, $return->counter_id);
            $rows[$key]['refunds'] += (float) $return->grand_total;
        }

        foreach ($payments as $payment) {
            if (in_array($payment->status, ['bounced', 'refunded', 'cancelled', 'pending_clearance'], true)) {
                continue;
            }
            $key = $ensure($payment->counter_code, is_numeric($payment->counter_id) ? (int) $payment->counter_id : null);
            $tender = self::normalizeTender($payment->payment_mode);
            if ($tender === 'cash') {
                $rows[$key]['cash_net'] += (float) $payment->amount;
            } elseif (in_array($tender, ['card', 'upi', 'wallet', 'gift_card', 'bank'], true)) {
                $rows[$key]['digital_net'] += (float) $payment->amount;
            }
        }

        foreach (Counter::query()->where('store_id', $storeId)->get() as $counter) {
            $ensure($counter->counter_code, $counter->id);
        }

        return array_map(function (array $row) {
            foreach (['gross_total', 'tax_total', 'cash_net', 'digital_net', 'refunds'] as $key) {
                $row[$key] = round($row[$key], 2);
            }

            return $row;
        }, array_values($rows));
    }

    public function history(int $storeId, ?string $from = null, ?string $to = null): array
    {
        return StoreDayClose::query()
            ->where('store_id', $storeId)
            ->when($from, fn ($q) => $q->whereDate('close_date', '>=', $from))
            ->when($to, fn ($q) => $q->whereDate('close_date', '<=', $to))
            ->orderByDesc('close_date')
            ->limit(90)
            ->get()
            ->map(fn (StoreDayClose $close) => [
                'id' => $close->id,
                'close_date' => $close->close_date?->toDateString(),
                'status' => $close->status ?: 'open',
                'gross_sales' => (float) $close->total_gross_sales,
                'cash_collected' => (float) $close->total_cash_collected,
                'digital_collected' => (float) $close->total_digital_collected,
                'refunds' => (float) $close->total_refunds,
                'expected_cash' => (float) $close->expected_cash,
                'counted_cash' => $close->counted_cash === null ? null : (float) $close->counted_cash,
                'cash_variance' => (float) $close->cash_variance,
                'bills_count' => (int) $close->total_bills_count,
                'locked_at' => $close->locked_at?->toIso8601String(),
            ])
            ->values()
            ->all();
    }
}

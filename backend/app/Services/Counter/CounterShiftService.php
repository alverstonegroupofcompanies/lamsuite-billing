<?php

namespace App\Services\Counter;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\CounterShift;
use App\Models\Expense;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use Illuminate\Support\Carbon;

/**
 * PRF-007 / B9 — the drawer belongs to the counter, and closing it reconciles.
 *
 * A shift row is written for one counter and nothing else: there is no signed-in
 * person at the POS to key it to, so `opened_by_user_id` is left to whoever the
 * panel says it was and the till's own rows carry `opened_via` instead — the
 * credential that actually moved the drawer.
 *
 * Closing is where the paisa has to land. The counter's own components (float,
 * cash in, cash sales, refunds, drops) give the expected drawer; the amount
 * counted gives the variance; and the server works its own tally for the same
 * counter and days out of the documents it holds, so an owner sees whether the
 * till's figures match the money the cloud has ever heard of. The two are
 * stored side by side rather than one overwriting the other, because a till
 * that was offline counted real cash the server had not been told about yet.
 */
class CounterShiftService
{
    public const VIA_COUNTER_PIN = 'counter_pin';
    public const VIA_PANEL_USER = 'panel_user';
    public const VIA_OFFLINE_TILL = 'offline_till';

    /** A PIN proved against the hash the till cached, while the link down. */
    public const VIA_PIN_AT_TILL = 'counter_pin_offline';

    private const RETURN_MODULES = ['credit_note', 'sales_return'];

    public function current(Counter $counter): ?CounterShift
    {
        return CounterShift::where('counter_id', $counter->id)
            ->where('status', 'open')
            ->latest('opened_at')
            ->first();
    }

    /**
     * Opening twice is one float, not two: a till that retries the call after a
     * dropped response gets the shift that is already standing.
     *
     * @param array{opening_float?: mixed, notes?: ?string, opened_at?: ?Carbon} $input
     */
    public function open(Counter $counter, array $input, string $via, ?int $userId = null): CounterShift
    {
        if ($existing = $this->current($counter)) {
            return $existing;
        }

        $float = self::money($input['opening_float'] ?? 0);

        $shift = CounterShift::create([
            'store_id' => $counter->store_id,
            'counter_id' => $counter->id,
            'opened_by_user_id' => $userId,
            'opened_via' => $via,
            'opening_float' => $float,
            'cash_sales' => 0,
            'digital_sales' => 0,
            'cash_refunds' => 0,
            'cash_in' => 0,
            'cash_drops' => 0,
            'status' => 'open',
            'opened_at' => ($input['opened_at'] ?? null) instanceof Carbon ? $input['opened_at'] : now(),
            'notes' => $input['notes'] ?? 'Shift opened at counter terminal',
        ]);

        AuditLog::log('counter_shift_opened', 'CounterShift', (string) $shift->id, null, [
            'opening_float' => $float,
            'counter_code' => $counter->counter_code,
            'via' => $via,
        ], $counter->store_id, $userId);

        return $shift;
    }

    /**
     * @param array{closing_cash_actual?: mixed, cash_sales?: mixed, digital_sales?: mixed,
     *              cash_refunds?: mixed, cash_in?: mixed, cash_drops?: mixed,
     *              opening_float?: mixed, notes?: ?string, opened_at?: ?Carbon} $input
     * @return array{shift: CounterShift, expected_cash: float, counted_cash: float, variance: float, reconciliation: array<string,mixed>}
     */
    public function close(Counter $counter, array $input, string $via, ?int $userId = null): array
    {
        $counted = self::money($input['closing_cash_actual'] ?? 0);

        // A till that worked offline never got its open call through, so the
        // shift it closes is built from what its drawer actually held rather
        // than refused for the record it could not push.
        $shift = $this->current($counter) ?? CounterShift::create([
            'store_id' => $counter->store_id,
            'counter_id' => $counter->id,
            'opened_by_user_id' => $userId,
            'opened_via' => $via,
            'opening_float' => self::money($input['opening_float'] ?? 0),
            'status' => 'open',
            'opened_at' => ($input['opened_at'] ?? null) instanceof Carbon ? $input['opened_at'] : now()->startOfDay(),
            'notes' => $input['notes'] ?? null,
        ]);

        return $this->settle($counter, $shift, $input, $counted, $via, $userId);
    }

    /**
     * The drawer a till counted while the cloud was down, recorded on the terms
     * it was counted on. The device token says which counter stood behind it and
     * `opened_via` says how the PIN was proved — at the counter against the hash
     * the owner's own cache handed out, or not at all. Nothing here pretends the
     * cloud saw a PIN it never saw, and nothing is refused for it.
     *
     * @param array<string,mixed> $payload
     * @return array{shift: CounterShift, expected_cash: float, counted_cash: float, variance: float, reconciliation: array<string,mixed>}
     */
    public function recordFromTill(Counter $counter, array $payload): array
    {
        $externalId = isset($payload['external_id']) ? trim((string) $payload['external_id']) : '';
        $counted = self::money($payload['closing_cash_actual'] ?? $payload['counted_cash'] ?? 0);
        $closing = strtolower((string) ($payload['status'] ?? '')) === 'closed';

        $via = filter_var($payload['pin_verified_at_till'] ?? false, FILTER_VALIDATE_BOOL)
            ? self::VIA_PIN_AT_TILL
            : self::VIA_OFFLINE_TILL;

        $shift = $externalId === ''
            ? null
            : CounterShift::where('counter_id', $counter->id)->where('external_id', $externalId)->first();

        $openedAt = $payload['opened_at'] ?? null;
        $openedAt = is_numeric($openedAt)
            ? Carbon::createFromTimestampMs((float) $openedAt)
            : ($openedAt instanceof Carbon ? $openedAt : now());

        if (!$shift) {
            $shift = CounterShift::create([
                'store_id' => $counter->store_id,
                'counter_id' => $counter->id,
                'external_id' => $externalId === '' ? null : $externalId,
                'opened_via' => $via,
                'opening_float' => self::money($payload['opening_float'] ?? 0),
                'status' => 'open',
                'opened_at' => $openedAt,
                'notes' => $payload['notes'] ?? null,
            ]);
        }

        if (!$closing) {
            $shift->update([
                'external_id' => $externalId === '' ? $shift->external_id : $externalId,
                'cash_in' => self::money($payload['cash_in'] ?? $shift->cash_in),
                'cash_sales' => self::money($payload['cash_sales'] ?? $shift->cash_sales),
                'digital_sales' => self::money($payload['digital_sales'] ?? $shift->digital_sales),
                'cash_refunds' => self::money($payload['cash_refunds'] ?? $shift->cash_refunds),
                'cash_drops' => self::money($payload['cash_drops'] ?? $shift->cash_drops),
            ]);

            $expected = self::expectedCash([
                'opening_float' => (float) $shift->opening_float,
                'cash_in' => (float) $shift->cash_in,
                'cash_sales' => (float) $shift->cash_sales,
                'cash_refunds' => (float) $shift->cash_refunds,
                'cash_drops' => (float) $shift->cash_drops,
            ]);

            return [
                'shift' => $shift->fresh(),
                'expected_cash' => $expected,
                'counted_cash' => 0.0,
                'variance' => 0.0,
                'reconciliation' => ['recorded' => 'open', 'expected_cash' => $expected],
            ];
        }

        return $this->settle($counter, $shift, $payload, $counted, $via, null);
    }

    /**
     * One settlement path, whether the drawer closed in front of the cloud or
     * arrived from a till that had been working without it.
     *
     * @param array<string,mixed> $input
     * @return array{shift: CounterShift, expected_cash: float, counted_cash: float, variance: float, reconciliation: array<string,mixed>}
     */
    private function settle(Counter $counter, CounterShift $shift, array $input, float $counted, string $via, ?int $userId): array
    {
        // SHF-01: the cloud saw this drawer's sales itself, so it does not take
        // the till's typed figures on trust. A close that came from a till the
        // server never saw keeps its own numbers instead (recordFromTill), and
        // the server tally is stored beside them for the owner to compare.
        $serverAuthoritative = in_array($via, [self::VIA_COUNTER_PIN, self::VIA_PANEL_USER], true);
        $window = $this->shiftWindow($shift, $this->closingInstant($input));
        $server = $this->serverTally($counter, $window[0], $window[1]);

        $ignored = [];
        if ($serverAuthoritative) {
            foreach (['cash_sales', 'digital_sales', 'cash_refunds'] as $field) {
                if (array_key_exists($field, $input)
                    && abs(self::money($input[$field]) - self::money(match ($field) {
                        'cash_sales' => $server['cash_collected'],
                        'digital_sales' => $server['digital_collected'],
                        'cash_refunds' => $server['cash_refunded'],
                    })) > 0.01) {
                    $ignored[$field] = self::money($input[$field]);
                }
            }
        }

        $components = [
            'opening_float' => self::money($shift->opening_float),
            'cash_in' => self::money($input['cash_in'] ?? $shift->cash_in),
            'cash_sales' => $serverAuthoritative
                ? self::money($server['cash_collected'])
                : self::money($input['cash_sales'] ?? $shift->cash_sales),
            'cash_refunds' => $serverAuthoritative
                ? self::money($server['cash_refunded'])
                : self::money($input['cash_refunds'] ?? $shift->cash_refunds),
            'cash_drops' => self::money($input['cash_drops'] ?? $shift->cash_drops),
            'cash_expenses' => $serverAuthoritative
                ? self::money($server['cash_expenses'])
                : 0.0,
        ];

        $expected = self::expectedCash($components);
        $variance = self::money($counted - $expected);
        $reconciliation = $this->reconcile($counter, $shift, $components, $counted, $expected, $server, $serverAuthoritative, $ignored);

        $digital = $serverAuthoritative
            ? self::money($server['digital_collected'])
            : self::money($input['digital_sales'] ?? $shift->digital_sales);

        $shift->update([
            'closed_by_user_id' => $userId ?? $shift->closed_by_user_id,
            'closed_via' => $via,
            'cash_in' => $components['cash_in'],
            'cash_sales' => $components['cash_sales'],
            'digital_sales' => $digital,
            'cash_refunds' => $components['cash_refunds'],
            'cash_drops' => $components['cash_drops'],
            'expected_cash' => $expected,
            'closing_cash_actual' => $counted,
            'closing_discrepancy' => $variance,
            'status' => 'closed',
            'closed_at' => $this->closingInstant($input),
            'notes' => $input['notes'] ?? $shift->notes,
            'reconciliation_json' => $reconciliation,
        ]);

        $shift = $shift->fresh();

        AuditLog::log('counter_shift_closed', 'CounterShift', (string) $shift->id, null, [
            'opening_float' => $components['opening_float'],
            'expected_cash' => $expected,
            'closing_cash_actual' => $counted,
            'closing_discrepancy' => $variance,
            'counter_code' => $counter->counter_code,
            'via' => $via,
        ], $counter->store_id, $userId);

        return [
            'shift' => $shift,
            'expected_cash' => $expected,
            'counted_cash' => $counted,
            'variance' => $variance,
            'reconciliation' => $reconciliation,
        ];
    }

    /**
     * The span this drawer was actually open, to the second. A window widened to
     * whole days would hand a counter that opens, closes and reopens on the same
     * day the whole day's money a second time.
     *
     * @return array{0: string, 1: string}
     */
    private function shiftWindow(CounterShift $shift, Carbon $closedAt): array
    {
        return [
            ($shift->opened_at ?? $closedAt->copy()->startOfDay())->toDateTimeString(),
            $closedAt->toDateTimeString(),
        ];
    }

    /** The drawer closed when the till said it did, not when the cloud got to it. */
    private function closingInstant(array $input): Carbon
    {
        $closedAt = $input['closed_at'] ?? null;

        if (is_numeric($closedAt)) {
            return Carbon::createFromTimestampMs((float) $closedAt);
        }

        return $closedAt instanceof Carbon ? $closedAt : now();
    }

    /**
     * What this counter's drawer should hold, from the counter's own components.
     *
     * @param array<string,float> $components
     */
    public static function expectedCash(array $components): float
    {
        return self::money(
            ($components['opening_float'] ?? 0)
            + ($components['cash_in'] ?? 0)
            + ($components['cash_sales'] ?? 0)
            - ($components['cash_refunds'] ?? 0)
            - ($components['cash_drops'] ?? 0)
            - ($components['cash_expenses'] ?? 0)
        );
    }

    /**
     * The same shift read back after it is closed: the drawer's components, the
     * counted cash, the variance, and the cloud's independent tally for this
     * counter over the days the shift covered.
     *
     * @param array<string,float> $components
     * @return array<string,mixed>
     */
    private function reconcile(
        Counter $counter,
        CounterShift $shift,
        array $components,
        float $counted,
        float $expected,
        ?array $server = null,
        bool $serverAuthoritative = false,
        array $ignoredClientTotals = []
    ): array {
        $window = $this->shiftWindow($shift, $shift->closed_at ?? now());
        $server = $server ?? $this->serverTally($counter, $window[0], $window[1]);

        return [
            'window_days' => [substr($window[0], 0, 10), substr($window[1], 0, 10)],
            'window' => $window,
            'authority' => $serverAuthoritative ? 'server' : 'till',
            'drawer' => $components + ['counted_cash' => $counted, 'expected_cash' => $expected],
            'server' => $server,
            'ignored_client_totals' => $ignoredClientTotals,
            // 0.01 is the smallest unit the drawer can hold; anything past that
            // is a difference an owner should look at, not a rounding artefact.
            'matches_server' => abs($expected - $server['expected_cash']) <= 0.01,
        ];
    }

    /**
     * Cash this counter took, paid back and paid out, counted from the documents
     * the server holds for the span the drawer stood open.
     *
     * @return array{cash_collected: float, digital_collected: float, cash_refunded: float, cash_expenses: float, bills: int, receipts: int, returns: int, opening_float: float, expected_cash: float}
     */
    private function serverTally(Counter $counter, string $from, string $to): array
    {
        $cashCollected = 0.0;
        $digitalCollected = 0.0;
        $receipts = 0;

        $payments = InvoicePayment::query()
            ->where('store_id', $counter->store_id)
            ->whereBetween('created_at', [$from, $to])
            ->whereNotIn('status', ['bounced', 'refunded', 'cancelled'])
            ->whereHas('invoice', fn ($q) => $q->where('counter_id', $counter->id)
                ->where('status', '!=', 'cancelled')
                ->whereNotIn('module_key', array_merge(self::RETURN_MODULES, ['quotation'])))
            ->get(['payment_mode', 'amount']);

        foreach ($payments as $payment) {
            if (self::isCash($payment->payment_mode)) {
                $cashCollected += (float) $payment->amount;
                $receipts++;
            } elseif (self::isDigital($payment->payment_mode)) {
                $digitalCollected += (float) $payment->amount;
                $receipts++;
            }
        }

        $returns = Invoice::query()
            ->where('store_id', $counter->store_id)
            ->where('counter_id', $counter->id)
            ->where('status', '!=', 'cancelled')
            ->whereIn('module_key', self::RETURN_MODULES)
            ->whereBetween('created_at', [$from, $to])
            ->get(['payment_mode', 'grand_total']);

        $cashRefunded = 0.0;
        foreach ($returns as $return) {
            if (self::isCash($return->payment_mode)) {
                $cashRefunded += (float) $return->grand_total;
            }
        }

        // EXP-01/SHF-01: a cash expense paid out of this counter's drawer is
        // money that left it, so the expected cash falls by the same amount.
        $cashExpenses = (float) Expense::query()
            ->where('store_id', $counter->store_id)
            ->where('counter_id', (string) $counter->id)
            ->whereBetween('created_at', [$from, $to])
            ->whereRaw('LOWER(payment_mode) LIKE ?', ['%cash%'])
            ->sum('amount');

        $float = (float) CounterShift::query()
            ->where('counter_id', $counter->id)
            ->whereBetween('opened_at', [$from, $to])
            ->sum('opening_float');

        return [
            'cash_collected' => self::money($cashCollected),
            'digital_collected' => self::money($digitalCollected),
            'cash_refunded' => self::money($cashRefunded),
            'cash_expenses' => self::money($cashExpenses),
            'receipts' => $receipts,
            'returns' => $returns->count(),
            'opening_float' => self::money($float),
            'expected_cash' => self::money($float + $cashCollected - $cashRefunded - $cashExpenses),
        ];
    }

    private static function isCash(?string $mode): bool
    {
        return $mode === null || str_contains(strtolower($mode), 'cash');
    }

    private static function isDigital(?string $mode): bool
    {
        $mode = strtolower((string) $mode);

        if (self::isCash($mode)) {
            return false;
        }

        foreach (['credit', 'udhari', 'gift', 'voucher', 'wallet'] as $nonMoney) {
            if (str_contains($mode, $nonMoney)) {
                return false;
            }
        }

        return true;
    }

    private static function money(mixed $value): float
    {
        return round((float) $value, 2);
    }
}

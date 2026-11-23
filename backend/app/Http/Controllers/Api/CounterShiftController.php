<?php

namespace App\Http\Controllers\Api;

use App\Http\Middleware\AuthenticateCounterProfile;
use App\Models\Counter;
use App\Models\CounterShift;
use App\Services\Auth\CounterPinAuthenticator;
use App\Services\Counter\CounterShiftService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * PRF-007 / B9 — the drawer of one counter, opened and closed with that
 * counter's own PIN.
 *
 * The device token names the counter and nothing in the request can choose
 * another (IS1); the PIN proves a person stood at that drawer at that moment.
 * A shift row is therefore keyed to the counter with no user identity, and the
 * only person recorded against it is whoever the admin panel happened to be,
 * which a till can never reach.
 *
 * What the counter profile allows is decided by `counter.profile` on the route
 * (`shift.open`, `shift.close`, `pos.cash_drawer`); this controller does not
 * re-read the profile, so there is one answer and one refusal path.
 */
class CounterShiftController
{
    public function __construct(
        private readonly CounterShiftService $shifts,
        private readonly CounterPinAuthenticator $pins,
    ) {}

    /** The shift this counter is standing in, plus what it closed recently. */
    public function show(Request $request): JsonResponse
    {
        $counter = $this->counter($request);

        if (!$counter) {
            return $this->unclaimed();
        }

        $open = $this->shifts->current($counter);

        return response()->json([
            'success' => true,
            'counter_id' => (int) $counter->id,
            'counter_code' => $counter->counter_code,
            'shift' => $open ? $this->present($open) : null,
            'expected_cash' => $open
                ? CounterShiftService::expectedCash([
                    'opening_float' => (float) $open->opening_float,
                    'cash_in' => (float) $open->cash_in,
                    'cash_sales' => (float) $open->cash_sales,
                    'cash_refunds' => (float) $open->cash_refunds,
                    'cash_drops' => (float) $open->cash_drops,
                ])
                : null,
            'recent' => CounterShift::where('counter_id', $counter->id)
                ->where('status', 'closed')
                ->latest('closed_at')
                ->limit(5)
                ->get()
                ->map(fn (CounterShift $shift) => $this->present($shift)),
        ]);
    }

    public function open(Request $request): JsonResponse
    {
        $counter = $this->counter($request);

        if (!$counter) {
            return $this->unclaimed();
        }

        $validated = $request->validate([
            'pin' => 'required|string|max:8',
            'opening_float' => 'nullable|numeric|min:0',
            'notes' => 'nullable|string|max:500',
        ]);

        $verdict = $this->pins->verify($counter, $validated['pin']);

        if (!$verdict['ok']) {
            return $this->refusal($verdict);
        }

        $alreadyOpen = (bool) $this->shifts->current($counter);

        $shift = $this->shifts->open($counter, [
            'opening_float' => $validated['opening_float'] ?? 0,
            'notes' => $validated['notes'] ?? null,
        ], CounterShiftService::VIA_COUNTER_PIN);

        return response()->json([
            'success' => true,
            'already_open' => $alreadyOpen,
            'shift' => $this->present($shift),
            'message' => $alreadyOpen
                ? "Counter {$counter->counter_code} was already standing in a shift; its float is unchanged."
                : "Shift opened with opening float ₹" . number_format((float) $shift->opening_float, 2) . '.',
        ]);
    }

    public function close(Request $request): JsonResponse
    {
        $counter = $this->counter($request);

        if (!$counter) {
            return $this->unclaimed();
        }

        $validated = $request->validate([
            'pin' => 'required|string|max:8',
            'closing_cash_actual' => 'required|numeric|min:0',
            'opening_float' => 'nullable|numeric|min:0',
            'cash_sales' => 'nullable|numeric|min:0',
            'digital_sales' => 'nullable|numeric|min:0',
            'cash_refunds' => 'nullable|numeric|min:0',
            'cash_in' => 'nullable|numeric|min:0',
            'cash_drops' => 'nullable|numeric|min:0',
            'notes' => 'nullable|string|max:500',
        ]);

        $verdict = $this->pins->verify($counter, $validated['pin']);

        if (!$verdict['ok']) {
            return $this->refusal($verdict);
        }

        $result = $this->shifts->close($counter, $validated, CounterShiftService::VIA_COUNTER_PIN);

        return response()->json([
            'success' => true,
            'shift' => $this->present($result['shift']),
            'expected_cash' => $result['expected_cash'],
            'counted_cash' => $result['counted_cash'],
            'variance' => $result['variance'],
            'server_tally' => $result['reconciliation']['server'] ?? null,
            'ignored_client_totals' => $result['reconciliation']['ignored_client_totals'] ?? [],
            'reconciliation' => $result['reconciliation'],
            'message' => "Shift closed for counter {$counter->counter_code}. Variance ₹"
                . number_format($result['variance'], 2) . '.',
        ]);
    }

    /** @param array<string,mixed> $verdict */
    private function refusal(array $verdict): JsonResponse
    {
        return response()->json([
            'success' => false,
            'code' => $verdict['code'],
            'message' => $verdict['message'],
        ] + array_intersect_key($verdict, array_flip(['locked_until', 'remaining_attempts'])), $verdict['status']);
    }

    private function present(CounterShift $shift): array
    {
        return [
            'id' => (int) $shift->id,
            'store_id' => (int) $shift->store_id,
            'counter_id' => (int) $shift->counter_id,
            'status' => $shift->status,
            'opening_float' => (float) $shift->opening_float,
            'cash_in' => (float) $shift->cash_in,
            'cash_sales' => (float) $shift->cash_sales,
            'digital_sales' => (float) $shift->digital_sales,
            'cash_refunds' => (float) $shift->cash_refunds,
            'cash_drops' => (float) $shift->cash_drops,
            'expected_cash' => $shift->expected_cash !== null ? (float) $shift->expected_cash : null,
            'closing_cash_actual' => $shift->closing_cash_actual !== null ? (float) $shift->closing_cash_actual : null,
            'closing_discrepancy' => $shift->closing_discrepancy !== null ? (float) $shift->closing_discrepancy : null,
            'opened_at' => $shift->opened_at?->toIso8601String(),
            'closed_at' => $shift->closed_at?->toIso8601String(),
            'opened_via' => $shift->opened_via,
            'closed_via' => $shift->closed_via,
            'notes' => $shift->notes,
            'reconciliation' => $shift->reconciliation_json,
        ];
    }

    /**
     * The counter the device token names, or none. Never a parameter, so one
     * till cannot open, close or read another counter's drawer (IS1).
     */
    private function counter(Request $request): ?Counter
    {
        return AuthenticateCounterProfile::counterFor($request);
    }

    private function unclaimed(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'error' => 'counter_unclaimed',
            'message' => 'This workstation is not on a counter yet. Ask the store owner for a counter activation code.',
        ], 409);
    }
}

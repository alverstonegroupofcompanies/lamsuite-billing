<?php

namespace App\Http\Controllers\Api;

use App\Http\Middleware\AuthenticateCounterProfile;
use App\Models\AuditLog;
use App\Services\Expenses\ExpenseIngest;
use App\Support\Payments\PaymentModePolicy;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * EXP-01 — an expense booked at the till, from the drawer that paid it.
 *
 * The counter is named by the device token and nothing in the request, so a
 * cash expense is attributed to the drawer that will be reconciled at shift
 * close. The reference rule is the store's own payment policy (PAY-04), with
 * the same "required reference" default a digital payment already gets.
 */
class TillExpenseController
{
    public function __construct(private readonly PaymentModePolicy $policy) {}

    public function store(Request $request): JsonResponse
    {
        $counter = AuthenticateCounterProfile::counterFor($request);

        if (!$counter) {
            return response()->json([
                'success' => false,
                'error' => 'counter_unclaimed',
                'message' => 'This workstation is not on a counter yet. Ask the store owner for a counter activation code.',
            ], 409);
        }

        $validated = $request->validate([
            'expense_head' => 'required|string|max:100',
            'amount' => 'required|numeric|min:0.01',
            'payment_mode' => 'nullable|string|max:30',
            'reference_no' => 'nullable|string|max:50',
            'notes' => 'nullable|string|max:1000',
            'expense_date' => 'nullable|date',
            // A till that queued the expense offline names it, so a replay is
            // the same row rather than a second expense.
            'expense_number' => 'nullable|string|max:40',
            // The till's own document id: the replay key. The number above is
            // only what the till printed and is re-minted if the store holds it.
            'external_id' => 'nullable|string|max:64',
        ]);

        $mode = trim((string) ($validated['payment_mode'] ?? 'Cash')) ?: 'Cash';
        $reference = trim((string) ($validated['reference_no'] ?? ''));

        try {
            $this->policy->assertLine((int) $counter->store_id, $mode, $reference === '' ? null : $reference);
        } catch (DomainException $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 422);
        }

        $attributes = [
            'counter_id' => (string) $counter->id,
            'expense_head' => $validated['expense_head'],
            'amount' => round((float) $validated['amount'], 2),
            'payment_mode' => $mode,
            'reference_no' => $reference === '' ? null : $reference,
            'notes' => $validated['notes'] ?? null,
            'expense_date' => $validated['expense_date'] ?? now()->toDateString(),
        ];

        $expense = app(ExpenseIngest::class)->upsert(
            (int) $counter->store_id,
            $attributes,
            $validated['external_id'] ?? null,
            $validated['expense_number'] ?? null
        );

        AuditLog::log('record_expense', 'Expense', (string) $expense->id, null, [
            'expense_head' => $expense->expense_head,
            'amount' => (float) $expense->amount,
            'payment_mode' => $expense->payment_mode,
            'counter_code' => $counter->counter_code,
            'via' => 'counter_token',
        ], (int) $counter->store_id);

        return response()->json([
            'success' => true,
            'message' => 'Expense recorded.',
            'expense' => [
                'id' => (int) $expense->id,
                'store_id' => (int) $expense->store_id,
                'counter_id' => $expense->counter_id !== null ? (int) $expense->counter_id : null,
                'counter_code' => $counter->counter_code,
                'expense_number' => $expense->expense_number,
                'expense_head' => $expense->expense_head,
                'amount' => (float) $expense->amount,
                'payment_mode' => $expense->payment_mode,
                'reference_no' => $expense->reference_no,
                'notes' => $expense->notes,
                'expense_date' => optional($expense->expense_date)->toDateString(),
            ],
        ], 201);
    }
}

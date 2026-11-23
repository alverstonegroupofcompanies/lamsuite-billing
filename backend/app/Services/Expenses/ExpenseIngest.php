<?php

namespace App\Services\Expenses;

use App\Models\Expense;
use Illuminate\Database\QueryException;

/**
 * EXP-01 — one way an expense from a till lands on the server, whether it came
 * through the counter route or the offline sync queue.
 *
 * The replay key is the till's own document id (`external_id`). The EXP-0000N a
 * till prints is numbered from its local row count, so it is display-only: it
 * is kept when the store does not hold it yet and re-minted when it does,
 * instead of rewriting the expense that already carries it.
 *
 * A till too old to send its id is still replay-safe: the same number with the
 * same head, amount and date is the same expense; anything else is a new one.
 */
class ExpenseIngest
{
    /**
     * @param array<string,mixed> $attributes expense columns other than store, number and external id
     */
    public function upsert(int $storeId, array $attributes, ?string $externalId, ?string $tillNumber): Expense
    {
        $externalId = $this->clean($externalId);
        $tillNumber = $this->clean($tillNumber);

        if ($externalId !== null) {
            $existing = Expense::where('store_id', $storeId)->where('external_id', $externalId)->first();
            if ($existing) {
                $existing->update($attributes);
                return $existing;
            }

            return $this->create($storeId, $attributes, $externalId, $tillNumber);
        }

        if ($tillNumber !== null) {
            $existing = Expense::where('store_id', $storeId)->where('expense_number', $tillNumber)->first();
            if ($existing && $this->sameDocument($existing, $attributes)) {
                return $existing;
            }
        }

        return $this->create($storeId, $attributes, null, $tillNumber);
    }

    /** @param array<string,mixed> $attributes */
    private function create(int $storeId, array $attributes, ?string $externalId, ?string $tillNumber): Expense
    {
        $number = $tillNumber !== null
            && !Expense::where('store_id', $storeId)->where('expense_number', $tillNumber)->exists()
                ? $tillNumber
                : Expense::nextNumberForStore($storeId);

        try {
            return Expense::create($attributes + [
                'store_id' => $storeId,
                'expense_number' => $number,
                'external_id' => $externalId,
            ]);
        } catch (QueryException $e) {
            // Two deliveries of the same queued document raced; the other one won.
            if ($externalId !== null) {
                $winner = Expense::where('store_id', $storeId)->where('external_id', $externalId)->first();
                if ($winner) {
                    return $winner;
                }
            }
            throw $e;
        }
    }

    /** @param array<string,mixed> $attributes */
    private function sameDocument(Expense $existing, array $attributes): bool
    {
        $date = isset($attributes['expense_date']) ? substr((string) $attributes['expense_date'], 0, 10) : null;

        return trim((string) $existing->expense_head) === trim((string) ($attributes['expense_head'] ?? ''))
            && abs((float) $existing->amount - (float) ($attributes['amount'] ?? 0)) < 0.005
            && ($date === null || optional($existing->expense_date)->toDateString() === $date);
    }

    private function clean(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}

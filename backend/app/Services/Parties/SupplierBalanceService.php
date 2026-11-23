<?php

namespace App\Services\Parties;

use App\Models\Party;
use App\Models\Purchase;
use App\Models\SupplierPayment;
use Illuminate\Support\Facades\DB;

/**
 * The supplier's outstanding balance is one number with one owner. The ledger screen
 * derives a running balance from the documents, and this service keeps the stored
 * `current_balance` moving by exactly the same arithmetic, so the column and the
 * ledger can never tell an owner two different stories.
 *
 * Every method works in deltas: a re-synced bill, an edited bill and a cancelled bill
 * all post the difference between what the row used to owe and what it owes now, which
 * makes the ingest path idempotent without asking callers to remember what they wrote
 * last time.
 */
class SupplierBalanceService
{
    /** Orders are not payable until they are received as a bill. */
    private const NON_PAYABLE_MODULES = ['purchase_order', 'order'];

    /**
     * What this document contributes to the supplier's outstanding balance right now.
     */
    public function contribution(?Purchase $purchase): float
    {
        if (!$purchase || !$purchase->exists) {
            return 0.0;
        }

        if (strtolower((string) $purchase->status) === 'cancelled') {
            return 0.0;
        }

        $module = strtolower((string) ($purchase->module_key ?: 'purchase'));
        if (in_array($module, self::NON_PAYABLE_MODULES, true)) {
            return 0.0;
        }

        $total = round((float) $purchase->grand_total, 2);

        return in_array($module, ['purchase_return', 'debit_note'], true) ? -$total : $total;
    }

    /**
     * Move the balance from the document's previous contribution to its new one,
     * handling a bill that changes supplier as two separate movements.
     */
    public function applyTransition(
        ?int $previousSupplierId,
        float $previousContribution,
        ?int $supplierId,
        float $newContribution,
        ?int $storeId = null
    ): void {
        if ($previousSupplierId === $supplierId) {
            $this->shift($supplierId, $newContribution - $previousContribution, $storeId);

            return;
        }

        $this->shift($previousSupplierId, -$previousContribution, $storeId);
        $this->shift($supplierId, $newContribution, $storeId);
    }

    public function shift(?int $supplierId, float $delta, ?int $storeId = null): void
    {
        $delta = round($delta, 2);
        if (!$supplierId || abs($delta) < 0.005) {
            return;
        }

        DB::transaction(function () use ($supplierId, $delta, $storeId) {
            $query = Party::whereKey($supplierId)->where('type', 'supplier');
            if ($storeId) {
                $query->where('store_id', $storeId);
            }

            $supplier = $query->lockForUpdate()->first();
            if (!$supplier) {
                return;
            }

            $supplier->increment('current_balance', $delta);
        });
    }

    /**
     * The balance the ledger screen would print, computed from the documents alone.
     */
    public function expectedBalance(Party $supplier): float
    {
        $purchases = Purchase::where('supplier_id', $supplier->id)
            ->where('store_id', $supplier->store_id)
            ->where('status', '!=', 'cancelled')
            ->where(function ($q) {
                $q->whereNull('module_key')
                    ->orWhereNotIn('module_key', self::NON_PAYABLE_MODULES);
            })
            ->get(['id', 'module_key', 'status', 'grand_total']);

        $documentTotal = $purchases->sum(fn (Purchase $purchase) => $this->contribution($purchase));

        $payments = (float) SupplierPayment::where('supplier_id', $supplier->id)->sum('amount');

        return round((float) $supplier->opening_balance + $documentTotal - $payments, 2);
    }
}

<?php

namespace App\Services\Purchase;

use App\Models\CompanySetting;
use App\Models\Expense;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\PurchaseChargeAllocation;
use App\Models\PurchaseItem;
use Illuminate\Support\Facades\DB;

/**
 * CR-C Task 4.12 — the money a supplier bill charged has to come back when goods go.
 *
 * A debit note reverses the returned share of every charge on the bill it returns against,
 * line by line rather than by a document-level percentage (PUR-015), and the figure is
 * always re-derived from the live returns instead of added to. Nothing accumulates, so a
 * retried sync, an edited return or a cancelled return cannot double-reverse (SYNC-002).
 */
class PurchaseChargeReversalService
{
    public const PROPORTIONAL = 'proportional';
    public const SUNK = 'sunk';

    public const RETURN_MODULES = ['purchase_return', 'debit_note'];

    /**
     * The store's rule for what a return does to charges (PUR-016 / CFG-003), read when the
     * return is posted. A policy change alters future bills only, so it is never stored on
     * the bill being returned against.
     */
    public function policy(int $storeId): string
    {
        $billing = CompanySetting::where('store_id', $storeId)->where('key', 'billing')->first()?->value;

        $value = is_array($billing) && is_array($billing['purchase_charges'] ?? null)
            ? ($billing['purchase_charges']['reverse_on_return'] ?? null)
            : null;

        return $value === self::SUNK ? self::SUNK : self::PROPORTIONAL;
    }

    /**
     * The inward bill a debit note returns against. The payload names it; a till that only
     * left the number in the notes still resolves, and a return whose lines are linked no
     * longer needs a header at all.
     */
    public function originalFor(Purchase $return, ?int $storeId = null, array $payload = []): ?Purchase
    {
        $storeId = $storeId ?? (int) $return->store_id;

        $query = fn () => Purchase::where('store_id', $storeId)->whereNotIn('module_key', self::RETURN_MODULES);

        $id = $payload['original_purchase_id'] ?? null;
        if (is_numeric($id) && $found = $query()->where('id', (int) $id)->first()) {
            return $found;
        }

        foreach (['original_purchase_number', 'supplier_invoice_no', 'original_invoice_number'] as $key) {
            $number = trim((string) ($payload[$key] ?? ''));
            if ($number !== '' && $found = $query()->where('invoice_number', $number)->first()) {
                return $found;
            }
        }

        // purchaseReturnNotes() keeps "Return against {number}" for every debit note a till pushes.
        if (preg_match('/return against\s+([^\s,;)]+)/i', (string) $return->notes, $m)
            && $found = $query()->where('invoice_number', $m[1])->first()) {
            return $found;
        }

        $linked = PurchaseItem::where('purchase_id', $return->id)
            ->whereNotNull('original_purchase_item_id')
            ->first();

        return $linked
            ? $query()->where('id', (int) PurchaseItem::find($linked->original_purchase_item_id)?->purchase_id)->first()
            : null;
    }

    /**
     * Point each return line at the bill line it returns, so a reversal can find the
     * allocation it has to give back (PUR-003). Lines of one batch are filled in order and
     * never past what the original line holds.
     */
    public function linkReturnLines(Purchase $return, int $storeId, ?Purchase $original = null): void
    {
        $original = $original ?? $this->originalFor($return, $storeId);
        if (!$original) {
            return;
        }

        $pool = [];
        foreach (PurchaseItem::where('purchase_id', $original->id)->orderBy('id')->get() as $item) {
            $pool[$this->batchKey($item)][(int) $item->id] = $item;
        }

        foreach (PurchaseItem::where('purchase_id', $return->id)->orderBy('id')->get() as $line) {
            $key = $this->batchKey($line);
            $taken = 0.0;

            foreach ($pool[$key] ?? [] as $itemId => $item) {
                $room = $this->unitsOf($item) - $this->returnedUnits($itemId, $return->id);
                if ($room <= 0.0001) {
                    continue;
                }

                $need = $this->unitsOf($line) - $taken;
                $line->update(['original_purchase_item_id' => $itemId]);
                $taken += $need > $room ? $room : $need;

                if ($taken + 0.0001 >= $this->unitsOf($line)) {
                    break;
                }
            }
        }
    }

    /**
     * Editing a bill re-keys its lines, so a debit note already filed against it points at
     * rows that no longer exist and would silently stop reversing its charge share. Re-link
     * those notes onto the new lines before any figure is re-derived (PUR-015). A note whose
     * stale link named one of this bill's dropped lines can only have belonged to this bill,
     * so the original is passed in rather than re-guessed from the notes.
     *
     * @param array<int, int> $droppedItemIds
     */
    public function relinkReturnsAfterEdit(Purchase $original, array $droppedItemIds, int $storeId): void
    {
        if ($droppedItemIds === []) {
            return;
        }

        $noteIds = PurchaseItem::query()
            ->whereIn('original_purchase_item_id', $droppedItemIds)
            ->pluck('purchase_id')
            ->unique();

        foreach ($noteIds as $noteId) {
            $note = Purchase::find($noteId);
            if ($note) {
                $this->linkReturnLines($note, $storeId, $original);
            }
        }
    }

    /**
     * The charge lines the debit note carries: the part of the reversal no other live return
     * of this bill has already claimed. Two part-returns therefore reverse exactly what one
     * full return would, to the paisa.
     *
     * @return array<int, array<string, mixed>>
     */
    public function reversalCharges(Purchase $return, Purchase $original): array
    {
        if ($this->policy((int) $return->store_id) === self::SUNK) {
            return [];
        }

        $due = $this->reversalMap($original)['charges'];
        $claimed = $this->reversalMap($original, $return->id)['charges'];

        $lines = [];
        foreach (PurchaseCharge::where('purchase_id', $original->id)->orderBy('seq')->get() as $charge) {
            $todo = round(($due[$charge->id] ?? 0) - ($claimed[$charge->id] ?? 0), 2);
            if (abs($todo) < 0.005) {
                continue;
            }

            $lines[] = $this->reversalLine($charge, $todo, count($lines) + 1);
        }

        return $lines;
    }

    /**
     * `Σ over the bill's lines of (what the charge put on that line × what has gone back)`.
     * A charge is never reversed past what it spread, and returning every line in full
     * reverses every charge in full.
     *
     * `charges` covers every charge line, however it was treated; `lines` covers only the ones
     * that landed on a goods line, which is the only money a landed cost ever carried.
     *
     * @return array{charges: array<int, float>, lines: array<int, float>}
     */
    public function reversalMap(Purchase $original, ?int $exceptReturnId = null): array
    {
        $items = PurchaseItem::where('purchase_id', $original->id)->get()->keyBy('id');
        $returned = $this->returnedUnitsByItem($original, $exceptReturnId);

        $perCharge = [];
        $perItem = [];

        foreach (PurchaseCharge::where('purchase_id', $original->id)->orderBy('seq')->get() as $charge) {
            $basis = $this->basisByItem($charge, $items);
            $spreadable = $this->spreadable($charge);
            // PUR-012: an expensed charge's line shares are derived only to total the reversal.
            // The money went to the expense register, so giving it back cannot move a landed cost.
            $landsOnBatch = $charge->treatment !== 'expense';

            $total = 0.0;
            foreach ($basis as $itemId => $share) {
                $units = $this->unitsOf($items[$itemId] ?? null);
                $ratio = $units > 0 ? min(1.0, ($returned[$itemId] ?? 0) / $units) : 0.0;

                // A line given back in full gives back the exact paisa it was charged.
                $reversed = $ratio >= 1.0 ? round($share, 2) : round($share * $ratio, 2);

                $total += $reversed;

                if ($landsOnBatch) {
                    $perItem[$itemId] = round(($perItem[$itemId] ?? 0) + $reversed, 2);
                }
            }

            $perCharge[$charge->id] = $this->clamp(round($total, 2), $spreadable);
        }

        return ['charges' => $perCharge, 'lines' => $perItem];
    }

    /**
     * The running reversal on the original's charge rows and the landed cost the returns have
     * taken back, re-derived after every return, edit or cancellation of that bill.
     */
    public function recordReversals(Purchase $original): array
    {
        // A sunk store never takes the charge back, so the bill reads as unreversed and the
        // batch keeps the whole landed cost, whatever the returns filed against it say.
        $map = $this->policy((int) $original->store_id) === self::SUNK
            ? ['charges' => [], 'lines' => []]
            : $this->reversalMap($original);

        DB::transaction(function () use ($original, $map) {
            foreach (PurchaseCharge::where('purchase_id', $original->id)->get() as $charge) {
                $charge->update(['reversed_amount' => round($map['charges'][$charge->id] ?? 0, 2)]);
            }

            $this->reduceLandedCost($original, $map['lines']);
        });

        return $map;
    }

    /**
     * A cancelled bill gives everything back (PUR-015): each charge reads as fully reversed,
     * the batch is valued at what the supplier charged, and the register entries the bill
     * generated are taken out. The posting itself is left in place so the bill's own figures
     * can still be reconciled against the reversal.
     */
    public function reverseOnCancel(Purchase $purchase): void
    {
        $charges = PurchaseCharge::where('purchase_id', $purchase->id)->get();
        if ($charges->isEmpty()) {
            return;
        }

        DB::transaction(function () use ($purchase, $charges) {
            foreach ($charges as $charge) {
                $charge->update(['reversed_amount' => round($this->spreadable($charge), 2)]);

                if ($charge->expense_id) {
                    Expense::where('purchase_charge_id', $charge->id)->delete();
                    $charge->update(['expense_id' => null]);
                }
            }

            foreach (PurchaseItem::where('purchase_id', $purchase->id)->get() as $item) {
                $batch = $this->batchFor((int) $purchase->store_id, $item);
                if ($batch) {
                    $batch->update(['landed_cost_rate' => round((float) $item->purchase_rate, 4)]);
                }
            }
        });
    }

    // ---------------------------------------------------------------- internals

    /** @return array<string, mixed> */
    private function reversalLine(PurchaseCharge $charge, float $amount, int $seq): array
    {
        $spreadable = $this->spreadable($charge);
        $taxable = (float) $charge->taxable_amount;

        // The engine prices a charge from its taxable amount, so the reversal is scaled back
        // out of the figure that also carries tax which can never be claimed.
        $net = $spreadable != 0 ? round($amount * ($taxable / $spreadable), 2) : round($amount, 2);

        return [
            'charge_id' => 'rev-' . $charge->id,
            'external_id' => 'rev|' . $charge->external_id,
            'seq' => $seq,
            'head_code' => $charge->head_code,
            'head_name' => $charge->head_name,
            'note' => 'Reversed on return of the ' . $charge->head_name . ' share',
            'sac_code' => $charge->sac_code,
            'amount' => -$net,
            'gst_percent' => (float) $charge->gst_percent,
            'cess_percent' => 0,
            'treatment' => $charge->treatment,
            'spread_method' => 'value',
            'itc_eligibility' => $charge->itc_eligibility,
            'is_rcm' => (bool) $charge->is_rcm,
            'paid_separately' => (bool) $charge->paid_separately,
            // CR-C-11: the note gives the charge back as the bill it returns was billed, so the
            // payable membership travels with the stored flag rather than today's policy (PUR-016).
            'in_payable' => (bool) $charge->in_payable,
            'paid_to_label' => $charge->paid_to_label,
            'place_of_supply' => $charge->place_of_supply,
            'source' => 'return_reversal',
        ];
    }

    /** The money a charge put on stock or on the expense register — what a return gives back. */
    private function spreadable(PurchaseCharge $charge): float
    {
        return $charge->reversibleAmount();
    }

    /**
     * What the charge put on each line of the bill. An add-to-cost charge already says so in
     * its allocation rows; an expensed one leaves none, so its share of each line is derived
     * from the line's value and the remainder paisa is placed on the last line, which keeps
     * `Σ basis == spreadable` to the paisa.
     *
     * @return array<int, float>
     */
    private function basisByItem(PurchaseCharge $charge, $items): array
    {
        $rows = PurchaseChargeAllocation::where('purchase_charge_id', $charge->id)
            ->orderBy('purchase_item_id')->get();

        if ($rows->isNotEmpty()) {
            return $rows->mapWithKeys(fn ($row) => [(int) $row->purchase_item_id => round((float) $row->allocated_amount, 2)])->all();
        }

        if ($charge->treatment !== 'expense') {
            return [];
        }

        $total = $this->spreadable($charge);
        $values = $items->mapWithKeys(fn ($item) => [(int) $item->id => max(0.0, (float) $item->taxable_amount)]);
        $valueTotal = $values->sum();

        if (abs($total) < 0.005 || $valueTotal <= 0) {
            return [];
        }

        $shares = [];
        $placed = 0.0;
        foreach ($values as $itemId => $value) {
            $shares[$itemId] = round($total * ($value / $valueTotal), 2);
            $placed = round($placed + $shares[$itemId], 2);
        }

        $last = array_key_last($shares);
        $shares[$last] = round($shares[$last] + ($total - $placed), 2);

        return $shares;
    }

    /** @return array<int, float> units returned per original line, across the live returns */
    private function returnedUnitsByItem(Purchase $original, ?int $exceptReturnId): array
    {
        $itemIds = PurchaseItem::where('purchase_id', $original->id)->pluck('id')->all();
        if (!$itemIds) {
            return [];
        }

        $returned = array_fill_keys(array_map('intval', $itemIds), 0.0);

        $lines = PurchaseItem::query()
            ->whereIn('original_purchase_item_id', $itemIds)
            ->whereIn('purchase_id', function ($query) use ($original, $exceptReturnId) {
                $query->select('id')->from('purchases')
                    ->where('store_id', $original->store_id)
                    ->whereIn('module_key', self::RETURN_MODULES)
                    ->where('status', '!=', 'cancelled')
                    ->when($exceptReturnId, fn ($q) => $q->where('id', '!=', $exceptReturnId));
            })
            ->get();

        foreach ($lines as $line) {
            $key = (int) $line->original_purchase_item_id;
            $returned[$key] = round(($returned[$key] ?? 0) + $this->unitsOf($line), 4);
        }

        return $returned;
    }

    private function returnedUnits(int $originalItemId, int $exceptReturnId): float
    {
        $lines = PurchaseItem::query()
            ->where('original_purchase_item_id', $originalItemId)
            ->whereIn('purchase_id', function ($query) use ($exceptReturnId) {
                $query->select('id')->from('purchases')
                    ->whereIn('module_key', self::RETURN_MODULES)
                    ->where('status', '!=', 'cancelled')
                    ->where('id', '!=', $exceptReturnId);
            })
            ->get();

        return round((float) $lines->sum(fn ($line) => $this->unitsOf($line)), 4);
    }

    private function unitsOf(?PurchaseItem $item): float
    {
        if (!$item) {
            return 0.0;
        }

        $upp = max(1, (float) ($item->units_per_pack ?: 1));

        return round(((float) $item->qty + (float) $item->free_qty) * $upp
            + (float) $item->loose_qty + (float) $item->free_loose_qty, 4);
    }

    private function clamp(float $value, float $reference): float
    {
        if (abs($reference) < 0.005) {
            return 0.0;
        }

        $magnitude = min(abs($value), abs($reference));

        return round($reference < 0 ? -$magnitude : $magnitude, 2);
    }

    /**
     * PUR-011 values a batch on what it cost to get here, so the paisa a return takes back
     * comes out of the landed cost while the supplier's own rate is untouched.
     */
    private function reduceLandedCost(Purchase $original, array $reversedPerItem): void
    {
        foreach (PurchaseItem::where('purchase_id', $original->id)->get() as $item) {
            $units = $this->unitsOf($item);
            $batch = $this->batchFor((int) $original->store_id, $item);

            if ($units <= 0 || !$batch) {
                continue;
            }

            $net = round((float) $item->charge_allocation, 2) - ($reversedPerItem[(int) $item->id] ?? 0.0);

            $batch->update(['landed_cost_rate' => round((float) $item->purchase_rate + $net / $units, 4)]);
        }
    }

    private function batchFor(int $storeId, PurchaseItem $item): ?ProductBatch
    {
        if (!$item->product_id) {
            return null;
        }

        return ProductBatch::where('store_id', $storeId)
            ->where('product_id', $item->product_id)
            ->where('batch_no', (string) ($item->batch_no ?: 'BAT-01'))
            ->first();
    }

    private function batchKey(PurchaseItem $item): string
    {
        return ((int) $item->product_id) . '|' . strtolower(trim((string) $item->batch_no))
            . '|' . strtolower(trim((string) $item->product_name));
    }
}

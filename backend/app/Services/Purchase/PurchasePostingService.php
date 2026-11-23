<?php

namespace App\Services\Purchase;

use App\Models\Counter;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\StockLedgerEntry;
use App\Models\SyncEvent;
use App\Services\Parties\SupplierBalanceService;
use Illuminate\Validation\ValidationException;

/**
 * G3 — a purchase becomes real in exactly one place.
 *
 * Every write path (the till's sync push, POST /purchases, a goods receipt against a
 * purchase order) ends here, so "saved" always means the same stock, the same ledger
 * rows and the same supplier payable. The one quantity definition lives here too:
 * `purchase_items.qty` is billed PACKS, and base units are derived from packs, loose
 * units and free goods.
 */
class PurchasePostingService
{
    public const RETURN_MODULES = ['purchase_return', 'debit_note'];

    public const ORDER_MODULES = ['purchase_order', 'order'];

    private SupplierBalanceService $balances;

    public function __construct(SupplierBalanceService $balances)
    {
        $this->balances = $balances;
    }

    public function postInward(
        Purchase $purchase,
        iterable $before,
        iterable $after,
        float $oldEffect = 0.0,
        ?int $oldSupplierId = null,
        ?Counter $counter = null,
        ?int $staffUserId = null
    ): void {
        $this->moveStock($purchase, $before, $after, 1.0, $counter, $staffUserId);
        $this->applyBalance($oldSupplierId, $oldEffect, $purchase);
    }

    public function postReturn(
        Purchase $purchase,
        iterable $before,
        iterable $after,
        float $oldEffect = 0.0,
        ?int $oldSupplierId = null,
        ?Counter $counter = null,
        ?int $staffUserId = null
    ): void {
        $this->moveStock($purchase, $before, $after, -1.0, $counter, $staffUserId);
        $this->applyBalance($oldSupplierId, $oldEffect, $purchase);
    }

    /** Cancelling a document puts back exactly what it moved and removes its payable. */
    public function reverse(
        Purchase $purchase,
        iterable $heldItems,
        float $oldEffect = 0.0,
        ?int $oldSupplierId = null,
        ?Counter $counter = null,
        ?int $staffUserId = null
    ): void {
        $direction = self::isReturnModule($purchase->module_key) ? -1.0 : 1.0;

        $this->moveStock($purchase, $heldItems, [], $direction, $counter, $staffUserId);
        $this->applyBalance($oldSupplierId, $oldEffect, $purchase);
    }

    public static function isReturnModule(?string $module): bool
    {
        return in_array(strtolower(trim((string) $module)), self::RETURN_MODULES, true);
    }

    public static function isOrderModule(?string $module): bool
    {
        return in_array(strtolower(trim((string) $module)), self::ORDER_MODULES, true);
    }

    /** Base units a purchase line brings in or sends back. qty is packs; returns use upp 1. */
    public function baseUnits($item): float
    {
        $unitsPerPack = max(1.0, (float) ($item->units_per_pack ?: 1));

        return ((float) $item->qty + (float) $item->free_qty) * $unitsPerPack
            + (float) $item->loose_qty + (float) $item->free_loose_qty;
    }

    /**
     * Move the difference between the items a document held and the items it holds now.
     *
     * A negative move is refused when the store does not have the batch or the units, so
     * a return or an edit can no longer push a batch, or the store, below zero (PUR-07).
     */
    public function moveStock(
        Purchase $purchase,
        iterable $before,
        iterable $after,
        float $direction = 1.0,
        ?Counter $counter = null,
        ?int $staffUserId = null
    ): void {
        $moves = [];

        $tally = function (iterable $items, float $sign) use (&$moves): void {
            foreach ($items as $item) {
                if (!$item->product_id) {
                    continue;
                }

                $units = $this->baseUnits($item);
                if (abs($units) < 0.0001) {
                    continue;
                }

                $batchNo = trim((string) ($item->batch_no ?? ''));
                $key = $item->product_id . '|' . $batchNo;

                if (!isset($moves[$key])) {
                    $moves[$key] = [
                        'product_id' => (int) $item->product_id,
                        'batch_no' => $batchNo !== '' ? $batchNo : null,
                        'line' => $item,
                        'qty' => 0.0,
                    ];
                }

                $moves[$key]['qty'] += $sign * $units;
                $moves[$key]['line'] = $item;
            }
        };

        $tally($before, -$direction);
        $tally($after, $direction);

        $cancelled = strtolower((string) $purchase->status) === 'cancelled';
        $returning = $direction < 0;

        foreach ($moves as $move) {
            $qty = round($move['qty'], 4);
            if (abs($qty) < 0.0001) {
                continue;
            }

            $line = $move['line'];

            $batch = $move['batch_no'] !== null
                ? ProductBatch::where('store_id', $purchase->store_id)
                    ->where('product_id', $move['product_id'])
                    ->where('batch_no', $move['batch_no'])
                    ->lockForUpdate()
                    ->first()
                : null;

            $product = Product::whereKey($move['product_id'])->lockForUpdate()->first();

            if ($qty < 0 && $batch) {
                if ((float) $batch->stock_qty + $qty < -0.0001) {
                    throw ValidationException::withMessages([
                        'items' => [
                            "Only {$this->fmt((float) $batch->stock_qty)} units of {$line->product_name} "
                            . "(batch {$this->batchLabel($move)}) are on hand; {$this->fmt(abs($qty))} cannot go back to the supplier.",
                        ],
                    ]);
                }

                if ($product && (float) $product->current_stock + $qty < -0.0001) {
                    throw ValidationException::withMessages([
                        'items' => [
                            "Only {$this->fmt((float) $product->current_stock)} units of {$line->product_name} "
                            . "are on hand in this store; {$this->fmt(abs($qty))} cannot be returned.",
                        ],
                    ]);
                }
            }

            if (!$batch && $qty > 0) {
                $batch = ProductBatch::create([
                    'store_id' => $purchase->store_id,
                    'product_id' => $move['product_id'],
                    'batch_no' => $move['batch_no'] ?? 'BAT-01',
                    'mfg_date' => $line->mfg_date ? $line->mfg_date->format('Y-m-d') : null,
                    'expiry_date' => $line->expiry_date
                        ? $line->expiry_date->format('Y-m-d')
                        : now()->addYear()->toDateString(),
                    'stock_qty' => 0,
                    'mrp' => $line->mrp ?? 0,
                    'purchase_rate' => $line->purchase_rate ?? 0,
                    'selling_rate' => $line->selling_rate ?? 0,
                ]);
            }

            if ($batch) {
                $batch->increment('stock_qty', $qty);
            }

            if ($product) {
                $product->increment('current_stock', $qty);
            }

            $balanceAfter = $batch ? (float) $batch->fresh()->stock_qty : 0;
            $prefix = $returning ? 'PURCHASE_RETURN' : 'PURCHASE';

            StockLedgerEntry::create([
                'store_id' => $purchase->store_id,
                'product_id' => $move['product_id'],
                'batch_id' => $batch ? $batch->id : null,
                'counter_id' => $counter?->id,
                'counter_code' => $counter?->counter_code,
                'location_name' => $counter?->location_name,
                'staff_user_id' => $staffUserId,
                'event_type' => $qty > 0
                    ? ($returning ? ($cancelled ? 'PURCHASE_RETURN_CANCEL' : 'PURCHASE_RETURN_EDIT_REVERSAL') : 'PURCHASE_RECEIPT')
                    : ($returning ? 'PURCHASE_RETURN' : ($cancelled ? 'PURCHASE_CANCEL' : 'PURCHASE_EDIT_REVERSAL')),
                'qty_delta' => $qty,
                'reference_type' => $prefix,
                'reference_id' => (string) $purchase->id,
                'balance_after' => $balanceAfter,
            ]);

            SyncEvent::create([
                'store_id' => $purchase->store_id,
                'entity_type' => 'stock_event',
                'entity_id' => (string) ($batch ? $batch->id : $move['product_id']),
                'action' => 'update',
                'client_data' => [
                    'product_id' => $move['product_id'],
                    'batch_id' => $batch ? $batch->id : null,
                    'batch_no' => $batch ? $batch->batch_no : null,
                    'remaining_stock' => $batch ? $balanceAfter : null,
                    'qty_delta' => $qty,
                    'reference_id' => "{$prefix}-{$purchase->invoice_number}",
                ],
                'status' => 'resolved',
            ]);
        }
    }

    /** What this document does to the supplier's balance: +owed, −returned, 0 cancelled/order. */
    public function payableEffect(Purchase $purchase): float
    {
        return $this->balances->contribution($purchase);
    }

    public function applyBalance(?int $oldSupplierId, float $oldEffect, Purchase $purchase): void
    {
        if (!$purchase->exists) {
            return;
        }

        $this->balances->applyTransition(
            $oldSupplierId,
            $oldEffect,
            $purchase->supplier_id ? (int) $purchase->supplier_id : null,
            $this->balances->contribution($purchase),
            (int) $purchase->store_id
        );
    }

    /**
     * One supplier cannot file the same bill number twice. Two suppliers may share a
     * number, and a return is its own document with its own number (PUR-06).
     */
    public function assertUniqueBill(
        int $storeId,
        string $moduleKey,
        ?int $supplierId,
        ?string $supplierName,
        ?string $invoiceNumber,
        ?int $ignoreId = null
    ): void {
        $number = strtoupper(trim((string) $invoiceNumber));
        if ($number === '') {
            return;
        }

        $returning = self::isReturnModule($moduleKey);
        $modules = $returning ? self::RETURN_MODULES : ['purchase'];

        $query = Purchase::where('store_id', $storeId)
            ->where(function ($q) use ($modules): void {
                $q->whereIn('module_key', $modules);

                // A row written before module_key was ever set is an inward bill.
                if (in_array('purchase', $modules, true)) {
                    $q->orWhereNull('module_key')->orWhere('module_key', '');
                }
            })
            ->where('status', '!=', 'cancelled');

        // An inward bill is identified by the supplier's own number. A debit note carries the
        // original bill's number too, so its identity is its own note number — otherwise a
        // second partial return against the same bill would be mistaken for a duplicate.
        if ($returning) {
            $query->whereRaw('UPPER(TRIM(invoice_number)) = ?', [$number]);
        } else {
            $query->where(function ($q) use ($number): void {
                $q->whereRaw('UPPER(TRIM(supplier_invoice_no)) = ?', [$number])
                    ->orWhereRaw('UPPER(TRIM(invoice_number)) = ?', [$number]);
            });
        }

        if ($ignoreId) {
            $query->where('id', '!=', $ignoreId);
        }

        if ($supplierId) {
            $query->where('supplier_id', $supplierId);
        } else {
            $name = strtoupper(trim((string) $supplierName));
            $query->whereNull('supplier_id')->whereRaw('UPPER(TRIM(supplier_name)) = ?', [$name]);
        }

        $existing = $query->first();

        if ($existing) {
            throw ValidationException::withMessages([
                'invoice_number' => [
                    "Supplier bill {$invoiceNumber} from {$existing->supplier_name} "
                    . "is already recorded as {$existing->invoice_number}.",
                ],
            ]);
        }
    }

    public function billKeyFor(Purchase $purchase): ?string
    {
        $module = strtolower(trim((string) $purchase->module_key)) ?: 'purchase';

        if (self::isOrderModule($module) || strtolower((string) $purchase->status) === 'cancelled') {
            return null;
        }

        // A debit note is named by its own note number; only an inward bill is named by the
        // supplier's bill number (its `supplier_invoice_no`).
        $number = self::isReturnModule($module)
            ? ($purchase->invoice_number ?: $purchase->supplier_invoice_no)
            : ($purchase->supplier_invoice_no ?: $purchase->invoice_number);
        $number = strtoupper(trim((string) $number));
        if ($number === '') {
            return null;
        }

        $supplier = $purchase->supplier_id
            ? 'id:' . $purchase->supplier_id
            : 'name:' . strtoupper(trim((string) $purchase->supplier_name));

        return $module . '|' . $supplier . '|' . $number;
    }

    public function stampBillKey(Purchase $purchase): void
    {
        $key = $this->billKeyFor($purchase);

        if ($purchase->getAttribute('bill_key') !== $key) {
            $purchase->setAttribute('bill_key', $key);
            $purchase->save();
        }
    }

    private function batchLabel(array $move): string
    {
        return $move['batch_no'] ?? 'no batch';
    }

    private function fmt(float $value): string
    {
        return rtrim(rtrim(number_format($value, 3, '.', ''), '0'), '.') ?: '0';
    }
}

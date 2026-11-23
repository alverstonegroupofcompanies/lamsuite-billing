<?php

namespace App\Services\Stock;

use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\User;

/**
 * G2-STOCK: stock only moves through the ledger. Opening stock and later batch
 * additions used to write products.current_stock directly, so the ledger and the
 * product disagreed from the first day of a product's life.
 */
class StockLedgerService
{
    /**
     * Recompute a product's movement total from its batches. This is a
     * reconciliation, not a movement: it writes no ledger row.
     */
    public function syncProductStock(Product $product): float
    {
        $storeId = (int) $product->store_id;

        $total = (float) ProductBatch::where('store_id', $storeId)
            ->where('product_id', $product->id)
            ->sum('stock_qty');

        Product::where('store_id', $storeId)
            ->where('id', $product->id)
            ->update(['current_stock' => $total]);
        $product->setAttribute('current_stock', $total);

        return $total;
    }

    /**
     * Record stock that entered a product without a purchase bill — the initial
     * batch at creation, or a batch an owner adds by hand afterwards.
     */
    public function postOpeningStock(ProductBatch $batch, ?User $actor = null): ?StockLedgerEntry
    {
        $qty = (float) $batch->stock_qty;
        if ($qty <= 0) {
            return null;
        }

        $this->syncProductStock($batch->product);

        // balance_after is the batch balance, as every other ledger writer records it.
        return StockLedgerEntry::create([
            'store_id' => $batch->store_id,
            'product_id' => $batch->product_id,
            'batch_id' => $batch->id,
            'event_type' => 'OPENING_STOCK',
            'qty_delta' => $qty,
            'reference_type' => 'opening_stock',
            'reference_id' => (string) $batch->id,
            'balance_after' => $qty,
            'idempotency_key' => "opening_stock_batch_{$batch->id}",
            'staff_user_id' => $actor?->id,
        ]);
    }

    /**
     * An owner changed a batch's quantity by hand in Masters (edit, zero-out or
     * delete). The batch row already holds $newQty; this books the difference so
     * the ledger total keeps matching the batch, and re-syncs the product.
     */
    public function postAdminCorrection(ProductBatch $batch, float $oldQty, float $newQty, ?User $actor = null): ?StockLedgerEntry
    {
        $delta = round($newQty - $oldQty, 3);

        $this->syncProductStock($batch->product);

        if (abs($delta) < 0.0005) {
            return null;
        }

        return StockLedgerEntry::create([
            'store_id' => $batch->store_id,
            'product_id' => $batch->product_id,
            'batch_id' => $batch->id,
            'event_type' => 'ADMIN_CORRECTION',
            'qty_delta' => $delta,
            'reference_type' => 'batch_edit',
            'reference_id' => (string) $batch->id,
            'is_reconciled_negative' => $newQty < 0,
            'balance_after' => $newQty,
            'idempotency_key' => sprintf('admin_correction_batch_%d_v%d', $batch->id, (int) $batch->version),
            'staff_user_id' => $actor?->id,
        ]);
    }
}

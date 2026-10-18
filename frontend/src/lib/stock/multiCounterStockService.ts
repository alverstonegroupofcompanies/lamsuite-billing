import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";

export interface StockReconciliationResult {
  product_id: string;
  batch_id: string;
  batch_no: string;
  opening_qty: number;
  total_deltas: number;
  reconciled_stock: number;
  is_negative: boolean;
  deficit_qty: number;
  counter_breakdown: Record<string, number>;
  transactions_count: number;
}

export class MultiCounterStockService {
  async computeBatchReconciledStock(
    batchId: string,
    openingQty = 0
  ): Promise<StockReconciliationResult> {
    const allTx = await sqliteStorage.findAll<any>("stock_transactions");
    const batchTx = (allTx || []).filter((tx) => tx.batch_id === batchId);

    const counterBreakdown: Record<string, number> = {};
    let totalDeltas = 0;

    for (const tx of batchTx) {
      const delta = Number(tx.qty_delta || 0);
      const counter = tx.counter_id || "Unassigned Counter";
      counterBreakdown[counter] = (counterBreakdown[counter] || 0) + delta;
      totalDeltas += delta;
    }

    const reconciledStock = openingQty + totalDeltas;
    const isNegative = reconciledStock < 0;
    const deficitQty = isNegative ? Math.abs(reconciledStock) : 0;

    const batch = await sqliteStorage.findById<ProductBatch>("product_batches", batchId);

    return {
      product_id: batch?.product_id || "",
      batch_id: batchId,
      batch_no: batch?.batch_no || "UNKNOWN",
      opening_qty: openingQty,
      total_deltas: totalDeltas,
      reconciled_stock: reconciledStock,
      is_negative: isNegative,
      deficit_qty: deficitQty,
      counter_breakdown: counterBreakdown,
      transactions_count: batchTx.length,
    };
  }

  async syncMergeCounterStockDeltas(
    counterEvents: Array<{
      id: string;
      product_id: string;
      batch_id: string;
      counter_id: string;
      qty_delta: number;
      reference_type: string;
      reference_id: string;
      created_at: number;
    }>
  ): Promise<{ applied: number; affectedBatches: string[] }> {
    let applied = 0;
    const affectedBatches = new Set<string>();

    for (const evt of counterEvents) {
      const existing = await sqliteStorage.findById("stock_transactions", evt.id);
      if (!existing) {
        await sqliteStorage.insertRecord("stock_transactions", evt.id, {
          ...evt,
          event_type: evt.qty_delta < 0 ? "SALE" : "PURCHASE",
        });
        applied += 1;
        affectedBatches.add(evt.batch_id);

        // Update local batch stock_qty to reflect new delta
        const batch = await sqliteStorage.findById<ProductBatch>("product_batches", evt.batch_id);
        if (batch) {
          batch.stock_qty = (batch.stock_qty || 0) + evt.qty_delta;
          await productsStore.upsertBatch(batch);
        }

        const prod = await productsStore.getProductById(evt.product_id);
        if (prod) {
          prod.current_stock = (prod.current_stock || 0) + evt.qty_delta;
          await productsStore.upsertProduct(prod);
        }
      }
    }

    return { applied, affectedBatches: Array.from(affectedBatches) };
  }

  /**
   * Cross-counter stock lookup showing stock across counters with last updated timestamp.
   */
  async getCrossCounterStockLookup(productId: string): Promise<{
    product_id: string;
    product_name: string;
    total_store_stock: number;
    batches: Array<{
      batch_id: string;
      batch_no: string;
      expiry_date: string;
      mrp: number;
      reconciled_stock: number;
      is_negative: boolean;
      counter_breakdown: Record<string, number>;
      last_updated_at: number;
    }>;
  }> {
    const prod = await productsStore.getProductById(productId);
    const allBatches = await sqliteStorage.findAll<ProductBatch>("product_batches");
    const prodBatches = (allBatches || []).filter((b) => b.product_id === productId);

    const batchResults = [];
    let totalStock = 0;

    for (const b of prodBatches) {
      // batch.stock_qty already has deltas merged into it; reconciled stock is simply b.stock_qty
      const recon = await this.computeBatchReconciledStock(b.id, 0);
      const effectiveStock = b.stock_qty || 0;
      totalStock += effectiveStock;
      batchResults.push({
        batch_id: b.id,
        batch_no: b.batch_no,
        expiry_date: b.expiry_date || "",
        mrp: b.mrp || 0,
        reconciled_stock: effectiveStock,
        is_negative: effectiveStock < 0,
        counter_breakdown: recon.counter_breakdown,
        last_updated_at: Date.now(),
      });
    }

    return {
      product_id: productId,
      product_name: prod?.name || "Unknown Product",
      total_store_stock: totalStock,
      batches: batchResults,
    };
  }
}

export const multiCounterStockService = new MultiCounterStockService();

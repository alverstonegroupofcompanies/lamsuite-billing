import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";

export interface StockAdjustmentInput {
  product_id: string;
  batch_id: string;
  adjustment_qty: number; // positive for addition, negative for write-off
  reason: "Damaged" | "Expired" | "Breakage" | "Theft" | "Found Stock" | "Other";
  notes?: string;
}

export interface PhysicalReconciliationLine {
  product_id: string;
  batch_id: string;
  counted_qty: number;
}

export interface InterStoreTransferInput {
  transfer_no: string;
  source_store_id: string;
  destination_store_id: string;
  product_id: string;
  batch_id: string;
  transfer_qty: number;
}

export class InventoryService {
  async recordStockAdjustment(input: StockAdjustmentInput): Promise<{ success: boolean; adjustmentId: string }> {
    const batch = await sqliteStorage.findById<ProductBatch>("product_batches", input.batch_id);
    if (!batch) throw new Error("Batch not found for stock adjustment");

    const newStock = batch.stock_qty + input.adjustment_qty;
    batch.stock_qty = newStock;
    await productsStore.upsertBatch(batch);

    // Also update product current_stock
    const product = await productsStore.getProductById(input.product_id);
    if (product) {
      product.current_stock = (product.current_stock || 0) + input.adjustment_qty;
      await productsStore.upsertProduct(product);
    }

    const adjustmentId = `adj_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const now = Date.now();

    // Double-entry stock transaction
    const eventType = input.adjustment_qty >= 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";
    await sqliteStorage.insertRecord("stock_transactions", adjustmentId, {
      id: adjustmentId,
      product_id: input.product_id,
      batch_id: input.batch_id,
      event_type: eventType,
      qty_delta: input.adjustment_qty,
      reference_type: "STOCK_ADJUSTMENT",
      reference_id: adjustmentId,
      notes: `${input.reason}: ${input.notes || ""}`.trim(),
      created_at: now,
    });

    return { success: true, adjustmentId };
  }

  async recordPhysicalReconciliation(
    lines: PhysicalReconciliationLine[],
    auditReference = "PHY_AUDIT"
  ): Promise<{ success: boolean; adjustmentsPosted: number }> {
    let adjustmentsPosted = 0;
    const now = Date.now();

    for (const line of lines) {
      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", line.batch_id);
      if (!batch) continue;

      const systemStock = batch.stock_qty;
      const variance = line.counted_qty - systemStock;

      if (variance !== 0) {
        batch.stock_qty = line.counted_qty;
        await productsStore.upsertBatch(batch);

        const txId = `rec_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("stock_transactions", txId, {
          id: txId,
          product_id: line.product_id,
          batch_id: line.batch_id,
          event_type: "RECONCILIATION_ADJUSTMENT",
          qty_delta: variance,
          reference_type: auditReference,
          created_at: now,
        });

        adjustmentsPosted += 1;
      }
    }

    return { success: true, adjustmentsPosted };
  }

  async dispatchInterStoreTransfer(transfer: InterStoreTransferInput): Promise<{ success: boolean; transferId: string }> {
    const batch = await sqliteStorage.findById<ProductBatch>("product_batches", transfer.batch_id);
    if (!batch) throw new Error("Batch not found for store transfer");

    if (batch.stock_qty < transfer.transfer_qty) {
      throw new Error(`Insufficient stock. Available: ${batch.stock_qty}, Requested: ${transfer.transfer_qty}`);
    }

    // Decrement source batch stock
    batch.stock_qty -= transfer.transfer_qty;
    await productsStore.upsertBatch(batch);

    const transferId = `st_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const now = Date.now();

    // Log stock transfer out
    await sqliteStorage.insertRecord("stock_transactions", transferId, {
      id: transferId,
      product_id: transfer.product_id,
      batch_id: transfer.batch_id,
      event_type: "TRANSFER_OUT",
      qty_delta: -transfer.transfer_qty,
      reference_type: "STORE_TRANSFER",
      reference_id: transfer.transfer_no,
      created_at: now,
    });

    return { success: true, transferId };
  }

  async getBatchesNearExpiry(thresholdDays = 60, referenceDate = new Date()): Promise<ProductBatch[]> {
    const all = await sqliteStorage.findAll<ProductBatch>("product_batches");
    const cutoffDate = new Date(referenceDate.getTime() + thresholdDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    return all
      .filter((b) => b.stock_qty > 0 && b.expiry_date <= cutoffDate)
      .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
  }

  async getLowStockProducts(): Promise<ProductItem[]> {
    const all = await sqliteStorage.findAll<ProductItem>("products");
    return all.filter((p) => p.is_active && (p.reorder_level || 0) > 0 && (p.current_stock || 0) <= (p.reorder_level || 0));
  }

  async getNegativeStockBatches(): Promise<ProductBatch[]> {
    const all = await sqliteStorage.findAll<ProductBatch>("product_batches");
    return all.filter((b) => (b.stock_qty || 0) < 0);
  }
}

export const inventoryService = new InventoryService();

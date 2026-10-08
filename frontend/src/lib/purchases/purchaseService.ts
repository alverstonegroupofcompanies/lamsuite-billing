import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch } from "../masters/productsStore";
import { round2, splitNetByGstMode } from "../billing/billingCalculations";
import { syncQueueService } from "../sync/syncQueueService";

export interface PurchaseLineItemInput {
  product_id: string;
  product_name: string;
  batch_no: string;
  mfg_date?: string;
  expiry_date: string;
  qty: number; // billed quantity
  free_qty?: number; // bonus / free goods
  units_per_pack?: number;
  purchase_rate: number; // ex-tax rate
  mrp?: number;
  gst_percent: number;
  cess_percent?: number;
}

export interface PurchaseDocumentInput {
  purchase_number: string;
  supplier_id: string;
  supplier_name: string;
  supplier_invoice_no: string;
  purchase_date: string;
  lines: PurchaseLineItemInput[];
  notes?: string;
}

export class PurchaseService {
  calculateLineTotals(line: PurchaseLineItemInput): {
    taxable_amount: number;
    cgst_amount: number;
    sgst_amount: number;
    total_tax: number;
    total_amount: number;
    total_stock_units: number;
    effective_unit_cost: number;
  } {
    const billedPacks = Math.max(0, line.qty);
    const freePacks = Math.max(0, line.free_qty || 0);
    const unitsPerPack = Math.max(1, line.units_per_pack || 1);

    // Free items are NOT billed; taxable value is strictly billed packs * purchase rate
    const taxableAmount = round2(billedPacks * line.purchase_rate);

    const combinedGst = (line.gst_percent || 0) + (line.cess_percent || 0);
    const split = splitNetByGstMode(taxableAmount, combinedGst, false); // Purchases are GST-exclusive

    const cgst = round2(split.tax / 2);
    const sgst = round2(split.tax - cgst);

    // Total stock units received = (billed + free) * unitsPerPack
    const totalStockUnits = (billedPacks + freePacks) * unitsPerPack;
    const effectiveUnitCost = totalStockUnits > 0 ? round2(taxableAmount / totalStockUnits) : 0;

    return {
      taxable_amount: split.taxable,
      cgst_amount: cgst,
      sgst_amount: sgst,
      total_tax: split.tax,
      total_amount: split.total,
      total_stock_units: totalStockUnits,
      effective_unit_cost: effectiveUnitCost,
    };
  }

  async recordInwardPurchaseBill(doc: PurchaseDocumentInput): Promise<{ success: boolean; purchaseId: string }> {
    if (doc.lines.length === 0) {
      throw new Error("Cannot save purchase bill with no items");
    }

    const purchaseId = `pb_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const now = Date.now();

    let subtotal = 0;
    let taxTotal = 0;
    let grandTotal = 0;

    for (const line of doc.lines) {
      const calc = this.calculateLineTotals(line);
      subtotal += calc.taxable_amount;
      taxTotal += calc.total_tax;
      grandTotal += calc.total_amount;

      // 1. Upsert or update batch stock
      const batchId = `batch_${line.product_id}_${line.batch_no.replace(/\s+/g, "_")}`;
      const existingBatch = (await sqliteStorage.findById<ProductBatch>("product_batches", batchId)) || null;

      const updatedStock = (existingBatch?.stock_qty || 0) + calc.total_stock_units;

      await productsStore.upsertBatch({
        id: batchId,
        product_id: line.product_id,
        batch_no: line.batch_no,
        mfg_date: line.mfg_date,
        expiry_date: line.expiry_date,
        stock_qty: updatedStock,
        mrp: line.mrp,
        purchase_rate: line.purchase_rate,
      });

      const prod = await productsStore.getProductById(line.product_id);
      if (prod) {
        prod.current_stock = (prod.current_stock || 0) + calc.total_stock_units;
        await productsStore.upsertProduct(prod);
      }

      // 2. Post double-entry stock transaction
      const stockTxId = `stk_tx_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
        id: stockTxId,
        product_id: line.product_id,
        batch_id: batchId,
        event_type: "PURCHASE_RECEIPT",
        qty_delta: calc.total_stock_units,
        unit_cost: calc.effective_unit_cost,
        reference_type: "PURCHASE_BILL",
        reference_id: purchaseId,
        created_at: now,
      });
    }

    const purchaseRow = {
      id: purchaseId,
      purchase_number: doc.purchase_number,
      supplier_id: doc.supplier_id,
      supplier_name: doc.supplier_name,
      supplier_invoice_no: doc.supplier_invoice_no,
      purchase_date: doc.purchase_date,
      subtotal: round2(subtotal),
      tax_total: round2(taxTotal),
      grand_total: round2(grandTotal),
      status: "issued",
      notes: doc.notes || "",
      created_at: now,
    };

    // 3. Save purchase document
    await sqliteStorage.insertRecord("purchase_documents", purchaseId, purchaseRow);

    // 4. Enqueue for cloud sync
    await syncQueueService.enqueue("product", purchaseId, "create", purchaseRow);

    return { success: true, purchaseId };
  }

  async recordPurchaseReturn(
    returnNo: string,
    supplierId: string,
    productId: string,
    batchId: string,
    returnQty: number,
    unitPrice: number
  ): Promise<{ success: boolean; returnId: string }> {
    const returnId = `pr_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const now = Date.now();

    // 1. Decrement batch stock
    const batch = await sqliteStorage.findById<ProductBatch>("product_batches", batchId);
    if (!batch) throw new Error("Batch not found");

    const newStock = Math.max(0, batch.stock_qty - returnQty);
    batch.stock_qty = newStock;
    await productsStore.upsertBatch(batch);

    // 2. Post stock transaction
    const stockTxId = `stk_tx_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
      id: stockTxId,
      product_id: productId,
      batch_id: batchId,
      event_type: "PURCHASE_RETURN",
      qty_delta: -returnQty,
      unit_cost: unitPrice,
      reference_type: "PURCHASE_RETURN",
      reference_id: returnId,
      created_at: now,
    });

    return { success: true, returnId };
  }
}

export const purchaseService = new PurchaseService();

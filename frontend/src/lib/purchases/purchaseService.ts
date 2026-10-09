import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";
import { supplierLedgerService } from "./supplierLedgerService";
import { purchaseOrderService } from "./purchaseOrderService";
import { companySettingsService } from "../settings/companySettingsService";
import { round2 } from "../billing/billingCalculations";
import { getIndianFinancialYear } from "../billing/salesReturnService";
import { syncQueueService } from "../sync/syncQueueService";

export interface PurchaseLineItemInput {
  product_id: string;
  product_name: string;
  hsn_code?: string;
  batch_no: string;
  mfg_date?: string;
  expiry_date: string;
  pack_qty: number; // billed packs
  loose_qty?: number; // billed loose units
  free_qty?: number; // bonus packs or units
  units_per_pack?: number;
  qty?: number; // legacy alias for pack_qty
  purchase_rate: number; // rate per pack (ex-tax)
  discount_percent?: number; // trade discount %
  discount_amount?: number; // scheme / cash discount amount
  mrp?: number;
  selling_rate?: number;
  gst_percent: number;
  cess_percent?: number;
  shelf_location?: string;
}

export interface PurchaseLineCalculation {
  billed_units: number;
  free_units: number;
  total_stock_units: number;
  gross_amount: number;
  discount_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_tax: number;
  total_amount: number;
  effective_unit_cost: number;
  margin_percent: number;
}

export interface PurchaseDocumentInput {
  purchase_number?: string;
  module_key?: "purchase" | "po" | "pr";
  supplier_id: string;
  supplier_name: string;
  supplier_gstin?: string;
  supplier_invoice_no: string;
  purchase_date: string;
  due_date?: string;
  place_of_supply?: string;
  is_interstate?: boolean;
  is_rcm?: boolean;
  itc_eligibility?: "eligible" | "ineligible" | "blocked";
  lines: PurchaseLineItemInput[];
  round_off?: number;
  notes?: string;
  po_id?: string;
}

export interface PurchaseDocumentRecord {
  id: string;
  purchase_number: string;
  module_key: string;
  supplier_id: string;
  supplier_name: string;
  supplier_gstin?: string;
  supplier_invoice_no: string;
  purchase_date: string;
  due_date?: string;
  place_of_supply?: string;
  is_interstate: number;
  is_rcm: number;
  itc_eligibility: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off: number;
  grand_total: number;
  paid_amount: number;
  payment_status: "unpaid" | "partial" | "paid";
  status: "received" | "draft" | "cancelled";
  cancel_reason?: string;
  notes?: string;
  sync_state: string;
  external_id: string;
  created_at: number;
  updated_at: number;
}

export interface PurchaseItemRecord {
  id: string;
  purchase_id: string;
  product_id: string;
  product_name: string;
  hsn_code?: string;
  batch_id: string;
  batch_no: string;
  mfg_date?: string;
  expiry_date: string;
  pack_qty: number;
  loose_qty: number;
  free_qty: number;
  units_per_pack: number;
  total_units: number;
  purchase_rate: number;
  discount_percent: number;
  discount_amount: number;
  effective_unit_cost: number;
  mrp?: number;
  selling_rate?: number;
  gst_percent: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  tax_amount: number;
  total_amount: number;
}

export class PurchaseService {
  /**
   * Generates sequential purchase bill number with FY reset (e.g. PB-26-27-0001)
   */
  async generateNextPurchaseNumber(): Promise<string> {
    const settings = await companySettingsService.loadSettings();
    let prefix = settings.sequences?.purchasePrefix || "PB";
    prefix = prefix.replace(/-+$/, "");
    const fy = getIndianFinancialYear();

    const allPurchases = await sqliteStorage.findAll<any>("purchase_documents");
    const searchPrefix = `${prefix}-${fy}-`;
    const matching = allPurchases.filter((p) => p.purchase_number?.startsWith(searchPrefix));

    let maxNum = 0;
    for (const p of matching) {
      const parts = p.purchase_number.split("-");
      const last = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(last) && last > maxNum) maxNum = last;
    }

    const nextSeq = String(maxNum + 1).padStart(4, "0");
    return `${prefix}-${fy}-${nextSeq}`;
  }

  /**
   * Check if a supplier invoice has already been entered for this supplier
   */
  async checkDuplicateInvoice(
    supplierId: string,
    supplierInvoiceNo: string,
    excludePurchaseId?: string
  ): Promise<PurchaseDocumentRecord | null> {
    if (!supplierId || !supplierInvoiceNo) return null;
    const cleanNo = supplierInvoiceNo.trim().toLowerCase();

    const allDocs = await sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents");
    const found = allDocs.find(
      (d) =>
        d.id !== excludePurchaseId &&
        d.supplier_id === supplierId &&
        d.status !== "cancelled" &&
        d.supplier_invoice_no?.trim().toLowerCase() === cleanNo
    );

    return found || null;
  }

  /**
   * Calculates all mathematical components for a single line item
   */
  calculateLineTotals(line: PurchaseLineItemInput, isInterstate = false): PurchaseLineCalculation {
    const packs = Math.max(0, line.pack_qty ?? line.qty ?? 0);
    const loose = Math.max(0, line.loose_qty || 0);
    const free = Math.max(0, line.free_qty || 0);
    const unitsPerPack = Math.max(1, line.units_per_pack || 1);

    const billedUnits = packs * unitsPerPack + loose;
    const freeUnits = free * unitsPerPack;
    const totalStockUnits = billedUnits + freeUnits;

    // Gross amount = (packs * rate) + (loose fraction * rate)
    const ratePerUnit = line.purchase_rate / unitsPerPack;
    const grossAmount = round2(billedUnits * ratePerUnit);

    // Apply trade discount % and flat discount amount
    const percentDisc = line.discount_percent ? round2((grossAmount * line.discount_percent) / 100) : 0;
    const flatDisc = Math.max(0, line.discount_amount || 0);
    const totalDiscount = round2(Math.min(grossAmount, percentDisc + flatDisc));

    const taxableAmount = round2(Math.max(0, grossAmount - totalDiscount));

    const combinedGst = (line.gst_percent || 0) + (line.cess_percent || 0);
    const totalTax = round2((taxableAmount * combinedGst) / 100);

    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    if (isInterstate) {
      igst = totalTax;
    } else {
      cgst = round2(totalTax / 2);
      sgst = round2(totalTax - cgst);
    }

    const totalAmount = round2(taxableAmount + totalTax);

    // Effective landing cost per sellable stock unit (ex-tax)
    const effectiveUnitCost = totalStockUnits > 0 ? round2(taxableAmount / totalStockUnits) : 0;

    // Calculate margin percentage against selling price
    // Selling price per unit
    const sellRate = line.selling_rate || (line.mrp ? line.mrp / unitsPerPack : 0);
    let marginPercent = 0;
    if (sellRate > 0) {
      // margin = ((Selling Rate - Landing Cost) / Selling Rate) * 100
      marginPercent = round2(((sellRate - effectiveUnitCost) / sellRate) * 100);
    }

    return {
      billed_units: billedUnits,
      free_units: freeUnits,
      total_stock_units: totalStockUnits,
      gross_amount: grossAmount,
      discount_amount: totalDiscount,
      taxable_amount: taxableAmount,
      cgst_amount: cgst,
      sgst_amount: sgst,
      igst_amount: igst,
      total_tax: totalTax,
      total_amount: totalAmount,
      effective_unit_cost: effectiveUnitCost,
      margin_percent: marginPercent,
    };
  }

  /**
   * Atomic record of inward purchase bill
   */
  async recordInwardPurchaseBill(doc: PurchaseDocumentInput): Promise<{
    success: boolean;
    purchaseId: string;
    purchaseNumber: string;
  }> {
    if (!doc.supplier_name?.trim() || !doc.supplier_invoice_no?.trim()) {
      throw new Error("Supplier name and supplier invoice number are required");
    }
    if (doc.lines.length === 0) {
      throw new Error("Cannot save purchase bill with no items");
    }

    const purchaseId = `pb_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const now = Date.now();
    const purchaseNumber = doc.purchase_number || (await this.generateNextPurchaseNumber());

    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;
    let totalLinesAmount = 0;

    const isInterstate = Boolean(doc.is_interstate);
    const itemRecords: PurchaseItemRecord[] = [];
    const receivedMap: Record<string, number> = {};

    for (const line of doc.lines) {
      const calc = this.calculateLineTotals(line, isInterstate);
      subtotal += calc.gross_amount;
      discountTotal += calc.discount_amount;
      taxTotal += calc.total_tax;
      cgstTotal += calc.cgst_amount;
      sgstTotal += calc.sgst_amount;
      igstTotal += calc.igst_amount;
      totalLinesAmount += calc.total_amount;

      // Track received quantity per product for PO fulfillment
      receivedMap[line.product_id] = (receivedMap[line.product_id] || 0) + (line.pack_qty || line.qty || 0);

      // 1. Upsert or update batch stock
      const batchId = `batch_${line.product_id}_${line.batch_no.replace(/\s+/g, "_")}`;
      const existingBatch = await sqliteStorage.findById<ProductBatch>("product_batches", batchId);

      const updatedStock = (existingBatch?.stock_qty || 0) + calc.total_stock_units;
      const unitsPerPack = Math.max(1, line.units_per_pack || 1);

      await productsStore.upsertBatch({
        id: batchId,
        product_id: line.product_id,
        batch_no: line.batch_no,
        mfg_date: line.mfg_date,
        expiry_date: line.expiry_date,
        stock_qty: updatedStock,
        mrp: line.mrp,
        purchase_rate: line.purchase_rate,
        selling_rate: line.selling_rate || (line.mrp ? round2(line.mrp / unitsPerPack) : undefined),
        rack_location: line.shelf_location,
      });

      // 2. Update master product current_stock and last purchase rates
      let prod = await productsStore.getProductById(line.product_id);
      if (prod) {
        prod.current_stock = (prod.current_stock || 0) + calc.total_stock_units;
        prod.ptr = line.purchase_rate;
        if (line.mrp) prod.mrp = line.mrp;
        if (line.selling_rate) prod.sel_rate = line.selling_rate;
        await productsStore.upsertProduct(prod);
      } else {
        prod = {
          id: line.product_id,
          name: line.product_name,
          barcode: line.product_id,
          hsn_sac_code: line.hsn_code,
          mrp: line.mrp || 0,
          sel_rate: line.selling_rate || (line.mrp ? round2(line.mrp / unitsPerPack) : line.purchase_rate),
          ptr: line.purchase_rate,
          gst_percent: line.gst_percent,
          units_per_pack: unitsPerPack,
          current_stock: calc.total_stock_units,
          is_active: true,
        };
        await productsStore.upsertProduct(prod);
      }

      // 3. Post double-entry stock transaction
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
        notes: `Inward: Inv #${doc.supplier_invoice_no} (${line.batch_no})`,
        created_at: now,
      });

      // 4. Save purchase item row
      const itemId = `pbi_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
      const itemRow: PurchaseItemRecord = {
        id: itemId,
        purchase_id: purchaseId,
        product_id: line.product_id,
        product_name: line.product_name,
        hsn_code: line.hsn_code,
        batch_id: batchId,
        batch_no: line.batch_no,
        mfg_date: line.mfg_date,
        expiry_date: line.expiry_date,
        pack_qty: line.pack_qty ?? line.qty ?? 1,
        loose_qty: line.loose_qty || 0,
        free_qty: line.free_qty || 0,
        units_per_pack: unitsPerPack,
        total_units: calc.total_stock_units,
        purchase_rate: line.purchase_rate,
        discount_percent: line.discount_percent || 0,
        discount_amount: calc.discount_amount,
        effective_unit_cost: calc.effective_unit_cost,
        mrp: line.mrp,
        selling_rate: line.selling_rate,
        gst_percent: line.gst_percent,
        cgst_amount: calc.cgst_amount,
        sgst_amount: calc.sgst_amount,
        igst_amount: calc.igst_amount,
        tax_amount: calc.total_tax,
        total_amount: calc.total_amount,
      };

      await sqliteStorage.insertRecord("purchase_items", itemId, itemRow as unknown as Record<string, unknown>);
      itemRecords.push(itemRow);
    }

    const roundOff = doc.round_off !== undefined ? doc.round_off : round2(Math.round(totalLinesAmount) - totalLinesAmount);
    const grandTotal = round2(totalLinesAmount + roundOff);

    const purchaseRow: PurchaseDocumentRecord = {
      id: purchaseId,
      purchase_number: purchaseNumber,
      module_key: doc.module_key || "purchase",
      supplier_id: doc.supplier_id,
      supplier_name: doc.supplier_name,
      supplier_gstin: doc.supplier_gstin,
      supplier_invoice_no: doc.supplier_invoice_no,
      purchase_date: doc.purchase_date,
      due_date: doc.due_date,
      place_of_supply: doc.place_of_supply || "Kerala",
      is_interstate: isInterstate ? 1 : 0,
      is_rcm: doc.is_rcm ? 1 : 0,
      itc_eligibility: doc.itc_eligibility || "eligible",
      subtotal: round2(subtotal),
      discount_total: round2(discountTotal),
      tax_total: round2(taxTotal),
      cgst_total: round2(cgstTotal),
      sgst_total: round2(sgstTotal),
      igst_total: round2(igstTotal),
      round_off: round2(roundOff),
      grand_total: round2(grandTotal),
      paid_amount: 0,
      payment_status: "unpaid",
      status: "received",
      notes: doc.notes || "",
      sync_state: "pending",
      external_id: purchaseId,
      created_at: now,
      updated_at: now,
    };

    // 5. Save purchase document header
    await sqliteStorage.insertRecord("purchase_documents", purchaseId, purchaseRow as unknown as Record<string, unknown>);

    // 6. Post double-entry credit to Supplier Ledger
    await supplierLedgerService.recordPurchaseCredit({
      supplier_id: doc.supplier_id,
      supplier_name: doc.supplier_name,
      purchase_id: purchaseId,
      purchase_number: purchaseNumber,
      purchase_date: doc.purchase_date,
      amount: grandTotal,
      notes: `Inward Invoice: ${doc.supplier_invoice_no}`,
    });

    // 7. Update PO fulfillment if linked
    if (doc.po_id) {
      await purchaseOrderService.updateReceivedQty(doc.po_id, receivedMap);
    }

    // 8. Enqueue for cloud sync
    await syncQueueService.enqueue("purchase", purchaseId, "create", {
      ...purchaseRow,
      items: itemRecords,
    });

    return { success: true, purchaseId, purchaseNumber };
  }

  /**
   * Cancel / Void a purchase bill with safety checks
   */
  async cancelPurchaseBill(purchaseId: string, reason: string): Promise<{ success: boolean }> {
    const doc = await sqliteStorage.findById<PurchaseDocumentRecord>("purchase_documents", purchaseId);
    if (!doc) throw new Error("Purchase bill not found");
    if (doc.status === "cancelled") throw new Error("Purchase bill is already cancelled");

    const allItems = await sqliteStorage.findAll<PurchaseItemRecord>("purchase_items");
    const billItems = allItems.filter((i) => i.purchase_id === purchaseId);
    const now = Date.now();

    // 1. Verify that all batches have enough available stock to revert
    for (const item of billItems) {
      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", item.batch_id);
      if (!batch || batch.stock_qty < item.total_units) {
        throw new Error(
          `Cannot cancel purchase: Stock for ${item.product_name} (Batch: ${item.batch_no}) has already been sold or consumed.`
        );
      }
    }

    // 2. Revert batch stocks and log stock adjustment transaction
    for (const item of billItems) {
      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", item.batch_id);
      if (batch) {
        batch.stock_qty = Math.max(0, batch.stock_qty - item.total_units);
        await productsStore.upsertBatch(batch);
      }

      const prod = await productsStore.getProductById(item.product_id);
      if (prod) {
        prod.current_stock = Math.max(0, (prod.current_stock || 0) - item.total_units);
        await productsStore.upsertProduct(prod);
      }

      const stockTxId = `stk_tx_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
        id: stockTxId,
        product_id: item.product_id,
        batch_id: item.batch_id,
        event_type: "PURCHASE_CANCEL",
        qty_delta: -item.total_units,
        unit_cost: item.effective_unit_cost,
        reference_type: "PURCHASE_CANCEL",
        reference_id: purchaseId,
        notes: `Cancelled: ${reason}`,
        created_at: now,
      });
    }

    // 3. Reverse Supplier Ledger credit
    await supplierLedgerService.recordReturnDebit({
      supplier_id: doc.supplier_id,
      return_id: purchaseId,
      return_number: `CANC-${doc.purchase_number}`,
      return_date: new Date().toISOString().slice(0, 10),
      amount: doc.grand_total,
      notes: `Purchase cancellation: ${reason}`,
    });

    // 4. Update status to cancelled
    doc.status = "cancelled";
    doc.cancel_reason = reason;
    doc.updated_at = now;
    await sqliteStorage.insertRecord("purchase_documents", purchaseId, doc as unknown as Record<string, unknown>);

    // 5. Enqueue sync
    await syncQueueService.enqueue("purchase", purchaseId, "update", doc);

    return { success: true };
  }

  /**
   * Fetch purchase bill by ID with its line items
   */
  async getPurchaseBillById(
    purchaseId: string
  ): Promise<{ document: PurchaseDocumentRecord; items: PurchaseItemRecord[] } | null> {
    const doc = await sqliteStorage.findById<PurchaseDocumentRecord>("purchase_documents", purchaseId);
    if (!doc) return null;

    const allItems = await sqliteStorage.findAll<PurchaseItemRecord>("purchase_items");
    const items = allItems.filter((i) => i.purchase_id === purchaseId);

    return { document: doc, items };
  }
}

export const purchaseService = new PurchaseService();

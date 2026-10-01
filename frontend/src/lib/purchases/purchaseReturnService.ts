import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch } from "../masters/productsStore";
import { partiesStore, type Supplier } from "../masters/partiesStore";
import { syncQueueService } from "../sync/syncQueueService";
import { companySettingsService } from "../settings/companySettingsService";
import { round2 } from "../billing/billingCalculations";
import { getIndianFinancialYear } from "../billing/salesReturnService";

export type PurchaseReturnReason = "expired" | "damaged" | "near_expiry" | "wrong_supply" | "excess" | "other";
export type PurchaseReturnSettlement = "credit_adjust" | "refund";

export interface PurchaseReturnLineInput {
  product_id: string;
  product_name: string;
  hsn_code?: string;
  batch_id: string;
  batch_no: string;
  expiry_date?: string;
  purchased_qty: number;
  return_qty: number;
  purchase_rate: number;
  gst_percent: number;
  reason: PurchaseReturnReason;
}

export interface PurchaseReturnItem extends PurchaseReturnLineInput {
  id: string;
  return_id: string;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  total_amount: number;
}

export interface PurchaseReturnInput {
  original_purchase_id?: string;
  original_purchase_number?: string;
  supplier_id: string;
  supplier_name: string;
  supplier_gstin?: string;
  supplier_invoice_no?: string;
  lines: PurchaseReturnLineInput[];
  settlement_type: PurchaseReturnSettlement;
  refund_mode?: "Cash" | "Bank Transfer" | "UPI";
  notes?: string;
}

export interface PurchaseReturnRecord {
  id: string;
  return_number: string;
  return_date: string;
  return_time: string;
  original_purchase_id?: string;
  original_purchase_number?: string;
  supplier_id: string;
  supplier_name: string;
  supplier_gstin?: string;
  supplier_invoice_no?: string;
  lines: PurchaseReturnItem[];
  subtotal: number;
  tax_total: number;
  cgst_total: number;
  sgst_total: number;
  round_off: number;
  grand_total: number;
  settlement_type: PurchaseReturnSettlement;
  refund_mode?: string;
  status: "completed" | "draft" | "cancelled";
  cancellation_reason?: string;
  cancelled_at?: number;
  notes?: string;
  created_at: number;
  updated_at: number;
}

export interface PurchaseReturnFilter {
  searchQuery?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  supplierId?: string;
}

export class PurchaseReturnService {
  /**
   * Generates sequential return number with financial year reset (e.g. PR-26-27-0001)
   */
  async generateNextReturnNumber(): Promise<string> {
    const settings = await companySettingsService.loadSettings();
    let prefix = settings.sequences?.purchaseReturnPrefix || "PR";
    prefix = prefix.replace(/-+$/, "");
    const fy = getIndianFinancialYear();

    const allReturns = await sqliteStorage.findAll<PurchaseReturnRecord>("purchase_returns");
    const searchPrefix = `${prefix}-${fy}-`;
    const matching = allReturns.filter((r) => r.return_number.startsWith(searchPrefix));

    let maxNum = settings.sequences?.nextPurchaseReturnNumber ? settings.sequences.nextPurchaseReturnNumber - 1 : 0;
    for (const ret of matching) {
      const parts = ret.return_number.split("-");
      const lastPart = parts[parts.length - 1];
      const parsed = parseInt(lastPart, 10);
      if (!isNaN(parsed) && parsed > maxNum) {
        maxNum = parsed;
      }
    }

    const nextSeq = maxNum + 1;
    return `${prefix}-${fy}-${String(nextSeq).padStart(4, "0")}`;
  }

  /**
   * Retrieves previous returns against an inward purchase bill
   */
  async getReturnsForPurchase(purchaseNumber: string): Promise<PurchaseReturnRecord[]> {
    if (!purchaseNumber) return [];
    const all = await sqliteStorage.findAll<PurchaseReturnRecord>("purchase_returns");
    return all.filter((r) => r.original_purchase_number === purchaseNumber && r.status !== "cancelled");
  }

  /**
   * Calculates already returned quantities per product & batch for a given purchase bill
   */
  async getReturnedQtyMapForPurchase(purchaseNumber: string): Promise<Map<string, number>> {
    const returns = await this.getReturnsForPurchase(purchaseNumber);
    const map = new Map<string, number>();

    for (const ret of returns) {
      for (const item of ret.lines) {
        const key = `${item.product_id}_${item.batch_no}`;
        map.set(key, (map.get(key) || 0) + item.return_qty);
      }
    }
    return map;
  }

  /**
   * Process and save a Purchase Return (Debit Note)
   */
  async createPurchaseReturn(input: PurchaseReturnInput): Promise<{
    success: boolean;
    returnId: string;
    returnNumber: string;
    grandTotal: number;
  }> {
    if (!input.lines || input.lines.length === 0) {
      throw new Error("Cannot create purchase return without any items");
    }

    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    const timeStr = new Date().toTimeString().slice(0, 8);
    const returnId = `pr_${now}_${Math.random().toString(16).slice(2, 6)}`;
    const returnNumber = await this.generateNextReturnNumber();

    // 1. Validation against original purchase bill and in-store batch stock
    const returnedQtyMap = input.original_purchase_number
      ? await this.getReturnedQtyMapForPurchase(input.original_purchase_number)
      : new Map<string, number>();

    for (const line of input.lines) {
      if (line.return_qty <= 0) {
        throw new Error(`Return quantity for ${line.product_name} must be greater than 0`);
      }

      // Check against purchase bill limits
      if (input.original_purchase_number && line.purchased_qty > 0) {
        const key = `${line.product_id}_${line.batch_no}`;
        const alreadyReturned = returnedQtyMap.get(key) || 0;
        const availableOnBill = line.purchased_qty - alreadyReturned;

        if (line.return_qty > availableOnBill) {
          throw new Error(
            `Cannot return ${line.return_qty} of ${line.product_name} (Batch ${line.batch_no}). Maximum bill allowance is ${availableOnBill} (Purchased: ${line.purchased_qty}, Already Returned: ${alreadyReturned})`
          );
        }
      }

      // Check against CURRENT PHYSICAL BATCH STOCK (hard block if stock already sold to customers!)
      let batch = await sqliteStorage.findById<ProductBatch>("product_batches", line.batch_id);
      if (!batch) {
        const batches = await productsStore.getBatchesForProduct(line.product_id, false);
        batch = batches.find((b) => b.batch_no === line.batch_no) || null;
      }

      const currentStock = batch?.stock_qty || 0;
      if (line.return_qty > currentStock) {
        throw new Error(
          `Cannot return ${line.return_qty} units of ${line.product_name} (Batch ${line.batch_no}). Available physical stock in store is only ${currentStock}. Stock that was already sold cannot be returned to supplier.`
        );
      }
    }

    // 2. Compute financial breakdown line by line
    let subtotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;

    const returnLines: PurchaseReturnItem[] = [];

    for (const line of input.lines) {
      const taxable = round2(line.return_qty * line.purchase_rate);
      const gst = line.gst_percent || 0;
      const totalTax = round2((taxable * gst) / 100);
      const cgst = round2(totalTax / 2);
      const sgst = round2(totalTax - cgst);
      const lineTotal = round2(taxable + totalTax);

      subtotal = round2(subtotal + taxable);
      cgstTotal = round2(cgstTotal + cgst);
      sgstTotal = round2(sgstTotal + sgst);

      const itemId = `pri_${now}_${Math.random().toString(16).slice(2, 6)}`;

      returnLines.push({
        ...line,
        id: itemId,
        return_id: returnId,
        taxable_amount: taxable,
        cgst_amount: cgst,
        sgst_amount: sgst,
        total_amount: lineTotal,
      });

      // 3. Decrement Inventory Batch Stock
      let batch = await sqliteStorage.findById<ProductBatch>("product_batches", line.batch_id);
      if (!batch) {
        const batches = await productsStore.getBatchesForProduct(line.product_id, false);
        batch = batches.find((b) => b.batch_no === line.batch_no) || null;
      }

      if (batch) {
        batch.stock_qty = Math.max(0, batch.stock_qty - line.return_qty);
        await productsStore.upsertBatch(batch);
      }

      // 4. Post Double-entry Stock Transaction
      const stockTxId = `stk_pr_${now}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
        id: stockTxId,
        product_id: line.product_id,
        batch_id: line.batch_id,
        event_type: "PURCHASE_RETURN",
        qty_delta: -line.return_qty,
        unit_cost: line.purchase_rate,
        reference_type: "PURCHASE_RETURN",
        reference_id: returnNumber,
        created_at: now,
      });
    }

    const taxTotal = round2(cgstTotal + sgstTotal);
    const rawTotal = subtotal + taxTotal;
    const roundedGrandTotal = Math.round(rawTotal);
    const roundOff = round2(roundedGrandTotal - rawTotal);
    const grandTotal = roundedGrandTotal;

    // 5. Build and save Purchase Return Record
    const returnRecord: PurchaseReturnRecord = {
      id: returnId,
      return_number: returnNumber,
      return_date: today,
      return_time: timeStr,
      original_purchase_id: input.original_purchase_id,
      original_purchase_number: input.original_purchase_number,
      supplier_id: input.supplier_id,
      supplier_name: input.supplier_name,
      supplier_gstin: input.supplier_gstin,
      supplier_invoice_no: input.supplier_invoice_no,
      lines: returnLines,
      subtotal,
      tax_total: taxTotal,
      cgst_total: cgstTotal,
      sgst_total: sgstTotal,
      round_off: roundOff,
      grand_total: grandTotal,
      settlement_type: input.settlement_type,
      refund_mode: input.refund_mode,
      status: "completed",
      notes: input.notes,
      created_at: now,
      updated_at: now,
    };

    await sqliteStorage.insertRecord("purchase_returns", returnId, returnRecord);

    // 6. Enqueue for sync
    await syncQueueService.enqueue("product", returnId, "create", returnRecord as unknown as Record<string, unknown>);

    return {
      success: true,
      returnId,
      returnNumber,
      grandTotal,
    };
  }

  /**
   * Cancel an existing purchase return: restores inventory and supplier balance
   */
  async cancelPurchaseReturn(returnId: string, reason: string): Promise<{ success: boolean }> {
    if (!reason || !reason.trim()) {
      throw new Error("A cancellation reason is required to cancel a purchase return");
    }

    const ret = await sqliteStorage.findById<PurchaseReturnRecord>("purchase_returns", returnId);
    if (!ret) throw new Error("Purchase return not found");
    if (ret.status === "cancelled") throw new Error("Purchase return is already cancelled");

    const now = Date.now();

    // 1. Restore batch stock
    for (const line of ret.lines) {
      let batch = await sqliteStorage.findById<ProductBatch>("product_batches", line.batch_id);
      if (!batch) {
        const batches = await productsStore.getBatchesForProduct(line.product_id, false);
        batch = batches.find((b) => b.batch_no === line.batch_no) || null;
      }

      if (batch) {
        batch.stock_qty += line.return_qty;
        await productsStore.upsertBatch(batch);
      }

      // Post stock reversal transaction
      const stockTxId = `stk_prev_${now}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
        id: stockTxId,
        product_id: line.product_id,
        batch_id: line.batch_id,
        event_type: "PURCHASE_RETURN_CANCELLED",
        qty_delta: line.return_qty,
        unit_cost: line.purchase_rate,
        reference_type: "PURCHASE_RETURN",
        reference_id: ret.return_number,
        created_at: now,
      });
    }

    // 2. Mark return as cancelled
    ret.status = "cancelled";
    ret.cancellation_reason = reason.trim();
    ret.cancelled_at = now;
    ret.updated_at = now;
    await sqliteStorage.insertRecord("purchase_returns", ret.id, ret);

    return { success: true };
  }

  /**
   * Search and filter purchase returns
   */
  async getPurchaseReturns(filter?: PurchaseReturnFilter): Promise<PurchaseReturnRecord[]> {
    const all = await sqliteStorage.findAll<PurchaseReturnRecord>("purchase_returns");
    let results = all.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    if (!filter) return results;

    if (filter.startDate) {
      results = results.filter((r) => r.return_date >= filter.startDate!);
    }
    if (filter.endDate) {
      results = results.filter((r) => r.return_date <= filter.endDate!);
    }
    if (filter.status && filter.status !== "all") {
      results = results.filter((r) => r.status === filter.status);
    }
    if (filter.supplierId && filter.supplierId !== "all") {
      results = results.filter((r) => r.supplier_id === filter.supplierId);
    }
    if (filter.searchQuery && filter.searchQuery.trim()) {
      const q = filter.searchQuery.trim().toLowerCase();
      results = results.filter((r) => {
        const numMatch = r.return_number.toLowerCase().includes(q);
        const origMatch = r.original_purchase_number?.toLowerCase().includes(q);
        const suppMatch = r.supplier_name.toLowerCase().includes(q);
        const invMatch = r.supplier_invoice_no?.toLowerCase().includes(q);
        const itemMatch = r.lines?.some((l) => l.product_name.toLowerCase().includes(q));
        return numMatch || origMatch || suppMatch || invMatch || itemMatch;
      });
    }

    return results;
  }

  async getPurchaseReturnById(id: string): Promise<PurchaseReturnRecord | null> {
    return await sqliteStorage.findById<PurchaseReturnRecord>("purchase_returns", id);
  }
}

export const purchaseReturnService = new PurchaseReturnService();

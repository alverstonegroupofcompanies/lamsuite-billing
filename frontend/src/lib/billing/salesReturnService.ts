import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch } from "../masters/productsStore";
import { partiesStore, type Customer } from "../masters/partiesStore";
import { syncQueueService } from "../sync/syncQueueService";
import { companySettingsService } from "../settings/companySettingsService";
import { round2 } from "./billingCalculations";
import { calculateDocumentTaxes } from "../tax-engine/taxEngine";
import type { InvoiceRecord, InvoiceItemRecord } from "../reports/reportEngine";

export type ReturnReason = "damaged" | "expired" | "wrong_item" | "customer_return" | "other";
export type ReturnCondition = "restock" | "damaged_discard" | "quarantine";
export type RefundPaymentMode = "Cash" | "UPI" | "Card" | "Credit Adjust" | "Store Credit";

export interface SalesReturnLineInput {
  product_id: string;
  product_name: string;
  hsn_code?: string;
  batch_id: string;
  batch_no: string;
  expiry_date?: string;
  sold_qty: number;
  return_qty: number;
  unit_price: number;
  discount_percent?: number;
  gst_percent: number;
  reason: ReturnReason;
  condition: ReturnCondition;
}

export interface SalesReturnItem extends SalesReturnLineInput {
  id: string;
  return_id: string;
  discount_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;
}

export interface SalesReturnInput {
  original_invoice_id?: string;
  original_invoice_number?: string;
  original_invoice_date?: string;
  customer_id?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_gstin?: string;
  lines: SalesReturnLineInput[];
  refund_mode: RefundPaymentMode;
  refund_amount?: number;
  notes?: string;
  manager_pin_verified?: boolean;
}

export interface SalesReturnRecord {
  id: string;
  return_number: string;
  return_date: string;
  return_time: string;
  original_invoice_id?: string;
  original_invoice_number?: string;
  original_invoice_date?: string;
  customer_id?: string;
  customer_name: string;
  customer_phone?: string;
  customer_gstin?: string;
  lines: SalesReturnItem[];
  subtotal: number;
  discount_total: number;
  tax_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off: number;
  grand_total: number;
  refund_amount: number;
  refund_mode: RefundPaymentMode;
  refund_status: "paid" | "partial" | "unpaid";
  status: "completed" | "draft" | "cancelled";
  cancellation_reason?: string;
  cancelled_at?: number;
  notes?: string;
  created_at: number;
  updated_at: number;
}

export interface SalesReturnFilter {
  searchQuery?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  refundMode?: string;
}

export function getIndianFinancialYear(date: Date = new Date()): string {
  const month = date.getMonth() + 1; // 1 to 12
  const year = date.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  const s = String(startYear).slice(-2);
  const e = String(endYear).slice(-2);
  return `${s}-${e}`;
}

export class SalesReturnService {
  /**
   * Generates a sequential, configurable return number with financial-year reset (e.g. SR-26-27-0001)
   */
  async generateNextReturnNumber(): Promise<string> {
    const settings = await companySettingsService.loadSettings();
    let prefix = settings.sequences?.returnPrefix || "SR";
    prefix = prefix.replace(/-+$/, "");
    const fy = getIndianFinancialYear();

    const allReturns = await sqliteStorage.findAll<SalesReturnRecord>("sales_returns");
    const searchPrefix = `${prefix}-${fy}-`;
    const matching = allReturns.filter((r) => r.return_number.startsWith(searchPrefix));

    let maxNum = settings.sequences?.nextReturnNumber ? settings.sequences.nextReturnNumber - 1 : 0;
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
   * Retrieves previous returns against an original invoice to compute returned quantities
   */
  async getReturnsForInvoice(invoiceNumber: string): Promise<SalesReturnRecord[]> {
    if (!invoiceNumber) return [];
    const all = await sqliteStorage.findAll<SalesReturnRecord>("sales_returns");
    return all.filter((r) => r.original_invoice_number === invoiceNumber && r.status !== "cancelled");
  }

  /**
   * Calculates already returned quantities per product & batch for a given invoice
   */
  async getReturnedQtyMapForInvoice(invoiceNumber: string): Promise<Map<string, number>> {
    const returns = await this.getReturnsForInvoice(invoiceNumber);
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
   * Process and save a Sales Return (Credit Note)
   */
  async createSalesReturn(input: SalesReturnInput): Promise<{
    success: boolean;
    returnId: string;
    returnNumber: string;
    grandTotal: number;
  }> {
    if (!input.lines || input.lines.length === 0) {
      throw new Error("Cannot create sales return without any items");
    }

    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    const timeStr = new Date().toTimeString().slice(0, 8);
    const returnId = `sr_${now}_${Math.random().toString(16).slice(2, 6)}`;
    const returnNumber = await this.generateNextReturnNumber();

    // Look up original invoice if available
    let originalInv: InvoiceRecord | null = null;
    if (input.original_invoice_id) {
      originalInv = await sqliteStorage.findById<InvoiceRecord>("invoices", input.original_invoice_id);
    }
    if (!originalInv && input.original_invoice_number) {
      const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
      originalInv = allInvoices.find((i) => i.invoice_number === input.original_invoice_number) || null;
    }

    // 1. Validation against original invoice
    if (input.original_invoice_number) {
      const returnedQtyMap = await this.getReturnedQtyMapForInvoice(input.original_invoice_number);

      for (const line of input.lines) {
        if (line.return_qty <= 0) {
          throw new Error(`Return quantity for ${line.product_name} must be greater than 0`);
        }

        const key = `${line.product_id}_${line.batch_no}`;
        const alreadyReturned = returnedQtyMap.get(key) || 0;
        const availableToReturn = line.sold_qty - alreadyReturned;

        if (line.return_qty > availableToReturn) {
          throw new Error(
            `Cannot return ${line.return_qty} of ${line.product_name}. Maximum available to return is ${availableToReturn} (Sold: ${line.sold_qty}, Already Returned: ${alreadyReturned})`
          );
        }
      }
    }

    // 2. Compute financial breakdown line by line via statutory TaxEngine
    const taxLines = input.lines.map((line, idx) => ({
      line_id: `line_${idx}`,
      product_id: line.product_id,
      product_name: line.product_name,
      hsn_code: line.hsn_code || "",
      qty: line.return_qty,
      pack_qty: line.return_qty,
      loose_qty: 0,
      units_per_pack: 1,
      unit_price: line.unit_price,
      discount_percent: line.discount_percent || 0,
      gst_percent: line.gst_percent || 0,
      gst_rate: line.gst_percent || 0,
      cess_percent: (line as any).cess_percent || 0,
      cess_rate: (line as any).cess_percent || 0,
    }));

    const customerGstin = input.customer_gstin || originalInv?.customer_gstin;
    const placeOfSupply = originalInv?.place_of_supply || "32-Kerala";
    const storeState = (originalInv as any)?.store_state_code;
    const isTaxInclusive = (originalInv as any)?.is_tax_inclusive || false;

    const taxResult = calculateDocumentTaxes({
      store_state: storeState || "32",
      lines: taxLines,
      customer_gstin: customerGstin,
      place_of_supply: placeOfSupply,
      default_tax_mode: isTaxInclusive ? "inclusive" : "exclusive",
    });

    const returnLines: SalesReturnItem[] = [];

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i];
      const lineRes = taxResult.lines[i];
      const itemId = `sri_${now}_${i}_${Math.random().toString(16).slice(2, 6)}`;

      returnLines.push({
        ...line,
        id: itemId,
        return_id: returnId,
        discount_amount: lineRes.line_discount,
        taxable_amount: lineRes.taxable_amount,
        cgst_amount: lineRes.cgst_amount,
        sgst_amount: lineRes.sgst_amount,
        igst_amount: lineRes.igst_amount,
        total_amount: lineRes.total_amount,
      });

      // 3. Double-entry Stock updates
      if (line.condition === "restock") {
        // Add back to inventory batch
        let batch = await sqliteStorage.findById<ProductBatch>("product_batches", line.batch_id);
        if (!batch) {
          // If batch not found by id, find by product and batch_no
          const productBatches = await productsStore.getBatchesForProduct(line.product_id, false);
          batch = productBatches.find((b) => b.batch_no === line.batch_no) || null;
        }

        if (batch) {
          batch.stock_qty += line.return_qty;
          await productsStore.upsertBatch(batch);
        }

        // Post stock ledger transaction
        const stockTxId = `stk_sr_${now}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
          id: stockTxId,
          product_id: line.product_id,
          batch_id: line.batch_id,
          event_type: "SALES_RETURN",
          qty_delta: line.return_qty,
          unit_cost: line.unit_price,
          reference_type: "SALES_RETURN",
          reference_id: returnNumber,
          created_at: now,
        });
      } else if (line.condition === "quarantine") {
        // Quarantine Shelf: Log to quarantine bucket for inspection without adding to sellable inventory
        const stockTxId = `stk_quar_${now}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
          id: stockTxId,
          product_id: line.product_id,
          batch_id: line.batch_id,
          event_type: "QUARANTINE_RETURN",
          qty_delta: 0,
          unit_cost: line.unit_price,
          reference_type: "SALES_RETURN",
          reference_id: returnNumber,
          notes: "Quarantine shelf - pending QA inspection",
          created_at: now,
        });
      } else {
        // Damaged / Discard: Log to damaged stock bucket without increasing sellable inventory
        const stockTxId = `stk_dam_${now}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
          id: stockTxId,
          product_id: line.product_id,
          batch_id: line.batch_id,
          event_type: "DAMAGED_RETURN",
          qty_delta: 0,
          unit_cost: line.unit_price,
          reference_type: "SALES_RETURN",
          reference_id: returnNumber,
          created_at: now,
        });
      }
    }

    const subtotal = taxResult.taxable_subtotal;
    const discountTotal = round2(taxResult.line_discount_total + taxResult.bill_discount_total);
    const taxTotal = taxResult.total_tax;
    const cgstTotal = taxResult.cgst_total;
    const sgstTotal = taxResult.sgst_total;
    const igstTotal = taxResult.igst_total;
    const roundOff = taxResult.round_off;
    const grandTotal = taxResult.grand_total;

    const refundAmount = input.refund_amount !== undefined ? input.refund_amount : grandTotal;
    const refundStatus = refundAmount >= grandTotal ? "paid" : refundAmount > 0 ? "partial" : "unpaid";

    // 4. Update Customer Ledger if Credit Adjustment
    if (input.customer_id && (input.refund_mode === "Credit Adjust" || input.refund_mode === "Store Credit")) {
      const customer = await partiesStore.getCustomerById(input.customer_id);
      if (customer) {
        customer.outstanding_balance = round2((customer.outstanding_balance || 0) - refundAmount);
        await partiesStore.upsertCustomer(customer);
      }
    }

    // 5. Build and save Sales Return Record
    const returnRecord: SalesReturnRecord = {
      id: returnId,
      return_number: returnNumber,
      return_date: today,
      return_time: timeStr,
      original_invoice_id: input.original_invoice_id,
      original_invoice_number: input.original_invoice_number,
      original_invoice_date: input.original_invoice_date,
      customer_id: input.customer_id,
      customer_name: input.customer_name || "Customer",
      customer_phone: input.customer_phone,
      customer_gstin: customerGstin,
      lines: returnLines,
      subtotal,
      discount_total: discountTotal,
      tax_total: taxTotal,
      cgst_total: cgstTotal,
      sgst_total: sgstTotal,
      igst_total: igstTotal,
      round_off: roundOff,
      grand_total: grandTotal,
      refund_amount: refundAmount,
      refund_mode: input.refund_mode,
      refund_status: refundStatus,
      status: "completed",
      notes: input.notes,
      created_at: now,
      updated_at: now,
    };

    await sqliteStorage.insertRecord("sales_returns", returnId, returnRecord);

    // 6. Insert mirror record into invoices table (module_key: "credit_note")
    // This allows existing GSTR-1, tax summary, and daily collection reports to process it natively!
    const mirrorInvoice: InvoiceRecord = {
      id: returnId,
      module_key: "credit_note",
      invoice_number: returnNumber,
      invoice_date: today,
      customer_id: input.customer_id,
      customer_name: input.customer_name || "Customer",
      customer_gstin: customerGstin,
      place_of_supply: placeOfSupply,
      subtotal,
      taxable_subtotal: taxResult.taxable_subtotal,
      discount_total: discountTotal,
      tax_total: taxTotal,
      cgst_total: cgstTotal,
      sgst_total: sgstTotal,
      igst_total: igstTotal,
      cess_total: taxResult.cess_total,
      round_off: roundOff,
      grand_total: grandTotal,
      paid_amount: refundAmount,
      payment_mode: input.refund_mode,
      status: "issued",
      original_invoice_number: input.original_invoice_number,
      created_at: now,
    };
    await sqliteStorage.insertRecord("invoices", returnId, mirrorInvoice);

    for (let i = 0; i < returnLines.length; i++) {
      const item = returnLines[i];
      const lineRes = taxResult.lines[i];
      const mirrorItem: InvoiceItemRecord = {
        id: item.id,
        invoice_id: returnId,
        product_id: item.product_id,
        product_name: item.product_name,
        hsn_code: item.hsn_code,
        batch_no: item.batch_no,
        expiry_date: item.expiry_date,
        qty: item.return_qty,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent,
        discount_amount: item.discount_amount,
        gst_percent: item.gst_percent,
        cgst_amount: item.cgst_amount,
        sgst_amount: item.sgst_amount,
        igst_amount: item.igst_amount,
        total_amount: item.total_amount,
      };
      await sqliteStorage.insertRecord("invoice_items", item.id, mirrorItem);
    }

    // 7. Enqueue for offline cloud sync
    await syncQueueService.enqueue("invoice", returnId, "create", returnRecord as unknown as Record<string, unknown>);

    return {
      success: true,
      returnId,
      returnNumber,
      grandTotal,
    };
  }

  /**
   * Cancel an existing sales return: restores stock and party balance
   */
  async cancelSalesReturn(returnId: string, reason: string): Promise<{ success: boolean }> {
    if (!reason || !reason.trim()) {
      throw new Error("A cancellation reason is required to cancel a sales return");
    }

    const ret = await sqliteStorage.findById<SalesReturnRecord>("sales_returns", returnId);
    if (!ret) throw new Error("Sales return not found");
    if (ret.status === "cancelled") throw new Error("Sales return is already cancelled");

    const now = Date.now();

    // 1. Reverse stock changes
    for (const line of ret.lines) {
      if (line.condition === "restock") {
        const batch = await sqliteStorage.findById<ProductBatch>("product_batches", line.batch_id);
        if (batch) {
          batch.stock_qty = Math.max(0, batch.stock_qty - line.return_qty);
          await productsStore.upsertBatch(batch);
        }

        // Post reversal stock transaction
        const stockTxId = `stk_rev_${now}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
          id: stockTxId,
          product_id: line.product_id,
          batch_id: line.batch_id,
          event_type: "RETURN_CANCELLED",
          qty_delta: -line.return_qty,
          unit_cost: line.unit_price,
          reference_type: "SALES_RETURN",
          reference_id: ret.return_number,
          created_at: now,
        });
      }
    }

    // 2. Reverse customer credit if applicable
    if (ret.customer_id && (ret.refund_mode === "Credit Adjust" || ret.refund_mode === "Store Credit")) {
      const customer = await partiesStore.getCustomerById(ret.customer_id);
      if (customer) {
        customer.outstanding_balance = round2((customer.outstanding_balance || 0) + ret.refund_amount);
        await partiesStore.upsertCustomer(customer);
      }
    }

    // 3. Mark return as cancelled
    ret.status = "cancelled";
    ret.cancellation_reason = reason.trim();
    ret.cancelled_at = now;
    ret.updated_at = now;
    await sqliteStorage.insertRecord("sales_returns", ret.id, ret);

    // 4. Update mirror invoice status
    const mirrorInvoice = await sqliteStorage.findById<InvoiceRecord>("invoices", ret.id);
    if (mirrorInvoice) {
      mirrorInvoice.status = "cancelled";
      await sqliteStorage.insertRecord("invoices", mirrorInvoice.id, mirrorInvoice);
    }

    return { success: true };
  }

  /**
   * Search and filter sales returns
   */
  async getSalesReturns(filter?: SalesReturnFilter): Promise<SalesReturnRecord[]> {
    const all = await sqliteStorage.findAll<SalesReturnRecord>("sales_returns");
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
    if (filter.refundMode && filter.refundMode !== "all") {
      results = results.filter((r) => r.refund_mode.toLowerCase() === filter.refundMode!.toLowerCase());
    }
    if (filter.searchQuery && filter.searchQuery.trim()) {
      const q = filter.searchQuery.trim().toLowerCase();
      results = results.filter((r) => {
        const numMatch = r.return_number.toLowerCase().includes(q);
        const origMatch = r.original_invoice_number?.toLowerCase().includes(q);
        const custMatch = r.customer_name.toLowerCase().includes(q);
        const phoneMatch = r.customer_phone?.includes(q);
        const itemMatch = r.lines?.some((l) => l.product_name.toLowerCase().includes(q));
        return numMatch || origMatch || custMatch || phoneMatch || itemMatch;
      });
    }

    return results;
  }

  async getSalesReturnById(id: string): Promise<SalesReturnRecord | null> {
    return await sqliteStorage.findById<SalesReturnRecord>("sales_returns", id);
  }
}

export const salesReturnService = new SalesReturnService();

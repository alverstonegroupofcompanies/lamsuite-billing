import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";
import { syncQueueService } from "../sync/syncQueueService";
import type { PosCartLine } from "./posCartService";
import { calculateInvoiceTotals, type BillingLineInput, type InvoiceTotals } from "./billingCalculations";

export interface InvoiceAuditEntry {
  timestamp: number;
  user: string;
  action: "CREATED" | "EDITED" | "CANCELLED";
  reason?: string;
  diffSummary?: string;
  oldTotal?: number;
  newTotal?: number;
}

export interface InvoiceRecord {
  id: string;
  module_key: string;
  invoice_number: string;
  invoice_date: string; // YYYY-MM-DD
  created_at_time?: string;
  customer_id?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_gstin?: string;
  place_of_supply?: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  round_off: number;
  grand_total: number;
  paid_amount: number;
  payment_mode: string;
  status: "issued" | "cancelled";
  cancel_reason?: string;
  is_revised?: boolean | number;
  edit_history?: string | InvoiceAuditEntry[];
  user_counter?: string;
  sync_state?: string;
  patient_name?: string;
  doctor_name?: string;
  doctor_reg_no?: string;
  notes?: string;
  external_id?: string;
  created_at: number;
  updated_at: number;
}

export interface InvoiceItemRecord {
  id: string;
  invoice_id: string;
  product_id: string;
  product_name: string;
  hsn_code?: string;
  batch_no: string;
  expiry_date: string;
  qty: number;
  loose_qty?: number;
  units_per_pack?: number;
  unit_price: number;
  mrp?: number;
  discount_percent?: number;
  discount_amount?: number;
  gst_percent: number;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  total_amount: number;
}

export interface InvoiceFilterCriteria {
  searchQuery?: string;
  dateRange?: "today" | "yesterday" | "last7days" | "month" | "all" | "custom";
  startDate?: string;
  endDate?: string;
  paymentMode?: string;
  status?: string;
  user?: string;
}

export interface InvoiceDiffResult {
  hasChanges: boolean;
  oldTotal: number;
  newTotal: number;
  totalDiff: number;
  changes: Array<{
    type: "ADDED" | "REMOVED" | "MODIFIED";
    productName: string;
    batchNo: string;
    oldQty?: number;
    newQty?: number;
    oldRate?: number;
    newRate?: number;
    oldAmount?: number;
    newAmount?: number;
  }>;
}

export class InvoiceManagementService {
  /**
   * List invoices with filtering, full search across invoice/customer/product, and offline availability
   */
  async listInvoices(filters?: InvoiceFilterCriteria): Promise<InvoiceRecord[]> {
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    // Map invoice_id -> array of items for product-level searching
    const itemsByInvoice = new Map<string, InvoiceItemRecord[]>();
    for (const item of allItems) {
      if (!itemsByInvoice.has(item.invoice_id)) {
        itemsByInvoice.set(item.invoice_id, []);
      }
      itemsByInvoice.get(item.invoice_id)!.push(item);
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

    const sevenDaysAgoDate = new Date();
    sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgoDate.toISOString().slice(0, 10);

    const monthStartStr = `${todayStr.slice(0, 7)}-01`;

    let startFilter = filters?.startDate;
    let endFilter = filters?.endDate;

    if (filters?.dateRange === "today") {
      startFilter = todayStr;
      endFilter = todayStr;
    } else if (filters?.dateRange === "yesterday") {
      startFilter = yesterdayStr;
      endFilter = yesterdayStr;
    } else if (filters?.dateRange === "last7days") {
      startFilter = sevenDaysAgoStr;
      endFilter = todayStr;
    } else if (filters?.dateRange === "month") {
      startFilter = monthStartStr;
      endFilter = todayStr;
    } else if (filters?.dateRange === "all") {
      startFilter = undefined;
      endFilter = undefined;
    } else if (!filters?.dateRange && !startFilter) {
      // Default to today
      startFilter = todayStr;
      endFilter = todayStr;
    }

    const query = filters?.searchQuery?.trim().toLowerCase();

    const filtered = allInvoices.filter((inv) => {
      // Date filter
      if (startFilter && inv.invoice_date < startFilter) return false;
      if (endFilter && inv.invoice_date > endFilter) return false;

      // Status filter
      if (filters?.status && filters.status !== "all") {
        if (inv.status?.toLowerCase() !== filters.status.toLowerCase()) return false;
      }

      // Payment mode filter
      if (filters?.paymentMode && filters.paymentMode !== "all") {
        if (inv.payment_mode?.toLowerCase() !== filters.paymentMode.toLowerCase()) return false;
      }

      // User / Counter filter
      if (filters?.user && filters.user !== "all") {
        const u = inv.user_counter || "Counter 01";
        if (!u.toLowerCase().includes(filters.user.toLowerCase())) return false;
      }

      // Query Search: matches invoice number, customer name, customer phone, or any product in items
      if (query) {
        const invNumMatch = inv.invoice_number?.toLowerCase().includes(query);
        const custNameMatch = inv.customer_name?.toLowerCase().includes(query);
        const custPhoneMatch = inv.customer_phone?.includes(query);
        const items = itemsByInvoice.get(inv.id) || [];
        const productMatch = items.some(
          (it) =>
            it.product_name?.toLowerCase().includes(query) ||
            it.batch_no?.toLowerCase().includes(query)
        );

        if (!invNumMatch && !custNameMatch && !custPhoneMatch && !productMatch) {
          return false;
        }
      }

      return true;
    });

    // Sort newest first
    return filtered.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  /**
   * Fetch invoice details with its items and parsed audit history
   */
  async getInvoiceWithDetails(
    invoiceIdOrNumber: string
  ): Promise<{ invoice: InvoiceRecord; items: InvoiceItemRecord[]; auditLog: InvoiceAuditEntry[] } | null> {
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const invoice = allInvoices.find(
      (inv) => inv.id === invoiceIdOrNumber || inv.invoice_number === invoiceIdOrNumber
    );

    if (!invoice) return null;

    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");
    const items = allItems.filter((it) => it.invoice_id === invoice.id);

    let auditLog: InvoiceAuditEntry[] = [];
    if (typeof invoice.edit_history === "string") {
      try {
        auditLog = JSON.parse(invoice.edit_history);
      } catch {
        auditLog = [];
      }
    } else if (Array.isArray(invoice.edit_history)) {
      auditLog = invoice.edit_history;
    }

    return { invoice, items, auditLog };
  }

  /**
   * Compute a structured diff between original invoice items and revised cart lines
   */
  computeDiff(originalItems: InvoiceItemRecord[], newLines: PosCartLine[]): InvoiceDiffResult {
    const changes: InvoiceDiffResult["changes"] = [];
    const origMap = new Map<string, InvoiceItemRecord>();

    for (const it of originalItems) {
      const key = `${it.product_id}_${it.batch_no}`;
      origMap.set(key, it);
    }

    const processedKeys = new Set<string>();

    for (const line of newLines) {
      const key = `${line.product.id}_${line.selectedBatch.batch_no}`;
      processedKeys.add(key);

      const orig = origMap.get(key);
      if (!orig) {
        changes.push({
          type: "ADDED",
          productName: line.product.name,
          batchNo: line.selectedBatch.batch_no,
          newQty: line.qty,
          newRate: line.unit_price,
          newAmount: line.calculated.total_amount,
        });
      } else {
        const qtyChanged = orig.qty !== line.qty || (orig.loose_qty || 0) !== (line.loose_qty || 0);
        const rateChanged = Math.abs(orig.unit_price - line.unit_price) > 0.01;

        if (qtyChanged || rateChanged) {
          changes.push({
            type: "MODIFIED",
            productName: line.product.name,
            batchNo: line.selectedBatch.batch_no,
            oldQty: orig.qty,
            newQty: line.qty,
            oldRate: orig.unit_price,
            newRate: line.unit_price,
            oldAmount: orig.total_amount,
            newAmount: line.calculated.total_amount,
          });
        }
      }
    }

    for (const [key, orig] of origMap.entries()) {
      if (!processedKeys.has(key)) {
        changes.push({
          type: "REMOVED",
          productName: orig.product_name,
          batchNo: orig.batch_no,
          oldQty: orig.qty,
          oldRate: orig.unit_price,
          oldAmount: orig.total_amount,
        });
      }
    }

    const oldTotal = originalItems.reduce((acc, it) => acc + (it.total_amount || 0), 0);
    const newTotal = newLines.reduce((acc, l) => acc + l.calculated.total_amount, 0);

    return {
      hasChanges: changes.length > 0 || Math.abs(oldTotal - newTotal) > 0.01,
      oldTotal: Math.round(oldTotal * 100) / 100,
      newTotal: Math.round(newTotal * 100) / 100,
      totalDiff: Math.round((newTotal - oldTotal) * 100) / 100,
      changes,
    };
  }

  /**
   * Save an edited invoice:
   * 1. Reverses original stock deductions in ledger
   * 2. Replaces invoice items with updated lines
   * 3. Applies new stock deductions in ledger
   * 4. Recalculates GST and totals
   * 5. Marks is_revised = 1 and appends to audit log
   * 6. Enqueues update to sync queue
   */
  async saveInvoiceEdit(
    originalInvoiceId: string,
    payload: {
      lines: PosCartLine[];
      customerName: string;
      customerPhone: string;
      customerGstin?: string;
      paymentMode?: string;
      notes?: string;
      reason?: string;
      operatorUser?: string;
    }
  ): Promise<{ success: boolean; invoiceId: string }> {
    const existing = await this.getInvoiceWithDetails(originalInvoiceId);
    if (!existing) {
      throw new Error(`Invoice ${originalInvoiceId} not found`);
    }

    const { invoice: originalInvoice, items: originalItems, auditLog } = existing;

    const lock = this.checkInvoiceLockStatus(originalInvoice);
    if (lock.isLocked) {
      throw new Error(lock.lockReason || "Invoice is locked from editing");
    }

    if (payload.lines.length === 0) {
      throw new Error("Cannot save invoice with 0 items. Please cancel the bill instead.");
    }

    const now = Date.now();

    // 1. REVERSE ORIGINAL STOCK
    for (const orig of originalItems) {
      const unitsPerPack = orig.units_per_pack || 1;
      const baseUnits = orig.qty * unitsPerPack + (orig.loose_qty || 0);

      // Restore batch stock
      const allBatches = await sqliteStorage.findAll<ProductBatch>("product_batches");
      const batch = allBatches.find(
        (b) => b.product_id === orig.product_id && b.batch_no === orig.batch_no
      );
      if (batch) {
        batch.stock_qty += baseUnits;
        await productsStore.upsertBatch(batch);
      }

      // Record reverse stock transaction
      const revTxId = `stk_rev_${now}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("stock_transactions", revTxId, {
        id: revTxId,
        product_id: orig.product_id,
        batch_id: batch?.id || "",
        event_type: "INVOICE_EDIT_REVERSAL",
        qty_delta: baseUnits,
        reference_type: "INVOICE",
        reference_id: originalInvoice.id,
        notes: `Stock reversal for editing bill ${originalInvoice.invoice_number}`,
        created_at: now,
      });

      // Delete old invoice_item record
      await sqliteStorage.deleteRecord("invoice_items", orig.id);
    }

    // 2. CALCULATE NEW TOTALS
    const billingLines: BillingLineInput[] = payload.lines.map((l) => ({
      qty: l.qty,
      loose_qty: l.loose_qty,
      units_per_pack: l.product.units_per_pack,
      unit_price: l.unit_price,
      mrp: l.product.mrp,
      discount_percent: l.discount_percent,
      discount_amount: l.discount_amount,
      gst_percent: l.product.gst_percent,
    }));

    const totals: InvoiceTotals = calculateInvoiceTotals(billingLines, { type: "amount", value: 0 }, "inclusive", false, true);

    // 3. APPLY NEW ITEMS & DEDUCT NEW STOCK
    for (const line of payload.lines) {
      const lineItemId = `inv_item_${now}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("invoice_items", lineItemId, {
        id: lineItemId,
        invoice_id: originalInvoice.id,
        product_id: line.product.id,
        product_name: line.product.name,
        hsn_code: line.product.hsn_sac_code || "",
        batch_no: line.selectedBatch.batch_no,
        expiry_date: line.selectedBatch.expiry_date,
        qty: line.qty,
        loose_qty: line.loose_qty,
        units_per_pack: line.product.units_per_pack || 1,
        unit_price: line.unit_price,
        mrp: line.product.mrp,
        discount_percent: line.discount_percent,
        discount_amount: line.discount_amount,
        gst_percent: line.product.gst_percent,
        cgst_amount: line.calculated.cgst_amount,
        sgst_amount: line.calculated.sgst_amount,
        igst_amount: line.calculated.igst_amount,
        total_amount: line.calculated.total_amount,
      });

      // Deduct new stock
      const newBaseUnits = line.qty * (line.product.units_per_pack || 1) + line.loose_qty;
      const allBatches = await sqliteStorage.findAll<ProductBatch>("product_batches");
      const batch = allBatches.find((b) => b.id === line.selectedBatch.id);
      if (batch) {
        batch.stock_qty = (batch.stock_qty || 0) - newBaseUnits;
        await productsStore.upsertBatch(batch);
      }

      const newTxId = `stk_edit_${now}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("stock_transactions", newTxId, {
        id: newTxId,
        product_id: line.product.id,
        batch_id: line.selectedBatch.id,
        event_type: "SALE",
        qty_delta: -newBaseUnits,
        reference_type: "INVOICE",
        reference_id: originalInvoice.id,
        notes: `Revised sale for bill ${originalInvoice.invoice_number}`,
        created_at: now,
      });
    }

    // 4. PREPARE AUDIT LOG
    const diff = this.computeDiff(originalItems, payload.lines);
    const auditEntry: InvoiceAuditEntry = {
      timestamp: now,
      user: payload.operatorUser || "Counter 01",
      action: "EDITED",
      reason: payload.reason || "Invoice revised from POS screen",
      diffSummary: `${diff.changes.length} change(s) made. Total changed from ₹${diff.oldTotal} to ₹${diff.newTotal}`,
      oldTotal: diff.oldTotal,
      newTotal: diff.newTotal,
    };
    const updatedAuditLog = [...auditLog, auditEntry];

    // 5. UPDATE INVOICE RECORD
    const updatedInvoiceRow: InvoiceRecord = {
      ...originalInvoice,
      external_id: originalInvoice.external_id || originalInvoice.id,
      customer_name: payload.customerName || originalInvoice.customer_name,
      customer_phone: payload.customerPhone || originalInvoice.customer_phone,
      customer_gstin: payload.customerGstin ?? originalInvoice.customer_gstin,
      payment_mode: payload.paymentMode || originalInvoice.payment_mode,
      notes: payload.notes ?? originalInvoice.notes,
      subtotal: totals.taxable_subtotal,
      discount_total: totals.line_discount_total + totals.bill_discount_amount,
      tax_total: totals.total_tax,
      round_off: totals.round_off,
      grand_total: totals.grand_total,
      paid_amount: totals.grand_total,
      is_revised: 1,
      edit_history: JSON.stringify(updatedAuditLog),
      updated_at: now,
      sync_state: "pending",
    };

    await sqliteStorage.insertRecord("invoices", originalInvoice.id, updatedInvoiceRow as unknown as Record<string, unknown>);

    // 6. ENQUEUE TO SYNC QUEUE WITH UPDATED LINE ITEMS
    await syncQueueService.enqueue("invoice", originalInvoice.id, "update", {
      ...updatedInvoiceRow,
      items: payload.lines.map((line) => ({
        product_id: line.product.id,
        product_name: line.product.name,
        batch_no: line.selectedBatch.batch_no,
        expiry_date: line.selectedBatch.expiry_date,
        qty: line.qty,
        unit_price: line.unit_price,
        discount_percent: line.discount_percent,
        discount_amount: line.discount_amount,
        gst_percent: line.product.gst_percent,
        tax_amount: line.calculated.cgst_amount + line.calculated.sgst_amount + line.calculated.igst_amount,
        total_amount: line.calculated.total_amount,
      })),
    });

    return { success: true, invoiceId: originalInvoice.id };
  }

  /**
   * Cancel an invoice:
   * 1. Restores all batch inventory
   * 2. Records cancel stock transactions
   * 3. Sets status = 'cancelled' and records cancellation reason
   * 4. Keeps the original invoice number (never hard-deletes)
   * 5. Enqueues cancellation to sync queue
   */
  async cancelInvoice(
    invoiceId: string,
    reason: string,
    operatorUser = "Counter 01"
  ): Promise<{ success: boolean }> {
    if (!reason || !reason.trim()) {
      throw new Error("A cancellation reason is mandatory");
    }

    const existing = await this.getInvoiceWithDetails(invoiceId);
    if (!existing) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    const { invoice, items, auditLog } = existing;

    if (invoice.status === "cancelled") {
      throw new Error("Invoice is already cancelled");
    }

    const lock = this.checkInvoiceLockStatus(invoice);
    if (lock.isLocked) {
      throw new Error(lock.lockReason || "Invoice is locked from cancellation");
    }

    const now = Date.now();

    // 1. RESTORE STOCK FOR ALL ITEMS
    for (const item of items) {
      const unitsPerPack = item.units_per_pack || 1;
      const baseUnits = item.qty * unitsPerPack + (item.loose_qty || 0);

      const allBatches = await sqliteStorage.findAll<ProductBatch>("product_batches");
      const batch = allBatches.find(
        (b) => b.product_id === item.product_id && b.batch_no === item.batch_no
      );

      if (batch) {
        batch.stock_qty += baseUnits;
        await productsStore.upsertBatch(batch);
      }

      const cancelTxId = `stk_cnl_${now}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("stock_transactions", cancelTxId, {
        id: cancelTxId,
        product_id: item.product_id,
        batch_id: batch?.id || "",
        event_type: "INVOICE_CANCEL",
        qty_delta: baseUnits,
        reference_type: "INVOICE",
        reference_id: invoice.id,
        notes: `Cancellation of bill ${invoice.invoice_number}: ${reason}`,
        created_at: now,
      });
    }

    // 2. UPDATE AUDIT LOG
    const auditEntry: InvoiceAuditEntry = {
      timestamp: now,
      user: operatorUser,
      action: "CANCELLED",
      reason: reason.trim(),
      oldTotal: invoice.grand_total,
      newTotal: 0,
      diffSummary: `Invoice marked cancelled. ₹${invoice.grand_total} reversed.`,
    };
    const updatedAuditLog = [...auditLog, auditEntry];

    // 3. MARK INVOICE CANCELLED
    const updatedInvoiceRow: InvoiceRecord = {
      ...invoice,
      status: "cancelled",
      cancel_reason: reason.trim(),
      edit_history: JSON.stringify(updatedAuditLog),
      updated_at: now,
      sync_state: "pending",
    };

    await sqliteStorage.insertRecord("invoices", invoice.id, updatedInvoiceRow as unknown as Record<string, unknown>);

    // 4. ENQUEUE CANCEL ACTION
    await syncQueueService.enqueue("invoice", invoice.id, "update", {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      status: "cancelled",
      cancel_reason: reason.trim(),
      updated_at: now,
    });

    return { success: true };
  }

  /**
   * Check store rules for locking invoices:
   * 1. Already cancelled bills are locked
   * 2. Bills older than maxDays (default 30) are locked
   */
  checkInvoiceLockStatus(invoice: InvoiceRecord, maxDays = 30): { isLocked: boolean; lockReason?: string } {
    if (invoice.status === "cancelled") {
      return { isLocked: true, lockReason: "This invoice is cancelled and cannot be edited." };
    }

    const invDate = new Date(invoice.invoice_date);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays > maxDays) {
      return {
        isLocked: true,
        lockReason: `Invoice is ${diffDays} days old (exceeds ${maxDays}-day editing limit). Please issue a Sales Return / Credit Note instead.`,
      };
    }

    return { isLocked: false };
  }

  /**
   * Verify Manager PIN for privileged operations (edit/cancel)
   */
  verifyManagerPin(pin: string, configuredPin = "1234"): boolean {
    return pin.trim() === configuredPin.trim();
  }
}

export const invoiceManagementService = new InvoiceManagementService();

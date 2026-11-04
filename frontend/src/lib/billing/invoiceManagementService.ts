import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";
import { partiesStore } from "../masters/partiesStore";
import { syncQueueService } from "../sync/syncQueueService";
import { storeRegistryService } from "../auth/storeRegistryService";
import type { PosCartLine } from "./posCartService";
import { calculateInvoiceTotals, type BillingLineInput, type InvoiceTotals } from "./billingCalculations";
import type { InvoicePaymentRecord, PaymentTenderLine } from "./billingTenderService";
import { cashShiftService } from "./cashShiftService";

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
  store_id?: string | number;
  store_code?: string;
  module_key: string;
  invoice_number: string;
  invoice_date: string; // YYYY-MM-DD
  created_at_time?: string;
  customer_id?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_gstin?: string;
  place_of_supply?: string;
  store_state_code?: string;
  tax_type?: "intra_state" | "inter_state" | string;
  subtotal: number;
  taxable_subtotal?: number;
  discount_total: number;
  tax_total: number;
  cgst_total?: number;
  sgst_total?: number;
  igst_total?: number;
  cess_total?: number;
  round_off: number;
  grand_total: number;
  paid_amount: number;
  payment_mode: string;
  payment_status?: "paid" | "partially_paid" | "unpaid";
  payments?: InvoicePaymentRecord[];
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
  taxable_amount?: number;
  gst_percent: number;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  cess_percent?: number;
  cess_amount?: number;
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
    const allCustomers = await sqliteStorage.findAll<any>("customers").catch(() => []);

    const phoneByCustId = new Map<string, string>();
    const phoneByCustName = new Map<string, string>();
    for (const c of allCustomers) {
      if (c.phone) {
        if (c.id) phoneByCustId.set(String(c.id), c.phone);
        if (c.server_id) phoneByCustId.set(String(c.server_id), c.phone);
        if (c.external_id) phoneByCustId.set(String(c.external_id), c.phone);
        if (c.name && c.name.toLowerCase() !== "walk-in customer") {
          phoneByCustName.set(c.name.toLowerCase(), c.phone);
        }
      }
    }

    for (const inv of allInvoices) {
      if (!inv.customer_phone) {
        if (inv.customer_id && phoneByCustId.has(String(inv.customer_id))) {
          inv.customer_phone = phoneByCustId.get(String(inv.customer_id));
        } else if (inv.customer_name && phoneByCustName.has(inv.customer_name.toLowerCase())) {
          inv.customer_phone = phoneByCustName.get(inv.customer_name.toLowerCase());
        }
      }
    }

    // Map invoice_id -> array of items for product-level searching
    const itemsByInvoice = new Map<string, InvoiceItemRecord[]>();
    for (const item of allItems) {
      if (!itemsByInvoice.has(item.invoice_id)) {
        itemsByInvoice.set(item.invoice_id, []);
      }
      itemsByInvoice.get(item.invoice_id)!.push(item);
    }

    const now = new Date();
    const formatYmdKolkata = (d: Date) => {
      try {
        return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      } catch {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
    };

    const todayStr = formatYmdKolkata(now);

    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = formatYmdKolkata(yesterdayDate);

    const sevenDaysAgoDate = new Date(now);
    sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 7);
    const sevenDaysAgoStr = formatYmdKolkata(sevenDaysAgoDate);

    const monthStartStr = `${todayStr.slice(0, 7)}-01`;
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthEndStr = `${todayStr.slice(0, 7)}-${String(lastDayOfMonth).padStart(2, "0")}`;

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
      endFilter = monthEndStr;
    } else if (filters?.dateRange === "all") {
      startFilter = undefined;
      endFilter = undefined;
    } else if (!filters?.dateRange && !startFilter) {
      // Default to today
      startFilter = todayStr;
      endFilter = todayStr;
    }

    const query = filters?.searchQuery?.trim().toLowerCase();

    const parseInvoiceDate = (inv: InvoiceRecord): string => {
      const raw = (inv.invoice_date || "").trim();
      if (!raw && inv.created_at) {
        return formatYmdKolkata(new Date(inv.created_at));
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return raw;
      }
      try {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          return formatYmdKolkata(d);
        }
      } catch {
        // fallback
      }
      return raw.slice(0, 10);
    };

    const filtered = allInvoices.filter((inv) => {
      // Date filter (compare date-only part in Asia/Kolkata store timezone)
      const invDateOnly = parseInvoiceDate(inv);
      if (startFilter && invDateOnly < startFilter) return false;
      if (endFilter && invDateOnly > endFilter) return false;

      // Status filter
      if (filters?.status && filters.status.toLowerCase() !== "all") {
        if ((inv.status || "issued").toLowerCase() !== filters.status.toLowerCase()) return false;
      }

      // Payment mode filter
      if (filters?.paymentMode && filters.paymentMode.toLowerCase() !== "all") {
        const targetPm = filters.paymentMode.toLowerCase();
        const invPm = (inv.payment_mode || "").toLowerCase();
        if (invPm !== targetPm && !invPm.includes(targetPm)) return false;
      }

      // User / Counter filter
      if (filters?.user && filters.user.toLowerCase() !== "all") {
        const u = inv.user_counter || (inv as any).counter_code || (inv as any).counter_name || "Counter 01";
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

    if (!invoice.customer_phone) {
      if (invoice.customer_id) {
        try {
          const cust = await partiesStore.getCustomerById(String(invoice.customer_id));
          if (cust?.phone) {
            invoice.customer_phone = cust.phone;
          }
        } catch {}
      }
      if (!invoice.customer_phone && invoice.customer_name && invoice.customer_name.toLowerCase() !== "walk-in customer") {
        try {
          const matches = await partiesStore.searchCustomers(invoice.customer_name, 1);
          if (matches[0]?.phone) {
            invoice.customer_phone = matches[0].phone;
          }
        } catch {}
      }
    }

    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");
    const items = allItems.filter((it) => it.invoice_id === invoice.id);

    const allPayments = await sqliteStorage.findAll<InvoicePaymentRecord>("invoice_payments").catch(() => []);
    const payments = allPayments.filter((p) => p.invoice_id === invoice.id);
    invoice.payments = payments;

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
    const activeStoreId = String(originalInvoice.store_id || storeRegistryService.getActiveStore()?.id || "1");
    const updatedInvoiceRow: InvoiceRecord = {
      ...originalInvoice,
      store_id: activeStoreId,
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

    // 3. REVERSE CUSTOMER CREDIT AND REFUND PAYMENT LINES
    const allPayments = await sqliteStorage.findAll<InvoicePaymentRecord>("invoice_payments").catch(() => []);
    const invPayments = allPayments.filter((p) => p.invoice_id === invoice.id);
    const creditRefund = invPayments
      .filter((p) => p.payment_mode.toLowerCase() === "credit")
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    if (creditRefund > 0 && invoice.customer_id) {
      const cust = await sqliteStorage.findById<any>("customers", invoice.customer_id);
      if (cust) {
        await sqliteStorage.insertRecord("customers", invoice.customer_id, {
          ...cust,
          current_balance: Math.max(0, (Number(cust.current_balance) || 0) - creditRefund),
          outstanding_balance: Math.max(0, (Number(cust.outstanding_balance) || 0) - creditRefund),
          updated_at: now,
        });
      }
    }

    for (const p of invPayments) {
      await sqliteStorage.insertRecord("invoice_payments", p.id, {
        ...p,
        status: "refunded",
        notes: (p.notes ? p.notes + " | " : "") + `Cancelled: ${reason.trim()}`,
        updated_at: now,
      });
    }

    // 4. MARK INVOICE CANCELLED
    const activeStoreId = String(invoice.store_id || storeRegistryService.getActiveStore()?.id || "1");
    const updatedInvoiceRow: InvoiceRecord = {
      ...invoice,
      store_id: activeStoreId,
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
      store_id: activeStoreId,
      invoice_number: invoice.invoice_number,
      status: "cancelled",
      cancel_reason: reason.trim(),
      updated_at: now,
    });

    return { success: true };
  }

  /**
   * Receive payment against a credit or partially-paid invoice.
   */
  async recordInvoiceReceipt(
    invoiceId: string,
    payment: PaymentTenderLine,
    operator = "Counter 01",
    counterId = "Counter 01"
  ): Promise<{ success: boolean; newPaidAmount: number; newStatus: string }> {
    const existing = await this.getInvoiceWithDetails(invoiceId);
    if (!existing) throw new Error("Invoice not found");
    const { invoice } = existing;

    const amt = Number(payment.amount) || 0;
    if (amt <= 0) throw new Error("Payment amount must be greater than zero");

    const now = Date.now();
    const paymentId = payment.id || `rcpt_${now}_${Math.random().toString(16).slice(2, 6)}`;
    const storeId = String(invoice.store_id || storeRegistryService.getActiveStore()?.id || "1");

    // 1. Insert payment record
    const pRec: any = {
      id: paymentId,
      store_id: storeId,
      invoice_id: invoice.id,
      counter_id: counterId,
      payment_mode: payment.mode,
      amount: amt,
      reference_no: payment.reference_no,
      status: payment.status || "received",
      extra_fields: payment.extra_fields ? JSON.stringify(payment.extra_fields) : undefined,
      notes: payment.notes || "Receipt against pending balance",
      received_by: operator,
      created_at: now,
      updated_at: now,
    };
    await sqliteStorage.insertRecord("invoice_payments", paymentId, pRec as unknown as Record<string, unknown>);

    // 2. Update Invoice paid_amount and payment_status
    const newPaid = Math.round(((Number(invoice.paid_amount) || 0) + amt + Number.EPSILON) * 100) / 100;
    const gTotal = Math.round(((Number(invoice.grand_total) || 0) + Number.EPSILON) * 100) / 100;
    const newStatus = newPaid >= gTotal - 0.01 ? "paid" : "partially_paid";

    await sqliteStorage.insertRecord("invoices", invoice.id, {
      ...invoice,
      paid_amount: newPaid,
      payment_status: newStatus,
      updated_at: now,
    });

    // 3. Update customer outstanding if registered
    if (invoice.customer_id) {
      const cust = await sqliteStorage.findById<any>("customers", invoice.customer_id);
      if (cust) {
        await sqliteStorage.insertRecord("customers", invoice.customer_id, {
          ...cust,
          current_balance: Math.max(0, (Number(cust.current_balance) || 0) - amt),
          outstanding_balance: Math.max(0, (Number(cust.outstanding_balance) || 0) - amt),
          updated_at: now,
        });
      }
    }

    // 4. Record tender in active counter shift
    await cashShiftService.recordSaleTenders(counterId, [payment], 0);

    return { success: true, newPaidAmount: newPaid, newStatus };
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

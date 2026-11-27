import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch } from "../masters/productsStore";
import { partiesStore, type Supplier } from "../masters/partiesStore";
import { syncQueueService } from "../sync/syncQueueService";
import { companySettingsService } from "../settings/companySettingsService";
import { round2 } from "../billing/billingCalculations";
import { formatDocumentNumber, nextSerialAfter, numberingFor } from "../billing/documentNumberFormat";
import { serverTimeToEpoch } from "../dateTimeUtils";
import { onlineTransactionService } from "../sync/onlineTransactionService";
import { storeRegistryService } from "../auth/storeRegistryService";
import { storeDeviceService } from "../auth/storeDeviceService";
import { getIndianFinancialYear } from "../billing/salesReturnService";
import { calculateDocumentTaxes } from "../tax-engine/taxEngine";
import { postCharges, removePostedCharges } from "./chargePosting";
import { findOriginalBill, recordReversals, reversalChargesForReturn } from "./chargeReversal";

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
  igst_amount: number;
  cess_amount?: number;
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
  igst_total: number;
  cess_total?: number;
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

/** An inward bill a debit note can be raised against, from this till or from the server. */
export interface PurchaseBillForReturn {
  id: string;
  purchase_number: string;
  supplier_id?: string;
  supplier_name: string;
  supplier_gstin?: string;
  supplier_invoice_no?: string;
  purchase_date: string;
  grand_total?: number;
  subtotal?: number;
  tax_total?: number;
  lines?: any[];
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
   * Generates sequential return number following settings sequence (e.g. PR-1)
   */
  async generateNextReturnNumber(): Promise<string> {
    const settings = await companySettingsService.loadSettings();
    const { prefix, searchPrefix, next, rule } = numberingFor(settings.sequences, "purchase_return");

    const allReturns = await sqliteStorage.findAll<PurchaseReturnRecord>("purchase_returns");
    const matching = allReturns.filter((r) => r.return_number.startsWith(searchPrefix));
    const nextNum = nextSerialAfter(next, matching.map((r) => r.return_number), rule);

    const docNumber = formatDocumentNumber({ ...rule, prefix }, nextNum);

    await companySettingsService.saveLocalSettings(
      {
        sequences: {
          ...settings.sequences,
          purchaseReturnPrefix: prefix,
          nextPurchaseReturnNumber: nextNum + 1,
        },
      });

    return docNumber;
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
    /** Whether the server has actually taken the debit note yet (PUR-07). */
    syncState?: "synced" | "pending";
    syncMessage?: string;
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

    // Determine if original purchase or supplier is inter-state
    const isInterstate = input.supplier_gstin ? !input.supplier_gstin.trim().startsWith("32") : false;

    // PUR-015: goods going back take their share of the bill's charges with them, so the debit
    // note the operator prints offline already carries the money the supplier gives back. The
    // server derives the same paisa when it ingests this note; neither adds to the other (SYNC-007).
    const against = await findOriginalBill({
      original_purchase_id: input.original_purchase_id,
      original_purchase_number: input.original_purchase_number,
      supplier_invoice_no: input.supplier_invoice_no,
    });
    const reversalLines = against
      ? await reversalChargesForReturn(
          String(against.id),
          input.lines.map((l) => ({ product_id: l.product_id, batch_no: l.batch_no, return_qty: l.return_qty })),
          returnId
        )
      : [];

    // 2. Compute financial breakdown line by line via TaxEngine
    const docTaxes = calculateDocumentTaxes({
      separately_paid_in_payable: Boolean(
        companySettingsService.getSettings().purchase_charges?.separately_paid_in_payable
      ),
      store_state: "32",
      customer_gstin: input.supplier_gstin,
      place_of_supply: isInterstate ? "XX" : "32",
      default_tax_mode: "exclusive",
      charges: reversalLines,
      lines: input.lines.map((l, idx) => ({
        line_id: `PR_${idx}`,
        product_id: l.product_id,
        product_name: l.product_name,
        hsn_code: l.hsn_code,
        qty: l.return_qty,
        loose_qty: 0,
        unit_price: l.purchase_rate,
        rate_basis: "ptr",
        discount_percent: 0,
        gst_percent: l.gst_percent,
        is_tax_inclusive: false,
      })),
      auto_round_off: true,
    });

    const returnLines: PurchaseReturnItem[] = [];

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i];
      const cLine = docTaxes.lines[i];
      const itemId = `pri_${now}_${Math.random().toString(16).slice(2, 6)}`;

      returnLines.push({
        ...line,
        id: itemId,
        return_id: returnId,
        taxable_amount: cLine.taxable_amount,
        cgst_amount: cLine.cgst_amount,
        sgst_amount: cLine.sgst_amount,
        igst_amount: cLine.igst_amount,
        cess_amount: cLine.cess_amount,
        total_amount: cLine.total_amount,
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

    const subtotal = docTaxes.taxable_subtotal;
    const cgstTotal = docTaxes.cgst_total;
    const sgstTotal = docTaxes.sgst_total;
    const igstTotal = docTaxes.igst_total;
    const cessTotal = docTaxes.cess_total;
    const taxTotal = docTaxes.total_tax;
    const roundOff = docTaxes.round_off;
    const grandTotal = docTaxes.grand_total;

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
      igst_total: igstTotal,
      cess_total: cessTotal,
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

    // The note's own charge rows: the money the supplier gives back. No `itemIdsByLine`, because
    // a debit note never re-spreads a charge onto goods — it only takes the original bill's share
    // back, and that reduction is what `recordReversals` writes on the bill (PUR-015).
    if (reversalLines.length) {
      await postCharges({
        purchaseId: returnId,
        invoiceNumber: returnNumber,
        charges: reversalLines,
        result: docTaxes,
        purchaseLines: [],
        itemIdsByLine: {},
      });
    }

    if (against) await recordReversals(String(against.id));

    // 6. Enqueue for sync — a debit note is a purchase document, and pushing it as a "product"
    // made the server drop it (no name to match), so the return never reached the backend.
    const queueId = await syncQueueService.enqueue("purchase", returnId, "create", {
      ...returnRecord,
      module_key: "purchase_return",
      // The purchase ingest only matches a re-push on an explicit external id, so without it one
      // debit note taken offline and pushed twice could be filed as two.
      external_id: returnId,
    } as unknown as Record<string, unknown>);

    // The counter is told the note is posted only when the server has taken it; offline it is
    // saved and queued (PUR-07). A refusal (over-return, duplicate) is reported, not hidden.
    if (syncQueueService.isOnline()) {
      const ack = await syncQueueService.syncSingleItem(queueId);
      if (ack.success) {
        return { success: true, returnId, returnNumber, grandTotal, syncState: "synced" };
      }

      return {
        success: true,
        returnId,
        returnNumber,
        grandTotal,
        syncState: "pending",
        syncMessage: ack.error,
      };
    }

    return { success: true, returnId, returnNumber, grandTotal, syncState: "pending" };
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

    // 3. Take the note's charge reversals back out. The note is already flagged cancelled, so
    // re-deriving the bill's reversal no longer counts its units — which is what puts the landed
    // cost, the reversed amount and the supplier's credit back exactly where they were (PUR-015).
    await removePostedCharges(ret.id);
    const against = await findOriginalBill({
      original_purchase_id: ret.original_purchase_id,
      original_purchase_number: ret.original_purchase_number,
      supplier_invoice_no: ret.supplier_invoice_no,
      notes: ret.notes,
    });
    if (against) await recordReversals(String(against.id));

    // Without this the server keeps the debit note as if it were still live and never gives the
    // returned units back to the batch.
    await syncQueueService.enqueue("purchase", ret.id, "update", {
      ...ret,
      module_key: "purchase_return",
    } as unknown as Record<string, unknown>);

    return { success: true };
  }

  /**
   * Debit notes the store holds on the server — a migrated legacy return, a note raised at
   * another counter, or one posted in the admin panel. They were invisible here because the
   * till only ever read its own `purchase_returns` table.
   */
  async getServerPurchaseReturns(): Promise<PurchaseReturnRecord[]> {
    const rows = await this.fetchServerDocuments("purchase_returns");
    return rows
      .map((row: any) => this.mapServerDebitNote(row))
      .filter(Boolean) as PurchaseReturnRecord[];
  }

  /**
   * Inward bills a debit note can be raised against, this device's own plus the server's. The
   * picker used to read `purchase_documents` alone, so goods bought before the till was set up —
   * or at another counter — could not be returned from here.
   */
  async getOriginalBills(): Promise<PurchaseBillForReturn[]> {
    const [local, rows] = await Promise.all([
      sqliteStorage.findAll<PurchaseBillForReturn>("purchase_documents"),
      this.fetchServerDocuments("purchases"),
    ]);

    const known = new Set<string>();
    for (const doc of local) {
      if (doc.id) known.add(String(doc.id));
      if (doc.purchase_number) known.add(String(doc.purchase_number).toLowerCase());
    }

    const bills = [...local];
    for (const row of rows) {
      const bill = this.mapServerPurchaseBill(row);
      if (!bill || known.has(bill.id) || known.has(bill.purchase_number.toLowerCase())) continue;
      bills.push(bill);
    }

    return bills;
  }

  private async fetchServerDocuments(module: string): Promise<any[]> {
    if (!syncQueueService.isOnline()) return [];

    const baseUrl = onlineTransactionService.getEffectiveBaseUrl();
    const deviceHeaders = await storeDeviceService.getDeviceAuthHeaders();
    // The token belongs to a store, so its store is the one to ask about — the registry's local id
    // ("store_main") is not a server store and would be refused as a tenant mismatch.
    const storeId = deviceHeaders["X-Store-Id"] || String(storeRegistryService.getActiveStore()?.id || "1");
    const params = new URLSearchParams({ store_id: storeId, module, per_page: "200" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(`${baseUrl}/api/purchases?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          "X-Store-Id": storeId,
          "Store-Id": storeId,
          // `/api/purchases` is a till route: with no device token the server answers 401, and a
          // silent 401 here looks to the operator exactly like a store with no purchases.
          ...deviceHeaders,
        },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json?.data) ? json.data : [];
    } catch (_) {
      // A server that will not answer must not empty the screen; the local book stays.
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The base units a server line covers. A bill pushed by a till stores its billed packs in both
   * `pack_qty` and `qty`, while a migrated line keeps its own units in `qty`, so the pack maths is
   * only applied when the row was packed.
   */
  private serverLineUnits(item: any): number {
    const perPack = Number(item.units_per_pack || 1);
    if (item.total_units != null) return Number(item.total_units);
    if (item.pack_qty != null || perPack > 1) {
      const packs = Number(item.pack_qty ?? item.qty ?? 0);
      return packs * perPack + Number(item.loose_qty || 0);
    }
    return Number(item.qty || 0);
  }

  private mapServerDebitNote(row: any): PurchaseReturnRecord | null {
    if (!row || (row.id == null && !row.invoice_number)) return null;

    const id = String(row.external_id || row.id);
    const createdAt = serverTimeToEpoch(row.created_at) || serverTimeToEpoch(row.invoice_date);
    const items = Array.isArray(row.items) ? row.items : [];

    const lines: PurchaseReturnItem[] = items.map((item: any, index: number) => {
      const units = this.serverLineUnits(item);
      return {
        id: String(item.id ?? `${id}_line_${index}`),
        return_id: id,
        product_id: String(item.product_id ?? ""),
        product_name: item.product_name || "Item",
        hsn_code: item.hsn_code || undefined,
        batch_id: "",
        batch_no: item.batch_no || "",
        expiry_date: item.expiry_date || undefined,
        purchased_qty: units,
        return_qty: units,
        purchase_rate: Number(item.purchase_rate || item.effective_unit_cost || 0),
        gst_percent: Number(item.gst_percent || 0),
        // The server has no per-line reason column; the note's own notes carry the supplier's.
        reason: "other",
        taxable_amount: Number(item.taxable_amount || 0),
        cgst_amount: Number(item.cgst_amount || 0),
        sgst_amount: Number(item.sgst_amount || 0),
        igst_amount: Number(item.igst_amount || 0),
        cess_amount: Number(item.cess_amount || 0),
        total_amount: Number(item.total_amount || 0),
      };
    });

    return {
      id,
      return_number: String(row.invoice_number || `DN-${row.id}`),
      return_date: String(row.invoice_date || "").slice(0, 10),
      return_time: "",
      original_purchase_number: row.original_purchase_number || row.supplier_invoice_no || undefined,
      supplier_id: String(row.supplier?.external_id ?? row.supplier_id ?? ""),
      supplier_name: row.supplier_name || row.supplier?.name || "Supplier",
      supplier_gstin: row.supplier_gstin || row.supplier?.gstin || undefined,
      supplier_invoice_no: row.supplier_invoice_no || undefined,
      lines,
      subtotal: Number(row.subtotal || 0),
      tax_total: Number(row.tax_total || 0),
      cgst_total: Number(row.cgst_total || 0),
      sgst_total: Number(row.sgst_total || 0),
      igst_total: Number(row.igst_total || 0),
      cess_total: Number(row.cess_total || 0),
      round_off: Number(row.round_off || 0),
      grand_total: Number(row.grand_total || 0),
      settlement_type: (row.settlement_type === "refund" ? "refund" : "credit_adjust") as PurchaseReturnSettlement,
      refund_mode: row.payment_mode || row.refund_mode || undefined,
      status: String(row.status || "").toLowerCase() === "cancelled" ? "cancelled" : "completed",
      notes: row.notes || undefined,
      created_at: createdAt,
      updated_at: serverTimeToEpoch(row.updated_at) || createdAt,
    };
  }

  private mapServerPurchaseBill(row: any): PurchaseBillForReturn | null {
    if (!row || (row.id == null && !row.invoice_number)) return null;

    return {
      id: String(row.external_id || row.id),
      purchase_number: String(row.invoice_number || ""),
      supplier_id: String(row.supplier?.external_id ?? row.supplier_id ?? ""),
      supplier_name: row.supplier_name || row.supplier?.name || "Supplier",
      supplier_gstin: row.supplier_gstin || undefined,
      supplier_invoice_no: row.supplier_invoice_no || undefined,
      purchase_date: String(row.invoice_date || "").slice(0, 10),
      grand_total: Number(row.grand_total || 0),
      subtotal: Number(row.subtotal || 0),
      tax_total: Number(row.tax_total || 0),
      // The till loads a local bill's lines by id; a server bill arrives with them attached.
      lines: (Array.isArray(row.items) ? row.items : []).map((item: any) => ({
        product_id: String(item.product_id ?? ""),
        product_name: item.product_name || "Item",
        hsn_code: item.hsn_code || undefined,
        batch_id: "",
        batch_no: item.batch_no || "",
        expiry_date: item.expiry_date || undefined,
        pack_qty: item.pack_qty ?? undefined,
        loose_qty: Number(item.loose_qty || 0),
        units_per_pack: Number(item.units_per_pack || 1),
        qty: Number(item.qty || 0),
        purchase_rate: Number(item.purchase_rate || 0),
        effective_unit_cost: Number(item.effective_unit_cost || 0),
        taxable_amount: Number(item.taxable_amount || 0),
        gst_percent: Number(item.gst_percent || 0),
      })),
    };
  }

  /**
   * Search and filter purchase returns
   *
   * This device's own notes lead — they carry the per-line reason and any edit the server has not
   * been given — and the server's notes are appended after them.
   */
  async getPurchaseReturns(filter?: PurchaseReturnFilter): Promise<PurchaseReturnRecord[]> {
    const [local, server] = await Promise.all([
      sqliteStorage.findAll<PurchaseReturnRecord>("purchase_returns"),
      this.getServerPurchaseReturns(),
    ]);

    const known = new Set<string>();
    for (const row of local) {
      if (row.id) known.add(String(row.id));
      if (row.return_number) known.add(String(row.return_number).toLowerCase());
    }

    let results = [...local];
    for (const row of server) {
      if (known.has(row.id) || known.has(row.return_number.toLowerCase())) continue;
      results.push(row);
    }

    results.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

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

import { sqliteStorage } from "../db/sqliteStorage";
import { canonicalizeInvoiceIdentity, clearInvoiceChildren } from "../db/invoiceCacheIdentity";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";
import { partiesStore } from "../masters/partiesStore";
import { syncQueueService } from "../sync/syncQueueService";
import { storeRegistryService } from "../auth/storeRegistryService";
import { onlineTransactionService } from "../sync/onlineTransactionService";
import type { PosCartLine } from "./posCartService";
import { calculateInvoiceTotals, type BillingLineInput, type InvoiceTotals } from "./billingCalculations";
import type { InvoicePaymentRecord, PaymentTenderLine } from "./billingTenderService";
import { cashShiftService } from "./cashShiftService";
import { companySettingsService } from "../settings/companySettingsService";
import { addDaysToDateString, formatInStoreTZ, getStoreTimezone, storeToday } from "../dateTimeUtils";

export interface InvoiceAuditEntry {
  timestamp: number;
  user: string;
  action: "CREATED" | "EDITED" | "CANCELLED";
  reason?: string;
  diffSummary?: string;
  oldTotal?: number;
  newTotal?: number;
  approvedBy?: string;
  approvalId?: string;
  approvalMode?: string;
}

/** Short-lived grant returned by the server after manager / one-time PIN approval. */
export interface InvoiceEditApproval {
  id: string;
  token: string;
  mode: string;
  approvedByName: string;
}

export interface InvoiceRecord {
  id: string;
  server_id?: number;
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
  status: "issued" | "cancelled" | "converted";
  cancel_reason?: string;
  is_revised?: boolean | number;
  edit_history?: string | InvoiceAuditEntry[];
  user_counter?: string;
  sync_state?: string;
  patient_name?: string;
  doctor_name?: string;
  doctor_reg_no?: string;
  // Who vouched for a restricted pack. The PIN they typed is never kept.
  pharmacist_id?: string;
  pharmacist_name?: string;
  pharmacist_reg_no?: string;
  pharmacist_confirmed_at?: number;
  notes?: string;
  external_id?: string;
  bill_discount_percent?: number;
  bill_discount_amount?: number;
  // Statutory compliance registry (recorded in the admin panel; pulled on demand)
  irn?: string;
  irn_ack_no?: string;
  irn_ack_date?: string;
  irn_qr?: string;
  irn_status?: string;
  irn_cancelled_at?: string;
  irn_cancel_reason?: string;
  irn_error?: string;
  irn_status_effective?: string;
  irn_applicable?: boolean;
  ewb_number?: string;
  ewb_date?: string;
  ewb_valid_until?: string;
  ewb_status?: string;
  ewb_status_effective?: string;
  ewb_applicable?: boolean;
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
  free_qty?: number;
  free_loose_qty?: number;
  units_per_pack?: number;
  unit_price: number;
  mrp?: number;
  discount_percent?: number;
  discount_amount?: number;
  taxable_amount?: number;
  gst_percent: number;
  tax_amount?: number;
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
  storeId?: string | number;
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

type ComplianceFields = Pick<
  InvoiceRecord,
  | "irn"
  | "irn_ack_no"
  | "irn_ack_date"
  | "irn_qr"
  | "irn_status"
  | "irn_cancelled_at"
  | "irn_cancel_reason"
  | "irn_error"
  | "irn_status_effective"
  | "irn_applicable"
  | "ewb_number"
  | "ewb_date"
  | "ewb_valid_until"
  | "ewb_status"
  | "ewb_status_effective"
  | "ewb_applicable"
>;

function extractComplianceFields(raw: any): ComplianceFields {
  return {
    irn: raw?.irn ?? undefined,
    irn_ack_no: raw?.irn_ack_no ?? undefined,
    irn_ack_date: raw?.irn_ack_date ?? undefined,
    irn_qr: raw?.irn_qr ?? undefined,
    irn_status: raw?.irn_status ?? undefined,
    irn_cancelled_at: raw?.irn_cancelled_at ?? undefined,
    irn_cancel_reason: raw?.irn_cancel_reason ?? undefined,
    irn_error: raw?.irn_error ?? undefined,
    irn_status_effective: raw?.irn_status_effective ?? undefined,
    irn_applicable: raw?.irn_applicable ?? undefined,
    ewb_number: raw?.ewb_number ?? undefined,
    ewb_date: raw?.ewb_date ?? undefined,
    ewb_valid_until: raw?.ewb_valid_until ?? undefined,
    ewb_status: raw?.ewb_status ?? undefined,
    ewb_status_effective: raw?.ewb_status_effective ?? undefined,
    ewb_applicable: raw?.ewb_applicable ?? undefined,
  };
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
    const storeTimeZone = getStoreTimezone(companySettingsService.getSettings());

    const todayStr = storeToday(companySettingsService.getSettings(), now);
    const yesterdayStr = addDaysToDateString(todayStr, -1);
    const sevenDaysAgoStr = addDaysToDateString(todayStr, -6);

    const monthStartStr = `${todayStr.slice(0, 7)}-01`;
    const lastDayOfMonth = new Date(
      Date.UTC(Number(todayStr.slice(0, 4)), Number(todayStr.slice(5, 7)), 0)
    ).getUTCDate();
    const monthEndStr = `${todayStr.slice(0, 7)}-${String(lastDayOfMonth).padStart(2, "0")}`;
    const formatStoreDate = (d: Date) => formatInStoreTZ(d, storeTimeZone);

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
    const queryDate = (() => {
      if (!query) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(query)) return query;
      const dmy = query.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      if (!dmy) return null;
      return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    })();

    const parseInvoiceDate = (inv: InvoiceRecord): string => {
      const raw = (inv.invoice_date || "").trim();
      if (!raw && inv.created_at) {
        return formatStoreDate(new Date(inv.created_at));
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return raw;
      }
      if (raw.includes("Z") || raw.includes("+") || (raw.includes("T") && !raw.includes(" "))) {
        try {
          const d = new Date(raw);
          if (!isNaN(d.getTime())) {
            return formatStoreDate(d);
          }
        } catch {}
      }
      if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        return raw.slice(0, 10);
      }
      try {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          return formatStoreDate(d);
        }
      } catch {}
      return raw.slice(0, 10);
    };

    const filtered = allInvoices.filter((inv) => {
      // Store filter
      if (filters?.storeId) {
        const sId = String(filters.storeId);
        if (inv.store_id && String(inv.store_id) !== sId) return false;
      }

      // Date filter (compare billing date in Asia/Kolkata store timezone)
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

      // Query Search: matches invoice number, customer name, customer phone,
      // billing date, or any product in items
      if (query) {
        const invNumMatch = inv.invoice_number?.toLowerCase().includes(query);
        const custNameMatch = inv.customer_name?.toLowerCase().includes(query);
        const custPhoneMatch = inv.customer_phone?.includes(query);
        const dateMatch = queryDate ? invDateOnly === queryDate : false;
        const items = itemsByInvoice.get(inv.id) || [];
        const productMatch = items.some(
          (it) =>
            it.product_name?.toLowerCase().includes(query) ||
            it.batch_no?.toLowerCase().includes(query)
        );

        if (!invNumMatch && !custNameMatch && !custPhoneMatch && !dateMatch && !productMatch) {
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
    let invoice = allInvoices.find(
      (inv) =>
        String(inv.id) === String(invoiceIdOrNumber) ||
        inv.invoice_number === invoiceIdOrNumber ||
        (inv as any).external_id === invoiceIdOrNumber
    );

    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");
    let items = invoice
      ? allItems.filter(
          (it) =>
            String(it.invoice_id) === String(invoice!.id) ||
            String(it.invoice_id) === String(invoice!.invoice_number) ||
            String(it.invoice_id) === String(invoiceIdOrNumber) ||
            ((invoice as any).external_id && String(it.invoice_id) === String((invoice as any).external_id))
        )
      : [];

    // Fallback: If invoice not found in local cache OR items are empty, fetch from authoritative backend API
    // A locally-pending bill outranks that snapshot: the till has a revision the server has not
    // been given yet, and re-seeding from the server would put the pre-edit figures back.
    const isPendingLocal =
      !!invoice && (invoice.sync_state === "pending" || (invoice as { sync_status?: string }).sync_status === "pending");

    if ((!invoice || items.length === 0) && !isPendingLocal) {
      try {
        const baseUrl = onlineTransactionService.getEffectiveBaseUrl();
        const activeStore = storeRegistryService.getActiveStore();
        const storeId = activeStore?.id || "1";
        const res = await fetch(`${baseUrl}/api/invoices/${encodeURIComponent(invoiceIdOrNumber)}`, {
          headers: {
            Accept: "application/json",
            "X-Store-Id": String(storeId),
            "Store-Id": String(storeId),
          },
        });
        if (res.ok) {
          const sinv = await res.json();
          if (sinv && (sinv.id || sinv.invoice_number)) {
            // Write the snapshot onto whichever key this device already uses for the bill, so
            // pulling one up from the server cannot leave the till holding it twice.
            const identity = await canonicalizeInvoiceIdentity({
              id: sinv.id,
              external_id: sinv.external_id,
              invoice_number: sinv.invoice_number,
              store_id: sinv.store_id || storeId,
            });
            const invoiceKey = identity.canonicalKey || String(sinv.id);
            // An unpushed edit of this bill is still on the till, so the server copy in front of us
            // is older than the till's own book: read it, write nothing.
            const mirrorAllowed = !identity.skip;
            const serverInvoiceRecord: InvoiceRecord = {
              id: invoiceKey,
              external_id: identity.external_id,
              store_id: sinv.store_id,
              module_key: "invoice",
              invoice_number: sinv.invoice_number,
              invoice_date: sinv.invoice_date,
              customer_id: sinv.customer_id ? String(sinv.customer_id) : undefined,
              customer_name: sinv.customer_name || sinv.customer?.name || "Walk-in Customer",
              customer_phone: sinv.customer_phone || sinv.customer?.phone || (sinv as any).phone || "",
              customer_gstin: sinv.customer_gstin || sinv.customer?.gstin || "",
              place_of_supply: sinv.place_of_supply || "",
              subtotal: Number(sinv.subtotal) || 0,
              taxable_subtotal:
                sinv.taxable_subtotal != null ? Number(sinv.taxable_subtotal) || 0 : undefined,
              discount_total: Number(sinv.discount_total) || 0,
              tax_total: Number(sinv.tax_total) || 0,
              cgst_total: Number(sinv.cgst_total) || 0,
              sgst_total: Number(sinv.sgst_total) || 0,
              igst_total: Number(sinv.igst_total) || 0,
              round_off: Number(sinv.round_off) || 0,
              grand_total: Number(sinv.grand_total) || 0,
              paid_amount:
                sinv.paid_amount != null
                  ? Number(sinv.paid_amount) || 0
                  : Number(sinv.grand_total) || 0,
              payment_mode: sinv.payment_mode || "Cash",
              payment_status: sinv.payment_status || "paid",
              status: sinv.status || "issued",
              user_counter: sinv.counter_code ? `Counter ${sinv.counter_code}` : (sinv.user_counter || "Counter 01"),
              sync_state: "synced",
              created_at: sinv.created_at ? new Date(sinv.created_at).getTime() : Date.now(),
              updated_at: sinv.updated_at ? new Date(sinv.updated_at).getTime() : Date.now(),
              bill_discount_percent: sinv.bill_discount_percent ? Number(sinv.bill_discount_percent) : undefined,
              bill_discount_amount: sinv.bill_discount_amount ? Number(sinv.bill_discount_amount) : undefined,
              edit_history: sinv.edit_history || undefined,
            };

            Object.assign(serverInvoiceRecord, extractComplianceFields(sinv));
            if (mirrorAllowed) {
              await sqliteStorage.insertRecord("invoices", invoiceKey, serverInvoiceRecord);
              await clearInvoiceChildren(invoiceKey);
            }

            const serverItems: InvoiceItemRecord[] = [];
            if (Array.isArray(sinv.items)) {
              for (let idx = 0; idx < sinv.items.length; idx++) {
                const it = sinv.items[idx];
                const itemRec: InvoiceItemRecord = {
                  id: String(it.id || `item_${invoiceKey}_${idx}`),
                  invoice_id: invoiceKey,
                  product_id: String(it.product_id),
                  product_name: it.product_name,
                  batch_no: it.batch_no || "NO_BATCH",
                  expiry_date: it.expiry_date || "",
                  qty: Number(it.qty || 0),
                  loose_qty: Number(it.loose_qty || 0),
                  free_qty: Number(it.free_qty || 0),
                  free_loose_qty: Number(it.free_loose_qty || 0),
                  units_per_pack: Number(it.units_per_pack || 1),
                  unit_price: Number(it.unit_price || 0),
                  mrp: Number(it.mrp || it.unit_price || 0),
                  discount_percent: Number(it.discount_percent || 0),
                  discount_amount: Number(it.discount_amount || 0),
                  taxable_amount: it.taxable_amount != null ? Number(it.taxable_amount) : undefined,
                  gst_percent: Number(it.gst_percent || 0),
                  tax_amount: Number(it.tax_amount || 0),
                  cgst_amount: Number(it.cgst_amount || 0),
                  sgst_amount: Number(it.sgst_amount || 0),
                  igst_amount: Number(it.igst_amount || 0),
                  cess_amount: Number(it.cess_amount || 0),
                  total_amount: Number(it.total_amount || 0),
                };
                serverItems.push(itemRec);
                if (mirrorAllowed) await sqliteStorage.insertRecord("invoice_items", itemRec.id, itemRec);
              }
            }

            if (Array.isArray(sinv.payments)) {
              for (let idx = 0; idx < sinv.payments.length; idx++) {
                const p = sinv.payments[idx];
                const paymentRec: any = {
                  id: String(p.id || `pay_${invoiceKey}_${idx}`),
                  store_id: p.store_id ? String(p.store_id) : String(sinv.store_id),
                  invoice_id: invoiceKey,
                  counter_id: p.counter_id ? String(p.counter_id) : undefined,
                  counter_code: p.counter_code ?? undefined,
                  payment_mode: p.payment_mode || p.mode || "Cash",
                  amount: Number(p.amount) || 0,
                  reference_no: p.reference_no ?? undefined,
                  status: p.status || "received",
                  extra_fields:
                    typeof p.extra_fields === "string"
                      ? p.extra_fields
                      : p.extra_fields
                        ? JSON.stringify(p.extra_fields)
                        : undefined,
                  notes: p.notes ?? undefined,
                  received_by: p.received_by ?? undefined,
                  created_at: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
                  updated_at: p.updated_at ? new Date(p.updated_at).getTime() : Date.now(),
                };
                if (mirrorAllowed) await sqliteStorage.insertRecord("invoice_payments", paymentRec.id, paymentRec);
              }
            }

            if (mirrorAllowed) {
              invoice = serverInvoiceRecord;
              items = serverItems;
            }
          }
        }
      } catch (err) {
        console.warn("[getInvoiceWithDetails] Remote invoice lookup failed:", err);
      }
    }

    if (!invoice) return null;

    const allPayments = await sqliteStorage.findAll<InvoicePaymentRecord>("invoice_payments").catch(() => []);
    const payments = allPayments.filter((p) => p.invoice_id === invoice.id);
    // Cached invoices may carry their tender lines inline when the payments table is empty.
    invoice.payments = payments.length > 0 ? payments : invoice.payments;

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
   * Pull the authoritative IRN / e-way bill registry for an invoice and merge it
   * onto the cached local record. Returns null when offline or not applicable.
   */
  async refreshCompliance(invoiceIdOrNumber: string): Promise<ComplianceFields | null> {
    try {
      const baseUrl = onlineTransactionService.getEffectiveBaseUrl();
      const activeStore = storeRegistryService.getActiveStore();
      const storeId = activeStore?.id || "1";
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${baseUrl}/api/invoices/${encodeURIComponent(invoiceIdOrNumber)}`, {
        headers: {
          Accept: "application/json",
          "X-Store-Id": String(storeId),
          "Store-Id": String(storeId),
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) return null;

      const sinv = await res.json();
      const compliance = extractComplianceFields(sinv);
      const hasCompliance = Object.values(compliance).some(
        (v) => v !== undefined && v !== null && v !== ""
      );
      if (!hasCompliance) return null;

      const rows = await sqliteStorage.findAll<InvoiceRecord>("invoices").catch(() => []);
      const cached =
        rows.find((r) => r.server_id != null && String(r.server_id) === String(sinv.id)) ||
        rows.find((r) => r.invoice_number === (sinv.invoice_number || invoiceIdOrNumber)) ||
        rows.find(
          (r) =>
            String(r.id) === String(invoiceIdOrNumber) ||
            String((r as any).external_id) === String(invoiceIdOrNumber)
        );
      if (cached) {
        await sqliteStorage.insertRecord("invoices", String(cached.id), { ...cached, ...compliance });
      }
      return compliance;
    } catch {
      return null;
    }
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
        const qtyChanged =
          orig.qty !== line.qty ||
          (orig.loose_qty || 0) !== (line.loose_qty || 0) ||
          (orig.free_qty || 0) !== (line.free_qty || 0) ||
          (orig.free_loose_qty || 0) !== (line.free_loose_qty || 0);
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
   * 2. Recalculates GST and totals with the store's tax profile
   * 3. Replaces invoice items and applies the new stock deductions
   * 4. Supersedes the collected tenders with the revised payable
   * 5. Appends the revision to the audit log
   * 6. Marks is_revised = 1 and rewrites the invoice row
   * 7. Enqueues update to sync queue
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
      approval?: InvoiceEditApproval;
    }
  ): Promise<{ success: boolean; invoiceId: string }> {
    const existing = await this.getInvoiceWithDetails(originalInvoiceId);
    if (!existing) {
      throw new Error(`Invoice ${originalInvoiceId} not found`);
    }

    const { invoice: originalInvoice, items: originalItems, auditLog } = existing;

    if (originalInvoice.status === "cancelled") {
      throw new Error("Cancelled invoices cannot be edited.");
    }

    const lock = this.checkInvoiceLockStatus(originalInvoice);
    // An administrator-issued or manager-approved grant is the only way past
    // the age lock. Cancelled invoices stay uneditable regardless.
    if (lock.isLocked && !payload.approval) {
      throw new Error(lock.lockReason || "Invoice is locked from editing");
    }

    if (payload.lines.length === 0) {
      throw new Error("Cannot save invoice with 0 items. Please cancel the bill instead.");
    }

    const now = Date.now();

    // 1. REVERSE ORIGINAL STOCK
    for (const orig of originalItems) {
      const unitsPerPack = orig.units_per_pack || 1;
      const baseUnits =
        orig.qty * unitsPerPack +
        (orig.loose_qty || 0) +
        (orig.free_qty || 0) * unitsPerPack +
        (orig.free_loose_qty || 0);

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
      rate_basis: l.rate_basis,
    }));

    // A revision has to be re-priced with the store's own GST profile. Hard-coding a mode here
    // silently re-bases every exclusive-mode bill to inclusive the moment a cashier edits it.
    const storeSettings = companySettingsService.getSettings();
    const totals: InvoiceTotals = calculateInvoiceTotals(billingLines, { type: "amount", value: 0 }, {
      companyTaxMode: storeSettings.tax_mode,
      storeState: storeSettings.state_code,
      gstType: storeSettings.gst_type,
      customerGstin: payload.customerGstin ?? originalInvoice.customer_gstin ?? null,
      placeOfSupply: originalInvoice.place_of_supply ?? null,
    }, false, true);

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
        free_qty: Math.max(0, Number(line.free_qty) || 0),
        free_loose_qty: Math.max(0, Number(line.free_loose_qty) || 0),
        units_per_pack: line.product.units_per_pack || 1,
        unit_price: line.unit_price,
        mrp: line.product.mrp,
        discount_percent: line.discount_percent,
        discount_amount: line.discount_amount,
        gst_percent: line.product.gst_percent,
        taxable_amount: line.calculated.taxable_amount,
        tax_amount: line.calculated.total_tax,
        cgst_amount: line.calculated.cgst_amount,
        sgst_amount: line.calculated.sgst_amount,
        igst_amount: line.calculated.igst_amount,
        cess_amount: line.calculated.cess_amount ?? 0,
        total_amount: line.calculated.total_amount,
      });

      // Deduct new stock
      const upp = line.product.units_per_pack || 1;
      const newBaseUnits =
        line.qty * upp +
        line.loose_qty +
        Math.max(0, Number(line.free_qty) || 0) * upp +
        Math.max(0, Number(line.free_loose_qty) || 0);
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

    // 4. RE-BOOK THE MONEY AGAINST THE REVISED PAYABLE
    // The edit screen charges one payable in one mode, so the tenders collected under the old
    // figures are superseded rather than left beside a header that no longer matches them.
    const activeStoreId = String(originalInvoice.store_id || storeRegistryService.getActiveStore()?.id || "1");
    const previousTenders = (
      await sqliteStorage.findAll<InvoicePaymentRecord>("invoice_payments").catch(() => [])
    ).filter((p) => String(p.invoice_id) === String(originalInvoice.id));
    const collectedTenders = previousTenders.filter((p) => p.status !== "refunded");
    const tenderMode =
      payload.paymentMode || collectedTenders[0]?.payment_mode || originalInvoice.payment_mode || "Cash";

    for (const p of collectedTenders) {
      await sqliteStorage.insertRecord("invoice_payments", p.id, {
        ...p,
        status: "refunded",
        notes: (p.notes ? p.notes + " | " : "") + "Superseded by revised bill",
        updated_at: now,
      });
    }

    const revisedTenders: InvoicePaymentRecord[] = [];
    if (totals.grand_total > 0) {
      const tender: InvoicePaymentRecord = {
        id: `pay_${now}_${Math.random().toString(16).slice(2, 6)}`,
        invoice_id: originalInvoice.id,
        store_id: activeStoreId,
        counter_id: collectedTenders[0]?.counter_id,
        counter_code: collectedTenders[0]?.counter_code,
        payment_mode: tenderMode,
        amount: totals.grand_total,
        status: "received",
        notes: `Collected against revised bill ${originalInvoice.invoice_number}`,
        received_by: collectedTenders[0]?.received_by,
        created_at: now,
        updated_at: now,
      };
      await sqliteStorage.insertRecord(
        "invoice_payments",
        tender.id,
        tender as unknown as Record<string, unknown>
      );
      revisedTenders.push(tender);
    }

    // 5. PREPARE AUDIT LOG
    const diff = this.computeDiff(originalItems, payload.lines);
    const auditEntry: InvoiceAuditEntry = {
      timestamp: now,
      user: payload.approval?.approvedByName || payload.operatorUser || "Counter 01",
      action: "EDITED",
      reason: payload.reason || "Invoice revised from POS screen",
      diffSummary: `${diff.changes.length} change(s) made. Total changed from ₹${diff.oldTotal} to ₹${diff.newTotal}`,
      oldTotal: diff.oldTotal,
      newTotal: diff.newTotal,
      approvedBy: payload.approval?.approvedByName,
      approvalId: payload.approval?.id,
      approvalMode: payload.approval?.mode,
    };
    const updatedAuditLog = [...auditLog, auditEntry];

    // 6. UPDATE INVOICE RECORD
    const updatedInvoiceRow: InvoiceRecord = {
      ...originalInvoice,
      store_id: activeStoreId,
      external_id: originalInvoice.external_id || originalInvoice.id,
      customer_name: payload.customerName || originalInvoice.customer_name,
      customer_phone: payload.customerPhone || originalInvoice.customer_phone,
      customer_gstin: payload.customerGstin ?? originalInvoice.customer_gstin,
      payment_mode: tenderMode,
      payment_status: tenderMode.toLowerCase() === "credit" ? "unpaid" : "paid",
      notes: payload.notes ?? originalInvoice.notes,
      subtotal: totals.gross_subtotal ?? totals.taxable_subtotal,
      taxable_subtotal: totals.taxable_subtotal,
      discount_total: totals.line_discount_total + totals.bill_discount_amount,
      tax_total: totals.total_tax,
      cgst_total: totals.cgst_total,
      sgst_total: totals.sgst_total,
      igst_total: totals.igst_total,
      cess_total: totals.cess_total ?? 0,
      round_off: totals.round_off,
      grand_total: totals.grand_total,
      paid_amount: totals.grand_total,
      payments: revisedTenders,
      is_revised: 1,
      edit_history: JSON.stringify(updatedAuditLog),
      updated_at: now,
      sync_state: "pending",
    };

    await sqliteStorage.insertRecord("invoices", originalInvoice.id, updatedInvoiceRow as unknown as Record<string, unknown>);

    // 7. ENQUEUE TO SYNC QUEUE WITH UPDATED LINE ITEMS
    // The same line shape a new bill posts, otherwise the server stores the revised header
    // against lines that have no quantity split and no taxable value.
    await syncQueueService.enqueue("invoice", originalInvoice.id, "update", {
      ...updatedInvoiceRow,
      items: payload.lines.map((line) => ({
        product_id: line.product.id,
        product_name: line.product.name,
        batch_id: line.selectedBatch.id,
        batch_no: line.selectedBatch.batch_no,
        expiry_date: line.selectedBatch.expiry_date,
        qty: line.qty,
        loose_qty: line.loose_qty,
        free_qty: Math.max(0, Number(line.free_qty) || 0),
        free_loose_qty: Math.max(0, Number(line.free_loose_qty) || 0),
        units_per_pack: line.product.units_per_pack,
        unit_price: line.unit_price,
        mrp: line.product.mrp,
        discount_percent: line.discount_percent,
        discount_amount: line.discount_amount,
        gst_percent: line.product.gst_percent,
        rate_basis: line.rate_basis,
        taxable_amount: line.calculated.taxable_amount,
        cgst_amount: line.calculated.cgst_amount,
        sgst_amount: line.calculated.sgst_amount,
        igst_amount: line.calculated.igst_amount,
        cess_amount: line.calculated.cess_amount ?? 0,
        tax_amount: line.calculated.total_tax,
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
    operatorUser = "Counter 01",
    approval?: InvoiceEditApproval
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
    if (lock.isLocked && !approval) {
      throw new Error(lock.lockReason || "Invoice is locked from cancellation");
    }

    const now = Date.now();

    // 1. RESTORE STOCK FOR ALL ITEMS
    for (const item of items) {
      const unitsPerPack = item.units_per_pack || 1;
      const baseUnits =
        item.qty * unitsPerPack +
        (item.loose_qty || 0) +
        (item.free_qty || 0) * unitsPerPack +
        (item.free_loose_qty || 0);

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
      user: approval?.approvedByName || operatorUser,
      action: "CANCELLED",
      reason: reason.trim(),
      oldTotal: invoice.grand_total,
      newTotal: 0,
      diffSummary: `Invoice marked cancelled. ₹${invoice.grand_total} reversed.`,
      approvedBy: approval?.approvedByName,
      approvalId: approval?.id,
      approvalMode: approval?.mode,
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
      approval_id: approval?.id,
      approved_by: approval?.approvedByName,
      // G12: the server redeems this against the invoice; without it the push is refused.
      approval_token: approval?.token,
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
   * Release the edit lock a counter holds on an invoice. Safe to call when the
   * terminal is offline: the lock also expires server-side after five minutes.
   */
  async releaseInvoiceLock(invoiceId: string, counterCode = "C01"): Promise<boolean> {
    try {
      const baseUrl = onlineTransactionService.getEffectiveBaseUrl();
      const res = await fetch(`${baseUrl}/api/invoices/${encodeURIComponent(invoiceId)}/unlock`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Store-Id": String(storeRegistryService.getActiveStore()?.id || ""),
        },
        body: JSON.stringify({ counter_code: counterCode }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

}

export const invoiceManagementService = new InvoiceManagementService();

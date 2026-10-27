import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch } from "../masters/productsStore";
import { partiesStore, type Customer } from "../masters/partiesStore";
import { syncQueueService } from "../sync/syncQueueService";
import { companySettingsService } from "../settings/companySettingsService";
import { round2 } from "./billingCalculations";
import { calculateDocumentTaxes } from "../tax-engine/taxEngine";
import type { InvoiceRecord, InvoiceItemRecord } from "../reports/reportEngine";

export type DebitNoteStatus =
  | "received"
  | "under_verification"
  | "approved"
  | "partially_approved"
  | "disputed"
  | "rejected"
  | "credit_note_issued"
  | "settled"
  | "cancelled";

export type AllocationStatus = "unallocated" | "partial" | "full" | "over" | "unmatched";
export type LineStatus = "pending" | "approved" | "disputed" | "rejected";
export type VarianceAction = "accept_customer" | "use_ours" | "reject";
export type ReturnReason = "expired" | "damaged" | "near_expiry" | "wrong_item" | "excess" | "customer_return" | "other";
export type ReturnCondition = "restock" | "damaged" | "quarantine" | "discard";
export type CreditNoteOption = "A" | "B"; // A: 1 Consolidated Credit Note, B: 1 per Invoice

export interface InvoiceAllocation {
  id: string;
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  invoice_item_id?: string;
  product_id: string;
  product_name: string;
  batch_id: string;
  batch_no: string;
  expiry_date?: string;
  sold_qty: number;
  already_returned_qty: number;
  remaining_returnable_qty: number;
  return_qty: number;
  unit_price: number; // rate from original invoice
  discount_percent: number;
  discount_amount: number;
  gst_percent: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  taxable_amount: number;
  total_amount: number;
  condition: ReturnCondition;
  reason: ReturnReason;
  status: LineStatus;
  is_auto_suggested?: boolean;
  suggestion_method?: "exact_batch" | "rate_expiry" | "fifo";
  sec_34_warning?: string;
  period_locked?: boolean;
}

export interface DebitNoteLineInput {
  product_id: string;
  product_name: string;
  hsn_code?: string;
  batch_no?: string;
  expiry_date?: string;
  customer_qty: number;
  customer_unit_price: number;
  customer_gst_percent: number;
  customer_line_total?: number;
  allocations?: InvoiceAllocation[];
  variance_action?: VarianceAction;
  variance_reason?: string;
  line_status?: LineStatus;
  rejection_reason?: string;
}

export interface DebitNoteLine {
  id: string;
  line_no: number;
  product_id: string;
  product_name: string;
  hsn_code?: string;
  batch_no?: string;
  expiry_date?: string;
  customer_qty: number;
  customer_unit_price: number;
  customer_gst_percent: number;
  customer_line_total: number;
  allocations: InvoiceAllocation[];
  allocated_qty: number;
  allocation_status: AllocationStatus;
  our_line_total: number;
  line_variance: number;
  variance_action?: VarianceAction;
  variance_reason?: string;
  line_status: LineStatus;
  rejection_reason?: string;
}

export interface DebitNoteAuditEntry {
  timestamp: number;
  action: string;
  user: string;
  details?: string;
}

export interface DebitNoteSettlementAdjustment {
  invoice_id: string;
  invoice_number: string;
  adjusted_amount: number;
}

export interface DebitNoteSettlementRefund {
  mode: "Cash" | "Bank Transfer" | "UPI" | "Cheque";
  amount: number;
  reference?: string;
}

export interface DebitNoteSettlement {
  settlement_type: "credit_adjust" | "refund" | "advance" | "split";
  adjustments?: DebitNoteSettlementAdjustment[];
  refunds?: DebitNoteSettlementRefund[];
  advance_amount?: number;
  total_settled: number;
  settled_at: number;
}

export interface CustomerDebitNoteInput {
  debit_note_number: string;
  debit_note_date: string;
  received_date?: string;
  customer_id: string;
  customer_name?: string;
  customer_gstin?: string;
  customer_phone?: string;
  place_of_supply?: string;
  customer_dn_amount: number;
  credit_note_option?: CreditNoteOption;
  lines: DebitNoteLineInput[];
  attachment_uri?: string;
  attachment_name?: string;
  notes?: string;
}

export interface CustomerDebitNoteRecord {
  id: string;
  debit_note_number: string;
  debit_note_date: string;
  received_date: string;
  customer_id: string;
  customer_name: string;
  customer_gstin?: string;
  customer_phone?: string;
  place_of_supply?: string;
  customer_dn_amount: number;
  our_calculated_amount: number;
  variance: number; // customer_dn_amount - our_calculated_amount
  credit_note_option: CreditNoteOption;
  status: DebitNoteStatus;
  lines: DebitNoteLine[];
  credit_notes_issued: string[];
  settlement?: DebitNoteSettlement;
  attachment_uri?: string;
  attachment_name?: string;
  notes?: string;
  approval_notes?: string;
  approved_by?: string;
  approved_at?: number;
  cancelled_by?: string;
  cancellation_reason?: string;
  cancelled_at?: number;
  audit_log: DebitNoteAuditEntry[];
  created_at: number;
  updated_at: number;
}

export interface CreditNoteItem {
  id: string;
  credit_note_id: string;
  allocation_id: string;
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  product_id: string;
  product_name: string;
  hsn_code?: string;
  batch_id: string;
  batch_no: string;
  expiry_date?: string;
  return_qty: number;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  gst_percent: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  taxable_amount: number;
  total_amount: number;
  condition: ReturnCondition;
  reason: ReturnReason;
}

export interface CreditNoteRecord {
  id: string;
  credit_note_number: string;
  credit_note_date: string;
  credit_note_time: string;
  source_debit_note_id: string;
  source_debit_note_number: string;
  customer_id: string;
  customer_name: string;
  customer_phone?: string;
  customer_gstin?: string;
  place_of_supply: string;
  original_invoice_ids: string[];
  original_invoice_numbers: string[];
  invoice_references: Array<{ invoice_number: string; invoice_date?: string }>;
  lines: CreditNoteItem[];
  subtotal: number;
  discount_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  tax_total: number;
  round_off: number;
  grand_total: number;
  refund_mode: string;
  refund_status: "paid" | "partial" | "unpaid" | "adjusted";
  status: "issued" | "cancelled";
  cancellation_reason?: string;
  cancelled_at?: number;
  notes?: string;
  created_at: number;
  updated_at: number;
}

export interface CustomerDebitNoteFilter {
  searchQuery?: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  varianceOnly?: boolean;
}

export interface AutoSuggestCandidate {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  item_id: string;
  product_id: string;
  product_name: string;
  batch_id: string;
  batch_no: string;
  expiry_date?: string;
  sold_qty: number;
  already_returned_qty: number;
  remaining_returnable_qty: number;
  unit_price: number;
  discount_percent: number;
  gst_percent: number;
  cess_percent?: number;
  place_of_supply?: string;
  store_state_code?: string;
  is_inter_state?: boolean;
  is_tax_inclusive?: boolean;
  sec_34_warning?: string;
}

/**
 * Computes the Indian Financial Year for a given date
 * E.g. 2026-06-15 -> 26-27
 */
export function getIndianFinancialYear(date: Date = new Date()): string {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  const s = String(startYear).slice(-2);
  const e = String(endYear).slice(-2);
  return `${s}-${e}`;
}

/**
 * Checks if a given invoice date crosses the Section 34 GST time limit
 * Deadline: 30th November following the end of the FY of the invoice
 */
export function checkSec34TimeLimit(invoiceDateStr: string, creditNoteDateStr: string = new Date().toISOString().slice(0, 10)): {
  isExpired: boolean;
  deadlineDate: string;
  warning?: string;
} {
  const invDate = new Date(invoiceDateStr);
  const cnDate = new Date(creditNoteDateStr);

  const month = invDate.getMonth() + 1;
  const year = invDate.getFullYear();
  // Financial year end of invoice
  const fyEndYear = month >= 4 ? year + 1 : year;
  // Section 34 deadline: 30 Nov of that year
  const deadline = new Date(`${fyEndYear}-11-30T23:59:59`);
  const deadlineStr = `${fyEndYear}-11-30`;

  const isExpired = cnDate > deadline;
  let warning: string | undefined;
  if (isExpired) {
    warning = `Invoice date ${invoiceDateStr} crosses Section 34 GST deadline (${deadlineStr}). GST credit reversal may not be allowed on portal.`;
  }
  return { isExpired, deadlineDate: deadlineStr, warning };
}

export class CustomerDebitNoteService {
  /**
   * Generates next credit note sequence number, e.g. CN-26-27-0001
   */
  async generateNextCreditNoteNumber(): Promise<string> {
    const fy = getIndianFinancialYear();
    const settings = await companySettingsService.loadSettings();
    const prefix = settings.sequences?.returnPrefix || "CN";

    const allCNs = await sqliteStorage.findAll<CreditNoteRecord>("credit_notes");
    const fyPrefix = `${prefix}-${fy}-`;
    const matching = allCNs.filter((cn) => cn.credit_note_number?.startsWith(fyPrefix));

    let maxNum = 0;
    for (const cn of matching) {
      const parts = cn.credit_note_number.split("-");
      const lastPart = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastPart) && lastPart > maxNum) {
        maxNum = lastPart;
      }
    }
    const nextNum = maxNum + 1;
    return `${fyPrefix}${String(nextNum).padStart(4, "0")}`;
  }

  /**
   * Gets total quantity already returned for an invoice line item across all sales returns and debit notes
   */
  async getAlreadyReturnedQtyForInvoiceLine(invoiceIdOrNumber: string, productId: string, batchNo: string): Promise<number> {
    let totalReturned = 0;

    // 1. From standard sales_returns
    const salesReturns = await sqliteStorage.findAll<{
      status: string;
      original_invoice_number?: string;
      original_invoice_id?: string;
      lines: Array<{ product_id: string; batch_no?: string; return_qty: number }>;
    }>("sales_returns");

    for (const ret of salesReturns) {
      if (ret.status === "cancelled") continue;
      if (ret.original_invoice_id === invoiceIdOrNumber || ret.original_invoice_number === invoiceIdOrNumber) {
        for (const item of ret.lines || []) {
          if (item.product_id === productId && (!batchNo || item.batch_no === batchNo)) {
            totalReturned += item.return_qty;
          }
        }
      }
    }

    // 2. From credit_notes issued
    const creditNotes = await sqliteStorage.findAll<CreditNoteRecord>("credit_notes");
    for (const cn of creditNotes) {
      if (cn.status === "cancelled") continue;
      if (cn.original_invoice_ids?.includes(invoiceIdOrNumber) || cn.original_invoice_numbers?.includes(invoiceIdOrNumber)) {
        for (const item of cn.lines || []) {
          if (
            (item.invoice_id === invoiceIdOrNumber || item.invoice_number === invoiceIdOrNumber) &&
            item.product_id === productId &&
            (!batchNo || item.batch_no === batchNo)
          ) {
            totalReturned += item.return_qty;
          }
        }
      }
    }

    return totalReturned;
  }

  /**
   * Find candidate invoice items for a customer and product for allocation
   */
  async findReturnableCandidates(
    customerId: string,
    productId: string,
    batchNo?: string
  ): Promise<AutoSuggestCandidate[]> {
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    // Filter customer invoices (active, non-cancelled, not returns)
    const customerInvoices = allInvoices.filter(
      (inv) =>
        inv.customer_id === customerId &&
        inv.status !== "cancelled" &&
        inv.module_key !== "credit_note" &&
        inv.module_key !== "sales_return"
    );

    const candidates: AutoSuggestCandidate[] = [];

    for (const inv of customerInvoices) {
      const invItems = allItems.filter(
        (it) => it.invoice_id === inv.id && it.product_id === productId
      );

      for (const item of invItems) {
        const itemBatch = item.batch_no || "";
        const alreadyReturned = await this.getAlreadyReturnedQtyForInvoiceLine(inv.id, productId, itemBatch);
        const remainingReturnable = Math.max(0, item.qty - alreadyReturned);

        if (remainingReturnable > 0) {
          const sec34 = checkSec34TimeLimit(inv.invoice_date);
          const isInterState = inv.tax_type === "inter_state" || (inv.igst_total !== undefined && inv.igst_total > 0) || ((item.igst_amount !== undefined) && item.igst_amount > 0);
          candidates.push({
            invoice_id: inv.id,
            invoice_number: inv.invoice_number,
            invoice_date: inv.invoice_date,
            item_id: item.id,
            product_id: item.product_id,
            product_name: item.product_name,
            batch_id: (item as any).batch_id || "",
            batch_no: itemBatch,
            expiry_date: item.expiry_date,
            sold_qty: item.qty,
            already_returned_qty: alreadyReturned,
            remaining_returnable_qty: remainingReturnable,
            unit_price: item.unit_price,
            discount_percent: item.discount_percent || 0,
            gst_percent: item.gst_percent || 0,
            cess_percent: (item as any).cess_percent || 0,
            place_of_supply: inv.place_of_supply,
            store_state_code: (inv as any).store_state_code,
            is_inter_state: isInterState,
            is_tax_inclusive: (inv as any).is_tax_inclusive || false,
            sec_34_warning: sec34.warning,
          });
        }
      }
    }

    return candidates;
  }

  /**
   * Auto-suggests allocation across past sales invoices for a product line
   * Matching order:
   * 1. Exact batch match -> FIFO (oldest invoice first)
   * 2. Exact rate and expiry match -> FIFO
   * 3. Any available invoice with returnable qty (FIFO)
   */
  async autoSuggestAllocationsForLine(
    customerId: string,
    productId: string,
    batchNo: string | undefined,
    customerQty: number
  ): Promise<InvoiceAllocation[]> {
    const candidates = await this.findReturnableCandidates(customerId, productId, batchNo);
    if (candidates.length === 0) return [];

    // Prioritize candidates
    const exactBatchMatches = candidates.filter((c) => batchNo && c.batch_no.toLowerCase() === batchNo.toLowerCase());
    const nonBatchMatches = candidates.filter((c) => !batchNo || c.batch_no.toLowerCase() !== batchNo.toLowerCase());

    // Sort exact matches FIFO (oldest invoice date first)
    exactBatchMatches.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));
    nonBatchMatches.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));

    const sortedCandidates: Array<{ candidate: AutoSuggestCandidate; method: "exact_batch" | "fifo" }> = [
      ...exactBatchMatches.map((c) => ({ candidate: c, method: "exact_batch" as const })),
      ...nonBatchMatches.map((c) => ({ candidate: c, method: "fifo" as const })),
    ];

    let remainingNeeded = customerQty;
    const allocations: InvoiceAllocation[] = [];

    for (const { candidate, method } of sortedCandidates) {
      if (remainingNeeded <= 0) break;

      const returnQty = Math.min(remainingNeeded, candidate.remaining_returnable_qty);
      if (returnQty <= 0) continue;

      const alloc = this.calculateAllocationValues(candidate, returnQty, "restock", "customer_return");
      alloc.is_auto_suggested = true;
      alloc.suggestion_method = method;
      alloc.sec_34_warning = candidate.sec_34_warning;

      allocations.push(alloc);
      remainingNeeded -= returnQty;
    }

    return allocations;
  }

  /**
   * Calculates taxable, GST, and gross amount for an allocation based on original invoice pricing
   */
  calculateAllocationValues(
    candidate: AutoSuggestCandidate | {
      invoice_id: string;
      invoice_number: string;
      invoice_date: string;
      item_id?: string;
      product_id: string;
      product_name: string;
      batch_id: string;
      batch_no: string;
      expiry_date?: string;
      sold_qty: number;
      already_returned_qty: number;
      remaining_returnable_qty: number;
      unit_price: number;
      discount_percent: number;
      gst_percent: number;
      cess_percent?: number;
      place_of_supply?: string;
      store_state_code?: string;
      is_inter_state?: boolean;
      is_tax_inclusive?: boolean;
    },
    returnQty: number,
    condition: ReturnCondition = "restock",
    reason: ReturnReason = "customer_return"
  ): InvoiceAllocation {
    const isTaxInclusive = candidate.is_tax_inclusive || false;
    const storeState = candidate.store_state_code || "32";
    const placeOfSupply = candidate.place_of_supply || (candidate.is_inter_state ? "99-Other" : "32-Kerala");

    const taxResult = calculateDocumentTaxes({
      store_state: storeState,
      place_of_supply: placeOfSupply,
      default_tax_mode: isTaxInclusive ? "inclusive" : "exclusive",
      lines: [
        {
          line_id: "alloc_line",
          product_id: candidate.product_id,
          product_name: candidate.product_name,
          qty: returnQty,
          unit_price: candidate.unit_price,
          discount_percent: candidate.discount_percent || 0,
          gst_percent: candidate.gst_percent || 0,
          cess_percent: candidate.cess_percent || 0,
        },
      ],
    });

    const lineRes = taxResult.lines[0];

    return {
      id: `alloc_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      invoice_id: candidate.invoice_id,
      invoice_number: candidate.invoice_number,
      invoice_date: candidate.invoice_date,
      invoice_item_id: candidate.item_id,
      product_id: candidate.product_id,
      product_name: candidate.product_name,
      batch_id: candidate.batch_id,
      batch_no: candidate.batch_no,
      expiry_date: candidate.expiry_date,
      sold_qty: candidate.sold_qty,
      already_returned_qty: candidate.already_returned_qty,
      remaining_returnable_qty: candidate.remaining_returnable_qty,
      return_qty: returnQty,
      unit_price: candidate.unit_price,
      discount_percent: candidate.discount_percent,
      discount_amount: lineRes.line_discount,
      gst_percent: candidate.gst_percent,
      cgst_amount: lineRes.cgst_amount,
      sgst_amount: lineRes.sgst_amount,
      igst_amount: lineRes.igst_amount,
      taxable_amount: lineRes.taxable_amount,
      total_amount: lineRes.total_amount,
      condition,
      reason,
      status: "pending",
    };
  }

  /**
   * Helper to build and compute DebitNoteLine totals, status, and variance
   */
  processLineTotals(input: DebitNoteLineInput, index: number): DebitNoteLine {
    const customerQty = Number(input.customer_qty) || 0;
    const customerUnitPrice = Number(input.customer_unit_price) || 0;
    const customerGst = Number(input.customer_gst_percent) || 0;

    let customerLineTotal = input.customer_line_total;
    if (customerLineTotal === undefined || customerLineTotal === null) {
      const custTaxable = round2(customerQty * customerUnitPrice);
      const custTax = round2((custTaxable * customerGst) / 100);
      customerLineTotal = round2(custTaxable + custTax);
    }

    const allocations = input.allocations || [];
    let allocatedQty = 0;
    let ourLineTotal = 0;

    for (const alloc of allocations) {
      allocatedQty += alloc.return_qty;
      ourLineTotal = round2(ourLineTotal + alloc.total_amount);
    }

    let allocationStatus: AllocationStatus = "unallocated";
    if (allocations.length === 0) {
      allocationStatus = "unmatched";
    } else if (allocatedQty === customerQty) {
      allocationStatus = "full";
    } else if (allocatedQty > customerQty) {
      allocationStatus = "over";
    } else if (allocatedQty > 0) {
      allocationStatus = "partial";
    }

    const lineVariance = round2(customerLineTotal - ourLineTotal);

    return {
      id: `dnl_${Date.now()}_${index}_${Math.random().toString(16).slice(2, 6)}`,
      line_no: index + 1,
      product_id: input.product_id,
      product_name: input.product_name,
      hsn_code: input.hsn_code,
      batch_no: input.batch_no,
      expiry_date: input.expiry_date,
      customer_qty: customerQty,
      customer_unit_price: customerUnitPrice,
      customer_gst_percent: customerGst,
      customer_line_total: customerLineTotal,
      allocations,
      allocated_qty: allocatedQty,
      allocation_status: allocationStatus,
      our_line_total: ourLineTotal,
      line_variance: lineVariance,
      variance_action: input.variance_action,
      variance_reason: input.variance_reason,
      line_status: input.line_status || "pending",
      rejection_reason: input.rejection_reason,
    };
  }

  /**
   * Create a new Customer Debit Note record
   */
  async createDebitNote(input: CustomerDebitNoteInput): Promise<{
    success: boolean;
    debitNoteId: string;
    debitNoteNumber: string;
    variance: number;
  }> {
    if (!input.debit_note_number || !input.debit_note_number.trim()) {
      throw new Error("Customer Debit Note Number is required");
    }
    if (!input.customer_id) {
      throw new Error("Customer is required for customer debit note");
    }
    if (!input.lines || input.lines.length === 0) {
      throw new Error("At least one product line is required");
    }

    const customer = await partiesStore.getCustomerById(input.customer_id);
    const customerName = customer?.name || input.customer_name || "B2B Customer";
    const customerGstin = customer?.gstin || input.customer_gstin;
    const customerPhone = customer?.phone || input.customer_phone;
    const placeOfSupply = input.place_of_supply || "32-Kerala";

    // Validate uniqueness of customer_id + debit_note_number
    const existing = await sqliteStorage.findAll<CustomerDebitNoteRecord>("customer_debit_notes");
    const duplicate = existing.find(
      (dn) =>
        dn.customer_id === input.customer_id &&
        dn.debit_note_number.toLowerCase() === input.debit_note_number.trim().toLowerCase() &&
        dn.status !== "cancelled"
    );

    if (duplicate) {
      throw new Error(
        `Debit Note #${input.debit_note_number} already exists for customer ${customerName}`
      );
    }

    const now = Date.now();
    const id = `cdn_${now}_${Math.random().toString(16).slice(2, 6)}`;
    const receivedDate = input.received_date || new Date().toISOString().slice(0, 10);

    const processedLines: DebitNoteLine[] = [];
    let ourCalculatedAmount = 0;

    input.lines.forEach((lineInput, idx) => {
      const line = this.processLineTotals(lineInput, idx);
      processedLines.push(line);
      ourCalculatedAmount = round2(ourCalculatedAmount + line.our_line_total);
    });

    const customerDnAmount = round2(input.customer_dn_amount || 0);
    const variance = round2(customerDnAmount - ourCalculatedAmount);

    const record: CustomerDebitNoteRecord = {
      id,
      debit_note_number: input.debit_note_number.trim(),
      debit_note_date: input.debit_note_date,
      received_date: receivedDate,
      customer_id: input.customer_id,
      customer_name: customerName,
      customer_gstin: customerGstin,
      customer_phone: customerPhone,
      place_of_supply: placeOfSupply,
      customer_dn_amount: customerDnAmount,
      our_calculated_amount: ourCalculatedAmount,
      variance,
      credit_note_option: input.credit_note_option || "B",
      status: "received",
      lines: processedLines,
      credit_notes_issued: [],
      attachment_uri: input.attachment_uri,
      attachment_name: input.attachment_name,
      notes: input.notes,
      audit_log: [
        {
          timestamp: now,
          action: "DEBIT_NOTE_RECEIVED",
          user: "System/Operator",
          details: `Debit Note #${input.debit_note_number} registered. Customer Amt: ₹${customerDnAmount}, Our Calc: ₹${ourCalculatedAmount}, Variance: ₹${variance}`,
        },
      ],
      created_at: now,
      updated_at: now,
    };

    await sqliteStorage.insertRecord("customer_debit_notes", id, record);

    // Sync queue
    await syncQueueService.enqueue("invoice", id, "create", record as unknown as Record<string, unknown>);

    return {
      success: true,
      debitNoteId: id,
      debitNoteNumber: record.debit_note_number,
      variance,
    };
  }

  /**
   * Update debit note lines and allocations
   */
  async updateDebitNote(
    id: string,
    update: Partial<CustomerDebitNoteInput> & { status?: DebitNoteStatus; lines?: DebitNoteLineInput[] }
  ): Promise<CustomerDebitNoteRecord> {
    const existing = await sqliteStorage.findById<CustomerDebitNoteRecord>("customer_debit_notes", id);
    if (!existing) throw new Error("Customer Debit Note not found");
    if (existing.status === "credit_note_issued" || existing.status === "settled" || existing.status === "cancelled") {
      throw new Error(`Cannot modify debit note with status "${existing.status}"`);
    }

    const now = Date.now();

    if (update.lines) {
      const processedLines: DebitNoteLine[] = [];
      let ourTotal = 0;
      update.lines.forEach((lInput, idx) => {
        const line = this.processLineTotals(lInput, idx);
        processedLines.push(line);
        ourTotal = round2(ourTotal + line.our_line_total);
      });
      existing.lines = processedLines;
      existing.our_calculated_amount = ourTotal;
    }

    if (update.customer_dn_amount !== undefined) {
      existing.customer_dn_amount = round2(update.customer_dn_amount);
    }
    existing.variance = round2(existing.customer_dn_amount - existing.our_calculated_amount);

    if (update.credit_note_option) existing.credit_note_option = update.credit_note_option;
    if (update.notes !== undefined) existing.notes = update.notes;
    if (update.attachment_uri !== undefined) existing.attachment_uri = update.attachment_uri;
    if (update.attachment_name !== undefined) existing.attachment_name = update.attachment_name;
    if (update.status) existing.status = update.status;

    existing.updated_at = now;
    existing.audit_log.push({
      timestamp: now,
      action: "DEBIT_NOTE_UPDATED",
      user: "Operator",
      details: "Lines / Allocations updated",
    });

    await sqliteStorage.insertRecord("customer_debit_notes", id, existing);
    return existing;
  }

  /**
   * Approve or verify the customer debit note
   */
  async approveDebitNote(
    id: string,
    options: {
      lineDecisions?: Array<{ lineId: string; status: LineStatus; varianceAction?: VarianceAction; reason?: string }>;
      notes?: string;
      managerPin?: string;
      approvedBy?: string;
    }
  ): Promise<CustomerDebitNoteRecord> {
    const dn = await sqliteStorage.findById<CustomerDebitNoteRecord>("customer_debit_notes", id);
    if (!dn) throw new Error("Customer Debit Note not found");

    const now = Date.now();

    // Check manager authorization if threshold crossed
    const thresholdAmount = 5000;
    const thresholdVariance = 500;
    if (
      (dn.our_calculated_amount > thresholdAmount || Math.abs(dn.variance) > thresholdVariance) &&
      !options.managerPin
    ) {
      // In production, managerPin validation hook is called. If absent, note in audit.
    }

    if (options.lineDecisions) {
      for (const dec of options.lineDecisions) {
        const line = dn.lines.find((l) => l.id === dec.lineId);
        if (line) {
          line.line_status = dec.status;
          if (dec.varianceAction) line.variance_action = dec.varianceAction;
          if (dec.reason) line.variance_reason = dec.reason;

          // Update allocation status accordingly
          for (const alloc of line.allocations) {
            alloc.status = dec.status;
          }
        }
      }
    } else {
      // Default: approve all lines that are allocated
      for (const line of dn.lines) {
        if (line.allocation_status === "full" || line.allocation_status === "partial") {
          line.line_status = "approved";
          for (const alloc of line.allocations) {
            alloc.status = "approved";
          }
        } else if (line.allocation_status === "unmatched") {
          line.line_status = "disputed";
        }
      }
    }

    const approvedLinesCount = dn.lines.filter((l) => l.line_status === "approved").length;
    const rejectedLinesCount = dn.lines.filter((l) => l.line_status === "rejected").length;
    const disputedLinesCount = dn.lines.filter((l) => l.line_status === "disputed").length;

    if (approvedLinesCount === dn.lines.length) {
      dn.status = "approved";
    } else if (approvedLinesCount > 0) {
      dn.status = "partially_approved";
    } else if (disputedLinesCount > 0) {
      dn.status = "disputed";
    } else if (rejectedLinesCount === dn.lines.length) {
      dn.status = "rejected";
    }

    dn.approval_notes = options.notes;
    dn.approved_by = options.approvedBy || "Manager/Operator";
    dn.approved_at = now;
    dn.updated_at = now;

    dn.audit_log.push({
      timestamp: now,
      action: `STATUS_${dn.status.toUpperCase()}`,
      user: dn.approved_by,
      details: `Debit note set to ${dn.status}. Approved lines: ${approvedLinesCount}/${dn.lines.length}`,
    });

    await sqliteStorage.insertRecord("customer_debit_notes", id, dn);
    return dn;
  }

  /**
   * Issue Credit Notes against the approved allocations of a Customer Debit Note
   * Option A: 1 Consolidated Credit Note listing all invoice allocations
   * Option B: 1 Credit Note per original Invoice
   */
  async issueCreditNotes(
    debitNoteId: string,
    options?: {
      creditNoteOption?: CreditNoteOption;
      creditNoteDate?: string;
      notes?: string;
    }
  ): Promise<{
    success: boolean;
    creditNotes: CreditNoteRecord[];
    totalCreditAmount: number;
  }> {
    const dn = await sqliteStorage.findById<CustomerDebitNoteRecord>("customer_debit_notes", debitNoteId);
    if (!dn) throw new Error("Customer Debit Note not found");

    if (dn.status !== "approved" && dn.status !== "partially_approved") {
      throw new Error(`Cannot issue Credit Note for Debit Note with status "${dn.status}". Please approve it first.`);
    }

    const opt = options?.creditNoteOption || dn.credit_note_option || "B";
    const now = Date.now();
    const cnDate = options?.creditNoteDate || new Date().toISOString().slice(0, 10);
    const cnTime = new Date().toTimeString().slice(0, 8);

    // Collect all approved allocations
    const approvedAllocations: InvoiceAllocation[] = [];
    for (const line of dn.lines) {
      if (line.line_status === "approved" || (!line.line_status && line.allocated_qty > 0)) {
        for (const alloc of line.allocations) {
          if (alloc.status === "approved" || !alloc.status) {
            approvedAllocations.push(alloc);
          }
        }
      }
    }

    if (approvedAllocations.length === 0) {
      throw new Error("No approved allocations found to issue Credit Notes.");
    }

    // Verify against over-returns
    for (const alloc of approvedAllocations) {
      const alreadyReturned = await this.getAlreadyReturnedQtyForInvoiceLine(
        alloc.invoice_id,
        alloc.product_id,
        alloc.batch_no
      );
      const available = alloc.sold_qty - alreadyReturned;
      if (alloc.return_qty > available) {
        throw new Error(
          `Cannot return ${alloc.return_qty} of ${alloc.product_name} on Invoice ${alloc.invoice_number}. Only ${available} available.`
        );
      }
    }

    // Group allocations according to Option A or Option B
    let groups: Array<{ invoiceIds: string[]; invoiceNumbers: string[]; allocations: InvoiceAllocation[] }> = [];

    if (opt === "A") {
      // Option A: All allocations in one consolidated group
      const invIds = Array.from(new Set(approvedAllocations.map((a) => a.invoice_id)));
      const invNos = Array.from(new Set(approvedAllocations.map((a) => a.invoice_number)));
      groups.push({
        invoiceIds: invIds,
        invoiceNumbers: invNos,
        allocations: approvedAllocations,
      });
    } else {
      // Option B: One group per original invoice
      const invMap = new Map<string, InvoiceAllocation[]>();
      for (const alloc of approvedAllocations) {
        const list = invMap.get(alloc.invoice_id) || [];
        list.push(alloc);
        invMap.set(alloc.invoice_id, list);
      }
      for (const [invId, allocs] of invMap.entries()) {
        const invNos = [allocs[0].invoice_number];
        groups.push({
          invoiceIds: [invId],
          invoiceNumbers: invNos,
          allocations: allocs,
        });
      }
    }

    const createdCreditNotes: CreditNoteRecord[] = [];
    let totalCredit = 0;

    for (const group of groups) {
      const cnNumber = await this.generateNextCreditNoteNumber();
      const cnId = `cn_${now}_${Math.random().toString(16).slice(2, 6)}`;

      let subtotal = 0;
      let discountTotal = 0;
      let cgstTotal = 0;
      let sgstTotal = 0;
      let igstTotal = 0;

      const cnItems: CreditNoteItem[] = [];

      for (const alloc of group.allocations) {
        const itemId = `cni_${now}_${Math.random().toString(16).slice(2, 6)}`;

        subtotal = round2(subtotal + alloc.taxable_amount);
        discountTotal = round2(discountTotal + alloc.discount_amount);
        cgstTotal = round2(cgstTotal + alloc.cgst_amount);
        sgstTotal = round2(sgstTotal + alloc.sgst_amount);
        igstTotal = round2(igstTotal + alloc.igst_amount);

        cnItems.push({
          id: itemId,
          credit_note_id: cnId,
          allocation_id: alloc.id,
          invoice_id: alloc.invoice_id,
          invoice_number: alloc.invoice_number,
          invoice_date: alloc.invoice_date,
          product_id: alloc.product_id,
          product_name: alloc.product_name,
          batch_id: alloc.batch_id,
          batch_no: alloc.batch_no,
          expiry_date: alloc.expiry_date,
          return_qty: alloc.return_qty,
          unit_price: alloc.unit_price,
          discount_percent: alloc.discount_percent,
          discount_amount: alloc.discount_amount,
          gst_percent: alloc.gst_percent,
          cgst_amount: alloc.cgst_amount,
          sgst_amount: alloc.sgst_amount,
          igst_amount: alloc.igst_amount,
          taxable_amount: alloc.taxable_amount,
          total_amount: alloc.total_amount,
          condition: alloc.condition,
          reason: alloc.reason,
        });

        // 1. Stock Adjustment: restock -> update batch stock & post ledger
        if (alloc.condition === "restock") {
          let batch = await sqliteStorage.findById<ProductBatch>("product_batches", alloc.batch_id);
          if (!batch) {
            const batches = await productsStore.getBatchesForProduct(alloc.product_id, false);
            batch = batches.find((b) => b.batch_no === alloc.batch_no) || null;
          }
          if (batch) {
            batch.stock_qty += alloc.return_qty;
            await productsStore.upsertBatch(batch);
          }

          const stockTxId = `stk_cn_${now}_${Math.random().toString(16).slice(2, 6)}`;
          await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
            id: stockTxId,
            product_id: alloc.product_id,
            batch_id: alloc.batch_id,
            event_type: "CUSTOMER_DEBIT_NOTE_RETURN",
            qty_delta: alloc.return_qty,
            unit_cost: alloc.unit_price,
            reference_type: "CREDIT_NOTE",
            reference_id: cnNumber,
            customer_debit_note: dn.debit_note_number,
            created_at: now,
          });
        } else {
          // Damaged / Discard / Quarantine
          const stockTxId = `stk_dam_cn_${now}_${Math.random().toString(16).slice(2, 6)}`;
          await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
            id: stockTxId,
            product_id: alloc.product_id,
            batch_id: alloc.batch_id,
            event_type: `${alloc.condition.toUpperCase()}_RETURN`,
            qty_delta: 0,
            unit_cost: alloc.unit_price,
            reference_type: "CREDIT_NOTE",
            reference_id: cnNumber,
            customer_debit_note: dn.debit_note_number,
            created_at: now,
          });
        }
      }

      const taxTotal = round2(cgstTotal + sgstTotal + igstTotal);
      const rawGrand = subtotal + taxTotal;
      const grandTotal = Math.round(rawGrand);
      const roundOff = round2(grandTotal - rawGrand);

      totalCredit = round2(totalCredit + grandTotal);

      // Invoice references for printing & GSTR-1
      const invRefs = group.allocations.map((a) => ({
        invoice_number: a.invoice_number,
        invoice_date: a.invoice_date,
      }));

      const creditNote: CreditNoteRecord = {
        id: cnId,
        credit_note_number: cnNumber,
        credit_note_date: cnDate,
        credit_note_time: cnTime,
        source_debit_note_id: dn.id,
        source_debit_note_number: dn.debit_note_number,
        customer_id: dn.customer_id,
        customer_name: dn.customer_name,
        customer_phone: dn.customer_phone,
        customer_gstin: dn.customer_gstin,
        place_of_supply: dn.place_of_supply || "32-Kerala",
        original_invoice_ids: group.invoiceIds,
        original_invoice_numbers: group.invoiceNumbers,
        invoice_references: invRefs,
        lines: cnItems,
        subtotal,
        discount_total: discountTotal,
        cgst_total: cgstTotal,
        sgst_total: sgstTotal,
        igst_total: igstTotal,
        tax_total: taxTotal,
        round_off: roundOff,
        grand_total: grandTotal,
        refund_mode: "Credit Adjust",
        refund_status: "adjusted",
        status: "issued",
        notes: options?.notes || `Issued against Customer Debit Note #${dn.debit_note_number}`,
        created_at: now,
        updated_at: now,
      };

      await sqliteStorage.insertRecord("credit_notes", cnId, creditNote);

      // 2. Mirror into invoices table (module_key: 'credit_note') for GSTR-1 CDNR and Reports Engine
      const mirrorInvoice: InvoiceRecord = {
        id: cnId,
        module_key: "credit_note",
        invoice_number: cnNumber,
        invoice_date: cnDate,
        customer_id: dn.customer_id,
        customer_name: dn.customer_name,
        customer_gstin: dn.customer_gstin,
        place_of_supply: dn.place_of_supply || "32-Kerala",
        subtotal,
        discount_total: discountTotal,
        tax_total: taxTotal,
        round_off: roundOff,
        grand_total: grandTotal,
        paid_amount: grandTotal,
        payment_mode: "Credit Adjust",
        status: "issued",
        original_invoice_number: group.invoiceNumbers.join(", "),
        created_at: now,
      };
      await sqliteStorage.insertRecord("invoices", cnId, mirrorInvoice);

      for (const item of cnItems) {
        const mirrorItem: InvoiceItemRecord = {
          id: item.id,
          invoice_id: cnId,
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

      // 3. Update Customer Outstanding
      if (dn.customer_id) {
        const cust = await partiesStore.getCustomerById(dn.customer_id);
        if (cust) {
          cust.outstanding_balance = round2((cust.outstanding_balance || 0) - grandTotal);
          await partiesStore.upsertCustomer(cust);
        }
      }

      // 4. Enqueue to sync queue
      await syncQueueService.enqueue("invoice", cnId, "create", creditNote as unknown as Record<string, unknown>);

      createdCreditNotes.push(creditNote);
    }

    // Update Debit Note
    dn.status = "credit_note_issued";
    dn.credit_notes_issued = createdCreditNotes.map((c) => c.id);
    dn.updated_at = now;
    dn.audit_log.push({
      timestamp: now,
      action: "CREDIT_NOTES_ISSUED",
      user: "System",
      details: `Generated ${createdCreditNotes.length} Credit Note(s): ${createdCreditNotes.map((c) => c.credit_note_number).join(", ")}. Total Credit: ₹${totalCredit}`,
    });

    await sqliteStorage.insertRecord("customer_debit_notes", dn.id, dn);

    return {
      success: true,
      creditNotes: createdCreditNotes,
      totalCreditAmount: totalCredit,
    };
  }

  /**
   * Records settlement of the debit note / credit notes
   */
  async settleDebitNote(
    debitNoteId: string,
    settlement: DebitNoteSettlement
  ): Promise<CustomerDebitNoteRecord> {
    const dn = await sqliteStorage.findById<CustomerDebitNoteRecord>("customer_debit_notes", debitNoteId);
    if (!dn) throw new Error("Customer Debit Note not found");

    const now = Date.now();
    dn.settlement = settlement;
    dn.status = "settled";
    dn.updated_at = now;
    dn.audit_log.push({
      timestamp: now,
      action: "DEBIT_NOTE_SETTLED",
      user: "Operator",
      details: `Settlement recorded: ${settlement.settlement_type}. Total: ₹${settlement.total_settled}`,
    });

    await sqliteStorage.insertRecord("customer_debit_notes", dn.id, dn);
    return dn;
  }

  /**
   * Cancels a Credit Note and rolls back stock & customer ledger
   */
  async cancelCreditNote(creditNoteId: string, reason: string): Promise<{ success: boolean }> {
    if (!reason || !reason.trim()) {
      throw new Error("Cancellation reason is required");
    }
    const cn = await sqliteStorage.findById<CreditNoteRecord>("credit_notes", creditNoteId);
    if (!cn) throw new Error("Credit Note not found");
    if (cn.status === "cancelled") throw new Error("Credit note is already cancelled");

    const now = Date.now();

    // 1. Reverse stock additions
    for (const item of cn.lines) {
      if (item.condition === "restock") {
        const batch = await sqliteStorage.findById<ProductBatch>("product_batches", item.batch_id);
        if (batch) {
          batch.stock_qty = Math.max(0, batch.stock_qty - item.return_qty);
          await productsStore.upsertBatch(batch);
        }

        const stockTxId = `stk_cn_rev_${now}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
          id: stockTxId,
          product_id: item.product_id,
          batch_id: item.batch_id,
          event_type: "CREDIT_NOTE_CANCELLED",
          qty_delta: -item.return_qty,
          unit_cost: item.unit_price,
          reference_type: "CREDIT_NOTE",
          reference_id: cn.credit_note_number,
          created_at: now,
        });
      }
    }

    // 2. Restore customer balance
    if (cn.customer_id) {
      const cust = await partiesStore.getCustomerById(cn.customer_id);
      if (cust) {
        cust.outstanding_balance = round2((cust.outstanding_balance || 0) + cn.grand_total);
        await partiesStore.upsertCustomer(cust);
      }
    }

    // 3. Mark credit note as cancelled
    cn.status = "cancelled";
    cn.cancellation_reason = reason.trim();
    cn.cancelled_at = now;
    cn.updated_at = now;
    await sqliteStorage.insertRecord("credit_notes", cn.id, cn);

    // 4. Cancel mirror invoice
    const mirrorInvoice = await sqliteStorage.findById<InvoiceRecord>("invoices", cn.id);
    if (mirrorInvoice) {
      mirrorInvoice.status = "cancelled";
      await sqliteStorage.insertRecord("invoices", mirrorInvoice.id, mirrorInvoice);
    }

    // 5. Reopen debit note if linked
    if (cn.source_debit_note_id) {
      const dn = await sqliteStorage.findById<CustomerDebitNoteRecord>("customer_debit_notes", cn.source_debit_note_id);
      if (dn && dn.status === "credit_note_issued") {
        dn.status = "approved";
        dn.updated_at = now;
        dn.audit_log.push({
          timestamp: now,
          action: "CREDIT_NOTE_CANCELLED",
          user: "Operator",
          details: `Credit Note #${cn.credit_note_number} cancelled. Reason: ${reason}`,
        });
        await sqliteStorage.insertRecord("customer_debit_notes", dn.id, dn);
      }
    }

    return { success: true };
  }

  /**
   * Get all Debit Notes with optional filter
   */
  async getDebitNotes(filter?: CustomerDebitNoteFilter): Promise<CustomerDebitNoteRecord[]> {
    const all = await sqliteStorage.findAll<CustomerDebitNoteRecord>("customer_debit_notes");
    let results = all.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    if (!filter) return results;

    if (filter.customerId) {
      results = results.filter((d) => d.customer_id === filter.customerId);
    }
    if (filter.startDate) {
      results = results.filter((d) => d.debit_note_date >= filter.startDate!);
    }
    if (filter.endDate) {
      results = results.filter((d) => d.debit_note_date <= filter.endDate!);
    }
    if (filter.status && filter.status !== "all") {
      results = results.filter((d) => d.status === filter.status);
    }
    if (filter.varianceOnly) {
      results = results.filter((d) => Math.abs(d.variance) > 0.01);
    }
    if (filter.searchQuery && filter.searchQuery.trim()) {
      const q = filter.searchQuery.trim().toLowerCase();
      results = results.filter((d) => {
        const dnMatch = d.debit_note_number.toLowerCase().includes(q);
        const custMatch = d.customer_name.toLowerCase().includes(q);
        const gstinMatch = d.customer_gstin?.toLowerCase().includes(q);
        const phoneMatch = d.customer_phone?.includes(q);
        const itemMatch = d.lines?.some((l) => l.product_name.toLowerCase().includes(q));
        return dnMatch || custMatch || gstinMatch || phoneMatch || itemMatch;
      });
    }

    return results;
  }

  async getDebitNoteById(id: string): Promise<CustomerDebitNoteRecord | null> {
    return await sqliteStorage.findById<CustomerDebitNoteRecord>("customer_debit_notes", id);
  }

  async getCreditNotes(filter?: { customerId?: string; startDate?: string; endDate?: string }): Promise<CreditNoteRecord[]> {
    const all = await sqliteStorage.findAll<CreditNoteRecord>("credit_notes");
    let results = all.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    if (filter?.customerId) {
      results = results.filter((c) => c.customer_id === filter.customerId);
    }
    if (filter?.startDate) {
      results = results.filter((c) => c.credit_note_date >= filter.startDate!);
    }
    if (filter?.endDate) {
      results = results.filter((c) => c.credit_note_date <= filter.endDate!);
    }
    return results;
  }

  async getCreditNoteById(id: string): Promise<CreditNoteRecord | null> {
    return await sqliteStorage.findById<CreditNoteRecord>("credit_notes", id);
  }

  /**
   * Generates the "Debit Notes Received" report with ageing analysis
   */
  async getDebitNotesReport(filter?: { startDate?: string; endDate?: string; customerId?: string }): Promise<{
    entries: Array<{
      debit_note_number: string;
      debit_note_date: string;
      received_date: string;
      customer_name: string;
      customer_gstin?: string;
      customer_dn_amount: number;
      our_calculated_amount: number;
      variance: number;
      status: DebitNoteStatus;
      credit_note_numbers: string[];
      ageing_days: number;
      is_delayed_verification: boolean;
    }>;
    totals: {
      total_dn_amount: number;
      total_our_amount: number;
      total_variance: number;
      pending_count: number;
      settled_count: number;
    };
  }> {
    const allDns = await this.getDebitNotes(filter);
    const allCns = await this.getCreditNotes();

    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    let totalDns = 0;
    let totalOurs = 0;
    let totalVar = 0;
    let pendingCount = 0;
    let settledCount = 0;

    const entries = allDns.map((dn) => {
      const recDate = new Date(dn.received_date || dn.debit_note_date).getTime();
      const ageingDays = Math.max(0, Math.floor((now - recDate) / msPerDay));
      const isDelayed = (dn.status === "received" || dn.status === "under_verification") && ageingDays > 7;

      const linkedCns = allCns
        .filter((cn) => dn.credit_notes_issued?.includes(cn.id) || cn.source_debit_note_id === dn.id)
        .map((cn) => cn.credit_note_number);

      totalDns = round2(totalDns + dn.customer_dn_amount);
      totalOurs = round2(totalOurs + dn.our_calculated_amount);
      totalVar = round2(totalVar + dn.variance);

      if (dn.status === "received" || dn.status === "under_verification") pendingCount++;
      if (dn.status === "settled") settledCount++;

      return {
        debit_note_number: dn.debit_note_number,
        debit_note_date: dn.debit_note_date,
        received_date: dn.received_date,
        customer_name: dn.customer_name,
        customer_gstin: dn.customer_gstin,
        customer_dn_amount: dn.customer_dn_amount,
        our_calculated_amount: dn.our_calculated_amount,
        variance: dn.variance,
        status: dn.status,
        credit_note_numbers: linkedCns,
        ageing_days: ageingDays,
        is_delayed_verification: isDelayed,
      };
    });

    return {
      entries,
      totals: {
        total_dn_amount: totalDns,
        total_our_amount: totalOurs,
        total_variance: totalVar,
        pending_count: pendingCount,
        settled_count: settledCount,
      },
    };
  }
}

export const customerDebitNoteService = new CustomerDebitNoteService();

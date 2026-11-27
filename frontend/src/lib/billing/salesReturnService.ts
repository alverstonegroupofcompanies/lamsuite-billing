import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch } from "../masters/productsStore";
import { partiesStore, type Customer } from "../masters/partiesStore";
import { syncQueueService } from "../sync/syncQueueService";
import { companySettingsService } from "../settings/companySettingsService";
import { counterSequenceService } from "../auth/counterSequenceService";
import { serverTimeToEpoch, storeToday } from "../dateTimeUtils";
import { onlineTransactionService } from "../sync/onlineTransactionService";
import { storeRegistryService } from "../auth/storeRegistryService";
import { storeDeviceService } from "../auth/storeDeviceService";
import { round2 } from "./billingCalculations";
import {
  formatDocumentNumber,
  nextSerialAfter,
  numberingFor,
  parseSerialNumber,
} from "./documentNumberFormat";
import { calculateDocumentTaxes } from "../tax-engine/taxEngine";
import {
  returnKey,
  reverseCreditsFromOriginal,
  reverseOriginalLine,
  returnBaseUnits,
  sumReturnCredits,
  type OriginalReturnLine,
  type ReturnCredit,
  type ReturnCreditTotals,
} from "./salesReturnPricing";
import { stateLabel } from "../gst/stateCodes";
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
  loose_qty?: number;
  units_per_pack?: number;
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

/** One line's return quantity expressed in base units (packs × units_per_pack + loose). */
export function toBaseUnits(
  qty: number | undefined,
  looseQty: number | undefined,
  unitsPerPack: number | undefined
): number {
  const packs = Math.max(0, Number(qty) || 0);
  const loose = Math.max(0, Number(looseQty) || 0);
  const upp = Math.max(1, Math.round(Number(unitsPerPack) || 1));
  return packs * upp + loose;
}

/**
 * Builds the per-line returnable quantity in base units: sold − already returned.
 * `items` are the original invoice lines; `returnedBaseUnits` comes from the
 * merged sales-return and credit-note history.
 */
export function buildReturnableQtyMap(
  items: Array<{
    product_id: string;
    batch_no?: string;
    qty?: number;
    loose_qty?: number;
    units_per_pack?: number;
  }>,
  returnedBaseUnits: Map<string, number>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = returnKey(item.product_id, item.batch_no);
    const sold = toBaseUnits(item.qty, item.loose_qty, item.units_per_pack);
    const alreadyReturned = returnedBaseUnits.get(key) || 0;
    map.set(key, Math.max(0, sold - alreadyReturned));
  }
  return map;
}

export class SalesReturnService {
  /**
   * Previews sequential return number following sequences in settings without advancing
   */
  async previewNextReturnNumber(): Promise<string> {
    // CNT-014: a till that is on a counter returns on that counter's own series.
    const counterNumber = counterSequenceService.previewForActive("sales_return");
    if (counterNumber) return counterNumber;

    const settings = await companySettingsService.loadSettings();
    const { prefix, searchPrefix, next, rule } = numberingFor(settings.sequences, "sales_return");

    const allReturns = await sqliteStorage.findAll<SalesReturnRecord>("sales_returns");
    const matching = allReturns.filter((r) => r.return_number?.startsWith(searchPrefix));
    const nextNum = nextSerialAfter(next, matching.map((r) => r.return_number), rule);

    return formatDocumentNumber({ ...rule, prefix }, nextNum);
  }

  /**
   * Generates a sequential, configurable return number following sequences in settings
   */
  async generateNextReturnNumber(): Promise<string> {
    const counterNumber = await counterSequenceService.numberFromActiveCounter("sales_return", true);
    if (counterNumber) return counterNumber;

    const settings = await companySettingsService.loadSettings();
    const { prefix, searchPrefix, next, rule } = numberingFor(settings.sequences, "sales_return");

    const allReturns = await sqliteStorage.findAll<SalesReturnRecord>("sales_returns");
    const matching = allReturns.filter((r) => r.return_number?.startsWith(searchPrefix));
    const nextNum = nextSerialAfter(next, matching.map((r) => r.return_number), rule);

    const docNumber = formatDocumentNumber({ ...rule, prefix }, nextNum);

    await companySettingsService.saveLocalSettings(
      {
        sequences: {
          ...settings.sequences,
          returnPrefix: prefix,
          nextReturnNumber: nextNum + 1,
        },
      });

    return docNumber;
  }

  async syncNextReturnSequence(returnNumber: string): Promise<void> {
    if (!returnNumber) return;
    const settings = await companySettingsService.loadSettings();
    const { rule } = numberingFor(settings.sequences, "sales_return");
    const lastNum = parseSerialNumber(returnNumber, rule.suffix);
    if (lastNum === null) return;
    const currNext = settings.sequences?.nextReturnNumber || 1;
    if (lastNum >= currNext) {
      await companySettingsService.saveLocalSettings(
        {
          sequences: {
            ...settings.sequences,
            returnPrefix: settings.sequences?.returnPrefix || "SR",
            nextReturnNumber: lastNum + 1,
          },
        });
    }
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
   * Calculates already returned quantities per product & batch for a given
   * invoice, in base units. Both locally recorded sales returns and credit-note
   * invoices that point at the original invoice are counted.
   */
  async getReturnedQtyMapForInvoice(invoiceNumber: string): Promise<Map<string, number>> {
    if (!invoiceNumber) return new Map();
    const map = new Map<string, number>();
    const add = (productId: string, batchNo: string | undefined, baseUnits: number) => {
      const key = returnKey(productId, batchNo);
      map.set(key, (map.get(key) || 0) + baseUnits);
    };

    const returns = await this.getReturnsForInvoice(invoiceNumber);
    const localReturnIds = new Set(returns.map((ret) => String(ret.id)));
    for (const ret of returns) {
      for (const item of ret.lines) {
        add(
          item.product_id,
          item.batch_no,
          toBaseUnits(item.return_qty, item.loose_qty, item.units_per_pack)
        );
      }
    }

    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const creditNotes = allInvoices.filter(
      (inv) =>
        (inv.module_key === "credit_note" || inv.module_key === "sales_return") &&
        (inv as any).original_invoice_number === invoiceNumber &&
        inv.status !== "cancelled" &&
        // Local returns also write a mirror credit-note row with the same id;
        // counting both would double the returned quantity.
        !localReturnIds.has(String(inv.id))
    );
    if (creditNotes.length > 0) {
      const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");
      for (const cn of creditNotes) {
        const cnItems = allItems.filter((it) => String(it.invoice_id) === String(cn.id));
        for (const item of cnItems) {
          add(
            item.product_id,
            item.batch_no,
            toBaseUnits(item.qty, item.loose_qty, item.units_per_pack)
          );
        }
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
    const today = storeToday(companySettingsService.getSettings());
    const timeStr = new Date().toTimeString().slice(0, 8);
    const returnId = `sr_${now}_${Math.random().toString(16).slice(2, 6)}`;
    const returnNumber = (input as any).return_number || (await this.generateNextReturnNumber());
    if ((input as any).return_number) {
      await this.syncNextReturnSequence(returnNumber);
    }

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
    const returnedQtyMap = await this.getReturnedQtyMapForInvoice(
      input.original_invoice_number || ""
    );
    const originalItems = originalInv
      ? (await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items")).filter(
          (it) => String(it.invoice_id) === String(originalInv!.id)
        )
      : [];

    if (input.original_invoice_number) {
      for (const line of input.lines) {
        const requestedBaseUnits = toBaseUnits(
          line.return_qty,
          line.loose_qty,
          line.units_per_pack
        );
        if (requestedBaseUnits <= 0) {
          throw new Error(`Return quantity for ${line.product_name} must be greater than 0`);
        }

        const key = returnKey(line.product_id, line.batch_no);
        const alreadyReturned = returnedQtyMap.get(key) || 0;
        const availableToReturn = line.sold_qty - alreadyReturned;

        if (requestedBaseUnits > availableToReturn) {
          throw new Error(
            `Cannot return ${requestedBaseUnits} of ${line.product_name}. Maximum available to return is ${availableToReturn} (Sold: ${line.sold_qty}, Already Returned: ${alreadyReturned})`
          );
        }
      }
    }

    // 2. A return credits the money the original line was charged, so whenever the
    //    bill is held locally and every line is on it, the credit is reversed from
    //    those lines. Otherwise the till has nothing to reverse and falls back to
    //    pricing the return on its own.
    let credits: ReturnCredit[] | null = reverseCreditsFromOriginal(
      originalInv,
      originalItems,
      input.lines,
      returnedQtyMap
    );

    const customerGstin = input.customer_gstin || originalInv?.customer_gstin;
    const storeState = (originalInv as any)?.store_state_code;
    // A return follows the original document; without one it is supplied where the store is.
    const placeOfSupply = originalInv?.place_of_supply || stateLabel(storeState || companySettingsService.getSettings().state_code);

    let totals: ReturnCreditTotals;
    if (!credits) {
      const isTaxInclusive = (originalInv as any)?.is_tax_inclusive || false;
      const isComposition = (originalInv as any)?.is_composition || (originalInv as any)?.gst_type === "composition" || (originalInv as any)?.gst_type === "no_tax" || (originalInv && originalInv.tax_total === 0);
      const taxResult = calculateDocumentTaxes({
        store_state: storeState || "32",
        lines: input.lines.map((line, idx) => ({
          line_id: `line_${idx}`,
          product_id: line.product_id,
          product_name: line.product_name,
          hsn_code: line.hsn_code || "",
          qty: line.return_qty,
          pack_qty: line.return_qty,
          loose_qty: line.loose_qty || 0,
          units_per_pack: line.units_per_pack || 1,
          unit_price: line.unit_price,
          discount_percent: line.discount_percent || 0,
          gst_percent: line.gst_percent || 0,
          gst_rate: line.gst_percent || 0,
          cess_percent: (line as any).cess_percent || 0,
          cess_rate: (line as any).cess_percent || 0,
        })),
        customer_gstin: customerGstin,
        place_of_supply: placeOfSupply,
        default_tax_mode: isTaxInclusive ? "inclusive" : "exclusive",
        is_composition: Boolean(isComposition),
      });

      credits = taxResult.lines.map((line) => ({
        taxable_amount: line.taxable_amount,
        cgst_amount: line.cgst_amount,
        sgst_amount: line.sgst_amount,
        igst_amount: line.igst_amount,
        cess_amount: line.cess_amount,
        tax_amount: line.total_tax,
        total_amount: line.total_amount,
        discount_amount: line.line_discount,
      }));

      totals = {
        subtotal: taxResult.taxable_subtotal,
        taxable_subtotal: taxResult.taxable_subtotal,
        discount_total: round2(taxResult.line_discount_total + taxResult.bill_discount_total),
        tax_total: taxResult.total_tax,
        cgst_total: taxResult.cgst_total,
        sgst_total: taxResult.sgst_total,
        igst_total: taxResult.igst_total,
        cess_total: taxResult.cess_total,
        round_off: taxResult.round_off,
        grand_total: taxResult.grand_total,
      };
    } else {
      totals = sumReturnCredits(credits);
    }

    const returnLines: SalesReturnItem[] = [];

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i];
      const credit = credits[i];
      const itemId = `sri_${now}_${i}_${Math.random().toString(16).slice(2, 6)}`;
      const returnedBaseUnits = toBaseUnits(line.return_qty, line.loose_qty, line.units_per_pack);

      returnLines.push({
        ...line,
        id: itemId,
        return_id: returnId,
        discount_amount: credit.discount_amount,
        taxable_amount: credit.taxable_amount,
        cgst_amount: credit.cgst_amount,
        sgst_amount: credit.sgst_amount,
        igst_amount: credit.igst_amount,
        total_amount: credit.total_amount,
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
          batch.stock_qty += returnedBaseUnits;
          await productsStore.upsertBatch(batch);
        }

        // Post stock ledger transaction
        const stockTxId = `stk_sr_${now}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
          id: stockTxId,
          product_id: line.product_id,
          batch_id: line.batch_id,
          event_type: "SALES_RETURN",
          qty_delta: returnedBaseUnits,
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

    const subtotal = totals.subtotal;
    const discountTotal = totals.discount_total;
    const taxTotal = totals.tax_total;
    const cgstTotal = totals.cgst_total;
    const sgstTotal = totals.sgst_total;
    const igstTotal = totals.igst_total;
    const cessTotal = totals.cess_total;
    const roundOff = totals.round_off;
    const grandTotal = totals.grand_total;

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
      taxable_subtotal: totals.taxable_subtotal,
      discount_total: discountTotal,
      tax_total: taxTotal,
      cgst_total: cgstTotal,
      sgst_total: sgstTotal,
      igst_total: igstTotal,
      cess_total: cessTotal,
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
      const mirrorItem: InvoiceItemRecord = {
        id: item.id,
        invoice_id: returnId,
        product_id: item.product_id,
        product_name: item.product_name,
        hsn_code: item.hsn_code,
        batch_no: item.batch_no,
        expiry_date: item.expiry_date,
        qty: item.return_qty,
        loose_qty: item.loose_qty || 0,
        units_per_pack: item.units_per_pack || 1,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent,
        discount_amount: item.discount_amount,
        taxable_amount: item.taxable_amount,
        gst_percent: item.gst_percent,
        cgst_amount: item.cgst_amount,
        sgst_amount: item.sgst_amount,
        igst_amount: item.igst_amount,
        total_amount: item.total_amount,
      };
      await sqliteStorage.insertRecord("invoice_items", item.id, mirrorItem);
    }

    // 7. Enqueue for offline cloud sync. This has to be the credit note the reports read — the raw
    // return record has no module_key and keeps its lines under `lines`, so the server stored a
    // zero-line bill and recomputed its tax from an empty line set.
    await syncQueueService.enqueue("invoice", returnId, "create", {
      ...mirrorInvoice,
      // The server reverses a credit note from the bill it credits. The till's own id for
      // that bill survives a server renumbering; the number printed on it may not.
      original_invoice_id: input.original_invoice_id || originalInv?.id || null,
      items: returnLines.map((item) => ({
        product_id: item.product_id,
        product_name: item.product_name,
        hsn_code: item.hsn_code,
        batch_no: item.batch_no,
        expiry_date: item.expiry_date,
        qty: item.return_qty,
        loose_qty: item.loose_qty || 0,
        units_per_pack: item.units_per_pack || 1,
        unit_price: item.unit_price,
        // The server restocks a credit note from its own lines, so it has to be told which lines
        // the till deliberately kept off the shelf.
        stock_action: item.condition,
        discount_percent: item.discount_percent,
        discount_amount: item.discount_amount,
        gst_percent: item.gst_percent,
        taxable_amount: item.taxable_amount,
        cgst_amount: item.cgst_amount,
        sgst_amount: item.sgst_amount,
        igst_amount: item.igst_amount,
        tax_amount: Math.round(
          (item.cgst_amount + item.sgst_amount + item.igst_amount) * 100
        ) / 100,
        total_amount: item.total_amount,
      })),
    } as unknown as Record<string, unknown>);

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
        const returnedBaseUnits = toBaseUnits(line.return_qty, line.loose_qty, line.units_per_pack);
        const batch = await sqliteStorage.findById<ProductBatch>("product_batches", line.batch_id);
        if (batch) {
          batch.stock_qty = Math.max(0, batch.stock_qty - returnedBaseUnits);
          await productsStore.upsertBatch(batch);
        }

        // Post reversal stock transaction
        const stockTxId = `stk_rev_${now}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
          id: stockTxId,
          product_id: line.product_id,
          batch_id: line.batch_id,
          event_type: "RETURN_CANCELLED",
          qty_delta: -returnedBaseUnits,
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

    // 5. Push the cancellation. Header only: a payload with money and no lines is read as a full
    // document and would re-store the credit note with its lines deleted.
    await syncQueueService.enqueue("invoice", ret.id, "update", {
      id: ret.id,
      invoice_number: ret.return_number,
      status: "cancelled",
      cancel_reason: reason.trim(),
      updated_at: now,
    });

    return { success: true };
  }

  /**
   * Credit notes the store holds on the server — a legacy migration, a return raised at another
   * counter, or a note created in the admin panel. The till's own table only ever saw the returns
   * typed on this device, so those documents existed in the backend and nowhere in the till.
   */
  async getServerSalesReturns(): Promise<SalesReturnRecord[]> {
    if (!syncQueueService.isOnline()) return [];

    const baseUrl = onlineTransactionService.getEffectiveBaseUrl();
    const deviceHeaders = await storeDeviceService.getDeviceAuthHeaders();
    // The token belongs to a store, so its store is the one to ask about — the registry's local id
    // ("store_main") is not a server store and would be refused as a tenant mismatch.
    const storeId = deviceHeaders["X-Store-Id"] || String(storeRegistryService.getActiveStore()?.id || "1");
    const params = new URLSearchParams({
      store_id: storeId,
      module: "credit_notes",
      per_page: "200",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(`${baseUrl}/api/invoices?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          "X-Store-Id": storeId,
          "Store-Id": storeId,
          // `/api/invoices` is a till route: with no device token the server answers 401, and a
          // silent 401 here looks to the operator exactly like a store with no returns.
          ...deviceHeaders,
        },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) return [];
      const json = await res.json();
      const rows = Array.isArray(json?.data) ? json.data : [];
      return rows.map((row: any) => this.mapServerCreditNote(row)).filter(Boolean) as SalesReturnRecord[];
    } catch (_) {
      // A server that will not answer must not empty the return screen; the local book stays.
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  private mapServerCreditNote(row: any): SalesReturnRecord | null {
    if (!row || (row.id == null && !row.invoice_number)) return null;

    const id = String(row.external_id || row.id);
    const createdAt = serverTimeToEpoch(row.created_at) || serverTimeToEpoch(row.invoice_date);
    const items = Array.isArray(row.items) ? row.items : [];
    const qtyOf = (item: any) => Number(item.qty ?? item.return_qty ?? 0);

    const lines: SalesReturnItem[] = items.map((item: any, index: number) => ({
      id: String(item.id ?? `${id}_line_${index}`),
      return_id: id,
      product_id: String(item.product_id ?? ""),
      product_name: item.product_name || "Item",
      hsn_code: item.hsn_code || undefined,
      batch_id: "",
      batch_no: item.batch_no || "",
      expiry_date: item.expiry_date || undefined,
      sold_qty: qtyOf(item),
      return_qty: qtyOf(item),
      loose_qty: Number(item.loose_qty || 0),
      units_per_pack: Number(item.units_per_pack || 1),
      unit_price: Number(item.unit_price || 0),
      discount_percent: Number(item.discount_percent || 0),
      discount_amount: Number(item.discount_amount || 0),
      taxable_amount: Number(item.taxable_amount || 0),
      gst_percent: Number(item.gst_percent || 0),
      cgst_amount: Number(item.cgst_amount || 0),
      sgst_amount: Number(item.sgst_amount || 0),
      igst_amount: Number(item.igst_amount || 0),
      total_amount: Number(item.total_amount || 0),
      // The server keeps the restock decision on the line but not the reason a customer gave.
      reason: "customer_return",
      condition: item.stock_action === "damaged_discard" || item.stock_action === "quarantine"
        ? item.stock_action
        : "restock",
    }));

    const grandTotal = Number(row.grand_total || 0);
    const refunded = Number(row.paid_amount ?? row.grand_total ?? 0);

    return {
      id,
      return_number: String(row.invoice_number || `CN-${row.id}`),
      return_date: String(row.invoice_date || "").slice(0, 10),
      return_time: "",
      original_invoice_id: row.original_invoice_id ? String(row.original_invoice_id) : undefined,
      original_invoice_number: row.original_invoice_number || undefined,
      original_invoice_date: row.original_invoice_date
        ? String(row.original_invoice_date).slice(0, 10)
        : undefined,
      customer_id: row.customer_id ? String(row.customer_id) : undefined,
      customer_name: row.customer_name || row.customer?.name || "Walk-in Customer",
      customer_phone: row.customer_phone || row.customer?.phone || "",
      customer_gstin: row.customer_gstin || row.customer?.gstin || "",
      lines,
      subtotal: Number(row.subtotal || 0),
      discount_total: Number(row.discount_total || 0),
      tax_total: Number(row.tax_total || 0),
      cgst_total: Number(row.cgst_total || 0),
      sgst_total: Number(row.sgst_total || 0),
      igst_total: Number(row.igst_total || 0),
      round_off: Number(row.round_off || 0),
      grand_total: grandTotal,
      refund_amount: refunded,
      refund_mode: (row.payment_mode || "Cash") as RefundPaymentMode,
      refund_status:
        Math.abs(refunded) >= Math.abs(grandTotal) && grandTotal !== 0
          ? "paid"
          : refunded
            ? "partial"
            : "unpaid",
      status: String(row.status || "").toLowerCase() === "cancelled" ? "cancelled" : "completed",
      notes: row.notes || undefined,
      created_at: createdAt,
      updated_at: serverTimeToEpoch(row.updated_at) || createdAt,
    };
  }

  /**
   * Search and filter sales returns
   *
   * The till's own rows lead: they carry the reason, the restock decision and any edit the server
   * has not been given yet. Server notes are appended for documents this device never held.
   */
  async getSalesReturns(filter?: SalesReturnFilter): Promise<SalesReturnRecord[]> {
    const [local, server] = await Promise.all([
      sqliteStorage.findAll<SalesReturnRecord>("sales_returns"),
      this.getServerSalesReturns(),
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

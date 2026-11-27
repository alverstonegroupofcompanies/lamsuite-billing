import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";
import { supplierLedgerService } from "./supplierLedgerService";
import { purchaseOrderService } from "./purchaseOrderService";
import { companySettingsService } from "../settings/companySettingsService";
import { counterSequenceService } from "../auth/counterSequenceService";
import { round2 } from "../billing/billingCalculations";
import {
  formatDocumentNumber,
  nextSerialAfter,
  numberingFor,
  parseSerialNumber,
} from "../billing/documentNumberFormat";
import { getIndianFinancialYear } from "../billing/salesReturnService";
import { syncQueueService } from "../sync/syncQueueService";
import { onlineTransactionService } from "../sync/onlineTransactionService";
import { storeRegistryService } from "../auth/storeRegistryService";
import { storeDeviceService } from "../auth/storeDeviceService";
import { serverTimeToEpoch } from "../dateTimeUtils";
import { calculateDocumentTaxes, cleanStateCode, type TaxEngineDocumentTotals } from "../tax-engine/taxEngine";
import {
  chargePayload,
  engineLines,
  legacyFreightCharge,
  postCharges,
  resolveCharges,
  type PurchaseChargeInput,
  type ResolvedCharge,
} from "./chargePosting";
import { recordReversals, reverseOnCancel } from "./chargeReversal";
import { calculateLineMargin } from "./purchaseEntryUtils";
import type { PurchaseChargeRecord } from "../reports/purchaseChargeRegister";

/** Document totals the purchase screens read. `engine` is the same pass in full detail. */
export interface PurchaseDocumentTotals {
  subtotal: number;
  discountTotal: number;
  billDiscountAmount: number;
  taxTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  cessTotal: number;
  freightCharges: number;
  roundOff: number;
  grandTotal: number;
  totalUnits: number;
  taxableSubtotal: number;
  chargeTotal: number;
  chargeTaxTotal: number;
  landedCostAddition: number;
  expenseChargeTotal: number;
  engine: TaxEngineDocumentTotals;
}

export interface PurchaseLineItemInput {
  product_id: string;
  product_name: string;
  hsn_code?: string;
  batch_no: string;
  mfg_date?: string;
  expiry_date: string;
  pack_qty: number; // billed packs
  loose_qty?: number; // billed loose units
  free_qty?: number; // bonus packs
  free_loose_qty?: number; // bonus loose units
  units_per_pack?: number;
  qty?: number; // legacy alias for pack_qty
  purchase_rate: number; // rate per pack (ex-tax)
  ptr?: number; // trade price to retailer
  pts?: number; // price to stockist
  ptss?: number; // price to sub-stockist
  discount_type?: "percent" | "amount";
  discount_percent?: number; // trade discount %
  discount_amount?: number; // scheme / cash discount amount
  mrp?: number;
  selling_rate?: number;
  gst_percent: number;
  cess_percent?: number;
  shelf_location?: string;
  /** CR-C D1: chargeable weight entered on the line so a weight-spread charge needs no master data. */
  gross_weight_kg?: number;
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
  cess_amount: number;
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
  /** CR-C: the charges section of the purchase screen (Alt+F). Posted with the bill. */
  charges?: PurchaseChargeInput[];
  round_off?: number;
  freight_charges?: number;
  bill_discount_type?: "percent" | "amount";
  bill_discount?: number;
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
  bill_discount_type?: "percent" | "amount";
  bill_discount?: number;
  freight_charges?: number;
  tax_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  cess_total?: number;
  round_off: number;
  grand_total: number;
  paid_amount: number;
  payment_status: "unpaid" | "partial" | "paid";
  status: "received" | "draft" | "cancelled";
  cancel_reason?: string;
  is_revised?: number;
  edit_history?: string;
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
  free_loose_qty?: number;
  units_per_pack: number;
  total_units: number;
  purchase_rate: number;
  ptr?: number;
  pts?: number;
  ptss?: number;
  discount_type?: "percent" | "amount";
  discount_percent: number;
  discount_amount: number;
  effective_unit_cost: number;
  taxable_amount: number;
  mrp?: number;
  selling_rate?: number;
  gst_percent: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  tax_amount: number;
  total_amount: number;
  /** CR-C: the weight this line was received at, its share of the bill's charges, and the cost per unit after them. */
  gross_weight_kg?: number | null;
  charge_allocation?: number;
  landed_unit_cost?: number | null;
}

export class PurchaseService {
  /**
   * Previews sequential purchase bill number from settings without advancing sequence
   */
  async previewNextPurchaseNumber(): Promise<string> {
    // CNT-014: a till that is on a counter inwards its bills on that counter's
    // own series; the store-wide settings series is only for tills with no counter.
    const counterNumber = counterSequenceService.previewForActive("purchase_bill");
    if (counterNumber) return counterNumber;

    const settings = await companySettingsService.loadSettings();
    const { prefix, searchPrefix, next, rule } = numberingFor(settings.sequences, "purchase");

    const allPurchases = await sqliteStorage.findAll<any>("purchase_documents");
    const matching = allPurchases.filter((p) => p.purchase_number?.startsWith(searchPrefix));
    const nextNum = nextSerialAfter(next, matching.map((p) => p.purchase_number), rule);

    return formatDocumentNumber({ ...rule, prefix }, nextNum);
  }

  /**
   * Generates sequential purchase bill number following sequences in settings
   */
  async generateNextPurchaseNumber(): Promise<string> {
    const counterNumber = await counterSequenceService.numberFromActiveCounter("purchase_bill", true);
    if (counterNumber) return counterNumber;

    const settings = await companySettingsService.loadSettings();
    const { prefix, searchPrefix, next, rule } = numberingFor(settings.sequences, "purchase");

    const allPurchases = await sqliteStorage.findAll<any>("purchase_documents");
    const matching = allPurchases.filter((p) => p.purchase_number?.startsWith(searchPrefix));
    const nextNum = nextSerialAfter(next, matching.map((p) => p.purchase_number), rule);

    const docNumber = formatDocumentNumber({ ...rule, prefix }, nextNum);

    await companySettingsService.saveLocalSettings(
      {
        sequences: {
          ...settings.sequences,
          purchasePrefix: prefix,
          nextPurchaseNumber: nextNum + 1,
        },
      });

    return docNumber;
  }

  async syncNextPurchaseSequence(purchaseNumber: string): Promise<void> {
    if (!purchaseNumber) return;
    const settings = await companySettingsService.loadSettings();
    const { rule } = numberingFor(settings.sequences, "purchase");
    const lastNum = parseSerialNumber(purchaseNumber, rule.suffix);
    if (lastNum === null) return;
    const currNext = settings.sequences?.nextPurchaseNumber || 201;
    if (lastNum >= currNext) {
      await companySettingsService.saveLocalSettings(
        {
          sequences: {
            ...settings.sequences,
            purchasePrefix: settings.sequences?.purchasePrefix || "PUR",
            nextPurchaseNumber: lastNum + 1,
          },
        });
    }
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

    const settings = companySettingsService.getSettings();
    const storeState = settings.state_code || "32";
    const defaultTaxMode = settings.purchase_tax_mode || "exclusive";
    // Legacy callers without an explicit type may pass both a trade % and a
    // flat scheme amount; the engine applies both. Typed lines are exclusive.
    const discountType = line.discount_type;

    const doc = calculateDocumentTaxes({
      store_state: storeState,
      place_of_supply: isInterstate ? (cleanStateCode(storeState) === "32" ? "29-Karnataka" : "32-Kerala") : storeState,
      default_tax_mode: defaultTaxMode,
      lines: [
        {
          qty: packs,
          loose_qty: loose,
          free_qty: free,
          free_loose_qty: Math.max(0, line.free_loose_qty || 0),
          units_per_pack: unitsPerPack,
          unit_price: line.purchase_rate,
          mrp: line.mrp,
          rate_basis: "ptr",
          discount_percent: discountType === "amount" ? 0 : line.discount_percent,
          discount_amount: discountType === "percent" ? 0 : line.discount_amount,
          gst_percent: line.gst_percent,
          cess_percent: line.cess_percent,
          is_tax_inclusive: defaultTaxMode === "inclusive",
        },
      ],
      auto_round_off: false,
    });

    const c = doc.lines[0];
    const marginPercent = calculateLineMargin(
      line.purchase_rate,
      line.selling_rate || line.mrp || 0,
      (line.gst_percent || 0) + (line.cess_percent || 0),
      settings.tax_mode !== "exclusive"
    ).marginPercent;

    return {
      billed_units: c.billed_units,
      free_units: c.free_units,
      total_stock_units: c.total_units,
      gross_amount: c.gross_amount,
      discount_amount: c.line_discount,
      taxable_amount: c.taxable_amount,
      cgst_amount: c.cgst_amount,
      sgst_amount: c.sgst_amount,
      igst_amount: c.igst_amount,
      cess_amount: c.cess_amount,
      total_tax: c.total_tax,
      total_amount: c.total_amount,
      effective_unit_cost: c.effective_unit_cost || 0,
      margin_percent: marginPercent,
    };
  }

  /**
   * The one statutory pass: the shared engine prices the lines, the bill discount and this
   * bill's charges together, so the totals bar, the supplier-invoice check and the posted
   * document cannot disagree (CR-C). Legacy freight no longer joins after the engine — it
   * enters as a 0% Freight charge, so its round-off and spread stay the engine's (PUR-017).
   */
  calculateDocumentEngine(
    lines: PurchaseLineItemInput[],
    opts: {
      isInterstate?: boolean;
      bill_discount_type?: "percent" | "amount";
      bill_discount_value?: number;
      round_off?: number | null;
      charges?: ResolvedCharge[];
    } = {}
  ): TaxEngineDocumentTotals {
    const settings = companySettingsService.getSettings();
    const storeState = settings.state_code || "32";
    const defaultTaxMode = settings.purchase_tax_mode || "exclusive";
    const isInterstate = Boolean(opts.isInterstate);

    return calculateDocumentTaxes({
      store_state: storeState,
      place_of_supply: isInterstate
        ? cleanStateCode(storeState) === "32"
          ? "29-Karnataka"
          : "32-Kerala"
        : storeState,
      default_tax_mode: defaultTaxMode,
      lines: engineLines(lines, { taxInclusive: defaultTaxMode === "inclusive" }),
      bill_discount: {
        type: opts.bill_discount_type || "amount",
        value: Math.max(0, opts.bill_discount_value || 0),
      },
      charges: opts.charges || [],
      // CR-C-11 / PUR-016: the store decides whether a separately-paid charge is money the
      // supplier is owed. The answer each bill got is stored on its charge rows, so a later
      // policy change cannot restate a bill that has already been printed.
      separately_paid_in_payable: Boolean(settings.purchase_charges?.separately_paid_in_payable),
      auto_round_off: opts.round_off == null,
      manual_round_off: opts.round_off ?? null,
    });
  }

  /**
   * Document totals for the screens that only need numbers. A bill with charges takes every
   * figure from the engine; one without keeps the pre-CR-C arithmetic, legacy freight included.
   */
  calculateDocumentTotals(
    lines: PurchaseLineItemInput[],
    isInterstate = false,
    opts: {
      bill_discount_type?: "percent" | "amount";
      bill_discount_value?: number;
      freight_charges?: number;
      round_off?: number | null;
      charges?: ResolvedCharge[];
    } = {}
  ): PurchaseDocumentTotals {
    const doc = this.calculateDocumentEngine(lines, {
      isInterstate,
      bill_discount_type: opts.bill_discount_type,
      bill_discount_value: opts.bill_discount_value,
      round_off: opts.round_off,
      charges: opts.charges,
    });

    const hasCharges = Boolean(opts.charges?.length);
    const freight = round2(opts.freight_charges || 0);
    const netBeforeRound = round2(doc.net_before_round + (hasCharges ? 0 : freight));
    const roundOff =
      opts.round_off != null
        ? round2(opts.round_off)
        : hasCharges
          ? round2(doc.round_off)
          : round2(Math.round(netBeforeRound) - netBeforeRound);
    const grandTotal = Math.max(0, round2(netBeforeRound + roundOff));
    const totalUnits = lines.reduce((sum, line) => {
      const upp = Math.max(1, line.units_per_pack || 1);
      const billed = Math.max(0, line.pack_qty ?? line.qty ?? 0) * upp + Math.max(0, line.loose_qty || 0);
      const free = Math.max(0, line.free_qty || 0) * upp + Math.max(0, line.free_loose_qty || 0);
      return sum + billed + free;
    }, 0);

    return {
      subtotal: doc.gross_subtotal,
      discountTotal: round2(doc.line_discount_total + doc.bill_discount_total),
      billDiscountAmount: doc.bill_discount_total,
      taxTotal: doc.total_tax,
      cgstTotal: doc.cgst_total,
      sgstTotal: doc.sgst_total,
      igstTotal: doc.igst_total,
      cessTotal: doc.cess_total,
      freightCharges: freight,
      roundOff,
      grandTotal,
      totalUnits,
      taxableSubtotal: doc.taxable_subtotal,
      chargeTotal: round2(doc.charge_taxable_total),
      chargeTaxTotal: round2(doc.charge_tax_total),
      landedCostAddition: round2(doc.landed_cost_addition),
      expenseChargeTotal: round2(doc.expense_charge_total),
      engine: doc,
    };
  }

  /**
   * Atomic record of inward purchase bill
   */
  async recordInwardPurchaseBill(doc: PurchaseDocumentInput): Promise<{
    success: boolean;
    purchaseId: string;
    purchaseNumber: string;
    /** Whether the server has actually taken the bill yet (PUR-01/05). */
    syncState?: "synced" | "pending";
    syncMessage?: string;
  }> {
    if (!doc.supplier_name?.trim() || !doc.supplier_invoice_no?.trim()) {
      throw new Error("Supplier name and supplier invoice number are required");
    }
    if (doc.lines.length === 0) {
      throw new Error("Cannot save purchase bill with no items");
    }

    // Resolved before a single row moves: a charge against a head this store does not have,
    // or one that would drive the payable below zero, must refuse the whole bill instead of
    // leaving half of it posted (rule R12, PUR-014).
    const docCharges = doc.charges?.length
      ? await resolveCharges(doc.charges, doc.place_of_supply ?? null)
      : await legacyFreightCharge(doc.freight_charges || 0, doc.place_of_supply ?? null);

    const isInterstate = Boolean(doc.is_interstate);
    const docTotals = this.calculateDocumentTotals(doc.lines, isInterstate, {
      bill_discount_type: doc.bill_discount_type,
      bill_discount_value: doc.bill_discount,
      freight_charges: doc.freight_charges,
      round_off: doc.round_off,
      charges: docCharges,
    });

    // The grand total is clamped at zero for display, so the unclamped figure is what the
    // till checks — the same rule the server applies before it writes a purchase.
    if (docCharges.length && round2(docTotals.engine.net_before_round + docTotals.roundOff) < 0) {
      throw new Error("The charges on this bill would take the payable below zero.");
    }

    const purchaseId = `pb_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const now = Date.now();
    const purchaseNumber = doc.purchase_number || (await this.generateNextPurchaseNumber());
    if (doc.purchase_number) {
      await this.syncNextPurchaseSequence(purchaseNumber);
    }
    const itemRecords: PurchaseItemRecord[] = [];
    const receivedMap: Record<string, number> = {};

    for (const line of doc.lines) {
      const calc = this.calculateLineTotals(line, isInterstate);

      // Track received quantity per product for PO fulfillment
      receivedMap[line.product_id] = (receivedMap[line.product_id] || 0) + (line.pack_qty || line.qty || 0);

      // 1. Upsert or update batch stock. Batch/expiry are optional for
      //    non-pharmacy stores, so batchless receipts share one bucket.
      const batchKey = line.batch_no?.trim()
        ? line.batch_no.trim().replace(/\s+/g, "_")
        : "NOBATCH";
      const batchId = `batch_${line.product_id}_${batchKey}`;
      const existingBatch = await sqliteStorage.findById<ProductBatch>("product_batches", batchId);

      const updatedStock = (existingBatch?.stock_qty || 0) + calc.total_stock_units;
      const unitsPerPack = Math.max(1, line.units_per_pack || 1);

      await productsStore.upsertBatch({
        id: batchId,
        product_id: line.product_id,
        batch_no: line.batch_no?.trim() || "",
        mfg_date: line.mfg_date,
        expiry_date: line.expiry_date || "",
        stock_qty: updatedStock,
        mrp: line.mrp,
        purchase_rate: line.purchase_rate,
        selling_rate: line.selling_rate || line.mrp || undefined,
        rack_location: line.shelf_location,
      });

      // 2. Update master product current_stock and last purchase rates
      let prod = await productsStore.getProductById(line.product_id);
      if (prod) {
        prod.current_stock = (prod.current_stock || 0) + calc.total_stock_units;
        prod.ptr = line.ptr ?? line.purchase_rate;
        if (line.pts) prod.pts = line.pts;
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
          sel_rate: line.selling_rate || line.mrp || line.purchase_rate,
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
        notes: `Inward: Inv #${doc.supplier_invoice_no} (${line.batch_no || "no batch"})`,
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
        gross_weight_kg: line.gross_weight_kg ?? null,
        free_qty: line.free_qty || 0,
        free_loose_qty: line.free_loose_qty || 0,
        units_per_pack: unitsPerPack,
        total_units: calc.total_stock_units,
        purchase_rate: line.purchase_rate,
        ptr: line.ptr ?? line.purchase_rate,
        pts: line.pts,
        ptss: line.ptss,
        discount_type: line.discount_type || "percent",
        discount_percent: line.discount_type === "amount" ? 0 : line.discount_percent || 0,
        discount_amount: line.discount_type === "percent" ? 0 : line.discount_amount ?? calc.discount_amount,
        effective_unit_cost: calc.effective_unit_cost,
        taxable_amount: calc.taxable_amount,
        mrp: line.mrp,
        selling_rate: line.selling_rate,
        gst_percent: line.gst_percent,
        cgst_amount: calc.cgst_amount,
        sgst_amount: calc.sgst_amount,
        igst_amount: calc.igst_amount,
        cess_amount: calc.cess_amount,
        tax_amount: calc.total_tax,
        total_amount: calc.total_amount,
      };

      await sqliteStorage.insertRecord("purchase_items", itemId, itemRow as unknown as Record<string, unknown>);
      itemRecords.push(itemRow);
    }

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
      subtotal: docTotals.subtotal,
      discount_total: docTotals.discountTotal,
      bill_discount_type: doc.bill_discount_type || "amount",
      bill_discount: doc.bill_discount || 0,
      freight_charges: docTotals.freightCharges,
      tax_total: docTotals.taxTotal,
      cgst_total: docTotals.cgstTotal,
      sgst_total: docTotals.sgstTotal,
      igst_total: docTotals.igstTotal,
      cess_total: docTotals.cessTotal,
      round_off: docTotals.roundOff,
      grand_total: docTotals.grandTotal,
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
      amount: docTotals.grandTotal,
      notes: `Inward Invoice: ${doc.supplier_invoice_no}`,
    });

    // 7. Update PO fulfillment if linked
    if (doc.po_id) {
      await purchaseOrderService.updateReceivedQty(doc.po_id, receivedMap);
    }

    // 8. Charge rows, their spread onto these lines and the landed cost they create.
    await postCharges({
      purchaseId,
      invoiceNumber: doc.supplier_invoice_no,
      charges: docCharges,
      result: docTotals.engine,
      purchaseLines: doc.lines,
      itemIdsByLine: Object.fromEntries(doc.lines.map((_, idx) => [String(idx), itemRecords[idx]?.id])),
    });

    // 9. Enqueue for cloud sync — the charge lines ride inside the bill, because the server
    //    re-prices them there and needs the same lines the till priced offline (SYNC-007).
    const queueId = await syncQueueService.enqueue("purchase", purchaseId, "create", {
      ...purchaseRow,
      items: itemRecords,
      charges: chargePayload(docCharges),
    });

    // A bill is only "posted" once the server has taken it. While the line is up we wait for
    // its answer, so a rejected charge or a duplicate supplier bill is reported at the counter
    // instead of a success the owner never actually had (PUR-01/06). Offline, the local bill
    // stands and the queue carries it when the link returns.
    if (syncQueueService.isOnline()) {
      const ack = await syncQueueService.syncSingleItem(queueId);
      if (ack.success) {
        return { success: true, purchaseId, purchaseNumber, syncState: "synced" };
      }

      return {
        success: true,
        purchaseId,
        purchaseNumber,
        syncState: "pending",
        syncMessage: ack.error,
      };
    }

    return { success: true, purchaseId, purchaseNumber, syncState: "pending" };
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

    // 4. PUR-015: the goods went back, so the charges they were carrying go back too — each
    //    charge reads as fully reversed, the expense rows it booked are withdrawn and the batch
    //    is valued at the supplier's own rate again. The postings stay so the bill can still be
    //    reconciled paisa for paisa against them.
    await reverseOnCancel(purchaseId);

    // 5. Update status to cancelled
    doc.status = "cancelled";
    doc.cancel_reason = reason;
    doc.updated_at = now;
    await sqliteStorage.insertRecord("purchase_documents", purchaseId, doc as unknown as Record<string, unknown>);

    // 6. Enqueue sync
    await syncQueueService.enqueue("purchase", purchaseId, "update", doc);

    return { success: true };
  }

  /**
   * Fetch purchase bill by ID with its line items and its charge lines.
   *
   * The charges come back with the bill because the purchase screen edits them as one document:
   * a bill keyed before CR-C has no rows, and its freight scalar is the caller's to present
   * (PUR-017) — this read never invents a charge row for it.
   */
  /**
   * Inward bills this store holds on the server — bought before this till was paired, entered at
   * another counter, or imported from the old panel. `purchase_documents` only ever saw the bills
   * typed on this device, so the purchase screen listed nothing while the book was full.
   */
  async getServerPurchases(): Promise<PurchaseDocumentRecord[]> {
    if (!syncQueueService.isOnline()) return [];

    const baseUrl = onlineTransactionService.getEffectiveBaseUrl();
    const deviceHeaders = await storeDeviceService.getDeviceAuthHeaders();
    // The token belongs to a store, so its store is the one to ask about — the registry's local id
    // ("store_main") is not a server store and would be refused as a tenant mismatch.
    const storeId = deviceHeaders["X-Store-Id"] || String(storeRegistryService.getActiveStore()?.id || "1");
    const params = new URLSearchParams({ store_id: storeId, module: "purchases", per_page: "200" });
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
      const rows = Array.isArray(json?.data) ? json.data : [];
      return rows.map((row: any) => this.mapServerPurchase(row)).filter(Boolean) as PurchaseDocumentRecord[];
    } catch (_) {
      // A server that will not answer must not empty the purchase screen; the local book stays.
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * This device's own bills first, then the server's that are not already filed here. A bill pushed
   * from this till carries its own id as `external_id`, so the server copy is recognised and dropped.
   */
  async getAllPurchaseDocuments(): Promise<PurchaseDocumentRecord[]> {
    const [local, server] = await Promise.all([
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents"),
      this.getServerPurchases(),
    ]);

    const known = new Set<string>();
    for (const doc of local) {
      if (doc.id) known.add(String(doc.id));
      if (doc.external_id) known.add(String(doc.external_id));
      if (doc.purchase_number) known.add(String(doc.purchase_number).toLowerCase());
    }

    const merged = [...local];
    for (const doc of server) {
      if (known.has(doc.id) || known.has(doc.purchase_number.toLowerCase())) continue;
      merged.push(doc);
    }

    return merged.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  private mapServerPurchase(row: any): PurchaseDocumentRecord | null {
    if (!row || (row.id == null && !row.invoice_number)) return null;

    const items = Array.isArray(row.items) ? row.items : [];
    const grandTotal = Number(row.grand_total || 0);
    const paid = Number(row.paid_amount || 0);

    return {
      id: String(row.external_id || row.id),
      purchase_number: String(row.invoice_number || row.document_number || `PUR-${row.id}`),
      module_key: row.module_key || "purchase",
      supplier_id: String(row.supplier_id ?? ""),
      supplier_name: row.supplier_name || "Supplier",
      supplier_gstin: row.supplier_gstin || undefined,
      supplier_invoice_no: row.supplier_invoice_no || "",
      purchase_date: String(row.invoice_date || "").slice(0, 10),
      place_of_supply: row.place_of_supply || undefined,
      is_interstate: Number(row.is_interstate || 0),
      is_rcm: Number(row.is_rcm || 0),
      itc_eligibility: row.itc_eligibility || "eligible",
      subtotal: Number(row.subtotal || 0),
      discount_total: Number(row.bill_discount || 0),
      bill_discount_type: row.bill_discount_type || undefined,
      bill_discount: Number(row.bill_discount || 0),
      freight_charges: Number(row.freight_charges || 0),
      tax_total: Number(row.tax_total || 0),
      cgst_total: Number(row.cgst_total || 0),
      sgst_total: Number(row.sgst_total || 0),
      igst_total: Number(row.igst_total || 0),
      cess_total: Number(row.cess_total || 0),
      round_off: Number(row.round_off || 0),
      grand_total: grandTotal,
      paid_amount: paid,
      payment_status: paid >= grandTotal && grandTotal > 0 ? "paid" : paid > 0 ? "partial" : "unpaid",
      status: row.status === "cancelled" ? "cancelled" : "received",
      notes: row.notes || undefined,
      sync_state: "synced",
      external_id: String(row.external_id || ""),
      // The server answers both an ISO instant and the bare timestamp SQLite stores.
      created_at: serverTimeToEpoch(row.created_at) || serverTimeToEpoch(row.invoice_date),
      updated_at: serverTimeToEpoch(row.updated_at),
      // Kept so the details drawer can show lines of a bill this device never recorded locally.
      lines: items,
    } as PurchaseDocumentRecord;
  }

  async getPurchaseBillById(
    purchaseId: string
  ): Promise<{
    document: PurchaseDocumentRecord;
    items: PurchaseItemRecord[];
    charges: PurchaseChargeRecord[];
  } | null> {
    const doc = await sqliteStorage.findById<PurchaseDocumentRecord>("purchase_documents", purchaseId);
    if (!doc) {
      // A bill that lives only on the server arrives with its lines attached, which is all the
      // drawer needs — the local charge rows cannot exist for it.
      const remote = (await this.getServerPurchases()).find(
        (d) => d.id === purchaseId || d.external_id === purchaseId || d.purchase_number === purchaseId
      );
      if (!remote) return null;
      return {
        document: remote,
        items: ((remote as any).lines || []) as PurchaseItemRecord[],
        charges: [],
      };
    }

    if (!doc.payment_status) {
      const paid = Number(doc.paid_amount || 0);
      const total = Number(doc.grand_total || 0);
      doc.payment_status = paid >= total && total > 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
    }

    const allItems = await sqliteStorage.findAll<PurchaseItemRecord>("purchase_items");
    let items = allItems.filter((i) => i.purchase_id === purchaseId);

    // Fallback: If legacy bill has no purchase_items rows, reconstruct them from stock_transactions or doc.lines
    if (items.length === 0) {
      if ((doc as any).lines && Array.isArray((doc as any).lines) && (doc as any).lines.length > 0) {
        items = (doc as any).lines;
      } else {
        const stockTxs = await sqliteStorage.findAll<any>("stock_transactions");
        const matchingTxs = stockTxs.filter(
          (tx) => tx.reference_id === purchaseId && tx.event_type === "PURCHASE_RECEIPT"
        );
        if (matchingTxs.length > 0) {
          const batches = await sqliteStorage.findAll<ProductBatch>("product_batches");
          const products = await productsStore.getAllProducts();

          items = matchingTxs.map((tx, idx) => {
            const batch = batches.find((b) => b.id === tx.batch_id);
            const prod = products.find((p) => p.id === tx.product_id);
            const rate = batch?.purchase_rate || tx.unit_cost || (doc.subtotal ? doc.subtotal / (tx.qty_delta || 1) : 0);
            const gst = doc.subtotal && doc.tax_total ? Math.round((doc.tax_total / doc.subtotal) * 100) : 12;
            const total = doc.grand_total || (tx.qty_delta * rate);

            const reconstructedItem: PurchaseItemRecord = {
              id: `pbi_rec_${doc.id}_${idx}`,
              purchase_id: doc.id,
              product_id: tx.product_id,
              product_name: prod?.name || `Inward Item (${batch?.batch_no || tx.product_id})`,
              hsn_code: prod?.hsn_sac_code || "30049099",
              batch_id: tx.batch_id || "",
              batch_no: batch?.batch_no || "BATCH-01",
              expiry_date: batch?.expiry_date || "2027-12-31",
              pack_qty: tx.qty_delta || 1,
              loose_qty: 0,
              free_qty: 0,
              units_per_pack: prod?.units_per_pack || 1,
              total_units: tx.qty_delta || 1,
              purchase_rate: rate,
              discount_percent: 0,
              discount_amount: 0,
              effective_unit_cost: tx.unit_cost || rate,
              mrp: batch?.mrp || prod?.mrp || rate * 1.2,
              selling_rate: batch?.selling_rate || prod?.sel_rate,
              gst_percent: gst,
              cgst_amount: doc.cgst_total || (doc.tax_total ? doc.tax_total / 2 : 0),
              sgst_amount: doc.sgst_total || (doc.tax_total ? doc.tax_total / 2 : 0),
              igst_amount: doc.igst_total || 0,
              cess_amount: doc.cess_total || 0,
              taxable_amount: doc.subtotal || (rate * (tx.qty_delta || 1)),
              tax_amount: doc.tax_total || 0,
              total_amount: total,
            };

            // Backfill to purchase_items so it's permanently stored in SQLite
            sqliteStorage.insertRecord("purchase_items", reconstructedItem.id, reconstructedItem as unknown as Record<string, unknown>).catch(() => {});

            return reconstructedItem;
          });
        }
      }
    }

    const chargeRows = await sqliteStorage
      .findAll<PurchaseChargeRecord>("purchase_charges")
      .catch(() => [] as PurchaseChargeRecord[]);
    const charges = chargeRows
      .filter((row) => String(row.purchase_id) === purchaseId)
      .sort((a, b) => (a.seq || 0) - (b.seq || 0));

    return { document: doc, items, charges };
  }

  /**
   * Retrieves the last recorded purchase details for a product, optionally specific to a supplier.
   * Useful for auto-filling rates, MRP, pack conversions, and displaying last purchase rate hints.
   */
  async getLastPurchaseForItem(
    productId: string,
    supplierId?: string
  ): Promise<{
    rate: number;
    mrp?: number;
    discount_percent?: number;
    units_per_pack?: number;
    gst_percent?: number;
    selling_rate?: number;
    hsn_code?: string;
    purchase_number?: string;
    purchase_date?: string;
  } | null> {
    if (!productId) return null;

    const allItems = await sqliteStorage.findAll<PurchaseItemRecord>("purchase_items");
    const matchingItems = allItems.filter((i) => i.product_id === productId);
    if (matchingItems.length === 0) return null;

    const allDocs = await sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents");
    const docMap = new Map<string, PurchaseDocumentRecord>();
    allDocs.forEach((d) => docMap.set(d.id, d));

    // Filter by supplier if provided and valid doc exists
    let candidateItems = matchingItems.map((item) => ({
      item,
      doc: docMap.get(item.purchase_id),
    })).filter((x) => x.doc && x.doc.status !== "cancelled");

    if (candidateItems.length === 0) return null;

    if (supplierId) {
      const supplierMatches = candidateItems.filter((x) => x.doc?.supplier_id === supplierId);
      if (supplierMatches.length > 0) {
        candidateItems = supplierMatches;
      }
    }

    // Sort by doc.created_at descending
    candidateItems.sort((a, b) => (b.doc?.created_at || 0) - (a.doc?.created_at || 0));
    const latest = candidateItems[0];

    return {
      rate: latest.item.purchase_rate,
      mrp: latest.item.mrp,
      discount_percent: latest.item.discount_percent,
      units_per_pack: latest.item.units_per_pack,
      gst_percent: latest.item.gst_percent,
      selling_rate: latest.item.selling_rate,
      hsn_code: latest.item.hsn_code,
      purchase_number: latest.doc?.purchase_number,
      purchase_date: latest.doc?.purchase_date,
    };
  }

  /**
   * Atomic Edit & Revision of an existing Purchase Bill:
   * 1. Reverses original stock received in batch & product master
   * 2. Reverses original supplier ledger credit entry
   * 3. Applies new items, stock updates, and recalculated taxes
   * 4. Updates supplier ledger credit for new total
   * 5. Enqueues sync update
   */
  async updatePurchaseBill(
    purchaseId: string,
    doc: PurchaseDocumentInput,
    reason = "Purchase bill revised"
  ): Promise<{
    success: boolean;
    purchaseId: string;
    purchaseNumber: string;
    syncState?: "synced" | "pending";
    syncMessage?: string;
  }> {
    const originalDoc = await sqliteStorage.findById<PurchaseDocumentRecord>("purchase_documents", purchaseId);
    if (!originalDoc) throw new Error("Purchase bill not found");
    if (originalDoc.status === "cancelled") throw new Error("Cannot edit a cancelled purchase bill");

    // Check duplicate invoice if changed
    if (
      (doc.supplier_id !== originalDoc.supplier_id || doc.supplier_invoice_no !== originalDoc.supplier_invoice_no) &&
      doc.supplier_id && doc.supplier_invoice_no
    ) {
      const dup = await this.checkDuplicateInvoice(doc.supplier_id, doc.supplier_invoice_no, purchaseId);
      if (dup) {
        throw new Error(`Supplier invoice #${doc.supplier_invoice_no} is already recorded on ${dup.purchase_number}`);
      }
    }

    const allItems = await sqliteStorage.findAll<PurchaseItemRecord>("purchase_items");
    const originalItems = allItems.filter((i) => i.purchase_id === purchaseId);
    const now = Date.now();

    // Same rule as the inward path: this store's heads are checked before the edit writes anything.
    const docCharges = doc.charges?.length
      ? await resolveCharges(doc.charges, doc.place_of_supply ?? null)
      : await legacyFreightCharge(doc.freight_charges || 0, doc.place_of_supply ?? null);

    const docTotals = this.calculateDocumentTotals(doc.lines, Boolean(doc.is_interstate), {
      bill_discount_type: doc.bill_discount_type,
      bill_discount_value: doc.bill_discount,
      freight_charges: doc.freight_charges,
      round_off: doc.round_off,
      charges: docCharges,
    });

    if (docCharges.length && round2(docTotals.engine.net_before_round + docTotals.roundOff) < 0) {
      throw new Error("The charges on this bill would take the payable below zero.");
    }

    // 1. REVERSE ORIGINAL ITEMS
    for (const item of originalItems) {
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

      const revTxId = `stk_tx_${now}_rev_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("stock_transactions", revTxId, {
        id: revTxId,
        product_id: item.product_id,
        batch_id: item.batch_id,
        event_type: "PURCHASE_UPDATE_REVERSE",
        qty_delta: -item.total_units,
        unit_cost: item.effective_unit_cost,
        reference_type: "PURCHASE_BILL",
        reference_id: purchaseId,
        notes: `Reversal for edit: ${originalDoc.purchase_number}`,
        created_at: now,
      });

      await sqliteStorage.deleteRecord("purchase_items", item.id);
    }

    // 2. REVERSE ORIGINAL SUPPLIER LEDGER IMPACT
    await supplierLedgerService.recordReturnDebit({
      supplier_id: originalDoc.supplier_id,
      return_id: purchaseId,
      return_number: `REV-${originalDoc.purchase_number}`,
      return_date: new Date().toISOString().slice(0, 10),
      amount: originalDoc.grand_total,
      notes: `Reversal for bill edit: ${reason}`,
    });

    // 3. APPLY UPDATED ITEMS
    const isInterstate = Boolean(doc.is_interstate);
    const newItemRecords: PurchaseItemRecord[] = [];
    const receivedMap: Record<string, number> = {};

    for (const line of doc.lines) {
      const calc = this.calculateLineTotals(line, isInterstate);

      receivedMap[line.product_id] = (receivedMap[line.product_id] || 0) + (line.pack_qty || line.qty || 0);

      const batchKey = line.batch_no?.trim()
        ? line.batch_no.trim().replace(/\s+/g, "_")
        : "NOBATCH";
      const batchId = `batch_${line.product_id}_${batchKey}`;
      const existingBatch = await sqliteStorage.findById<ProductBatch>("product_batches", batchId);
      const updatedStock = (existingBatch?.stock_qty || 0) + calc.total_stock_units;
      const unitsPerPack = Math.max(1, line.units_per_pack || 1);

      await productsStore.upsertBatch({
        id: batchId,
        product_id: line.product_id,
        batch_no: line.batch_no?.trim() || "",
        mfg_date: line.mfg_date,
        expiry_date: line.expiry_date || "",
        stock_qty: updatedStock,
        mrp: line.mrp,
        purchase_rate: line.purchase_rate,
        selling_rate: line.selling_rate || line.mrp || undefined,
        rack_location: line.shelf_location,
      });

      let prod = await productsStore.getProductById(line.product_id);
      if (prod) {
        prod.current_stock = (prod.current_stock || 0) + calc.total_stock_units;
        prod.ptr = line.ptr ?? line.purchase_rate;
        if (line.pts) prod.pts = line.pts;
        if (line.mrp) prod.mrp = line.mrp;
        if (line.selling_rate) prod.sel_rate = line.selling_rate;
        await productsStore.upsertProduct(prod);
      }

      const stockTxId = `stk_tx_${now}_app_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
        id: stockTxId,
        product_id: line.product_id,
        batch_id: batchId,
        event_type: "PURCHASE_RECEIPT",
        qty_delta: calc.total_stock_units,
        unit_cost: calc.effective_unit_cost,
        reference_type: "PURCHASE_BILL",
        reference_id: purchaseId,
        notes: `Inward (Edit): Inv #${doc.supplier_invoice_no} (${line.batch_no})`,
        created_at: now,
      });

      const itemId = `pbi_${now}_${Math.random().toString(16).slice(2, 6)}`;
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
        gross_weight_kg: line.gross_weight_kg ?? null,
        free_qty: line.free_qty || 0,
        free_loose_qty: line.free_loose_qty || 0,
        units_per_pack: unitsPerPack,
        total_units: calc.total_stock_units,
        purchase_rate: line.purchase_rate,
        ptr: line.ptr ?? line.purchase_rate,
        pts: line.pts,
        ptss: line.ptss,
        discount_type: line.discount_type || "percent",
        discount_percent: line.discount_type === "amount" ? 0 : line.discount_percent || 0,
        discount_amount: line.discount_type === "percent" ? 0 : line.discount_amount ?? calc.discount_amount,
        effective_unit_cost: calc.effective_unit_cost,
        taxable_amount: calc.taxable_amount,
        mrp: line.mrp,
        selling_rate: line.selling_rate,
        gst_percent: line.gst_percent,
        cgst_amount: calc.cgst_amount,
        sgst_amount: calc.sgst_amount,
        igst_amount: calc.igst_amount,
        cess_amount: calc.cess_amount,
        tax_amount: calc.total_tax,
        total_amount: calc.total_amount,
      };

      await sqliteStorage.insertRecord("purchase_items", itemId, itemRow as unknown as Record<string, unknown>);
      newItemRecords.push(itemRow);
    }

    // 4. UPDATE PURCHASE DOCUMENT RECORD
    const updatedDocRow: PurchaseDocumentRecord = {
      ...originalDoc,
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
      subtotal: docTotals.subtotal,
      discount_total: docTotals.discountTotal,
      bill_discount_type: doc.bill_discount_type || "amount",
      bill_discount: doc.bill_discount || 0,
      freight_charges: docTotals.freightCharges,
      tax_total: docTotals.taxTotal,
      cgst_total: docTotals.cgstTotal,
      sgst_total: docTotals.sgstTotal,
      igst_total: docTotals.igstTotal,
      cess_total: docTotals.cessTotal,
      round_off: docTotals.roundOff,
      grand_total: docTotals.grandTotal,
      is_revised: 1,
      notes: doc.notes ? `${doc.notes} (Edited: ${reason})` : `Edited: ${reason}`,
      updated_at: now,
      sync_state: "pending",
    };

    await sqliteStorage.insertRecord("purchase_documents", purchaseId, updatedDocRow as unknown as Record<string, unknown>);

    // 5. POST NEW SUPPLIER LEDGER CREDIT
    await supplierLedgerService.recordPurchaseCredit({
      supplier_id: doc.supplier_id,
      supplier_name: doc.supplier_name,
      purchase_id: purchaseId,
      purchase_number: originalDoc.purchase_number,
      purchase_date: doc.purchase_date,
      amount: docTotals.grandTotal,
      notes: `Inward Invoice (Revised): ${doc.supplier_invoice_no}`,
    });

    // 6. UPDATE PO FULFILLMENT IF LINKED
    if (doc.po_id) {
      await purchaseOrderService.updateReceivedQty(doc.po_id, receivedMap);
    }

    // 7. Re-post the charge lines: rows, spread, landed cost and expense entries. Anything
    //    this edit no longer carries is deleted, so an edit cannot leave orphan money.
    await postCharges({
      purchaseId,
      invoiceNumber: doc.supplier_invoice_no,
      charges: docCharges,
      result: docTotals.engine,
      purchaseLines: doc.lines,
      itemIdsByLine: Object.fromEntries(doc.lines.map((_, idx) => [String(idx), newItemRecords[idx]?.id])),
    });

    // 8. A re-post writes `reversed_amount: 0`, so the debit notes already filed against this
    //    bill have to be read back into the new rows — otherwise an edit quietly gives the
    //    supplier money it never returned (PUR-015).
    await recordReversals(purchaseId);

    // 9. ENQUEUE FOR SYNC
    const queueId = await syncQueueService.enqueue("purchase", purchaseId, "update", {
      ...updatedDocRow,
      items: newItemRecords,
      charges: chargePayload(docCharges),
    });

    if (syncQueueService.isOnline()) {
      const ack = await syncQueueService.syncSingleItem(queueId);
      if (ack.success) {
        return {
          success: true,
          purchaseId,
          purchaseNumber: originalDoc.purchase_number,
          syncState: "synced",
        };
      }

      return {
        success: true,
        purchaseId,
        purchaseNumber: originalDoc.purchase_number,
        syncState: "pending",
        syncMessage: ack.error,
      };
    }

    return {
      success: true,
      purchaseId,
      purchaseNumber: originalDoc.purchase_number,
      syncState: "pending",
    };
  }
}

export const purchaseService = new PurchaseService();

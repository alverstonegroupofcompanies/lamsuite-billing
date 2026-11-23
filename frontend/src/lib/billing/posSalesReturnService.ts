import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch } from "../masters/productsStore";
import { syncQueueService } from "../sync/syncQueueService";
import { calculateDocumentTaxes, type CompanyTaxMode } from "../tax-engine/taxEngine";
import { stateLabel } from "../gst/stateCodes";
import { salesReturnService } from "./salesReturnService";
import {
  reverseCreditsFromOriginal,
  sumReturnCredits,
  type ReturnCredit,
  type ReturnCreditTotals,
} from "./salesReturnPricing";
import { companySettingsService } from "../settings/companySettingsService";
import { storeToday } from "../dateTimeUtils";
import type { InvoiceRecord, InvoiceItemRecord } from "../reports/reportEngine";

export interface ReturnItemInput {
  product_id: string;
  product_name?: string;
  batch_id: string;
  batch_no?: string;
  qty: number;
  loose_qty?: number;
  units_per_pack?: number;
  return_rate: number;
  gst_percent: number;
}

export interface QuotationLineInput {
  product_id: string;
  product_name: string;
  batch_id: string;
  batch_no?: string;
  hsn_code?: string;
  qty: number;
  loose_qty?: number;
  units_per_pack?: number;
  unit_price: number;
  discount_percent?: number;
  discount_amount?: number;
  gst_percent: number;
}

export interface QuotationOptions {
  customer_id?: string;
  customer_phone?: string;
  customer_gstin?: string;
  place_of_supply?: string;
  store_id?: string;
}

export class PosSalesReturnService {
  async processSalesReturn(
    returnNumber: string,
    originalInvoiceNumber: string,
    customerId: string,
    customerName: string,
    returnItems: ReturnItemInput[],
    refundPaymentMode = "Cash"
  ): Promise<{ success: boolean; creditNoteId: string; refundAmount: number }> {
    const now = Date.now();
    const creditNoteId = `cn_${now}_${Math.random().toString(16).slice(2, 6)}`;

    // Look up original invoice if present
    let originalInv: InvoiceRecord | null = null;
    if (originalInvoiceNumber) {
      const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
      originalInv = allInvoices.find((i) => i.invoice_number === originalInvoiceNumber) || null;
    }

    const isTaxInclusive = (originalInv as any)?.is_tax_inclusive || false;
    const storeState = (originalInv as any)?.store_state_code || companySettingsService.getSettings().state_code || "32";
    const placeOfSupply = originalInv?.place_of_supply || stateLabel(storeState);

    // A credit note gives back the money the original bill charged, so when this till
    // still holds that bill its lines are reversed. Otherwise there is nothing to
    // reverse and the return is priced on its own lines.
    const originalItems = originalInv
      ? (await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items")).filter(
          (it) => String(it.invoice_id) === String(originalInv!.id)
        )
      : [];
    const priorReturnedUnits = await salesReturnService.getReturnedQtyMapForInvoice(
      originalInvoiceNumber
    );

    let credits: ReturnCredit[] = [];
    let totals: ReturnCreditTotals;
    const reversed = reverseCreditsFromOriginal(
      originalInv,
      originalItems,
      returnItems,
      priorReturnedUnits
    );

    if (reversed) {
      credits = reversed;
      totals = sumReturnCredits(credits);
    } else {
      const isComposition = (originalInv as any)?.is_composition || (originalInv as any)?.gst_type === "composition" || (originalInv as any)?.gst_type === "no_tax" || (originalInv && originalInv.tax_total === 0);
      const taxResult = calculateDocumentTaxes({
        store_state: storeState,
        customer_gstin: originalInv?.customer_gstin,
        place_of_supply: placeOfSupply,
        default_tax_mode: isTaxInclusive ? "inclusive" : "exclusive",
        is_composition: Boolean(isComposition),
        lines: returnItems.map((item, idx) => ({
          line_id: `line_${idx}`,
          product_id: item.product_id,
          product_name: item.product_name || `Item ${idx}`,
          qty: item.qty,
          loose_qty: item.loose_qty || 0,
          units_per_pack: item.units_per_pack || 1,
          unit_price: item.return_rate,
          gst_percent: item.gst_percent,
        })),
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
        discount_total: Math.round((taxResult.line_discount_total + taxResult.bill_discount_total) * 100) / 100,
        tax_total: taxResult.total_tax,
        cgst_total: taxResult.cgst_total,
        sgst_total: taxResult.sgst_total,
        igst_total: taxResult.igst_total,
        cess_total: taxResult.cess_total,
        round_off: taxResult.round_off,
        grand_total: taxResult.grand_total,
      };
    }

    for (let i = 0; i < returnItems.length; i++) {
      const item = returnItems[i];
      const unitsPerPack = item.units_per_pack || 1;
      const returnedBaseUnits = item.qty * unitsPerPack + (item.loose_qty || 0);

      // Restock batch in SQLite
      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", item.batch_id);
      if (batch) {
        batch.stock_qty += returnedBaseUnits;
        await productsStore.upsertBatch(batch);

        // Double-entry stock transaction
        const stockTxId = `stk_ret_${now}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
          id: stockTxId,
          product_id: item.product_id,
          batch_id: item.batch_id,
          event_type: "SALES_RETURN",
          qty_delta: returnedBaseUnits,
          reference_type: "CREDIT_NOTE",
          reference_id: returnNumber,
          created_at: now,
        });
      }
    }

    const creditNoteRow: InvoiceRecord = {
      id: creditNoteId,
      module_key: "credit_note",
      invoice_number: returnNumber,
      invoice_date: storeToday(companySettingsService.getSettings()),
      customer_id: customerId,
      customer_name: customerName,
      customer_gstin: originalInv?.customer_gstin,
      place_of_supply: placeOfSupply,
      subtotal: totals.subtotal,
      taxable_subtotal: totals.taxable_subtotal,
      discount_total: totals.discount_total,
      tax_total: totals.tax_total,
      cgst_total: totals.cgst_total,
      sgst_total: totals.sgst_total,
      igst_total: totals.igst_total,
      cess_total: totals.cess_total,
      round_off: totals.round_off,
      grand_total: totals.grand_total,
      paid_amount: totals.grand_total,
      payment_mode: refundPaymentMode,
      status: "issued",
      original_invoice_number: originalInvoiceNumber,
      created_at: now,
    };

    await sqliteStorage.insertRecord("invoices", creditNoteId, creditNoteRow);

    // Mirror each item into invoice_items
    for (let i = 0; i < returnItems.length; i++) {
      const item = returnItems[i];
      const credit = credits[i];
      const itemId = `cni_${now}_${i}_${Math.random().toString(16).slice(2, 6)}`;
      const mirrorItem: InvoiceItemRecord = {
        id: itemId,
        invoice_id: creditNoteId,
        product_id: item.product_id,
        product_name: item.product_name || "Returned Item",
        batch_no: item.batch_no,
        qty: item.qty,
        loose_qty: item.loose_qty || 0,
        units_per_pack: item.units_per_pack || 1,
        unit_price: item.return_rate,
        taxable_amount: credit.taxable_amount,
        gst_percent: item.gst_percent,
        cgst_amount: credit.cgst_amount,
        sgst_amount: credit.sgst_amount,
        igst_amount: credit.igst_amount,
        cess_amount: credit.cess_amount,
        total_amount: credit.total_amount,
      };
      await sqliteStorage.insertRecord("invoice_items", itemId, mirrorItem);
    }

    await syncQueueService.enqueue("invoice", creditNoteId, "create", {
      ...creditNoteRow,
      // The server reverses this note from the bill it credits, and its own id for
      // that bill survives a renumbering; the printed number may not.
      original_invoice_id: originalInv?.id || null,
      items: returnItems.map((item, idx) => ({
        product_id: item.product_id,
        product_name: item.product_name || "Returned Item",
        batch_no: item.batch_no,
        qty: item.qty,
        loose_qty: item.loose_qty || 0,
        units_per_pack: item.units_per_pack || 1,
        unit_price: item.return_rate,
        gst_percent: item.gst_percent,
        taxable_amount: credits[idx].taxable_amount,
        cgst_amount: credits[idx].cgst_amount,
        sgst_amount: credits[idx].sgst_amount,
        igst_amount: credits[idx].igst_amount,
        cess_amount: credits[idx].cess_amount,
        tax_amount: credits[idx].tax_amount,
        total_amount: credits[idx].total_amount,
      })),
    });

    return {
      success: true,
      creditNoteId,
      refundAmount: totals.grand_total,
    };
  }

  async createQuotation(
    quotationNumber?: string,
    customerName: string = "Walk-in Customer",
    lines: QuotationLineInput[] = [],
    defaultTaxMode: CompanyTaxMode = "exclusive",
    options: QuotationOptions = {}
  ): Promise<{ success: boolean; quotationId: string; quotationNumber: string }> {
    if (lines.length === 0) {
      throw new Error("Cannot save a quotation without line items.");
    }

    const assignedQuotationNumber =
      quotationNumber || (await companySettingsService.generateNextDocumentNumber("quotation"));
    if (quotationNumber) {
      await companySettingsService.syncNextDocumentSequence("quotation", quotationNumber);
    }
    const quotationId = `quot_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const now = Date.now();

    const taxLines = lines.map((line, idx) => ({
      line_id: `line_${idx}`,
      product_id: line.product_id,
      product_name: line.product_name,
      qty: line.qty,
      loose_qty: line.loose_qty || 0,
      units_per_pack: line.units_per_pack || 1,
      unit_price: line.unit_price,
      discount_percent: line.discount_percent || 0,
      discount_amount: line.discount_amount || 0,
      gst_percent: line.gst_percent,
    }));

    const storeSettings = companySettingsService.getSettings();
    const stState = storeSettings.state_code || "32";
    const isComp = storeSettings.gst_type === "composition" || storeSettings.gst_type === "no_tax";

    const taxResult = calculateDocumentTaxes({
      store_state: stState,
      customer_gstin: options.customer_gstin,
      place_of_supply: options.place_of_supply,
      default_tax_mode: defaultTaxMode,
      gst_type: storeSettings.gst_type,
      is_composition: isComp,
      lines: taxLines,
    });

    const quotationRow: InvoiceRecord = {
      id: quotationId,
      module_key: "quotation",
      store_id: options.store_id,
      invoice_number: assignedQuotationNumber,
      invoice_date: storeToday(companySettingsService.getSettings()),
      customer_id: options.customer_id,
      customer_name: customerName,
      customer_phone: options.customer_phone,
      customer_gstin: options.customer_gstin,
      place_of_supply: options.place_of_supply,
      subtotal: taxResult.taxable_subtotal,
      taxable_subtotal: taxResult.taxable_subtotal,
      discount_total: Math.round((taxResult.line_discount_total + taxResult.bill_discount_total) * 100) / 100,
      tax_total: taxResult.total_tax,
      cgst_total: taxResult.cgst_total,
      sgst_total: taxResult.sgst_total,
      igst_total: taxResult.igst_total,
      cess_total: taxResult.cess_total,
      round_off: taxResult.round_off,
      grand_total: taxResult.grand_total,
      paid_amount: 0,
      payment_mode: "Quotation",
      status: "issued",
      sync_state: "pending",
      created_at: now,
    };

    await sqliteStorage.insertRecord("invoices", quotationId, quotationRow);

    const syncItems: Record<string, unknown>[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineRes = taxResult.lines[i];
      const itemId = `qi_${now}_${i}_${Math.random().toString(16).slice(2, 6)}`;
      const mirrorItem: InvoiceItemRecord = {
        id: itemId,
        invoice_id: quotationId,
        product_id: line.product_id,
        product_name: line.product_name,
        batch_no: line.batch_no,
        hsn_code: line.hsn_code,
        qty: line.qty,
        loose_qty: line.loose_qty || 0,
        units_per_pack: line.units_per_pack || 1,
        unit_price: line.unit_price,
        discount_percent: line.discount_percent || 0,
        discount_amount: line.discount_amount || 0,
        taxable_amount: lineRes.taxable_amount,
        gst_percent: line.gst_percent,
        cgst_amount: lineRes.cgst_amount,
        sgst_amount: lineRes.sgst_amount,
        igst_amount: lineRes.igst_amount,
        cess_amount: lineRes.cess_amount,
        total_amount: lineRes.total_amount,
      };
      await sqliteStorage.insertRecord("invoice_items", itemId, mirrorItem);
      syncItems.push({ ...mirrorItem });
    }

    try {
      await syncQueueService.enqueue("invoice", quotationId, "create", {
        ...quotationRow,
        items: syncItems,
      } as unknown as Record<string, unknown>);
    } catch (err) {
      console.warn("Quotation sync enqueue failed:", err);
    }

    return { success: true, quotationId, quotationNumber: assignedQuotationNumber };
  }

  async convertQuotationToInvoice(quotationId: string): Promise<{ success: boolean; quotation: InvoiceRecord }> {
    const quotation = await sqliteStorage.findById<InvoiceRecord>("invoices", quotationId);
    if (!quotation) throw new Error("Quotation not found");

    quotation.status = "converted";
    quotation.sync_state = "pending";
    await sqliteStorage.insertRecord("invoices", quotation.id, quotation);

    try {
      await syncQueueService.enqueue("invoice", quotation.id, "update", {
        ...quotation,
      } as unknown as Record<string, unknown>);
    } catch (err) {
      console.warn("Quotation conversion sync enqueue failed:", err);
    }

    return { success: true, quotation };
  }
}

export const posSalesReturnService = new PosSalesReturnService();

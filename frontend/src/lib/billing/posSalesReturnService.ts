import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch } from "../masters/productsStore";
import { syncQueueService } from "../sync/syncQueueService";
import { calculateDocumentTaxes, type CompanyTaxMode } from "../tax-engine/taxEngine";
import { companySettingsService } from "../settings/companySettingsService";
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
  qty: number;
  unit_price: number;
  gst_percent: number;
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
    const storeState = (originalInv as any)?.store_state_code || "32";
    const placeOfSupply = originalInv?.place_of_supply || "32-Kerala";

    const taxLines = returnItems.map((item, idx) => ({
      line_id: `line_${idx}`,
      product_id: item.product_id,
      product_name: item.product_name || `Item ${idx}`,
      qty: item.qty,
      loose_qty: item.loose_qty || 0,
      units_per_pack: item.units_per_pack || 1,
      unit_price: item.return_rate,
      gst_percent: item.gst_percent,
    }));

    const isComposition = (originalInv as any)?.is_composition || (originalInv as any)?.gst_type === "composition" || (originalInv as any)?.gst_type === "no_tax" || (originalInv && originalInv.tax_total === 0);
    const taxResult = calculateDocumentTaxes({
      store_state: storeState,
      customer_gstin: originalInv?.customer_gstin,
      place_of_supply: placeOfSupply,
      default_tax_mode: isTaxInclusive ? "inclusive" : "exclusive",
      is_composition: Boolean(isComposition),
      lines: taxLines,
    });

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
      invoice_date: new Date().toISOString().slice(0, 10),
      customer_id: customerId,
      customer_name: customerName,
      customer_gstin: originalInv?.customer_gstin,
      place_of_supply: placeOfSupply,
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
      paid_amount: taxResult.grand_total,
      payment_mode: refundPaymentMode,
      status: "issued",
      original_invoice_number: originalInvoiceNumber,
      created_at: now,
    };

    await sqliteStorage.insertRecord("invoices", creditNoteId, creditNoteRow);

    // Mirror each item into invoice_items
    for (let i = 0; i < returnItems.length; i++) {
      const item = returnItems[i];
      const lineRes = taxResult.lines[i];
      const itemId = `cni_${now}_${i}_${Math.random().toString(16).slice(2, 6)}`;
      const mirrorItem: InvoiceItemRecord = {
        id: itemId,
        invoice_id: creditNoteId,
        product_id: item.product_id,
        product_name: item.product_name || "Returned Item",
        batch_no: item.batch_no,
        qty: lineRes.qty,
        unit_price: item.return_rate,
        gst_percent: item.gst_percent,
        cgst_amount: lineRes.cgst_amount,
        sgst_amount: lineRes.sgst_amount,
        igst_amount: lineRes.igst_amount,
        total_amount: lineRes.total_amount,
      };
      await sqliteStorage.insertRecord("invoice_items", itemId, mirrorItem);
    }

    await syncQueueService.enqueue("invoice", creditNoteId, "create", {
      ...creditNoteRow,
      items: returnItems.map((item, idx) => ({
        product_id: item.product_id,
        product_name: item.product_name || "Returned Item",
        batch_no: item.batch_no,
        qty: taxResult.lines[idx].qty,
        unit_price: item.return_rate,
        gst_percent: item.gst_percent,
        tax_amount: Math.round((taxResult.lines[idx].cgst_amount + taxResult.lines[idx].sgst_amount + taxResult.lines[idx].igst_amount + taxResult.lines[idx].cess_amount) * 100) / 100,
        total_amount: taxResult.lines[idx].total_amount,
      })),
    });

    return {
      success: true,
      creditNoteId,
      refundAmount: taxResult.grand_total,
    };
  }

  async createQuotation(
    quotationNumber: string,
    customerName: string,
    lines: QuotationLineInput[],
    defaultTaxMode: CompanyTaxMode = "exclusive"
  ): Promise<{ success: boolean; quotationId: string }> {
    const quotationId = `quot_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const now = Date.now();

    const taxLines = lines.map((line, idx) => ({
      line_id: `line_${idx}`,
      product_id: line.product_id,
      product_name: line.product_name,
      qty: line.qty,
      unit_price: line.unit_price,
      gst_percent: line.gst_percent,
    }));

    const storeSettings = companySettingsService.getSettings();
    const stState = storeSettings.state_code || "32";
    const isComp = storeSettings.gst_type === "composition" || storeSettings.gst_type === "no_tax";

    const taxResult = calculateDocumentTaxes({
      store_state: stState,
      default_tax_mode: defaultTaxMode,
      gst_type: storeSettings.gst_type,
      is_composition: isComp,
      lines: taxLines,
    });

    const quotationRow: InvoiceRecord = {
      id: quotationId,
      module_key: "quotation",
      invoice_number: quotationNumber,
      invoice_date: new Date().toISOString().slice(0, 10),
      customer_name: customerName,
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
      created_at: now,
    };

    await sqliteStorage.insertRecord("invoices", quotationId, quotationRow);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineRes = taxResult.lines[i];
      const itemId = `qi_${now}_${i}_${Math.random().toString(16).slice(2, 6)}`;
      const mirrorItem: InvoiceItemRecord = {
        id: itemId,
        invoice_id: quotationId,
        product_id: line.product_id,
        product_name: line.product_name,
        qty: line.qty,
        unit_price: line.unit_price,
        gst_percent: line.gst_percent,
        cgst_amount: lineRes.cgst_amount,
        sgst_amount: lineRes.sgst_amount,
        igst_amount: lineRes.igst_amount,
        total_amount: lineRes.total_amount,
      };
      await sqliteStorage.insertRecord("invoice_items", itemId, mirrorItem);
    }

    return { success: true, quotationId };
  }

  async convertQuotationToInvoice(quotationId: string): Promise<{ success: boolean; quotation: InvoiceRecord }> {
    const quotation = await sqliteStorage.findById<InvoiceRecord>("invoices", quotationId);
    if (!quotation) throw new Error("Quotation not found");

    quotation.status = "converted";
    await sqliteStorage.insertRecord("invoices", quotation.id, quotation);

    return { success: true, quotation };
  }
}

export const posSalesReturnService = new PosSalesReturnService();

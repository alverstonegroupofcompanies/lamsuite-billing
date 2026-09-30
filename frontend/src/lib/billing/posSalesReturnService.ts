import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch } from "../masters/productsStore";
import { syncQueueService } from "../sync/syncQueueService";
import type { InvoiceRecord, InvoiceItemRecord } from "../reports/reportEngine";

export interface ReturnItemInput {
  product_id: string;
  batch_id: string;
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
    let subtotal = 0;
    let taxTotal = 0;
    const now = Date.now();
    const creditNoteId = `cn_${now}_${Math.random().toString(16).slice(2, 6)}`;

    for (const item of returnItems) {
      const unitsPerPack = item.units_per_pack || 1;
      const totalUnits = item.qty + (item.loose_qty ? item.loose_qty / unitsPerPack : 0);
      const lineTaxable = Math.round(totalUnits * item.return_rate * 100) / 100;
      const lineTax = Math.round((lineTaxable * item.gst_percent) / 100 * 100) / 100;

      subtotal = Math.round((subtotal + lineTaxable) * 100) / 100;
      taxTotal = Math.round((taxTotal + lineTax) * 100) / 100;

      // Restock batch in SQLite
      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", item.batch_id);
      if (batch) {
        const returnedBaseUnits = item.qty * unitsPerPack + (item.loose_qty || 0);
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

    const grandTotal = Math.round((subtotal + taxTotal) * 100) / 100;

    const creditNoteRow: InvoiceRecord = {
      id: creditNoteId,
      module_key: "credit_note",
      invoice_number: returnNumber,
      invoice_date: new Date().toISOString().slice(0, 10),
      customer_id: customerId,
      customer_name: customerName,
      subtotal,
      discount_total: 0,
      tax_total: taxTotal,
      round_off: 0,
      grand_total: grandTotal,
      paid_amount: grandTotal,
      payment_mode: refundPaymentMode,
      status: "issued",
      original_invoice_number: originalInvoiceNumber,
      created_at: now,
    };

    await sqliteStorage.insertRecord("invoices", creditNoteId, creditNoteRow);
    await syncQueueService.enqueue("invoice", creditNoteId, "create", creditNoteRow as unknown as Record<string, unknown>);

    return {
      success: true,
      creditNoteId,
      refundAmount: grandTotal,
    };
  }

  async createQuotation(
    quotationNumber: string,
    customerName: string,
    lines: QuotationLineInput[]
  ): Promise<{ success: boolean; quotationId: string }> {
    const quotationId = `quot_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const now = Date.now();

    let subtotal = 0;
    let taxTotal = 0;

    for (const line of lines) {
      const lineTaxable = Math.round(line.qty * line.unit_price * 100) / 100;
      const lineTax = Math.round((lineTaxable * line.gst_percent) / 100 * 100) / 100;
      subtotal = Math.round((subtotal + lineTaxable) * 100) / 100;
      taxTotal = Math.round((taxTotal + lineTax) * 100) / 100;
    }

    const quotationRow: InvoiceRecord = {
      id: quotationId,
      module_key: "quotation",
      invoice_number: quotationNumber,
      invoice_date: new Date().toISOString().slice(0, 10),
      customer_name: customerName,
      subtotal,
      discount_total: 0,
      tax_total: taxTotal,
      round_off: 0,
      grand_total: Math.round((subtotal + taxTotal) * 100) / 100,
      paid_amount: 0,
      payment_mode: "Quotation",
      status: "issued",
      created_at: now,
    };

    await sqliteStorage.insertRecord("invoices", quotationId, quotationRow);
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

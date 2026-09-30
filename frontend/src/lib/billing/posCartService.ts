import { productsStore, type ProductItem, type ProductBatch } from "../masters/productsStore";
import {
  calculateLineTotals,
  calculateInvoiceTotals,
  type BillingLineInput,
  type CalculatedLine,
  type InvoiceTotals,
  type CompanyTaxMode,
} from "./billingCalculations";
import { sqliteStorage } from "../db/sqliteStorage";
import { syncQueueService } from "../sync/syncQueueService";

export interface PosCartLine {
  id: string;
  product: ProductItem;
  selectedBatch: ProductBatch;
  qty: number;
  loose_qty: number;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  discount_manual?: boolean;
  rate_basis: "sel_rate" | "mrp" | "ptr" | "pts" | "ptss";
  calculated: CalculatedLine;
}

export interface PosPrescriptionMeta {
  patient_id?: string;
  patient_name?: string;
  patient_age?: string | number;
  patient_gender?: string;
  doctor_id?: string;
  doctor_name?: string;
  doctor_reg_no?: string;
  prescription_no?: string;
  prescription_date?: string;
}

export class PosCartService {
  private lines: PosCartLine[] = [];
  private customerId = "";
  private customerName = "Walk-in Customer";
  private customerGstin = "";
  private placeOfSupply = "";
  private billDiscount: { type: "percent" | "amount"; value: number } = { type: "amount", value: 0 };
  private companyTaxMode: CompanyTaxMode = "inclusive";
  private isInterState = false;
  private prescriptionMeta: PosPrescriptionMeta = {};

  getLines(): PosCartLine[] {
    return [...this.lines];
  }

  setCustomer(id: string, name: string, gstin = "", placeOfSupply = "") {
    this.customerId = id;
    this.customerName = name;
    this.customerGstin = gstin;
    this.placeOfSupply = placeOfSupply;
  }

  setPrescriptionMeta(meta: PosPrescriptionMeta) {
    this.prescriptionMeta = { ...meta };
  }

  getPrescriptionMeta(): PosPrescriptionMeta {
    return { ...this.prescriptionMeta };
  }

  setBillDiscount(type: "percent" | "amount", value: number) {
    this.billDiscount = { type, value };
  }

  setCompanyTaxMode(mode: CompanyTaxMode) {
    this.companyTaxMode = mode;
    this.recalculateAllLines();
  }

  private recalculateAllLines() {
    this.lines = this.lines.map((l) => ({
      ...l,
      calculated: this.calculateLine(l),
    }));
  }

  private calculateLine(line: Omit<PosCartLine, "calculated">): CalculatedLine {
    const input: BillingLineInput = {
      qty: line.qty,
      loose_qty: line.loose_qty,
      units_per_pack: line.product.units_per_pack,
      unit_price: line.unit_price,
      mrp: line.product.mrp,
      ptr: line.product.ptr,
      pts: line.product.pts,
      discount_percent: line.discount_percent,
      discount_amount: line.discount_amount,
      gst_percent: line.product.gst_percent,
      rate_basis: line.rate_basis,
    };
    return calculateLineTotals(input, this.companyTaxMode, this.isInterState);
  }

  async scanBarcodeAndAddToCart(barcode: string): Promise<{ success: boolean; line?: PosCartLine; error?: string }> {
    const product = await productsStore.findProductByBarcode(barcode);
    if (!product) {
      return { success: false, error: `Product not found for barcode: ${barcode}` };
    }

    const batch = await productsStore.getEarliestExpiringBatch(product.id);
    if (!batch) {
      return { success: false, error: `No available stock batch for: ${product.name}` };
    }

    return this.addProductToCart(product, batch);
  }

  addProductToCart(product: ProductItem, batch: ProductBatch, qty = 1, looseQty = 0): { success: boolean; line: PosCartLine } {
    const existingIndex = this.lines.findIndex((l) => l.product.id === product.id && l.selectedBatch.id === batch.id);

    const unitPrice = product.sel_rate || product.mrp;
    const lineId = `line_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;

    if (existingIndex >= 0) {
      const existing = this.lines[existingIndex];
      const updatedQty = existing.qty + qty;
      const updatedLoose = existing.loose_qty + looseQty;

      const updatedLine: PosCartLine = {
        ...existing,
        qty: updatedQty,
        loose_qty: updatedLoose,
        calculated: this.calculateLine({
          ...existing,
          qty: updatedQty,
          loose_qty: updatedLoose,
        }),
      };
      this.lines[existingIndex] = updatedLine;
      return { success: true, line: updatedLine };
    }

    const baseLine: Omit<PosCartLine, "calculated"> = {
      id: lineId,
      product,
      selectedBatch: batch,
      qty,
      loose_qty: looseQty,
      unit_price: unitPrice,
      discount_percent: 0,
      discount_amount: 0,
      rate_basis: "sel_rate",
    };

    const newLine: PosCartLine = {
      ...baseLine,
      calculated: this.calculateLine(baseLine),
    };

    this.lines.push(newLine);
    return { success: true, line: newLine };
  }

  updateLineQuantity(lineId: string, qty: number, looseQty = 0) {
    const index = this.lines.findIndex((l) => l.id === lineId);
    if (index >= 0) {
      const line = this.lines[index];
      line.qty = Math.max(0, qty);
      line.loose_qty = Math.max(0, looseQty);
      line.calculated = this.calculateLine(line);
    }
  }

  removeLine(lineId: string) {
    this.lines = this.lines.filter((l) => l.id !== lineId);
  }

  clearCart() {
    this.lines = [];
    this.customerId = "";
    this.customerName = "Walk-in Customer";
    this.customerGstin = "";
    this.placeOfSupply = "";
    this.billDiscount = { type: "amount", value: 0 };
    this.prescriptionMeta = {};
  }

  getTotals(): InvoiceTotals {
    const billingLines: BillingLineInput[] = this.lines.map((l) => ({
      qty: l.qty,
      loose_qty: l.loose_qty,
      units_per_pack: l.product.units_per_pack,
      unit_price: l.unit_price,
      mrp: l.product.mrp,
      ptr: l.product.ptr,
      pts: l.product.pts,
      discount_percent: l.discount_percent,
      discount_amount: l.discount_amount,
      gst_percent: l.product.gst_percent,
      rate_basis: l.rate_basis,
    }));

    return calculateInvoiceTotals(billingLines, this.billDiscount, this.companyTaxMode, this.isInterState, true);
  }

  async finalizeInvoice(invoiceNumber: string, paymentMode = "Cash"): Promise<{ success: boolean; invoiceId: string }> {
    if (this.lines.length === 0) {
      throw new Error("Cannot finalize empty cart");
    }

    const totals = this.getTotals();
    const invoiceId = `inv_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const externalId = `ext_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const now = Date.now();

    const invoiceRow = {
      id: invoiceId,
      module_key: "invoice",
      invoice_number: invoiceNumber,
      invoice_date: new Date().toISOString().slice(0, 10),
      customer_id: this.customerId,
      customer_name: this.customerName,
      customer_gstin: this.customerGstin,
      place_of_supply: this.placeOfSupply,
      subtotal: totals.taxable_subtotal,
      discount_total: totals.line_discount_total + totals.bill_discount_amount,
      tax_total: totals.total_tax,
      round_off: totals.round_off,
      grand_total: totals.grand_total,
      paid_amount: totals.grand_total,
      payment_mode: paymentMode,
      status: "issued",
      patient_name: this.prescriptionMeta.patient_name,
      doctor_name: this.prescriptionMeta.doctor_name,
      doctor_reg_no: this.prescriptionMeta.doctor_reg_no,
      sync_state: "pending",
      external_id: externalId,
      created_at: now,
      updated_at: now,
    };

    // 1. Commit Invoice to local SQLite
    await sqliteStorage.insertRecord("invoices", invoiceId, invoiceRow);

    // 2. Commit Invoice Line Items & Stock Transactions
    for (const line of this.lines) {
      const lineItemId = `inv_item_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("invoice_items", lineItemId, {
        id: lineItemId,
        invoice_id: invoiceId,
        product_id: line.product.id,
        product_name: line.product.name,
        hsn_code: line.product.hsn_sac_code,
        batch_no: line.selectedBatch.batch_no,
        expiry_date: line.selectedBatch.expiry_date,
        qty: line.qty,
        loose_qty: line.loose_qty,
        units_per_pack: line.product.units_per_pack,
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

      // Deduct stock in double-entry ledger
      const deductedBaseUnits = line.qty * line.product.units_per_pack + line.loose_qty;
      const stockTxId = `stk_tx_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
        id: stockTxId,
        product_id: line.product.id,
        batch_id: line.selectedBatch.id,
        event_type: "SALE",
        qty_delta: -deductedBaseUnits,
        reference_type: "INVOICE",
        reference_id: invoiceId,
        created_at: now,
      });
    }

    // 3. Enqueue for background sync
    await syncQueueService.enqueue("invoice", invoiceId, "create", invoiceRow);

    // 4. Reset Cart
    this.clearCart();

    return { success: true, invoiceId };
  }
}

export const posCartService = new PosCartService();

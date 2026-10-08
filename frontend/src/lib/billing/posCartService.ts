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
  rate_basis: "sel_rate" | "mrp" | "ptr" | "pts" | "ptss" | "loose_rate";
  calculated: CalculatedLine;
  isNegativeStock?: boolean;
  shortageQty?: number;
  isAdhocBatch?: boolean;
  availableStockSnapshot?: number;
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
  private customerPhone = "";
  private customerGstin = "";
  private placeOfSupply = "";
  private billDiscount: { type: "percent" | "amount"; value: number } = { type: "amount", value: 0 };
  private manualRoundOff: number | null = null;
  private companyTaxMode: CompanyTaxMode = "inclusive";
  private isInterState = false;
  private prescriptionMeta: PosPrescriptionMeta = {};

  getLines(): PosCartLine[] {
    return [...this.lines];
  }

  setCustomer(id: string, name: string, gstin = "", placeOfSupply = "", phone = "") {
    this.customerId = id;
    this.customerName = name;
    this.customerGstin = gstin;
    this.placeOfSupply = placeOfSupply;
    this.customerPhone = phone;
  }

  getCustomer() {
    return {
      customerId: this.customerId,
      customerName: this.customerName,
      customerPhone: this.customerPhone,
      customerGstin: this.customerGstin,
      placeOfSupply: this.placeOfSupply,
    };
  }

  setBillDiscount(type: "percent" | "amount", value: number) {
    this.billDiscount = { type, value: Math.max(0, Number(value) || 0) };
  }

  getBillDiscount() {
    return { ...this.billDiscount };
  }

  setManualRoundOff(value: number | null) {
    if (value === null || value === undefined || isNaN(Number(value))) {
      this.manualRoundOff = null;
    } else {
      this.manualRoundOff = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    }
  }

  getManualRoundOff(): number | null {
    return this.manualRoundOff;
  }

  clearManualRoundOff() {
    this.manualRoundOff = null;
  }

  setCompanyTaxMode(taxMode: CompanyTaxMode) {
    this.companyTaxMode = taxMode;
  }

  setIsInterState(isInterState: boolean) {
    this.isInterState = isInterState;
  }

  setPrescriptionMeta(meta: PosPrescriptionMeta) {
    this.prescriptionMeta = { ...this.prescriptionMeta, ...meta };
  }

  getPrescriptionMeta(): PosPrescriptionMeta {
    return { ...this.prescriptionMeta };
  }

  calculateLine(line: Omit<PosCartLine, "calculated">): CalculatedLine {
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

    let batch = await productsStore.getEarliestExpiringBatch(product.id);
    if (!batch) {
      // Create ad-hoc batch if product has no batches
      batch = {
        id: `batch_adhoc_${product.id}_${Date.now()}`,
        product_id: product.id,
        batch_no: "NO_BATCH",
        expiry_date: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        stock_qty: 0,
        mrp: product.mrp,
        selling_rate: product.sel_rate,
        purchase_rate: product.sel_rate * 0.7,
      };
    }

    return this.addProductToCart(product, batch);
  }

  addProductToCart(
    product: ProductItem,
    batch: ProductBatch,
    qty = 1,
    looseQty = 0,
    options?: { isAdhocBatch?: boolean }
  ): { success: boolean; line: PosCartLine } {
    const existingIndex = this.lines.findIndex((l) => l.product.id === product.id && l.selectedBatch.id === batch.id);

    const unitPrice = batch.selling_rate || product.sel_rate || product.mrp;
    const lineId = `line_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const availableStock = batch.stock_qty !== undefined ? batch.stock_qty : 0;

    if (existingIndex >= 0) {
      const existing = this.lines[existingIndex];
      const updatedQty = existing.qty + qty;
      const updatedLoose = existing.loose_qty + looseQty;

      const isNegative = updatedQty > availableStock || availableStock <= 0;
      const shortage = Math.max(0, updatedQty - Math.max(0, availableStock));

      const updatedLine: PosCartLine = {
        ...existing,
        qty: updatedQty,
        loose_qty: updatedLoose,
        isNegativeStock: isNegative,
        shortageQty: shortage,
        availableStockSnapshot: availableStock,
        calculated: this.calculateLine({
          ...existing,
          qty: updatedQty,
          loose_qty: updatedLoose,
        }),
      };
      this.lines[existingIndex] = updatedLine;
      return { success: true, line: updatedLine };
    }

    const isNegative = qty > availableStock || availableStock <= 0;
    const shortage = Math.max(0, qty - Math.max(0, availableStock));

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
      isNegativeStock: isNegative,
      shortageQty: shortage,
      isAdhocBatch: options?.isAdhocBatch || batch.batch_no === "NO_BATCH",
      availableStockSnapshot: availableStock,
    };

    const newLine: PosCartLine = {
      ...baseLine,
      calculated: this.calculateLine(baseLine),
    };

    this.lines.push(newLine);
    return { success: true, line: newLine };
  }

  /**
   * Split a requested quantity across available batches in FEFO order.
   * If total stock is insufficient, the remainder is placed on the last batch (or ad-hoc batch) with negative stock flag.
   */
  addBatchesWithFefoSplit(
    product: ProductItem,
    batches: ProductBatch[],
    requestedQty: number,
    looseQty = 0
  ): { addedCount: number } {
    if (!batches || batches.length === 0) {
      const adhocBatch: ProductBatch = {
        id: `batch_adhoc_${product.id}_${Date.now()}`,
        product_id: product.id,
        batch_no: "NO_BATCH",
        expiry_date: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        stock_qty: 0,
        mrp: product.mrp,
        selling_rate: product.sel_rate,
        purchase_rate: product.sel_rate * 0.7,
      };
      this.addProductToCart(product, adhocBatch, requestedQty, looseQty, { isAdhocBatch: true });
      return { addedCount: 1 };
    }

    let remaining = requestedQty;
    let added = 0;

    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      const available = Math.max(0, b.stock_qty || 0);

      if (i === batches.length - 1) {
        // Last batch absorbs all remaining quantity (even if negative)
        this.addProductToCart(product, b, remaining, looseQty);
        added++;
        break;
      }

      if (available > 0) {
        const alloc = Math.min(remaining, available);
        this.addProductToCart(product, b, alloc, i === 0 ? looseQty : 0);
        remaining -= alloc;
        added++;

        if (remaining <= 0) break;
      }
    }

    return { addedCount: added };
  }

  updateLineQuantity(lineId: string, qty: number, looseQty = 0) {
    const index = this.lines.findIndex((l) => l.id === lineId);
    if (index >= 0) {
      const line = this.lines[index];
      const newQty = Math.max(0, qty);
      const newLoose = Math.max(0, looseQty);
      const available = line.selectedBatch.stock_qty !== undefined ? line.selectedBatch.stock_qty : 0;
      const isNegative = newQty > available || available <= 0;
      const shortage = Math.max(0, newQty - Math.max(0, available));

      line.qty = newQty;
      line.loose_qty = newLoose;
      line.isNegativeStock = isNegative;
      line.shortageQty = shortage;
      line.calculated = this.calculateLine(line);
    }
  }

  updateLinePrice(
    lineId: string,
    unitPrice: number,
    rateBasis?: "sel_rate" | "mrp" | "ptr" | "pts" | "ptss" | "loose_rate"
  ) {
    const index = this.lines.findIndex((l) => l.id === lineId);
    if (index >= 0) {
      const line = this.lines[index];
      line.unit_price = Math.max(0, unitPrice);
      if (rateBasis) {
        line.rate_basis = rateBasis;
      }
      line.calculated = this.calculateLine(line);
    }
  }

  updateLineDiscount(lineId: string, percent?: number, amount?: number) {
    const index = this.lines.findIndex((l) => l.id === lineId);
    if (index >= 0) {
      const line = this.lines[index];
      if (percent !== undefined) line.discount_percent = Math.max(0, percent);
      if (amount !== undefined) line.discount_amount = Math.max(0, amount);
      line.discount_manual = true;
      line.calculated = this.calculateLine(line);
    }
  }

  async updateLineConversion(
    lineId: string,
    unitsPerPack: number,
    packName?: string,
    looseName?: string,
    persistToProductMaster = false
  ): Promise<void> {
    const index = this.lines.findIndex((l) => l.id === lineId);
    if (index >= 0) {
      const line = this.lines[index];
      const upp = Math.max(1, Number(unitsPerPack) || 1);
      const updatedProduct: ProductItem = {
        ...line.product,
        units_per_pack: upp,
        unit_name: packName || line.product.unit_name || "strip",
        sub_unit_name: looseName || (upp > 1 ? "tab" : "unit"),
        allow_loose_sale: upp > 1,
      };

      line.product = updatedProduct;

      // Re-normalize loose qty if needed
      if (upp > 1 && line.loose_qty >= upp) {
        const extraPacks = Math.floor(line.loose_qty / upp);
        line.qty += extraPacks;
        line.loose_qty = line.loose_qty % upp;
      } else if (upp <= 1) {
        line.qty += line.loose_qty;
        line.loose_qty = 0;
      }

      line.calculated = this.calculateLine(line);

      if (persistToProductMaster) {
        await productsStore.upsertProduct(updatedProduct);
      }
    }
  }

  removeLine(lineId: string): { removedLine?: PosCartLine; index: number } {
    const idx = this.lines.findIndex((l) => l.id === lineId);
    if (idx >= 0) {
      const removed = this.lines[idx];
      this.lines.splice(idx, 1);
      return { removedLine: removed, index: idx };
    }
    return { index: -1 };
  }

  restoreLine(line: PosCartLine, targetIndex?: number): void {
    if (targetIndex !== undefined && targetIndex >= 0 && targetIndex <= this.lines.length) {
      this.lines.splice(targetIndex, 0, line);
    } else {
      this.lines.push(line);
    }
  }

  moveLine(fromIndex: number, toIndex: number): boolean {
    if (fromIndex < 0 || fromIndex >= this.lines.length) return false;
    if (toIndex < 0 || toIndex >= this.lines.length) return false;
    const [moved] = this.lines.splice(fromIndex, 1);
    this.lines.splice(toIndex, 0, moved);
    return true;
  }

  clearCart() {
    this.lines = [];
    this.customerId = "";
    this.customerName = "Walk-in Customer";
    this.customerGstin = "";
    this.placeOfSupply = "";
    this.billDiscount = { type: "amount", value: 0 };
    this.manualRoundOff = null;
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

    return calculateInvoiceTotals(
      billingLines,
      this.billDiscount,
      this.companyTaxMode,
      this.isInterState,
      this.manualRoundOff === null,
      this.manualRoundOff
    );
  }

  async finalizeInvoice(
    invoiceNumber: string,
    paymentMode = "Cash",
    options?: {
      autoClear?: boolean;
      linesSnapshot?: PosCartLine[];
      totalsSnapshot?: InvoiceTotals;
      operatorId?: string;
    }
  ): Promise<{ success: boolean; invoiceId: string }> {
    const linesToFinalize = options?.linesSnapshot && options.linesSnapshot.length > 0
      ? options.linesSnapshot
      : this.lines;

    if (linesToFinalize.length === 0) {
      throw new Error("Cannot finalize empty cart");
    }

    const totals = options?.totalsSnapshot || this.getTotals();
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
      customer_phone: this.customerPhone,
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
    for (const line of linesToFinalize) {
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

      // Deduct stock in double-entry ledger without artificial 0 clamping
      const deductedBaseUnits = line.qty * (line.product.units_per_pack || 1) + (line.loose_qty || 0);

      // Fetch or create batch in database
      const allBatches = await sqliteStorage.findAll<ProductBatch>("product_batches");
      let batch = allBatches.find((b) => b.id === line.selectedBatch.id);

      if (!batch) {
        batch = {
          ...line.selectedBatch,
          stock_qty: -(deductedBaseUnits),
        };
        await productsStore.upsertBatch(batch);
      } else {
        batch.stock_qty = (batch.stock_qty || 0) - deductedBaseUnits;
        await productsStore.upsertBatch(batch);
      }

      // Update product current_stock
      const prod = await productsStore.getProductById(line.product.id);
      if (prod) {
        prod.current_stock = (prod.current_stock || 0) - deductedBaseUnits;
        await productsStore.upsertProduct(prod);
      }

      const stockTxId = `stk_tx_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
      const isShortage = line.isNegativeStock || (batch.stock_qty < 0);
      const noteStr = isShortage
        ? `Sale beyond available stock (Batch: ${line.selectedBatch.batch_no}, short: ${line.shortageQty || Math.abs(batch.stock_qty)})`
        : `Sale (Bill: ${invoiceNumber})`;

      await sqliteStorage.insertRecord("stock_transactions", stockTxId, {
        id: stockTxId,
        product_id: line.product.id,
        batch_id: line.selectedBatch.id,
        event_type: "SALE",
        qty_delta: -deductedBaseUnits,
        reference_type: "INVOICE",
        reference_id: invoiceId,
        notes: noteStr,
        created_at: now,
      });
    }

    // 3. Enqueue for background sync
    await syncQueueService.enqueue("invoice", invoiceId, "create", invoiceRow);

    // 4. Reset Cart only if autoClear is not explicitly disabled
    if (options?.autoClear !== false) {
      this.clearCart();
    }

    return { success: true, invoiceId };
  }
}

export const posCartService = new PosCartService();

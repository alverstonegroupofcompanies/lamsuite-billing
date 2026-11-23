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
import { onlineTransactionService } from "../sync/onlineTransactionService";
import { storeRegistryService } from "../auth/storeRegistryService";
import { storeDeviceService } from "../auth/storeDeviceService";
import { counterGraceService } from "../auth/counterGraceService";
import { billingTenderService, type PaymentTenderLine } from "./billingTenderService";
import { cashShiftService } from "./cashShiftService";
import { ApprovalRequiredError } from "./approvalGateService";
import {
  PharmacistConfirmationRequiredError,
  isPharmacistRefusal,
  pharmacistFields,
  type PharmacistCredential,
} from "./pharmacistGate";
import { companySettingsService } from "../settings/companySettingsService";
import { findMrpBreach, mrpCeilingEnforced } from "./mrpCeiling";
import { storeToday, toStoreDateString, getStoreTimezone } from "../dateTimeUtils";

export interface PosCartLine {
  id: string;
  product: ProductItem;
  selectedBatch: ProductBatch;
  qty: number;
  loose_qty: number;
  free_qty?: number;
  free_loose_qty?: number;
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
  price_list_applied?: boolean;
  price_list_name?: string;
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
  private salespersonId = "";
  private salespersonName = "";
  private billDiscount: { type: "percent" | "amount"; value: number } = { type: "amount", value: 0 };
  private manualRoundOff: number | null = null;
  private companyTaxMode: CompanyTaxMode = "inclusive";
  private storeState: string = "32";
  private gstType: "regular" | "composition" | "no_tax" = "regular";
  private taxModeOverride?: CompanyTaxMode | null = null;
  private gstTypeOverride?: "regular" | "composition" | "no_tax" | null = null;
  private allowTaxOverride: boolean = false;
  private isInterState = false;
  private prescriptionMeta: PosPrescriptionMeta = {};
  private priceListItems: Record<string, { rate: number; discount_percent: number; min_qty: number }> = {};
  private priceListName: string | null = null;

  getLines(): PosCartLine[] {
    return [...this.lines];
  }

  setStoreTaxSettings(config: {
    taxMode?: CompanyTaxMode;
    storeState?: string;
    gstType?: "regular" | "composition" | "no_tax";
    allowTaxOverride?: boolean;
  }) {
    if (config.taxMode) this.companyTaxMode = config.taxMode;
    if (config.storeState) this.storeState = config.storeState;
    if (config.gstType) this.gstType = config.gstType;
    if (config.allowTaxOverride !== undefined) this.allowTaxOverride = config.allowTaxOverride;
    this.recalculateAllLines();
  }

  setTaxOverride(override: {
    taxMode?: CompanyTaxMode | null;
    gstType?: "regular" | "composition" | "no_tax" | null;
  }) {
    if (override.taxMode !== undefined) this.taxModeOverride = override.taxMode;
    if (override.gstType !== undefined) this.gstTypeOverride = override.gstType;
    this.recalculateAllLines();
  }

  clearTaxOverride() {
    this.taxModeOverride = null;
    this.gstTypeOverride = null;
    this.recalculateAllLines();
  }

  getActiveTaxMode(): {
    taxMode: CompanyTaxMode;
    gstType: "regular" | "composition" | "no_tax";
    isOverridden: boolean;
    isComposition: boolean;
    isInterState: boolean;
    documentTitle: "Tax Invoice" | "Bill of Supply";
    allowOverride: boolean;
  } {
    const taxMode = this.taxModeOverride || this.companyTaxMode;
    const gstType = this.gstTypeOverride || this.gstType;
    const isComposition = gstType === "composition" || gstType === "no_tax";
    return {
      taxMode,
      gstType,
      isOverridden: Boolean(this.taxModeOverride || this.gstTypeOverride),
      isComposition,
      isInterState: this.isInterState,
      documentTitle: isComposition ? "Bill of Supply" : "Tax Invoice",
      allowOverride: this.allowTaxOverride,
    };
  }

  recalculateAllLines() {
    this.lines = this.lines.map((l) => ({
      ...l,
      calculated: this.calculateLine(l),
    }));
  }

  setCustomer(id: string, name: string, gstin = "", placeOfSupply = "", phone = "") {
    if (String(id || "") !== String(this.customerId || "")) {
      // Customer changed: drop the previous customer's negotiated rates until the
      // new price list resolves, so one customer's rates never leak into another.
      this.setPriceListPricing(null, []);
    }
    this.customerId = id;
    this.customerName = name;
    this.customerGstin = gstin;
    this.placeOfSupply = placeOfSupply;
    this.customerPhone = phone;

    // Automatically resolve place of supply and intra/inter state
    const cleanGst = (gstin || "").trim();
    const cleanPos = (placeOfSupply || "").trim();
    let destState = this.storeState;
    if (cleanGst.length >= 2 && /^\d{2}/.test(cleanGst)) {
      destState = cleanGst.slice(0, 2);
    } else if (cleanPos.length >= 2 && /^\d{2}/.test(cleanPos)) {
      destState = cleanPos.slice(0, 2);
    }
    this.isInterState = destState !== this.storeState;
    this.recalculateAllLines();
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

  /**
   * GAP-01 / SPR-010: who sold this bill. The name goes with the id because
   * the bill prints what the till showed, and the person may be renamed later.
   */
  setSalesperson(id: string, name: string) {
    this.salespersonId = id || "";
    this.salespersonName = id ? name || "" : "";
  }

  /** Apply a customer-specific price list. Empty items clears negotiated pricing. */
  setPriceListPricing(
    listName: string | null,
    items: Array<{ product_id: number | string; rate: number; discount_percent?: number; min_qty?: number }>
  ) {
    const map: Record<string, { rate: number; discount_percent: number; min_qty: number }> = {};
    for (const item of items || []) {
      if (!item || item.product_id === undefined || item.product_id === null) continue;
      map[String(item.product_id)] = {
        rate: Math.max(0, Number(item.rate) || 0),
        discount_percent: Math.max(0, Number(item.discount_percent) || 0),
        min_qty: Math.max(0, Number(item.min_qty) || 0),
      };
    }
    this.priceListItems = map;
    this.priceListName = listName && Object.keys(map).length > 0 ? listName : null;
    this.lines = this.lines.map((line) => {
      const base = { ...line } as Omit<PosCartLine, "calculated">;
      this.applyPriceListPricing(base);
      return { ...base, calculated: this.calculateLine(base) };
    });
  }

  getPriceListContext(): { name: string | null; productCount: number } {
    return { name: this.priceListName, productCount: Object.keys(this.priceListItems).length };
  }

  private stockBaseUnits(line: Pick<PosCartLine, "qty" | "loose_qty" | "free_qty" | "free_loose_qty" | "product">): number {
    const unitsPerPack = Math.max(1, Number(line.product?.units_per_pack) || 1);
    const billed = Math.max(0, Number(line.qty) || 0);
    const loose = Math.max(0, Number(line.loose_qty) || 0);
    const free = Math.max(0, Number(line.free_qty) || 0);
    const freeLoose = Math.max(0, Number(line.free_loose_qty) || 0);
    return (billed + free) * unitsPerPack + loose + freeLoose;
  }

  private effectiveQty(line: Pick<PosCartLine, "qty" | "loose_qty" | "product">): number {
    const unitsPerPack = Math.max(1, Number(line.product?.units_per_pack) || 1);
    return Math.max(0, Number(line.qty) || 0) + Math.max(0, Number(line.loose_qty) || 0) / unitsPerPack;
  }

  private baseLinePrice(line: Pick<PosCartLine, "product" | "selectedBatch">): number {
    return line.selectedBatch?.selling_rate || line.product?.sel_rate || line.product?.mrp || 0;
  }

  private applyPriceListPricing(line: Omit<PosCartLine, "calculated"> | PosCartLine): void {
    // A manually edited price always wins over the negotiated list.
    if (line.price_list_applied === false) return;

    const item = this.priceListItems[String(line.product?.id)];
    const qualifies = Boolean(item) && this.effectiveQty(line) >= item!.min_qty;

    if (item && qualifies) {
      line.unit_price = item.rate;
      if (!line.discount_manual) line.discount_percent = item.discount_percent;
      line.price_list_applied = true;
      line.price_list_name = this.priceListName || undefined;
    } else if (line.price_list_applied) {
      line.unit_price = this.baseLinePrice(line);
      if (!line.discount_manual) line.discount_percent = 0;
      line.price_list_applied = undefined;
      line.price_list_name = undefined;
    }
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
    // Recalculate existing lines with new interstate setting
    this.lines = this.lines.map((l) => ({
      ...l,
      calculated: this.calculateLine(l),
    }));
  }

  getIsInterState(): boolean {
    return this.isInterState;
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
    const active = this.getActiveTaxMode();
    return calculateLineTotals(input, {
      companyTaxMode: active.taxMode,
      isInterState: this.isInterState,
      storeState: this.storeState,
      gstType: active.gstType,
      placeOfSupply: this.placeOfSupply,
      customerGstin: this.customerGstin,
    });
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
        expiry_date: toStoreDateString(new Date(Date.now() + 365 * 86400000), getStoreTimezone(companySettingsService.getSettings())),
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
      const requestedBaseUnits = this.stockBaseUnits({
        qty: updatedQty,
        loose_qty: updatedLoose,
        free_qty: existing.free_qty,
        free_loose_qty: existing.free_loose_qty,
        product,
      });

      const isNegative = requestedBaseUnits > availableStock || availableStock <= 0;
      const shortage = Math.max(0, requestedBaseUnits - Math.max(0, availableStock));

      const updatedBase: Omit<PosCartLine, "calculated"> = {
        ...existing,
        qty: updatedQty,
        loose_qty: updatedLoose,
        isNegativeStock: isNegative,
        shortageQty: shortage,
        availableStockSnapshot: availableStock,
      };
      this.applyPriceListPricing(updatedBase);
      const updatedLine: PosCartLine = {
        ...updatedBase,
        calculated: this.calculateLine(updatedBase),
      };
      this.lines[existingIndex] = updatedLine;
      return { success: true, line: updatedLine };
    }

    const unitsPerPack = Math.max(1, Number(product.units_per_pack) || 1);
    const requestedBaseUnits = qty * unitsPerPack + looseQty;
    const isNegative = requestedBaseUnits > availableStock || availableStock <= 0;
    const shortage = Math.max(0, requestedBaseUnits - Math.max(0, availableStock));

    const baseLine: Omit<PosCartLine, "calculated"> = {
      id: lineId,
      product,
      selectedBatch: batch,
      qty,
      loose_qty: looseQty,
      free_qty: 0,
      free_loose_qty: 0,
      unit_price: unitPrice,
      discount_percent: 0,
      discount_amount: 0,
      rate_basis: "sel_rate",
      isNegativeStock: isNegative,
      shortageQty: shortage,
      isAdhocBatch: options?.isAdhocBatch || batch.batch_no === "NO_BATCH",
      availableStockSnapshot: availableStock,
    };

    this.applyPriceListPricing(baseLine);

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
        expiry_date: toStoreDateString(new Date(Date.now() + 365 * 86400000), getStoreTimezone(companySettingsService.getSettings())),
        stock_qty: 0,
        mrp: product.mrp,
        selling_rate: product.sel_rate,
        purchase_rate: product.sel_rate * 0.7,
      };
      this.addProductToCart(product, adhocBatch, requestedQty, looseQty, { isAdhocBatch: true });
      return { addedCount: 1 };
    }

    const unitsPerPack = Math.max(1, Number(product.units_per_pack) || 1);
    let remainingBaseUnits = requestedQty * unitsPerPack + Math.max(0, looseQty);
    let added = 0;

    const toPacksAndLoose = (baseUnits: number) => ({
      packs: Math.floor(baseUnits / unitsPerPack),
      loose: baseUnits % unitsPerPack,
    });

    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      const available = Math.max(0, b.stock_qty || 0);

      if (i === batches.length - 1) {
        // Last batch absorbs all remaining quantity (even if negative)
        const { packs, loose } = toPacksAndLoose(remainingBaseUnits);
        this.addProductToCart(product, b, packs, loose);
        added++;
        break;
      }

      if (available > 0) {
        const allocBaseUnits = Math.min(remainingBaseUnits, available);
        const { packs, loose } = toPacksAndLoose(allocBaseUnits);
        this.addProductToCart(product, b, packs, loose);
        remainingBaseUnits -= allocBaseUnits;
        added++;

        if (remainingBaseUnits <= 0) break;
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

      line.qty = newQty;
      line.loose_qty = newLoose;
      this.refreshStockStatus(line);
      this.applyPriceListPricing(line);
      line.calculated = this.calculateLine(line);
    }
  }

  updateLineFreeQuantity(lineId: string, freeQty: number, freeLooseQty = 0) {
    const index = this.lines.findIndex((l) => l.id === lineId);
    if (index >= 0) {
      const line = this.lines[index];
      line.free_qty = Math.max(0, freeQty);
      line.free_loose_qty = Math.max(0, freeLooseQty);
      this.refreshStockStatus(line);
    }
  }

  private refreshStockStatus(line: PosCartLine) {
    // Batch stock is stored in base units; billed and free units both consume it.
    const requestedBaseUnits = this.stockBaseUnits(line);
    const available = line.selectedBatch.stock_qty !== undefined ? line.selectedBatch.stock_qty : 0;
    line.isNegativeStock = requestedBaseUnits > available || available <= 0;
    line.shortageQty = Math.max(0, requestedBaseUnits - Math.max(0, available));
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
      line.price_list_applied = false;
      line.price_list_name = undefined;
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

      const freeLoose = Math.max(0, Number(line.free_loose_qty) || 0);
      if (upp > 1 && freeLoose >= upp) {
        line.free_qty = Math.max(0, Number(line.free_qty) || 0) + Math.floor(freeLoose / upp);
        line.free_loose_qty = freeLoose % upp;
      } else if (upp <= 1) {
        line.free_qty = Math.max(0, Number(line.free_qty) || 0) + freeLoose;
        line.free_loose_qty = 0;
      }

      this.refreshStockStatus(line);
      line.calculated = this.calculateLine(line);

      if (persistToProductMaster) {
        await productsStore.upsertProduct(updatedProduct);
      }
    }
  }

  async updateLineProductAndBatch(
    lineId: string,
    productUpdates: Partial<ProductItem>,
    batchUpdates: Partial<ProductBatch>,
    persistToMaster = true
  ): Promise<void> {
    const index = this.lines.findIndex((l) => l.id === lineId);
    if (index >= 0) {
      const line = this.lines[index];

      // Merge product updates
      const updatedProduct: ProductItem = {
        ...line.product,
        ...productUpdates,
      };

      // Merge batch updates
      const updatedBatch: ProductBatch = {
        ...line.selectedBatch,
        ...batchUpdates,
      };

      line.product = updatedProduct;
      line.selectedBatch = updatedBatch;

      // Update unit_price if selling_rate or sel_rate was updated
      if (batchUpdates.selling_rate !== undefined) {
        line.unit_price = Math.max(0, Number(batchUpdates.selling_rate) || 0);
      } else if (productUpdates.sel_rate !== undefined) {
        line.unit_price = Math.max(0, Number(productUpdates.sel_rate) || 0);
      }

      // Recalculate line with new rate/taxes
      line.calculated = this.calculateLine(line);

      if (persistToMaster) {
        await productsStore.upsertProduct(updatedProduct, true);
        await productsStore.upsertBatch(updatedBatch, true);
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

  hasUnsavedItems(): boolean {
    return this.lines.length > 0;
  }

  resetCart() {
    this.priceListItems = {};
    this.priceListName = null;
    this.clearCart();
  }

  clearCart() {
    this.lines = [];
    this.customerId = "";
    this.customerName = "Walk-in Customer";
    this.customerGstin = "";
    this.placeOfSupply = "";
    this.salespersonId = "";
    this.salespersonName = "";
    this.billDiscount = { type: "amount", value: 0 };
    this.manualRoundOff = null;
    this.prescriptionMeta = {};
    this.taxModeOverride = null;
    this.gstTypeOverride = null;
  }

  addItem(product: ProductItem, batch: ProductBatch, qty = 1, looseQty = 0) {
    return this.addProductToCart(product, batch, qty, looseQty);
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

    const active = this.getActiveTaxMode();
    return calculateInvoiceTotals(
      billingLines,
      this.billDiscount,
      {
        companyTaxMode: active.taxMode,
        isInterState: this.isInterState,
        storeState: this.storeState,
        gstType: active.gstType,
        placeOfSupply: this.placeOfSupply,
        customerGstin: this.customerGstin,
      },
      this.isInterState,
      this.manualRoundOff === null,
      this.manualRoundOff
    );
  }

  async finalizeInvoice(
    invoiceNumber?: string,
    paymentModeOrPayments: string | PaymentTenderLine[] = "Cash",
    options?: {
      autoClear?: boolean;
      linesSnapshot?: PosCartLine[];
      totalsSnapshot?: InvoiceTotals;
      operatorId?: string;
      cashChange?: number;
      payments?: PaymentTenderLine[];
      /** APR-003: retry of a bill the server already refused, with its grant. */
      externalId?: string;
      approvalToken?: string;
      approvalReason?: string;
      /** PHR-004: retry of a restricted bill, with the pharmacist who vouched. */
      pharmacist?: PharmacistCredential | null;
    }
  ): Promise<{ success: boolean; invoiceId: string; invoiceNumber?: string; isOfflineQueued?: boolean; isTempNumber?: boolean }> {
    const resolvedInvoiceNumber = invoiceNumber || (await companySettingsService.generateNextInvoiceNumber());
    const linesToFinalize = options?.linesSnapshot && options.linesSnapshot.length > 0
      ? options.linesSnapshot
      : this.lines;

    if (linesToFinalize.length === 0) {
      throw new Error("Cannot finalize empty cart");
    }

    const activeStore = storeRegistryService.getActiveStore();
    if (activeStore && activeStore.is_active === false) {
      throw new Error("Cannot finalize invoice: Store is disabled by administration.");
    }

    // CNT-011: the grace the store server granted is what lets a dark counter
    // keep taking bills. Once that window closes the cart stops, here rather
    // than in the sync queue, so nothing is written that cannot be defended.
    counterGraceService.assertWorkAllowed();

    // TAX-02: the server refuses a rate above MRP, but an offline bill never reaches it
    // before the customer leaves, so the counter holds the same ceiling here.
    if (mrpCeilingEnforced(companySettingsService.getSettings().enforce_mrp_capping)) {
      const breach = findMrpBreach(linesToFinalize);
      if (breach) {
        throw new Error(breach.message);
      }
    }

    const totals = options?.totalsSnapshot || this.getTotals();

    // Safety net: integrity check verifying invoice totals equal sum of lines
    const sumLineTotals = linesToFinalize.reduce((acc, l) => acc + (l.calculated?.total_amount || 0), 0);
    const billDiscount = totals.bill_discount_amount || 0;
    const expectedNet = sumLineTotals - billDiscount + (totals.round_off || 0);
    if (Math.abs(expectedNet - totals.grand_total) > 0.05) {
      throw new Error(
        `Invoice integrity violation: Line sum (₹${sumLineTotals.toFixed(2)}) minus discount (₹${billDiscount.toFixed(2)}) plus round-off (₹${(totals.round_off || 0).toFixed(2)}) does not match grand total (₹${totals.grand_total.toFixed(2)})`
      );
    }
    // A retried save reuses the identity the grant was bound to; a new bill gets
    // its own, so one approval can never settle two documents.
    const externalId =
      options?.externalId || `ext_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

    const deviceProfile = await storeDeviceService.getDeviceProfile();
    // B8b: a sale belongs to the counter this till claimed, not to a person.
    const activeCounterId = deviceProfile?.counter_id || "Counter 01";
    const activeStoreId = String(activeStore?.id || deviceProfile?.store_id || "1");
    const activeStoreCode = String(activeStore?.code || deviceProfile?.store_code || "STORE-01");

    const resolvedPayments: PaymentTenderLine[] = Array.isArray(paymentModeOrPayments)
      ? paymentModeOrPayments
      : options?.payments && options.payments.length > 0
      ? options.payments
      : [{ mode: typeof paymentModeOrPayments === "string" ? paymentModeOrPayments : "Cash", amount: totals.grand_total }];

    // PAY-02: ₹500 handed over for a ₹210 bill settled ₹210 and ₹290 back. The
    // server reads the same way, so the till files what actually stays in the
    // drawer instead of a payment that never happened.
    const settled = billingTenderService.settleTenders(totals.grand_total, resolvedPayments);

    const primaryPaymentMode = settled.lines.length > 1
      ? "Split"
      : (settled.lines[0]?.mode || resolvedPayments[0]?.mode || (typeof paymentModeOrPayments === "string" ? paymentModeOrPayments : "Cash"));

    const activeTax = this.getActiveTaxMode();

    // 1. Submit through Online Transaction Service (Online-First with offline fallback)
    const txRes = await onlineTransactionService.submitAuthoritativeInvoice({
      store_id: activeStoreId,
      store_code: activeStoreCode,
      external_id: externalId,
      idempotency_key: externalId,
      invoice_number: resolvedInvoiceNumber,
      invoice_date: storeToday(companySettingsService.getSettings()),
      customer_id: this.customerId,
      customer_name: this.customerName,
      customer_phone: this.customerPhone,
      customer_gstin: this.customerGstin,
      place_of_supply: this.placeOfSupply,
      payment_mode: primaryPaymentMode,
      paid_amount: settled.paid,
      payments: settled.lines,
      counter_id: activeCounterId,
      tax_mode: activeTax.taxMode,
      store_state: this.storeState,
      gst_type: activeTax.gstType,
      is_composition: activeTax.isComposition,
      patient_name: this.prescriptionMeta.patient_name,
      doctor_name: this.prescriptionMeta.doctor_name,
      doctor_reg_no: this.prescriptionMeta.doctor_reg_no,
      salesperson_id: this.salespersonId,
      salesperson_name: this.salespersonName,
      bill_discount_percent: this.billDiscount?.type === "percent" ? this.billDiscount.value : 0,
      bill_discount_amount: totals.bill_discount_amount,
      manual_round_off: this.manualRoundOff,
      subtotal: totals.taxable_subtotal,
      discount_total: totals.line_discount_total + totals.bill_discount_amount,
      tax_total: totals.total_tax,
      round_off: totals.round_off,
      grand_total: totals.grand_total,
      is_inter_state: this.isInterState,
      ...(options?.approvalToken
        ? { approval_token: options.approvalToken, approval_reason: options.approvalReason }
        : {}),
      ...pharmacistFields(options?.pharmacist),
      items: linesToFinalize.map((line) => ({
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
      })),
    });

    if (!txRes.success) {
      // The server said a threshold was crossed. Hand the caller the action
      // keys and the document identity the grant must name, so the till can
      // collect an approver PIN and send the same bill again.
      if (txRes.businessRule?.code === "approval_required") {
        throw new ApprovalRequiredError(
          txRes.businessRule.actions || [],
          txRes.businessRule.reasons || {},
          externalId
        );
      }

      if (isPharmacistRefusal(txRes.businessRule?.code)) {
        // Nothing was written. The lines are held until a pharmacist with a
        // registration that holds says so with their own PIN.
        throw new PharmacistConfirmationRequiredError(txRes.businessRule!, externalId);
      }

      throw new Error(txRes.error || "Invoice failed to finalize.");
    }

    const finalizedInvoice = txRes.invoice;
    const finalId = finalizedInvoice.id || externalId;
    const finalDocNumber = finalizedInvoice.invoice_number || resolvedInvoiceNumber;

    // Advance setting document sequence
    await companySettingsService.syncNextInvoiceSequence(finalDocNumber).catch(() => {});

    // Record tender in active counter shift
    await cashShiftService.recordSaleTenders(activeCounterId, settled.lines, options?.cashChange || 0);

    // Reset Cart only if autoClear is not explicitly disabled
    if (options?.autoClear !== false) {
      this.clearCart();
    }

    return {
      success: true,
      invoiceId: String(finalId),
      invoiceNumber: finalDocNumber,
      isOfflineQueued: txRes.isOfflineQueued,
      isTempNumber: txRes.isTempNumber,
    };
  }
}

export const posCartService = new PosCartService();

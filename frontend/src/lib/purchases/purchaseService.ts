import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";
import { supplierLedgerService } from "./supplierLedgerService";
import { purchaseOrderService } from "./purchaseOrderService";
import { companySettingsService } from "../settings/companySettingsService";
import { round2 } from "../billing/billingCalculations";
import { getIndianFinancialYear } from "../billing/salesReturnService";
import { syncQueueService } from "../sync/syncQueueService";
import { calculateDocumentTaxes, cleanStateCode } from "../tax-engine/taxEngine";

export interface PurchaseLineItemInput {
  product_id: string;
  product_name: string;
  hsn_code?: string;
  batch_no: string;
  mfg_date?: string;
  expiry_date: string;
  pack_qty: number; // billed packs
  loose_qty?: number; // billed loose units
  free_qty?: number; // bonus packs or units
  units_per_pack?: number;
  qty?: number; // legacy alias for pack_qty
  purchase_rate: number; // rate per pack (ex-tax)
  discount_percent?: number; // trade discount %
  discount_amount?: number; // scheme / cash discount amount
  mrp?: number;
  selling_rate?: number;
  gst_percent: number;
  cess_percent?: number;
  shelf_location?: string;
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
  round_off?: number;
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
  units_per_pack: number;
  total_units: number;
  purchase_rate: number;
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
}

export class PurchaseService {
  /**
   * Generates sequential purchase bill number with FY reset (e.g. PB-26-27-0001)
   */
  async generateNextPurchaseNumber(): Promise<string> {
    const settings = await companySettingsService.loadSettings();
    let prefix = settings.sequences?.purchasePrefix || "PB";
    prefix = prefix.replace(/-+$/, "");
    const fy = getIndianFinancialYear();

    const allPurchases = await sqliteStorage.findAll<any>("purchase_documents");
    const searchPrefix = `${prefix}-${fy}-`;
    const matching = allPurchases.filter((p) => p.purchase_number?.startsWith(searchPrefix));

    let maxNum = 0;
    for (const p of matching) {
      const parts = p.purchase_number.split("-");
      const last = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(last) && last > maxNum) maxNum = last;
    }

    const nextSeq = String(maxNum + 1).padStart(4, "0");
    return `${prefix}-${fy}-${nextSeq}`;
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

    const doc = calculateDocumentTaxes({
      store_state: storeState,
      place_of_supply: isInterstate ? (cleanStateCode(storeState) === "32" ? "29-Karnataka" : "32-Kerala") : storeState,
      default_tax_mode: defaultTaxMode,
      lines: [
        {
          qty: packs,
          loose_qty: loose,
          free_qty: free,
          units_per_pack: unitsPerPack,
          unit_price: line.purchase_rate,
          mrp: line.mrp,
          rate_basis: "ptr",
          discount_percent: line.discount_percent,
          discount_amount: line.discount_amount,
          gst_percent: line.gst_percent,
          cess_percent: line.cess_percent,
          is_tax_inclusive: defaultTaxMode === "inclusive",
        },
      ],
      auto_round_off: false,
    });

    const c = doc.lines[0];
    const sellRate = line.selling_rate || (line.mrp ? line.mrp / unitsPerPack : 0);
    let marginPercent = 0;
    if (sellRate > 0) {
      marginPercent = round2(((sellRate - c.effective_unit_cost!) / sellRate) * 100);
    }

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
   * Atomic record of inward purchase bill
   */
  async recordInwardPurchaseBill(doc: PurchaseDocumentInput): Promise<{
    success: boolean;
    purchaseId: string;
    purchaseNumber: string;
  }> {
    if (!doc.supplier_name?.trim() || !doc.supplier_invoice_no?.trim()) {
      throw new Error("Supplier name and supplier invoice number are required");
    }
    if (doc.lines.length === 0) {
      throw new Error("Cannot save purchase bill with no items");
    }

    const purchaseId = `pb_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const now = Date.now();
    const purchaseNumber = doc.purchase_number || (await this.generateNextPurchaseNumber());

    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;
    let cessTotal = 0;
    let totalLinesAmount = 0;

    const isInterstate = Boolean(doc.is_interstate);
    const itemRecords: PurchaseItemRecord[] = [];
    const receivedMap: Record<string, number> = {};

    for (const line of doc.lines) {
      const calc = this.calculateLineTotals(line, isInterstate);
      subtotal += calc.gross_amount;
      discountTotal += calc.discount_amount;
      taxTotal += calc.total_tax;
      cgstTotal += calc.cgst_amount;
      sgstTotal += calc.sgst_amount;
      igstTotal += calc.igst_amount;
      cessTotal += calc.cess_amount;
      totalLinesAmount += calc.total_amount;

      // Track received quantity per product for PO fulfillment
      receivedMap[line.product_id] = (receivedMap[line.product_id] || 0) + (line.pack_qty || line.qty || 0);

      // 1. Upsert or update batch stock
      const batchId = `batch_${line.product_id}_${line.batch_no.replace(/\s+/g, "_")}`;
      const existingBatch = await sqliteStorage.findById<ProductBatch>("product_batches", batchId);

      const updatedStock = (existingBatch?.stock_qty || 0) + calc.total_stock_units;
      const unitsPerPack = Math.max(1, line.units_per_pack || 1);

      await productsStore.upsertBatch({
        id: batchId,
        product_id: line.product_id,
        batch_no: line.batch_no,
        mfg_date: line.mfg_date,
        expiry_date: line.expiry_date,
        stock_qty: updatedStock,
        mrp: line.mrp,
        purchase_rate: line.purchase_rate,
        selling_rate: line.selling_rate || (line.mrp ? round2(line.mrp / unitsPerPack) : undefined),
        rack_location: line.shelf_location,
      });

      // 2. Update master product current_stock and last purchase rates
      let prod = await productsStore.getProductById(line.product_id);
      if (prod) {
        prod.current_stock = (prod.current_stock || 0) + calc.total_stock_units;
        prod.ptr = line.purchase_rate;
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
          sel_rate: line.selling_rate || (line.mrp ? round2(line.mrp / unitsPerPack) : line.purchase_rate),
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
        notes: `Inward: Inv #${doc.supplier_invoice_no} (${line.batch_no})`,
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
        free_qty: line.free_qty || 0,
        units_per_pack: unitsPerPack,
        total_units: calc.total_stock_units,
        purchase_rate: line.purchase_rate,
        discount_percent: line.discount_percent || 0,
        discount_amount: calc.discount_amount,
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

    const roundOff = doc.round_off !== undefined ? doc.round_off : round2(Math.round(totalLinesAmount) - totalLinesAmount);
    const grandTotal = round2(totalLinesAmount + roundOff);

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
      subtotal: round2(subtotal),
      discount_total: round2(discountTotal),
      tax_total: round2(taxTotal),
      cgst_total: round2(cgstTotal),
      sgst_total: round2(sgstTotal),
      igst_total: round2(igstTotal),
      cess_total: round2(cessTotal),
      round_off: round2(roundOff),
      grand_total: round2(grandTotal),
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
      amount: grandTotal,
      notes: `Inward Invoice: ${doc.supplier_invoice_no}`,
    });

    // 7. Update PO fulfillment if linked
    if (doc.po_id) {
      await purchaseOrderService.updateReceivedQty(doc.po_id, receivedMap);
    }

    // 8. Enqueue for cloud sync
    await syncQueueService.enqueue("purchase", purchaseId, "create", {
      ...purchaseRow,
      items: itemRecords,
    });

    return { success: true, purchaseId, purchaseNumber };
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

    // 4. Update status to cancelled
    doc.status = "cancelled";
    doc.cancel_reason = reason;
    doc.updated_at = now;
    await sqliteStorage.insertRecord("purchase_documents", purchaseId, doc as unknown as Record<string, unknown>);

    // 5. Enqueue sync
    await syncQueueService.enqueue("purchase", purchaseId, "update", doc);

    return { success: true };
  }

  /**
   * Fetch purchase bill by ID with its line items
   */
  async getPurchaseBillById(
    purchaseId: string
  ): Promise<{ document: PurchaseDocumentRecord; items: PurchaseItemRecord[] } | null> {
    const doc = await sqliteStorage.findById<PurchaseDocumentRecord>("purchase_documents", purchaseId);
    if (!doc) return null;

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

    return { document: doc, items };
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
  ): Promise<{ success: boolean; purchaseId: string; purchaseNumber: string }> {
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
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;
    let cessTotal = 0;
    let totalLinesAmount = 0;

    const isInterstate = Boolean(doc.is_interstate);
    const newItemRecords: PurchaseItemRecord[] = [];
    const receivedMap: Record<string, number> = {};

    for (const line of doc.lines) {
      const calc = this.calculateLineTotals(line, isInterstate);
      subtotal += calc.gross_amount;
      discountTotal += calc.discount_amount;
      taxTotal += calc.total_tax;
      cgstTotal += calc.cgst_amount;
      sgstTotal += calc.sgst_amount;
      igstTotal += calc.igst_amount;
      cessTotal += calc.cess_amount;
      totalLinesAmount += calc.total_amount;

      receivedMap[line.product_id] = (receivedMap[line.product_id] || 0) + (line.pack_qty || line.qty || 0);

      const batchId = `batch_${line.product_id}_${line.batch_no.replace(/\s+/g, "_")}`;
      const existingBatch = await sqliteStorage.findById<ProductBatch>("product_batches", batchId);
      const updatedStock = (existingBatch?.stock_qty || 0) + calc.total_stock_units;
      const unitsPerPack = Math.max(1, line.units_per_pack || 1);

      await productsStore.upsertBatch({
        id: batchId,
        product_id: line.product_id,
        batch_no: line.batch_no,
        mfg_date: line.mfg_date,
        expiry_date: line.expiry_date,
        stock_qty: updatedStock,
        mrp: line.mrp,
        purchase_rate: line.purchase_rate,
        selling_rate: line.selling_rate || (line.mrp ? round2(line.mrp / unitsPerPack) : undefined),
        rack_location: line.shelf_location,
      });

      let prod = await productsStore.getProductById(line.product_id);
      if (prod) {
        prod.current_stock = (prod.current_stock || 0) + calc.total_stock_units;
        prod.ptr = line.purchase_rate;
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
        free_qty: line.free_qty || 0,
        units_per_pack: unitsPerPack,
        total_units: calc.total_stock_units,
        purchase_rate: line.purchase_rate,
        discount_percent: line.discount_percent || 0,
        discount_amount: calc.discount_amount,
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

    const roundOff = doc.round_off !== undefined ? doc.round_off : round2(Math.round(totalLinesAmount) - totalLinesAmount);
    const grandTotal = round2(totalLinesAmount + roundOff);

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
      subtotal: round2(subtotal),
      discount_total: round2(discountTotal),
      tax_total: round2(taxTotal),
      cgst_total: round2(cgstTotal),
      sgst_total: round2(sgstTotal),
      igst_total: round2(igstTotal),
      cess_total: round2(cessTotal),
      round_off: round2(roundOff),
      grand_total: round2(grandTotal),
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
      amount: grandTotal,
      notes: `Inward Invoice (Revised): ${doc.supplier_invoice_no}`,
    });

    // 6. UPDATE PO FULFILLMENT IF LINKED
    if (doc.po_id) {
      await purchaseOrderService.updateReceivedQty(doc.po_id, receivedMap);
    }

    // 7. ENQUEUE FOR SYNC
    await syncQueueService.enqueue("purchase", purchaseId, "update", {
      ...updatedDocRow,
      items: newItemRecords,
    });

    return { success: true, purchaseId, purchaseNumber: originalDoc.purchase_number };
  }
}

export const purchaseService = new PurchaseService();

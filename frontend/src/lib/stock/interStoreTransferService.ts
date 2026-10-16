import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";
import { storeService, type BranchStore } from "../masters/storeService";
import { companySettingsService } from "../settings/companySettingsService";
import { round2 } from "../billing/billingCalculations";
import { normalizePackLoose } from "../billing/unitConversion";
import type { InvoicePrintData } from "../printing/printingEngine";
import { syncQueueService } from "../sync/syncQueueService";

export type TransferStatus =
  | "draft"
  | "dispatched"
  | "in_transit"
  | "partially_received"
  | "received"
  | "rejected"
  | "cancelled";

export type TransferRateBasis = "mrp" | "sel_rate" | "ptr" | "pts" | "cost_price";

export type TransferGstTreatment = "intra_state" | "inter_state";

export interface TransportDetails {
  transporter_name?: string;
  vehicle_number?: string;
  lr_number?: string;
  eway_bill_number?: string;
  driver_name?: string;
  driver_phone?: string;
}

export interface InterStoreTransferLine {
  id: string;
  line_no: number;
  product_id: string;
  product_name: string;
  barcode?: string;
  hsn_code?: string;
  batch_id: string;
  batch_no: string;
  expiry_date: string;
  units_per_pack: number;
  pack_unit_name: string;
  loose_unit_name: string;
  
  // Quantities
  available_stock_packs: number;
  available_stock_loose: number;
  available_stock_total: number; // in base loose units
  
  transfer_packs: number;
  transfer_loose: number;
  transfer_total_qty: number; // in base loose units
  remaining_stock_total: number; // available - transfer
  
  // Rate & Financials
  rate_basis: TransferRateBasis;
  unit_rate: number; // price per pack
  loose_rate: number; // derived price per loose unit
  mrp: number;
  purchase_rate?: number;
  taxable_amount: number;
  gst_percent: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;

  // Batch health indicators
  is_near_expiry: boolean;
  is_expired: boolean;
  warnings: string[];

  // Receipt verification fields
  received_packs?: number;
  received_loose?: number;
  received_total_qty?: number;
  accepted_qty?: number; // total base units accepted into destination
  short_qty?: number; // total base units short
  damaged_qty?: number; // total base units damaged/rejected
  variance_reason?: string;
  variance_action?: "return_source" | "write_off_damage" | "pending_approval";
  receipt_notes?: string;
}

export interface InterStoreTransfer {
  id: string;
  transfer_no: string;
  transfer_date: string;
  expected_delivery_date?: string;
  
  source_store_id: string;
  source_store_name: string;
  source_store_gstin: string;
  source_store_address: string;
  source_store_state_code: string;

  destination_store_id: string;
  destination_store_name: string;
  destination_store_gstin: string;
  destination_store_address: string;
  destination_store_state_code: string;

  transport_details: TransportDetails;
  notes?: string;
  status: TransferStatus;
  default_rate_basis: TransferRateBasis;
  gst_treatment: TransferGstTreatment;

  lines: InterStoreTransferLine[];
  
  // Aggregate totals
  item_count: number;
  total_transfer_qty: number; // in base loose units
  total_transfer_packs: number;
  taxable_subtotal: number;
  total_tax: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  grand_total: number;

  // Workflow timestamps & audit
  dispatched_at?: number;
  dispatched_by?: string;
  received_at?: number;
  received_by?: string;
  settled_at?: number;
  cancelled_at?: number;
  cancel_reason?: string;

  audit_logs: Array<{
    timestamp: number;
    action: string;
    user: string;
    notes?: string;
  }>;

  created_at: number;
  updated_at: number;
}

export interface InterStoreTransferInput {
  transfer_no?: string;
  transfer_date?: string;
  expected_delivery_date?: string;
  source_store_id?: string;
  destination_store_id: string;
  transport_details?: TransportDetails;
  notes?: string;
  default_rate_basis?: TransferRateBasis;
  lines: Array<{
    product_id: string;
    batch_id: string;
    transfer_packs?: number;
    transfer_loose?: number;
    rate_basis?: TransferRateBasis;
    unit_rate?: number;
  }>;
}

export interface TransferReceiptLineInput {
  line_id: string;
  received_packs: number;
  received_loose: number;
  damaged_packs?: number;
  damaged_loose?: number;
  variance_reason?: string;
  variance_action?: "return_source" | "write_off_damage" | "pending_approval";
  receipt_notes?: string;
}

export class InterStoreTransferService {
  /**
   * Calculate derived rates and line tax for a transfer line
   */
  calculateLineFinancials(
    product: ProductItem,
    batch: ProductBatch,
    transferPacks: number,
    transferLoose: number,
    rateBasis: TransferRateBasis,
    customUnitRate?: number,
    gstTreatment: TransferGstTreatment = "intra_state"
  ): {
    transfer_total_qty: number;
    unit_rate: number;
    loose_rate: number;
    taxable_amount: number;
    cgst_amount: number;
    sgst_amount: number;
    igst_amount: number;
    total_amount: number;
  } {
    const upp = Math.max(1, product.units_per_pack || 1);
    const normalized = normalizePackLoose(transferPacks, transferLoose, upp);
    const totalQty = normalized.packs * upp + normalized.loose;

    let basePackRate = customUnitRate !== undefined ? customUnitRate : 0;
    if (customUnitRate === undefined || customUnitRate <= 0) {
      switch (rateBasis) {
        case "mrp":
          basePackRate = batch.mrp || product.mrp || 0;
          break;
        case "ptr":
          basePackRate = product.ptr || batch.selling_rate || product.sel_rate || 0;
          break;
        case "pts":
          basePackRate = product.pts || product.ptr || batch.selling_rate || product.sel_rate || 0;
          break;
        case "cost_price":
          basePackRate = batch.purchase_rate || product.pts || round2((batch.selling_rate || product.sel_rate) * 0.75);
          break;
        case "sel_rate":
        default:
          basePackRate = batch.selling_rate || product.sel_rate || 0;
          break;
      }
    }

    const looseRate = upp > 1 ? round2(basePackRate / upp) : basePackRate;
    const taxableAmount = round2(normalized.packs * basePackRate + normalized.loose * looseRate);

    const gstPercent = product.gst_percent || 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;

    if (gstTreatment === "inter_state") {
      igstAmount = round2(taxableAmount * (gstPercent / 100));
    } else {
      cgstAmount = round2(taxableAmount * (gstPercent / 200));
      sgstAmount = round2(taxableAmount * (gstPercent / 200));
    }

    const totalTax = gstTreatment === "inter_state" ? igstAmount : round2(cgstAmount + sgstAmount);
    const totalAmount = round2(taxableAmount + totalTax);

    return {
      transfer_total_qty: totalQty,
      unit_rate: basePackRate,
      loose_rate: looseRate,
      taxable_amount: taxableAmount,
      cgst_amount: cgstAmount,
      sgst_amount: sgstAmount,
      igst_amount: igstAmount,
      total_amount: totalAmount,
    };
  }

  /**
   * Construct full transfer line object with stock and expiry warnings
   */
  async buildTransferLine(
    product: ProductItem,
    batch: ProductBatch,
    transferPacks: number,
    transferLoose: number,
    lineNo: number,
    rateBasis: TransferRateBasis = "sel_rate",
    customUnitRate?: number,
    gstTreatment: TransferGstTreatment = "intra_state",
    referenceDate = new Date()
  ): Promise<InterStoreTransferLine> {
    const upp = Math.max(1, product.units_per_pack || 1);
    const availTotal = Math.max(0, batch.stock_qty || 0);
    const availPacks = Math.floor(availTotal / upp);
    const availLoose = round2(availTotal % upp);

    const financials = this.calculateLineFinancials(
      product,
      batch,
      transferPacks,
      transferLoose,
      rateBasis,
      customUnitRate,
      gstTreatment
    );

    const remainingStock = round2(availTotal - financials.transfer_total_qty);

    // Expiry check
    const todayStr = referenceDate.toISOString().slice(0, 10);
    const nearCutoffStr = new Date(referenceDate.getTime() + 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const isExpired = Boolean(batch.expiry_date && batch.expiry_date < todayStr);
    const isNearExpiry = Boolean(!isExpired && batch.expiry_date && batch.expiry_date <= nearCutoffStr);

    const warnings: string[] = [];
    if (isExpired) {
      warnings.push(`Batch ${batch.batch_no} expired on ${batch.expiry_date}`);
    } else if (isNearExpiry) {
      warnings.push(`Batch ${batch.batch_no} expires soon (${batch.expiry_date})`);
    }

    if (financials.transfer_total_qty > availTotal) {
      warnings.push(`Requested quantity (${financials.transfer_total_qty}) exceeds available stock (${availTotal})`);
    }

    return {
      id: `line_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      line_no: lineNo,
      product_id: product.id,
      product_name: product.name,
      barcode: product.barcode,
      hsn_code: product.hsn_sac_code || "30049099",
      batch_id: batch.id,
      batch_no: batch.batch_no,
      expiry_date: batch.expiry_date,
      units_per_pack: upp,
      pack_unit_name: product.unit_id || "pack",
      loose_unit_name: "pc",
      available_stock_packs: availPacks,
      available_stock_loose: availLoose,
      available_stock_total: availTotal,
      transfer_packs: transferPacks,
      transfer_loose: transferLoose,
      transfer_total_qty: financials.transfer_total_qty,
      remaining_stock_total: remainingStock,
      rate_basis: rateBasis,
      unit_rate: financials.unit_rate,
      loose_rate: financials.loose_rate,
      mrp: batch.mrp || product.mrp || 0,
      purchase_rate: batch.purchase_rate,
      taxable_amount: financials.taxable_amount,
      gst_percent: product.gst_percent || 0,
      cgst_amount: financials.cgst_amount,
      sgst_amount: financials.sgst_amount,
      igst_amount: financials.igst_amount,
      total_amount: financials.total_amount,
      is_near_expiry: isNearExpiry,
      is_expired: isExpired,
      warnings,
    };
  }

  /**
   * Recalculate transfer totals from lines
   */
  recomputeTransferTotals(lines: InterStoreTransferLine[]): {
    item_count: number;
    total_transfer_qty: number;
    total_transfer_packs: number;
    taxable_subtotal: number;
    cgst_total: number;
    sgst_total: number;
    igst_total: number;
    total_tax: number;
    grand_total: number;
  } {
    let totalQty = 0;
    let totalPacks = 0;
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    for (const l of lines) {
      totalQty += l.transfer_total_qty;
      totalPacks += l.transfer_packs + (l.units_per_pack > 1 ? l.transfer_loose / l.units_per_pack : 0);
      taxable += l.taxable_amount;
      cgst += l.cgst_amount;
      sgst += l.sgst_amount;
      igst += l.igst_amount;
    }

    const totalTax = round2(cgst + sgst + igst);
    const grandTotal = round2(taxable + totalTax);

    return {
      item_count: lines.length,
      total_transfer_qty: round2(totalQty),
      total_transfer_packs: round2(totalPacks),
      taxable_subtotal: round2(taxable),
      cgst_total: round2(cgst),
      sgst_total: round2(sgst),
      igst_total: round2(igst),
      total_tax: totalTax,
      grand_total: grandTotal,
    };
  }

  /**
   * Create a new draft inter-store transfer
   */
  async createDraft(input: InterStoreTransferInput, operatorName = "Operator"): Promise<InterStoreTransfer> {
    const sourceStore = input.source_store_id
      ? await storeService.getStoreById(input.source_store_id)
      : await storeService.getCurrentStore();

    if (!sourceStore) throw new Error("Source store not found");

    const destinationStore = await storeService.getStoreById(input.destination_store_id);
    if (!destinationStore) throw new Error("Destination store not found");

    if (sourceStore.id === destinationStore.id) {
      throw new Error("Destination store cannot be the same as the source store");
    }

    const gstEval = storeService.determineGstTreatment(sourceStore, destinationStore);
    const gstTreatment = gstEval.treatment;

    const rateBasis = input.default_rate_basis || "sel_rate";
    const transferNo =
      input.transfer_no || (await companySettingsService.generateNextDocumentNumber("transfer"));

    const builtLines: InterStoreTransferLine[] = [];
    for (let i = 0; i < input.lines.length; i++) {
      const lineReq = input.lines[i];
      const product = await productsStore.getProductById(lineReq.product_id);
      if (!product) continue;

      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", lineReq.batch_id);
      if (!batch) continue;

      const line = await this.buildTransferLine(
        product,
        batch,
        lineReq.transfer_packs || 0,
        lineReq.transfer_loose || 0,
        i + 1,
        lineReq.rate_basis || rateBasis,
        lineReq.unit_rate,
        gstTreatment
      );
      builtLines.push(line);
    }

    const totals = this.recomputeTransferTotals(builtLines);
    const now = Date.now();
    const transferId = `st_${now}_${Math.random().toString(16).slice(2, 6)}`;

    const transferRecord: InterStoreTransfer = {
      id: transferId,
      transfer_no: transferNo,
      transfer_date: input.transfer_date || new Date().toISOString().slice(0, 10),
      expected_delivery_date: input.expected_delivery_date,
      source_store_id: sourceStore.id,
      source_store_name: sourceStore.name,
      source_store_gstin: sourceStore.gstin || "",
      source_store_address: sourceStore.address || "",
      source_store_state_code: sourceStore.state_code || "32",
      destination_store_id: destinationStore.id,
      destination_store_name: destinationStore.name,
      destination_store_gstin: destinationStore.gstin || "",
      destination_store_address: destinationStore.address || "",
      destination_store_state_code: destinationStore.state_code || "32",
      transport_details: input.transport_details || {},
      notes: input.notes,
      status: "draft",
      default_rate_basis: rateBasis,
      gst_treatment: gstTreatment,
      lines: builtLines,
      item_count: totals.item_count,
      total_transfer_qty: totals.total_transfer_qty,
      total_transfer_packs: totals.total_transfer_packs,
      taxable_subtotal: totals.taxable_subtotal,
      total_tax: totals.total_tax,
      cgst_total: totals.cgst_total,
      sgst_total: totals.sgst_total,
      igst_total: totals.igst_total,
      grand_total: totals.grand_total,
      audit_logs: [
        {
          timestamp: now,
          action: "CREATED_DRAFT",
          user: operatorName,
          notes: `Created draft transfer to ${destinationStore.name} with ${builtLines.length} products`,
        },
      ],
      created_at: now,
      updated_at: now,
    };

    await sqliteStorage.insertRecord("stock_transfers", transferId, transferRecord as unknown as Record<string, unknown>);
    return transferRecord;
  }

  /**
   * Update an existing draft transfer
   */
  async updateTransfer(
    id: string,
    updates: Partial<InterStoreTransferInput> & { lines?: InterStoreTransferLine[] },
    operatorName = "Operator"
  ): Promise<InterStoreTransfer> {
    const existing = await this.getTransferById(id);
    if (!existing) throw new Error("Transfer not found");

    if (existing.status !== "draft") {
      throw new Error(`Cannot modify transfer in '${existing.status}' status`);
    }

    let destinationStore = existing.destination_store_id
      ? await storeService.getStoreById(existing.destination_store_id)
      : null;

    if (updates.destination_store_id && updates.destination_store_id !== existing.destination_store_id) {
      destinationStore = await storeService.getStoreById(updates.destination_store_id);
      if (!destinationStore) throw new Error("Destination store not found");
      if (destinationStore.id === existing.source_store_id) {
        throw new Error("Destination store cannot be the same as source store");
      }
      existing.destination_store_id = destinationStore.id;
      existing.destination_store_name = destinationStore.name;
      existing.destination_store_gstin = destinationStore.gstin || "";
      existing.destination_store_address = destinationStore.address || "";
      existing.destination_store_state_code = destinationStore.state_code || "32";
    }

    const sourceStore = await storeService.getStoreById(existing.source_store_id);
    if (sourceStore && destinationStore) {
      const gstEval = storeService.determineGstTreatment(sourceStore, destinationStore);
      existing.gst_treatment = gstEval.treatment;
    }

    if (updates.transport_details) existing.transport_details = { ...existing.transport_details, ...updates.transport_details };
    if (updates.notes !== undefined) existing.notes = updates.notes;
    if (updates.transfer_date) existing.transfer_date = updates.transfer_date;
    if (updates.expected_delivery_date !== undefined) existing.expected_delivery_date = updates.expected_delivery_date;
    if (updates.default_rate_basis) existing.default_rate_basis = updates.default_rate_basis;

    if (updates.lines) {
      existing.lines = updates.lines;
    }

    const totals = this.recomputeTransferTotals(existing.lines);
    existing.item_count = totals.item_count;
    existing.total_transfer_qty = totals.total_transfer_qty;
    existing.total_transfer_packs = totals.total_transfer_packs;
    existing.taxable_subtotal = totals.taxable_subtotal;
    existing.total_tax = totals.total_tax;
    existing.cgst_total = totals.cgst_total;
    existing.sgst_total = totals.sgst_total;
    existing.igst_total = totals.igst_total;
    existing.grand_total = totals.grand_total;
    existing.updated_at = Date.now();

    existing.audit_logs.push({
      timestamp: Date.now(),
      action: "UPDATED_DRAFT",
      user: operatorName,
      notes: `Updated draft lines (${existing.lines.length} items, total ₹${totals.grand_total})`,
    });

    await sqliteStorage.insertRecord("stock_transfers", id, existing as unknown as Record<string, unknown>);
    return existing;
  }

  /**
   * Dispatch Transfer: Immediately deducts stock from source batches into in_transit
   */
  async dispatchTransfer(id: string, operatorName = "Operator"): Promise<InterStoreTransfer> {
    const transfer = await this.getTransferById(id);
    if (!transfer) throw new Error("Transfer not found");

    if (transfer.status !== "draft") {
      throw new Error(`Transfer is already in '${transfer.status}' status`);
    }

    if (transfer.lines.length === 0) {
      throw new Error("Cannot dispatch an empty transfer. Add at least one item.");
    }

    // Step 1: Pre-validation of source stock
    for (const line of transfer.lines) {
      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", line.batch_id);
      if (!batch) {
        throw new Error(`Batch ${line.batch_no} for product ${line.product_name} not found`);
      }
      if (batch.stock_qty < line.transfer_total_qty) {
        throw new Error(
          `Insufficient stock for ${line.product_name} (Batch: ${line.batch_no}). Requested: ${line.transfer_total_qty}, Available: ${batch.stock_qty}`
        );
      }
    }

    const now = Date.now();

    // Step 2: Deduct stock from source batches and log double-entry stock transactions
    for (const line of transfer.lines) {
      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", line.batch_id);
      if (!batch) continue;

      batch.stock_qty = round2(batch.stock_qty - line.transfer_total_qty);
      await productsStore.upsertBatch(batch);

      const product = await productsStore.getProductById(line.product_id);
      if (product) {
        product.current_stock = round2((product.current_stock || 0) - line.transfer_total_qty);
        await productsStore.upsertProduct(product);
      }

      const txId = `st_tx_out_${now}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("stock_transactions", txId, {
        id: txId,
        product_id: line.product_id,
        batch_id: line.batch_id,
        event_type: "TRANSFER_OUT",
        qty_delta: -line.transfer_total_qty,
        unit_cost: line.loose_rate,
        reference_type: "INTER_STORE_TRANSFER",
        reference_id: transfer.transfer_no,
        notes: `Dispatched to ${transfer.destination_store_name} via ${transfer.transfer_no}`,
        created_at: now,
      });
    }

    transfer.status = "dispatched";
    transfer.dispatched_at = now;
    transfer.dispatched_by = operatorName;
    transfer.updated_at = now;

    transfer.audit_logs.push({
      timestamp: now,
      action: "DISPATCHED",
      user: operatorName,
      notes: `Dispatched ${transfer.lines.length} items (Total Qty: ${transfer.total_transfer_qty}) to ${transfer.destination_store_name}`,
    });

    await sqliteStorage.insertRecord("stock_transfers", id, transfer as unknown as Record<string, unknown>);
    try {
      await syncQueueService.enqueue("transfer", id, "create", transfer as unknown as Record<string, unknown>);
    } catch (_) {}
    return transfer;
  }

  /**
   * Receive Transfer at Destination Store with Line Variance Reconciliation
   */
  async receiveTransfer(
    id: string,
    receiptLines: TransferReceiptLineInput[],
    operatorName = "Receiving Officer"
  ): Promise<InterStoreTransfer> {
    const transfer = await this.getTransferById(id);
    if (!transfer) throw new Error("Transfer not found");

    if (transfer.status !== "dispatched" && transfer.status !== "in_transit" && transfer.status !== "partially_received") {
      throw new Error(`Cannot receive transfer in '${transfer.status}' status`);
    }

    const now = Date.now();
    let hasVariance = false;
    let allLinesProcessed = true;

    for (const receipt of receiptLines) {
      const line = transfer.lines.find((l) => l.id === receipt.line_id);
      if (!line) continue;

      const upp = Math.max(1, line.units_per_pack || 1);
      const receivedNormalized = normalizePackLoose(receipt.received_packs, receipt.received_loose, upp);
      const receivedQty = receivedNormalized.packs * upp + receivedNormalized.loose;

      const damagedNormalized = normalizePackLoose(receipt.damaged_packs || 0, receipt.damaged_loose || 0, upp);
      const damagedQty = damagedNormalized.packs * upp + damagedNormalized.loose;

      const acceptedQty = Math.max(0, receivedQty - damagedQty);
      const shortQty = Math.max(0, line.transfer_total_qty - receivedQty);

      line.received_packs = receipt.received_packs;
      line.received_loose = receipt.received_loose;
      line.received_total_qty = receivedQty;
      line.accepted_qty = acceptedQty;
      line.damaged_qty = damagedQty;
      line.short_qty = shortQty;
      line.variance_reason = receipt.variance_reason;
      line.variance_action = receipt.variance_action || (shortQty > 0 || damagedQty > 0 ? "return_source" : undefined);
      line.receipt_notes = receipt.receipt_notes;

      if (shortQty > 0 || damagedQty > 0) {
        hasVariance = true;
      }

      // Step 1: Add accepted stock to destination inventory
      if (acceptedQty > 0) {
        // Upsert matching batch in destination store
        const destBatchId = `${transfer.destination_store_id}_${line.product_id}_${line.batch_no}`;
        const existingDestBatch = await sqliteStorage.findById<ProductBatch>("product_batches", destBatchId);
        if (existingDestBatch) {
          existingDestBatch.stock_qty = round2(existingDestBatch.stock_qty + acceptedQty);
          await productsStore.upsertBatch(existingDestBatch);
        } else {
          // Create new batch record for destination store
          const newBatch: ProductBatch = {
            id: destBatchId,
            product_id: line.product_id,
            batch_no: line.batch_no,
            expiry_date: line.expiry_date,
            stock_qty: acceptedQty,
            mrp: line.mrp,
            selling_rate: line.unit_rate,
            purchase_rate: line.purchase_rate || line.loose_rate,
          };
          await productsStore.upsertBatch(newBatch);
        }

        const product = await productsStore.getProductById(line.product_id);
        if (product) {
          product.current_stock = round2((product.current_stock || 0) + acceptedQty);
          await productsStore.upsertProduct(product);
        }

        // Log double-entry TRANSFER_IN
        const inTxId = `st_tx_in_${now}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("stock_transactions", inTxId, {
          id: inTxId,
          product_id: line.product_id,
          batch_id: destBatchId,
          event_type: "TRANSFER_IN",
          qty_delta: acceptedQty,
          unit_cost: line.loose_rate,
          reference_type: "INTER_STORE_TRANSFER",
          reference_id: transfer.transfer_no,
          notes: `Received at ${transfer.destination_store_name} from ${transfer.source_store_name}`,
          created_at: now,
        });
      }

      // Step 2: Handle short items with return_source action (restore back to source)
      if (shortQty > 0 && line.variance_action === "return_source") {
        const sourceBatch = await sqliteStorage.findById<ProductBatch>("product_batches", line.batch_id);
        if (sourceBatch) {
          sourceBatch.stock_qty = round2(sourceBatch.stock_qty + shortQty);
          await productsStore.upsertBatch(sourceBatch);
        }

        const sourceProduct = await productsStore.getProductById(line.product_id);
        if (sourceProduct) {
          sourceProduct.current_stock = round2((sourceProduct.current_stock || 0) + shortQty);
          await productsStore.upsertProduct(sourceProduct);
        }

        const restoreTxId = `st_tx_ret_${now}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("stock_transactions", restoreTxId, {
          id: restoreTxId,
          product_id: line.product_id,
          batch_id: line.batch_id,
          event_type: "TRANSFER_RETURN_RESTORE",
          qty_delta: shortQty,
          reference_type: "INTER_STORE_TRANSFER_VARIANCE",
          reference_id: transfer.transfer_no,
          notes: `Shortage variance returned to source store (${receipt.variance_reason || "Short delivery"})`,
          created_at: now,
        });
      }

      // Step 3: Log damaged loss if written off
      if (damagedQty > 0) {
        const dmgTxId = `st_tx_dmg_${now}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("stock_transactions", dmgTxId, {
          id: dmgTxId,
          product_id: line.product_id,
          batch_id: line.batch_id,
          event_type: "TRANSFER_DAMAGE_LOSS",
          qty_delta: -damagedQty,
          reference_type: "INTER_STORE_TRANSFER_VARIANCE",
          reference_id: transfer.transfer_no,
          notes: `Transit damage write-off (${receipt.variance_reason || "Damaged goods in transit"})`,
          created_at: now,
        });
      }
    }

    transfer.status = hasVariance ? "received" : "received";
    transfer.received_at = now;
    transfer.received_by = operatorName;
    transfer.settled_at = now;
    transfer.updated_at = now;

    transfer.audit_logs.push({
      timestamp: now,
      action: "RECEIVED",
      user: operatorName,
      notes: `Received and verified transfer ${transfer.transfer_no} at ${transfer.destination_store_name}${
        hasVariance ? " (with variances recorded)" : " (in full)"
      }`,
    });

    await sqliteStorage.insertRecord("stock_transfers", id, transfer as unknown as Record<string, unknown>);
    return transfer;
  }

  /**
   * Cancel Transfer: Reverses dispatch and restores source batch stock
   */
  async cancelTransfer(id: string, reason = "Cancelled by user", operatorName = "Operator"): Promise<InterStoreTransfer> {
    const transfer = await this.getTransferById(id);
    if (!transfer) throw new Error("Transfer not found");

    if (transfer.status === "received" || transfer.status === "partially_received") {
      throw new Error("Cannot cancel a transfer that has already been received. Create a reverse return transfer instead.");
    }

    if (transfer.status === "cancelled") {
      throw new Error("Transfer is already cancelled");
    }

    const now = Date.now();

    // If transfer was dispatched / in transit, rollback source stock deductions
    if (transfer.status === "dispatched" || transfer.status === "in_transit") {
      for (const line of transfer.lines) {
        const batch = await sqliteStorage.findById<ProductBatch>("product_batches", line.batch_id);
        if (batch) {
          batch.stock_qty = round2(batch.stock_qty + line.transfer_total_qty);
          await productsStore.upsertBatch(batch);
        }

        const product = await productsStore.getProductById(line.product_id);
        if (product) {
          product.current_stock = round2((product.current_stock || 0) + line.transfer_total_qty);
          await productsStore.upsertProduct(product);
        }

        const txId = `st_tx_cnl_${now}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("stock_transactions", txId, {
          id: txId,
          product_id: line.product_id,
          batch_id: line.batch_id,
          event_type: "TRANSFER_CANCEL_RESTORE",
          qty_delta: line.transfer_total_qty,
          reference_type: "INTER_STORE_TRANSFER",
          reference_id: transfer.transfer_no,
          notes: `Restored stock due to transfer cancellation (${reason})`,
          created_at: now,
        });
      }
    }

    transfer.status = "cancelled";
    transfer.cancelled_at = now;
    transfer.cancel_reason = reason;
    transfer.updated_at = now;

    transfer.audit_logs.push({
      timestamp: now,
      action: "CANCELLED",
      user: operatorName,
      notes: `Transfer cancelled: ${reason}. Source inventory restored.`,
    });

    await sqliteStorage.insertRecord("stock_transfers", id, transfer as unknown as Record<string, unknown>);
    return transfer;
  }

  /**
   * Auto-Split a single product's requested quantity across multiple batches in FEFO order
   */
  async autoSplitAcrossBatches(
    productId: string,
    requestedPacks: number,
    requestedLoose = 0,
    rateBasis: TransferRateBasis = "sel_rate",
    gstTreatment: TransferGstTreatment = "intra_state"
  ): Promise<InterStoreTransferLine[]> {
    const product = await productsStore.getProductById(productId);
    if (!product) throw new Error("Product not found");

    const upp = Math.max(1, product.units_per_pack || 1);
    const totalRequestedUnits = requestedPacks * upp + requestedLoose;
    if (totalRequestedUnits <= 0) return [];

    const batches = await productsStore.getBatchesForProduct(productId, false);
    // Sort in FEFO order
    const sorted = batches.filter((b) => b.stock_qty > 0).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));

    let remainingNeeded = totalRequestedUnits;
    const generatedLines: InterStoreTransferLine[] = [];

    for (const batch of sorted) {
      if (remainingNeeded <= 0) break;

      const takeUnits = Math.min(batch.stock_qty, remainingNeeded);
      const linePacks = Math.floor(takeUnits / upp);
      const lineLoose = round2(takeUnits % upp);

      const line = await this.buildTransferLine(
        product,
        batch,
        linePacks,
        lineLoose,
        generatedLines.length + 1,
        rateBasis,
        undefined,
        gstTreatment
      );
      generatedLines.push(line);
      remainingNeeded -= takeUnits;
    }

    return generatedLines;
  }

  /**
   * Import lines from CSV / TSV / Excel paste text with validation preview
   */
  async importFromCsv(
    csvContent: string,
    defaultRateBasis: TransferRateBasis = "sel_rate",
    gstTreatment: TransferGstTreatment = "intra_state"
  ): Promise<{
    validLines: InterStoreTransferLine[];
    invalidRows: Array<{ row: number; raw: string; error: string }>;
    summary: { totalRows: number; validCount: number; invalidCount: number };
  }> {
    const lines = csvContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const validLines: InterStoreTransferLine[] = [];
    const invalidRows: Array<{ row: number; raw: string; error: string }> = [];

    const allProducts = await productsStore.getAllProducts();

    for (let i = 0; i < lines.length; i++) {
      const rowNum = i + 1;
      const raw = lines[i];

      // Skip header row if contains standard column names
      if (
        i === 0 &&
        (raw.toLowerCase().includes("product") ||
          raw.toLowerCase().includes("barcode") ||
          raw.toLowerCase().includes("batch") ||
          raw.toLowerCase().includes("qty"))
      ) {
        continue;
      }

      const cols = raw.split(/[\t,;]/).map((c) => c.trim().replace(/^["']|["']$/g, ""));
      if (cols.length < 2) {
        invalidRows.push({ row: rowNum, raw, error: "Row has insufficient columns (expected: Identifier, Qty/Batch)" });
        continue;
      }

      const identifier = cols[0]; // Barcode or Product Name / Code
      let batchNo = cols.length >= 3 ? cols[1] : "";
      const qtyStr = cols.length >= 3 ? cols[2] : cols[1];
      const parsedQty = parseFloat(qtyStr);

      if (isNaN(parsedQty) || parsedQty <= 0) {
        invalidRows.push({ row: rowNum, raw, error: `Invalid quantity "${qtyStr}"` });
        continue;
      }

      // Match product by barcode or name
      const matchedProduct = allProducts.find(
        (p) =>
          p.barcode.toLowerCase() === identifier.toLowerCase() ||
          p.name.toLowerCase() === identifier.toLowerCase() ||
          p.id.toLowerCase() === identifier.toLowerCase()
      );

      if (!matchedProduct) {
        invalidRows.push({ row: rowNum, raw, error: `Product not found for "${identifier}"` });
        continue;
      }

      const batches = await productsStore.getBatchesForProduct(matchedProduct.id, false);
      let matchedBatch: ProductBatch | undefined;

      if (batchNo) {
        matchedBatch = batches.find((b) => b.batch_no.toLowerCase() === batchNo.toLowerCase());
      }
      if (!matchedBatch && batches.length > 0) {
        // Default to first available FEFO batch
        matchedBatch = batches.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))[0];
      }

      if (!matchedBatch) {
        invalidRows.push({ row: rowNum, raw, error: `No active stock batch found for ${matchedProduct.name}` });
        continue;
      }

      const upp = Math.max(1, matchedProduct.units_per_pack || 1);
      const packs = Math.floor(parsedQty);
      const loose = upp > 1 ? round2((parsedQty - packs) * upp) : 0;

      const line = await this.buildTransferLine(
        matchedProduct,
        matchedBatch,
        packs,
        loose,
        validLines.length + 1,
        defaultRateBasis,
        undefined,
        gstTreatment
      );

      validLines.push(line);
    }

    return {
      validLines,
      invalidRows,
      summary: {
        totalRows: lines.length,
        validCount: validLines.length,
        invalidCount: invalidRows.length,
      },
    };
  }

  /**
   * Suggest products with low stock at destination and stock available at source
   */
  async getLowStockSuggestions(destinationStoreId: string): Promise<ProductItem[]> {
    const all = await productsStore.getAllProducts();
    // Return products with current_stock > 0 and reorder_level set
    return all.filter((p) => (p.current_stock || 0) > 0 && p.is_active);
  }

  /**
   * Fetch all near-expiry batches (expiring within thresholdDays) available at source
   */
  async getNearExpirySuggestions(thresholdDays = 60, referenceDate = new Date()): Promise<ProductBatch[]> {
    const all = await sqliteStorage.findAll<ProductBatch>("product_batches");
    const cutoffDate = new Date(referenceDate.getTime() + thresholdDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    return all
      .filter((b) => b.stock_qty > 0 && b.expiry_date && b.expiry_date <= cutoffDate)
      .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
  }

  /**
   * Duplicate a past transfer lines into a new draft input
   */
  async duplicateTransfer(sourceTransferId: string, operatorName = "Operator"): Promise<InterStoreTransfer> {
    const source = await this.getTransferById(sourceTransferId);
    if (!source) throw new Error("Source transfer not found to duplicate");

    const lineInputs = source.lines.map((l) => ({
      product_id: l.product_id,
      batch_id: l.batch_id,
      transfer_packs: l.transfer_packs,
      transfer_loose: l.transfer_loose,
      rate_basis: l.rate_basis,
      unit_rate: l.unit_rate,
    }));

    return await this.createDraft(
      {
        destination_store_id: source.destination_store_id,
        source_store_id: source.source_store_id,
        transport_details: source.transport_details,
        notes: `Duplicated from ${source.transfer_no}`,
        default_rate_basis: source.default_rate_basis,
        lines: lineInputs,
      },
      operatorName
    );
  }

  /**
   * Generate InvoicePrintData structure for Delivery Challan / Transfer Note
   */
  generateTransferPrintData(transfer: InterStoreTransfer): InvoicePrintData {
    const printLines = transfer.lines.map((l) => ({
      description: `${l.product_name} [${l.batch_no}]`,
      hsn_code: l.hsn_code,
      batch_no: l.batch_no,
      expiry_date: l.expiry_date,
      qty: l.transfer_packs,
      loose_qty: l.transfer_loose,
      rate: l.unit_rate,
      taxable_amount: l.taxable_amount,
      gst_percent: l.gst_percent,
      amount: l.total_amount,
    }));

    const transportText = [
      transfer.transport_details.transporter_name ? `Transporter: ${transfer.transport_details.transporter_name}` : "",
      transfer.transport_details.vehicle_number ? `Vehicle: ${transfer.transport_details.vehicle_number}` : "",
      transfer.transport_details.lr_number ? `LR No: ${transfer.transport_details.lr_number}` : "",
      transfer.transport_details.eway_bill_number ? `E-Way Bill: ${transfer.transport_details.eway_bill_number}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    return {
      invoice_number: transfer.transfer_no,
      invoice_date: transfer.transfer_date,
      store_name: transfer.source_store_name,
      store_address: transfer.source_store_address,
      store_gstin: transfer.source_store_gstin,
      customer_name: transfer.destination_store_name,
      customer_address: transfer.destination_store_address,
      customer_gstin: transfer.destination_store_gstin,
      payment_status: "STOCK TRANSFER / DELIVERY CHALLAN",
      payment_mode: "Internal Transfer",
      lines: printLines,
      subtotal: transfer.taxable_subtotal,
      tax_total: transfer.total_tax,
      cgst_total: transfer.cgst_total,
      sgst_total: transfer.sgst_total,
      igst_total: transfer.igst_total,
      round_off: 0,
      grand_total: transfer.grand_total,
      terms_and_conditions: `Goods dispatched under Rule 55 of CGST Rules for internal store transfer. Not for direct commercial sale. ${transportText}`,
      footer_note: `Generated by LamStone Inter-Store Transfer Engine. Source: ${transfer.source_store_name} → Destination: ${transfer.destination_store_name}`,
    };
  }

  async getAllTransfers(): Promise<InterStoreTransfer[]> {
    try {
      const records = await sqliteStorage.findAll<InterStoreTransfer>("stock_transfers");
      return (records || []).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    } catch (_) {
      return [];
    }
  }

  async getTransferById(id: string): Promise<InterStoreTransfer | null> {
    try {
      return await sqliteStorage.findById<InterStoreTransfer>("stock_transfers", id);
    } catch (_) {
      return null;
    }
  }
}

export const interStoreTransferService = new InterStoreTransferService();

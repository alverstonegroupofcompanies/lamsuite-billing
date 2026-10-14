import type { EntityDefinition } from "../types";
import { sqliteStorage } from "../../../db/sqliteStorage";

export const stockEventsDefinition: EntityDefinition = {
  id: "stock_events",
  label: "Stock Events & Inventory Adjustments",
  singularLabel: "Stock Event",
  category: "stock",
  description: "Stock audits, damage write-offs, physical count reconciliations, and quantity adjustments.",
  targetTable: "stock_transactions",
  primaryKey: "id",
  requiredPermission: "inventory:adjust",
  supportsRoundTrip: true,
  duplicateKeys: [
    { id: "ref_tx", label: "Reference ID", fields: ["reference_id"], exactMatch: true },
  ],
  foreignKeys: [
    {
      field: "barcode",
      targetEntityId: "items",
      lookupField: "barcode",
      autoCreateSupported: false,
    },
  ],
  fields: {
    barcode: {
      key: "barcode",
      label: "Product Barcode / SKU",
      type: "string",
      required: true,
      example: "8901030012345",
      description: "Barcode of the catalog item",
      aliases: ["barcode", "item_code", "sku"],
    },
    batch_no: {
      key: "batch_no",
      label: "Batch Number",
      type: "string",
      required: true,
      example: "BAT-9941",
      description: "Batch identifier to adjust",
      aliases: ["batch", "batch_no", "lot_no"],
    },
    event_type: {
      key: "event_type",
      label: "Event Type",
      type: "select",
      required: true,
      defaultValue: "adjustment",
      example: "adjustment",
      description: "Classification of inventory movement",
      options: [
        { value: "adjustment", label: "Physical Count Adjustment (+/-)" },
        { value: "damage_writeoff", label: "Damaged / Broken Stock (-)" },
        { value: "expiry_writeoff", label: "Expired Stock Removal (-)" },
        { value: "wastage", label: "Spillage / Breakage (-)" },
      ],
      aliases: ["type", "event_type", "reason"],
    },
    qty_delta: {
      key: "qty_delta",
      label: "Quantity Delta (+ or -)",
      type: "number",
      required: true,
      example: -5,
      description: "Signed change in stock units (+ for positive surplus, - for deficit/damage)",
      aliases: ["qty", "qty_delta", "adjustment_qty", "difference"],
    },
    remarks: {
      key: "remarks",
      label: "Audit Remarks / Reason",
      type: "string",
      required: false,
      example: "Quarterly stocktaking physical variance",
      description: "Audit ledger justification",
      aliases: ["remarks", "notes", "reason"],
    },
  },
  sampleRows: [
    {
      barcode: "8901030012345",
      batch_no: "B-2026A",
      event_type: "adjustment",
      qty_delta: -2,
      remarks: "Physical verification discrepancy",
    },
  ],
  postImportHook: async (events) => {
    const now = Date.now();
    for (const ev of events) {
      const product = await sqliteStorage.findByField<any>("products", "barcode", ev.barcode);
      if (product) {
        // Find matching batch
        const batches = await sqliteStorage.findAll<any>("product_batches");
        const batch = batches.find((b) => b.product_id === product.id && b.batch_no === ev.batch_no);
        if (batch) {
          const newBatchStock = Math.max(0, Number(batch.stock_qty || 0) + Number(ev.qty_delta || 0));
          await sqliteStorage.updateRecord("product_batches", batch.id, {
            stock_qty: newBatchStock,
          });

          // Update parent product stock
          const allProdBatches = (await sqliteStorage.findAll<any>("product_batches")).filter(
            (b) => b.product_id === product.id
          );
          const totalStock = allProdBatches.reduce((sum, b) => sum + Number(b.stock_qty || 0), 0);
          await sqliteStorage.updateRecord("products", product.id, {
            current_stock: totalStock,
          });
        }
      }
    }
  },
  transformRow: (raw) => {
    const id = raw.id || `stk_ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      barcode: String(raw.barcode || "").trim(),
      batch_no: String(raw.batch_no || "").trim(),
      event_type: raw.event_type || "adjustment",
      qty_delta: Number(raw.qty_delta || 0),
      reference_type: "manual_adjustment",
      reference_id: id,
      remarks: raw.remarks ? String(raw.remarks).trim() : undefined,
      created_at: Date.now(),
    };
  },
  exportQuery: async () => sqliteStorage.findAll<any>("stock_transactions"),
};

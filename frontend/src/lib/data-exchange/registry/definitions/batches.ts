import type { EntityDefinition } from "../types";
import { sqliteStorage } from "../../../db/sqliteStorage";

export const batchesDefinition: EntityDefinition = {
  id: "batches",
  label: "Batches & Opening Stock",
  singularLabel: "Batch",
  category: "stock",
  description: "Initial physical stock on hand with batch identifiers, manufacturing/expiry dates and cost rates.",
  targetTable: "product_batches",
  primaryKey: "id",
  requiredPermission: "inventory:adjust",
  supportsRoundTrip: true,
  duplicateKeys: [
    { id: "batch_product", label: "Product + Batch No", fields: ["product_barcode", "batch_no"], exactMatch: true },
  ],
  foreignKeys: [
    {
      field: "product_barcode",
      targetEntityId: "items",
      lookupField: "barcode",
      autoCreateSupported: false,
    },
  ],
  rowActionSupport: {
    allowCreateMissingFk: false,
    allowUpdate: true,
    allowMerge: false,
    allowSkip: true,
  },
  fields: {
    product_barcode: {
      key: "product_barcode",
      label: "Product Barcode / SKU",
      type: "string",
      required: true,
      example: "8901030012345",
      description: "Barcode of the existing catalog item",
      aliases: ["barcode", "item_code", "product_code", "sku"],
    },
    batch_no: {
      key: "batch_no",
      label: "Batch Number",
      type: "string",
      required: true,
      example: "BAT-9941",
      description: "Manufacturer lot or batch number",
      aliases: ["batch", "batch_no", "lot_no", "batchnumber"],
    },
    expiry_date: {
      key: "expiry_date",
      label: "Expiry Date (DD-MM-YYYY)",
      type: "date",
      required: true,
      example: "31-12-2027",
      description: "Medicine or product expiry date in Indian DD-MM-YYYY format or YYYY-MM-DD",
      aliases: ["expiry", "expiry_date", "exp_date", "exp"],
    },
    mfg_date: {
      key: "mfg_date",
      label: "Mfg Date (DD-MM-YYYY)",
      type: "date",
      required: false,
      example: "01-01-2025",
      description: "Manufacturing date",
      aliases: ["mfg", "mfg_date"],
    },
    stock_qty: {
      key: "stock_qty",
      label: "Opening Stock Quantity",
      type: "number",
      required: true,
      defaultValue: 0,
      example: 50,
      description: "Physical unit count on shelf",
      aliases: ["qty", "stock_qty", "opening_qty", "quantity", "stock"],
      min: 0,
    },
    purchase_rate: {
      key: "purchase_rate",
      label: "Cost / Purchase Rate (₹)",
      type: "currency",
      required: false,
      example: 22.5,
      description: "Unit purchase price ex-tax",
      aliases: ["rate", "purchase_rate", "cost_price", "ptr"],
      min: 0,
    },
    mrp: {
      key: "mrp",
      label: "Batch MRP (₹)",
      type: "currency",
      required: false,
      example: 35.0,
      description: "Batch specific printed MRP",
      aliases: ["mrp"],
      min: 0,
    },
    selling_rate: {
      key: "selling_rate",
      label: "Batch Selling Rate (₹)",
      type: "currency",
      required: false,
      example: 32.0,
      description: "Store selling price for this specific batch",
      aliases: ["selling_rate", "sale_rate"],
      min: 0,
    },
    rack_location: {
      key: "rack_location",
      label: "Rack Location",
      type: "string",
      required: false,
      example: "R-02",
      description: "Shelf or rack location for this batch",
      aliases: ["rack", "shelf"],
    },
  },
  sampleRows: [
    {
      product_barcode: "8901030012345",
      batch_no: "B-2026A",
      expiry_date: "31-12-2027",
      mfg_date: "01-01-2026",
      stock_qty: 100,
      purchase_rate: 22.5,
      mrp: 35.0,
      selling_rate: 32.0,
      rack_location: "R-02",
    },
    {
      product_barcode: "8901030098765",
      batch_no: "AMX-880",
      expiry_date: "30-06-2028",
      stock_qty: 45,
      purchase_rate: 75.0,
      mrp: 110.0,
      selling_rate: 98.0,
      rack_location: "R-05",
    },
  ],
  postImportHook: async (batches, context) => {
    // 1. Update product current_stock
    // 2. Insert into stock_transactions (audit ledger)
    const now = Date.now();
    for (const b of batches) {
      const product = await sqliteStorage.findByField<any>("products", "barcode", b.product_barcode);
      if (product) {
        // Record stock transaction for audit trail
        const txId = `stk_op_${now}_${Math.random().toString(36).slice(2, 7)}`;
        await sqliteStorage.insertRecord("stock_transactions", txId, {
          id: txId,
          product_id: product.id,
          batch_id: b.id,
          event_type: "opening_stock",
          qty_delta: Number(b.stock_qty || 0),
          unit_cost: Number(b.purchase_rate || product.ptr || 0),
          reference_type: "import_batch",
          reference_id: context.batchId,
          created_at: now,
        });

        // Recalculate parent product total stock
        const allBatches = await sqliteStorage.findAll<any>("product_batches");
        const totalStock = allBatches
          .filter((item) => item.product_id === product.id)
          .reduce((sum, item) => sum + Number(item.stock_qty || 0), 0);
        
        await sqliteStorage.updateRecord("products", product.id, {
          current_stock: totalStock,
        });
      }
    }
  },
  exportQuery: async () => {
    const batches = await sqliteStorage.findAll<any>("product_batches");
    const products = await sqliteStorage.findAll<any>("products");
    const prodMap = new Map(products.map((p) => [p.id, p]));

    return batches.map((b) => {
      const p = prodMap.get(b.product_id);
      return {
        ...b,
        product_barcode: p?.barcode || "",
        product_name: p?.name || "",
      };
    });
  },
};

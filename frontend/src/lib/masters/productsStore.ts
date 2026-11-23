import { sqliteStorage } from "../db/sqliteStorage";
import { syncQueueService } from "../sync/syncQueueService";

export interface ProductBatch {
  id: string;
  product_id: string;
  batch_no: string;
  mfg_date?: string;
  expiry_date: string;
  stock_qty: number;
  mrp?: number;
  purchase_rate?: number;
  landed_cost_rate?: number;
  selling_rate?: number;
  rack_location?: string;
  shelf_location?: string;
  store_id?: string;
}

/**
 * Parses any expiry string (ISO timestamp, YYYY-MM-DD, YYYY-MM, or MM/YY)
 * without time-zone shifting (e.g. 18:30Z UTC which represents midnight IST is preserved as intended day).
 */
export function parseExpiryDateParts(raw: string | null | undefined): { month: string; year: string; fullDateStr: string } | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Case: MM/YY or MM/YYYY (e.g. 10/27, 05/2028)
  const slashMatch = s.match(/^(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, "0");
    const y = slashMatch[2].length === 4 ? slashMatch[2].slice(-2) : slashMatch[2];
    const fullYear = slashMatch[2].length === 4 ? slashMatch[2] : `20${slashMatch[2]}`;
    return { month: m, year: y, fullDateStr: `${fullYear}-${m}-01` };
  }

  // Case: ISO timestamp with T, e.g. 2027-10-09T18:30:00.000000Z
  if (s.includes("T")) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      // Adding 5.5 hours (+05:30 IST) gives the intended calendar date in India
      const istTime = new Date(d.getTime() + 5.5 * 3600 * 1000);
      const m = String(istTime.getUTCMonth() + 1).padStart(2, "0");
      const y = String(istTime.getUTCFullYear()).slice(-2);
      const fullYear = String(istTime.getUTCFullYear());
      const day = String(istTime.getUTCDate()).padStart(2, "0");
      return { month: m, year: y, fullDateStr: `${fullYear}-${m}-${day}` };
    }
  }

  // Case: YYYY-MM-DD or YYYY-MM
  const dashMatch = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (dashMatch) {
    const fullYear = dashMatch[1];
    const y = fullYear.slice(-2);
    const m = dashMatch[2].padStart(2, "0");
    const day = dashMatch[3] ? dashMatch[3].padStart(2, "0") : "01";
    return { month: m, year: y, fullDateStr: `${fullYear}-${m}-${day}` };
  }

  return null;
}

/** Formats an expiry date string as MM/YY for display */
export function formatExpiryDisplay(raw: string | null | undefined): string {
  const parts = parseExpiryDateParts(raw);
  if (!parts) return raw ? String(raw) : "—";
  return `${parts.month}/${parts.year}`;
}

/** Check if batch expiry date is in the past relative to reference date */
export const isBatchExpired = (expiryDate: string, referenceDate: Date = new Date()): boolean => {
  if (!expiryDate) return false;
  const parts = parseExpiryDateParts(expiryDate);
  const todayStr = referenceDate.toISOString().slice(0, 10);
  if (parts) {
    if (parts.fullDateStr.endsWith("-01") && (expiryDate.length === 7 || expiryDate.includes("/"))) {
      return `${parts.fullDateStr.slice(0, 7)}` < todayStr.slice(0, 7);
    }
    return parts.fullDateStr < todayStr;
  }
  return expiryDate < todayStr;
};

/** A batch can be selected in billing if it is not expired (or override allowed), and out-of-stock batches are allowed when allowNegativeStock is true */
export const isBatchSelectable = (
  batch: ProductBatch,
  referenceDate: Date = new Date(),
  allowNegativeStock = true,
  allowExpired = false
): boolean => {
  const isExpired = isBatchExpired(batch.expiry_date, referenceDate);
  if (isExpired && !allowExpired) return false;
  const isOutOfStock = (batch.stock_qty || 0) <= 0;
  if (isOutOfStock && !allowNegativeStock) return false;
  return true;
};

export interface ProductItem {
  id: string;
  name: string;
  print_name?: string;
  barcode?: string | null;
  secondary_barcodes?: string[];
  hsn_sac_code?: string;
  category_id?: string;
  brand_id?: string;
  unit_id?: string;
  mrp: number;
  sel_rate: number;
  ptr?: number;
  pts?: number;
  gst_percent: number;
  units_per_pack: number;
  unit_name?: string;
  sub_unit_name?: string;
  allow_loose_sale?: boolean;
  loose_selling_rate?: number;
  loose_mrp?: number;
  precision?: number;
  generic_name?: string;
  strength?: string;
  rack_location?: string;
  shelf_location?: string;
  reorder_level?: number;
  current_stock?: number;
  schedule_type?: "H" | "H1" | "X" | "G" | "NONE";
  is_active: boolean;
  external_id?: string;
  /** Store this catalog row belongs to (P-STORE-SCOPE: products are per-store). */
  store_id?: string;
  /** Offline-created products wait for the next successful sync push. */
  sync_state?: "pending" | "synced";
}

export class ProductsStore {
  /** Rows with no store_id are legacy pre-scope data on this device; they count as this store's. */
  private isForActiveStore(row: { store_id?: string } | null | undefined): boolean {
    if (!row || !row.store_id) return true;
    return String(row.store_id) === sqliteStorage.getActiveStoreId();
  }

  async upsertProduct(product: ProductItem, enqueueSync = false): Promise<void> {
    const storeId = product.store_id || sqliteStorage.getActiveStoreId();
    const record: ProductItem = {
      ...product,
      store_id: storeId || undefined,
      // Offline-created / locally-edited products wait for the next sync push.
      sync_state: enqueueSync ? "pending" : product.sync_state ?? "synced",
    };
    await sqliteStorage.insertRecord("products", record.id, record as unknown as Record<string, unknown>);
    if (enqueueSync) {
      try {
        await syncQueueService.enqueue("product", record.id, "update", record as unknown as Record<string, unknown>);
      } catch (_) {}
    }
  }

  async deactivateProduct(id: string, enqueueSync = true): Promise<void> {
    const existing = await this.getProductById(id);
    if (!existing) return;
    const deactivated: ProductItem = { ...existing, is_active: false };
    if (enqueueSync) deactivated.sync_state = "pending";
    await sqliteStorage.insertRecord("products", id, deactivated as unknown as Record<string, unknown>);
    if (enqueueSync) {
      try {
        await syncQueueService.enqueue("product", id, "update", deactivated as unknown as Record<string, unknown>);
      } catch (_) {}
    }
  }

  async getProductById(id: string): Promise<ProductItem | null> {
    return await sqliteStorage.findById<ProductItem>("products", id);
  }

  async getAllProducts(autoSeedIfEmpty = true): Promise<ProductItem[]> {
    let prods = await sqliteStorage.findAll<ProductItem>("products");
    prods = (prods || []).filter((p) => this.isForActiveStore(p));
    if (autoSeedIfEmpty && (!prods || prods.length === 0)) {
      await sqliteStorage.ensureCatalogReady();
      prods = ((await sqliteStorage.findAll<ProductItem>("products")) || []).filter((p) => this.isForActiveStore(p));
    }
    return prods;
  }

  async ensureCatalogPopulated(storeId?: string): Promise<{ populated: boolean; count: number; source: string }> {
    return await sqliteStorage.ensureCatalogReady(storeId);
  }

  async findProductByBarcode(barcode: string): Promise<ProductItem | null> {
    const cleanBarcode = String(barcode || "").trim();
    if (!cleanBarcode) return null;

    const all = await this.getAllProducts();

    for (const item of all) {
      if (item.barcode && String(item.barcode).trim() === cleanBarcode) return item;
      if (item.secondary_barcodes && item.secondary_barcodes.some((b) => b && String(b).trim() === cleanBarcode)) {
        return item;
      }
    }
    return null;
  }

  async searchProducts(query: string): Promise<ProductItem[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const all = await this.getAllProducts();

    return all.filter((item) => {
      // Treat as active if true, 1, "1", or undefined/null (default active)
      const isActive =
        item.is_active !== false &&
        (item.is_active as any) !== 0 &&
        (item.is_active as any) !== "0" &&
        (item.is_active as any) !== "false";
      if (!isActive) return false;

      const nameMatch = item.name ? String(item.name).toLowerCase().includes(q) : false;
      const genericMatch = item.generic_name ? String(item.generic_name).toLowerCase().includes(q) : false;
      const barcodeMatch = item.barcode ? String(item.barcode).toLowerCase().includes(q) : false;
      const secondaryBarcodeMatch = item.secondary_barcodes
        ? item.secondary_barcodes.some((b) => b && String(b).toLowerCase().includes(q))
        : false;
      const hsnMatch = item.hsn_sac_code ? String(item.hsn_sac_code).toLowerCase().includes(q) : false;
      return Boolean(nameMatch || genericMatch || barcodeMatch || secondaryBarcodeMatch || hsnMatch);
    });
  }

  async upsertBatch(batch: ProductBatch, enqueueSync = false): Promise<void> {
    const record: ProductBatch = {
      ...batch,
      store_id: batch.store_id || sqliteStorage.getActiveStoreId() || undefined,
    };
    await sqliteStorage.insertRecord("product_batches", record.id, record as unknown as Record<string, unknown>);
    if (enqueueSync) {
      try {
        await syncQueueService.enqueue("product", record.product_id, "update", {
          id: record.product_id,
          batches: [record],
        });
      } catch (_) {}
    }
  }

  async getBatchesForProduct(productId: string, onlyInStock = true): Promise<ProductBatch[]> {
    const all = await sqliteStorage.findAll<ProductBatch>("product_batches");
    const matched = all.filter(
      (b) =>
        this.isForActiveStore(b) &&
        String(b.product_id) === String(productId) &&
        (!onlyInStock || (b.stock_qty || 0) > 0)
    );

    // Sort FEFO (First-Expiry, First-Out)
    return matched.sort((a, b) => (a.expiry_date || "").localeCompare(b.expiry_date || ""));
  }

  async getEarliestExpiringBatch(productId: string): Promise<ProductBatch | null> {
    const batches = await this.getBatchesForProduct(productId, true);
    return batches.length > 0 ? batches[0] : null;
  }
}

export const productsStore = new ProductsStore();

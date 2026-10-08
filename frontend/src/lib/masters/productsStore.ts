import { sqliteStorage } from "../db/sqliteStorage";

export interface ProductBatch {
  id: string;
  product_id: string;
  batch_no: string;
  mfg_date?: string;
  expiry_date: string;
  stock_qty: number;
  mrp?: number;
  purchase_rate?: number;
  selling_rate?: number;
  rack_location?: string;
  shelf_location?: string;
}

/** Check if batch expiry date is in the past relative to reference date */
export const isBatchExpired = (expiryDate: string, referenceDate: Date = new Date()): boolean => {
  if (!expiryDate) return false;
  const todayStr = referenceDate.toISOString().slice(0, 10);
  if (expiryDate.length === 7) {
    return expiryDate < todayStr.slice(0, 7);
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
  barcode: string;
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
  is_active: boolean;
  external_id?: string;
}

export class ProductsStore {
  async upsertProduct(product: ProductItem): Promise<void> {
    await sqliteStorage.insertRecord("products", product.id, product as unknown as Record<string, unknown>);
  }

  async getProductById(id: string): Promise<ProductItem | null> {
    return await sqliteStorage.findById<ProductItem>("products", id);
  }

  async getAllProducts(): Promise<ProductItem[]> {
    return await sqliteStorage.findAll<ProductItem>("products");
  }

  async findProductByBarcode(barcode: string): Promise<ProductItem | null> {
    const cleanBarcode = barcode.trim();
    if (!cleanBarcode) return null;

    const all = await sqliteStorage.findAll<ProductItem>("products");
    for (const item of all) {
      if (item.barcode === cleanBarcode) return item;
      if (item.secondary_barcodes && item.secondary_barcodes.includes(cleanBarcode)) {
        return item;
      }
    }
    return null;
  }

  async searchProducts(query: string): Promise<ProductItem[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const all = await sqliteStorage.findAll<ProductItem>("products");
    return all.filter((item) => {
      if (!item.is_active) return false;
      const nameMatch = item.name.toLowerCase().includes(q);
      const genericMatch = item.generic_name?.toLowerCase().includes(q);
      const barcodeMatch = item.barcode.includes(q);
      const hsnMatch = item.hsn_sac_code?.includes(q);
      return nameMatch || genericMatch || barcodeMatch || hsnMatch;
    });
  }

  async upsertBatch(batch: ProductBatch): Promise<void> {
    await sqliteStorage.insertRecord("product_batches", batch.id, batch as unknown as Record<string, unknown>);
  }

  async getBatchesForProduct(productId: string, onlyInStock = true): Promise<ProductBatch[]> {
    const all = await sqliteStorage.findAll<ProductBatch>("product_batches");
    const matched = all.filter((b) => b.product_id === productId && (!onlyInStock || b.stock_qty > 0));

    // Sort FEFO (First-Expiry, First-Out)
    return matched.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
  }

  async getEarliestExpiringBatch(productId: string): Promise<ProductBatch | null> {
    const batches = await this.getBatchesForProduct(productId, true);
    return batches.length > 0 ? batches[0] : null;
  }
}

export const productsStore = new ProductsStore();

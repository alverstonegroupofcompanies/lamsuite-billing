import { describe, it, expect, beforeEach } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore } from "./productsStore";
import { TEST_SEED_PRODUCTS, TEST_SEED_BATCHES, seed50Products } from "./seedProductsData";

describe("seedProductsData - 50 Test Products", () => {
  beforeEach(async () => {
    await sqliteStorage.initDatabase();
    await sqliteStorage.clearTable("products");
    await sqliteStorage.clearTable("product_batches");
  });

  it("should define exactly 50 distinct test products", () => {
    expect(TEST_SEED_PRODUCTS.length).toBe(50);

    const ids = new Set(TEST_SEED_PRODUCTS.map((p) => p.id));
    expect(ids.size).toBe(50);

    const barcodes = new Set(TEST_SEED_PRODUCTS.map((p) => p.barcode));
    expect(barcodes.size).toBe(50);
  });

  it("should have realistic pharmacy attributes for every product", () => {
    for (const p of TEST_SEED_PRODUCTS) {
      expect(p.name).toBeTruthy();
      expect(p.generic_name).toBeTruthy();
      expect(p.barcode).toMatch(/^\d{13}$/);
      expect(p.hsn_sac_code).toMatch(/^\d{4,8}$/);
      expect(p.mrp).toBeGreaterThan(0);
      expect(p.sel_rate).toBeGreaterThan(0);
      expect(p.sel_rate).toBeLessThanOrEqual(p.mrp);
      expect([0, 5, 12, 18, 28]).toContain(p.gst_percent);
      expect(p.units_per_pack).toBeGreaterThanOrEqual(1);
      expect(p.is_active).toBe(true);
      expect(p.rack_location).toBeTruthy();
      expect(p.shelf_location).toBeTruthy();
    }
  });

  it("should have valid batches referencing valid products", () => {
    const productIds = new Set(TEST_SEED_PRODUCTS.map((p) => p.id));
    const batchIds = new Set<string>();

    for (const b of TEST_SEED_BATCHES) {
      expect(productIds.has(b.product_id)).toBe(true);
      expect(batchIds.has(b.id)).toBe(false);
      batchIds.add(b.id);
      expect(b.batch_no).toBeTruthy();
      expect(b.expiry_date).toMatch(/^\d{4}-\d{2}/);
      expect(b.stock_qty).toBeGreaterThan(0);
      expect(b.selling_rate).toBeGreaterThan(0);
    }

    // Every product should have at least 1 batch
    const productsWithBatches = new Set(TEST_SEED_BATCHES.map((b) => b.product_id));
    expect(productsWithBatches.size).toBe(50);
  });

  it("should successfully seed all 50 products and their batches into storage", async () => {
    const res = await seed50Products();
    expect(res.productsCount).toBe(50);
    expect(res.batchesCount).toBeGreaterThanOrEqual(50);

    const allProds = await sqliteStorage.findAll("products");
    expect(allProds.length).toBe(50);

    const allBatches = await sqliteStorage.findAll("product_batches");
    expect(allBatches.length).toBe(res.batchesCount);

    // Search by generic
    const paracetamolProds = await productsStore.searchProducts("Paracetamol");
    expect(paracetamolProds.length).toBeGreaterThanOrEqual(5);

    // Search by barcode
    const foundBarcode = await productsStore.findProductByBarcode("8901234000001");
    expect(foundBarcode).not.toBeNull();
    expect(foundBarcode?.name).toBe("Dolo 650 Tablet");

    // FEFO batches
    const doloBatches = await productsStore.getBatchesForProduct("prod_seed_01", true);
    expect(doloBatches.length).toBe(2);
    // Earlier expiry should come first
    expect(doloBatches[0].batch_no).toBe("DL2601");
    expect(doloBatches[1].batch_no).toBe("DL2602");
  });
});

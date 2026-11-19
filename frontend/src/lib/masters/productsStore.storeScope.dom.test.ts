import { describe, it, expect, beforeEach } from "vitest";
import { getMockDatabase } from "../db/sqliteStorage";
import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductItem } from "./productsStore";

/**
 * P-STORE-SCOPE (T8): the till's local catalog is scoped to the active store.
 * Deltas tag store_id; offline-created products wait to sync.
 */
describe("productsStore store scoping", () => {
  beforeEach(() => {
    getMockDatabase().reset();
    window.localStorage.setItem("lamsuite_active_store_id", "store_A");
    getMockDatabase().setStore("store_A");
    sqliteStorage.getActiveStoreId();
  });

  const prod = (id: string, overrides: Partial<ProductItem> = {}): ProductItem => ({
    id,
    name: `Product ${id}`,
    barcode: `BC-${id}`,
    mrp: 10,
    sel_rate: 9,
    gst_percent: 12,
    units_per_pack: 1,
    is_active: true,
    ...overrides,
  });

  it("tags locally-created products with the active store and a pending sync state", async () => {
    await productsStore.upsertProduct(prod("p_offline"), true);

    const row = (await sqliteStorage.findById<any>("products", "p_offline"))!;
    expect(row.store_id).toBe("store_A");
    expect(row.sync_state).toBe("pending");

    const visible = await productsStore.getAllProducts(false);
    expect(visible.map((p) => p.id)).toContain("p_offline");
  });

  it("marks delta-ingested products synced and keeps foreign-store rows invisible", async () => {
    await sqliteStorage.insertRecord("products", "p_a", {
      ...prod("p_a"),
      store_id: "store_A",
      sync_state: "synced",
    });
    await sqliteStorage.insertRecord("products", "p_b", {
      ...prod("p_b"),
      store_id: "store_B",
      sync_state: "synced",
    });
    await sqliteStorage.insertRecord("product_batches", "b_a", {
      id: "b_a",
      product_id: "p_a",
      batch_no: "B1",
      expiry_date: "2030-01-01",
      stock_qty: 5,
      store_id: "store_A",
    });
    await sqliteStorage.insertRecord("product_batches", "b_b", {
      id: "b_b",
      product_id: "p_b",
      batch_no: "B2",
      expiry_date: "2030-01-01",
      stock_qty: 5,
      store_id: "store_B",
    });

    const visible = await productsStore.getAllProducts(false);
    expect(visible.map((p) => p.id)).toContain("p_a");
    expect(visible.map((p) => p.id)).not.toContain("p_b");

    const barcodeHit = await productsStore.findProductByBarcode("BC-p_b");
    expect(barcodeHit).toBeNull();

    const batches = await productsStore.getBatchesForProduct("p_a");
    expect(batches.map((b) => b.id)).toEqual(["b_a"]);
  });

  it("adopted legacy rows (no store_id) remain visible and get adopted by the catalog bootstrap", async () => {
    await sqliteStorage.insertRecord("products", "p_legacy", prod("p_legacy"));

    const res = await sqliteStorage.ensureCatalogReady("store_A");
    expect(["already_populated", "deliberately_empty", "no_active_store"]).toContain(res.source);

    const row = (await sqliteStorage.findById<any>("products", "p_legacy"))!;
    expect(row.store_id).toBe("store_A");
    expect((await productsStore.getAllProducts(false)).map((p) => p.id)).toContain("p_legacy");
  });

  it("deactivate keeps the pending flag so the edit syncs", async () => {
    await productsStore.upsertProduct(prod("p_x"), false);
    await productsStore.deactivateProduct("p_x");

    const row = (await sqliteStorage.findById<any>("products", "p_x"))!;
    expect(row.is_active).toBe(false);
    expect(row.sync_state).toBe("pending");
  });
});

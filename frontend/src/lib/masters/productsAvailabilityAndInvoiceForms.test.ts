import { describe, it, expect, beforeEach } from "vitest";
import { productsStore, type ProductItem } from "./productsStore";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { cloudDeltaSyncService } from "../sync/cloudDeltaSyncService";

describe("Products Availability in Masters & All Invoice Forms", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase(false);
  });

  it("keeps a fresh store empty when the backend has no catalog (P-STORE-SCOPE: no fabricated demo products)", async () => {
    const initial = await sqliteStorage.findAll("products");
    expect(initial.length).toBe(0);

    // Offline, empty backend: the store simply has no products yet — the owner
    // imports or copies them. Seeding demo rows into a real store is forbidden.
    const result = await productsStore.ensureCatalogPopulated("1");
    expect(result.populated).toBe(false);
    expect(result.source).toBe("backend_empty");

    const prods = await productsStore.getAllProducts();
    expect(prods.length).toBe(0);
  }, 15000);

  it("handles products with is_active as 1, true, and undefined as active in POS search", async () => {
    const prodTrue: ProductItem = {
      id: "prod_active_bool",
      name: "Paracetamol 500mg Tablet",
      barcode: "890001",
      mrp: 20,
      sel_rate: 18,
      gst_percent: 12,
      units_per_pack: 10,
      is_active: true,
    };

    const prodNum: any = {
      id: "prod_active_num",
      name: "Paracetamol 650mg Tablet",
      barcode: "890002",
      mrp: 30,
      sel_rate: 28,
      gst_percent: 12,
      units_per_pack: 15,
      is_active: 1, // Common from SQLite/Laravel integer boolean representation
    };

    const prodUndefined: any = {
      id: "prod_active_undef",
      name: "Paracetamol Suspension 60ml",
      barcode: "890003",
      mrp: 45,
      sel_rate: 40,
      gst_percent: 12,
      units_per_pack: 1,
      // is_active omitted
    };

    const prodInactive: ProductItem = {
      id: "prod_inactive",
      name: "Paracetamol Discontinued",
      barcode: "890004",
      mrp: 10,
      sel_rate: 8,
      gst_percent: 12,
      units_per_pack: 10,
      is_active: false,
    };

    await productsStore.upsertProduct(prodTrue);
    await productsStore.upsertProduct(prodNum);
    await productsStore.upsertProduct(prodUndefined);
    await productsStore.upsertProduct(prodInactive);

    const results = await productsStore.searchProducts("paracetamol");
    const ids = results.map((r) => r.id);

    expect(ids).toContain("prod_active_bool");
    expect(ids).toContain("prod_active_num");
    expect(ids).toContain("prod_active_undef");
    expect(ids).not.toContain("prod_inactive");
  });

  it("finds products by barcode with numeric or string types", async () => {
    const prod: ProductItem = {
      id: "prod_barcode_test",
      name: "Azithromycin 500mg",
      barcode: "8901234567890",
      mrp: 120,
      sel_rate: 110,
      gst_percent: 12,
      units_per_pack: 5,
      is_active: true,
    };

    await productsStore.upsertProduct(prod);

    // Exact string match
    const foundStr = await productsStore.findProductByBarcode("8901234567890");
    expect(foundStr?.id).toBe("prod_barcode_test");

    // Match with leading/trailing whitespace
    const foundTrim = await productsStore.findProductByBarcode("  8901234567890  ");
    expect(foundTrim?.id).toBe("prod_barcode_test");

    // Number passed as any
    const foundNum = await productsStore.findProductByBarcode(8901234567890 as any);
    expect(foundNum?.id).toBe("prod_barcode_test");
  });

  it("ingests cloud deltas into storage using batch insertion", async () => {
    const mockApiClient = {
      fetchMasterDeltas: async () => ({
        watermark: 1793000000000,
        products: [
          {
            id: 101 as any,
            name: "Cloud Product A",
            barcode: "89099901",
            mrp: 100,
            sel_rate: 90,
            gst_percent: 18,
            units_per_pack: 1,
            is_active: true,
          },
          {
            id: 102 as any,
            name: "Cloud Product B",
            barcode: "89099902",
            mrp: 200,
            sel_rate: 180,
            gst_percent: 12,
            units_per_pack: 10,
            is_active: 1 as any,
          },
        ] as any,
        batches: [
          {
            id: 501 as any,
            product_id: 101 as any,
            batch_no: "BATCH-CP-01",
            expiry_date: "2028-12-31",
            stock_qty: 150,
          },
        ] as any,
        parties: [],
      }),
    };

    const res = await cloudDeltaSyncService.pullMasterDelta(mockApiClient);
    expect(res.success).toBe(true);
    expect(res.appliedProducts).toBe(2);
    expect(res.appliedBatches).toBe(1);

    const prod101 = await productsStore.getProductById("101");
    expect(prod101).toBeDefined();
    expect(prod101?.name).toBe("Cloud Product A");

    const searchResults = await productsStore.searchProducts("cloud product");
    expect(searchResults.length).toBe(2);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import {
  productsStore,
  isBatchExpired,
  isBatchSelectable,
  formatExpiryDisplay,
  parseExpiryDateParts,
  type ProductItem,
  type ProductBatch,
} from "./productsStore";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";

describe("ProductsStore & FEFO Batch Engine (MST-001, POS-001, POS-002)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  it("finds product by primary barcode and secondary box barcodes", async () => {
    const product: ProductItem = {
      id: "prod_amox",
      name: "Amoxicillin 500mg",
      barcode: "8901001",
      secondary_barcodes: ["BOX-8901001", "STRIP-8901001"],
      hsn_sac_code: "3004",
      mrp: 65,
      sel_rate: 55,
      gst_percent: 12,
      units_per_pack: 10,
      generic_name: "Amoxicillin Trihydrate",
      is_active: true,
    };

    await productsStore.upsertProduct(product);

    // Primary barcode lookup
    const byPrimary = await productsStore.findProductByBarcode("8901001");
    expect(byPrimary?.id).toBe("prod_amox");

    // Secondary barcode lookup
    const byBox = await productsStore.findProductByBarcode("BOX-8901001");
    expect(byBox?.id).toBe("prod_amox");

    const byStrip = await productsStore.findProductByBarcode("STRIP-8901001");
    expect(byStrip?.id).toBe("prod_amox");
  });

  it("returns batches sorted strictly by FEFO (First-Expiry, First-Out)", async () => {
    const productId = "prod_dolo";

    const batch1: ProductBatch = {
      id: "batch_2028",
      product_id: productId,
      batch_no: "D28",
      expiry_date: "2028-05-31",
      stock_qty: 50,
    };

    const batch2: ProductBatch = {
      id: "batch_2026",
      product_id: productId,
      batch_no: "D26",
      expiry_date: "2026-11-30", // Earlier expiry
      stock_qty: 20,
    };

    const batchEmpty: ProductBatch = {
      id: "batch_empty",
      product_id: productId,
      batch_no: "D00",
      expiry_date: "2026-08-31",
      stock_qty: 0, // Zero stock
    };

    await productsStore.upsertBatch(batch1);
    await productsStore.upsertBatch(batch2);
    await productsStore.upsertBatch(batchEmpty);

    const availableBatches = await productsStore.getBatchesForProduct(productId, true);
    expect(availableBatches.length).toBe(2);
    expect(availableBatches[0].batch_no).toBe("D26"); // Earliest expiry first
    expect(availableBatches[1].batch_no).toBe("D28");

    const earliest = await productsStore.getEarliestExpiringBatch(productId);
    expect(earliest?.batch_no).toBe("D26");
  });

  it("searches products across name, generic name, barcode, and HSN", async () => {
    await productsStore.upsertProduct({
      id: "prod_1",
      name: "Augmentin 625mg",
      generic_name: "Amoxycillin and Potassium Clavulanate",
      barcode: "8902002",
      hsn_sac_code: "30041010",
      mrp: 200,
      sel_rate: 180,
      gst_percent: 12,
      units_per_pack: 10,
      is_active: true,
    });

    // Search by partial generic name
    const byGeneric = await productsStore.searchProducts("clavulanate");
    expect(byGeneric.length).toBe(1);
    expect(byGeneric[0].name).toBe("Augmentin 625mg");

    // Search by HSN
    const byHsn = await productsStore.searchProducts("30041010");
    expect(byHsn.length).toBe(1);

    // Product with null / undefined barcode does not throw error during search
    await productsStore.upsertProduct({
      id: "prod_no_barcode",
      name: "Product Without Barcode",
      barcode: null as any,
      mrp: 50,
      sel_rate: 45,
      gst_percent: 5,
      units_per_pack: 1,
      is_active: true,
    });

    const searchNullBarcode = await productsStore.searchProducts("Without Barcode");
    expect(searchNullBarcode.length).toBe(1);
    expect(searchNullBarcode[0].id).toBe("prod_no_barcode");

    // Search query for something else should safely filter without TypeError
    const searchNoMatch = await productsStore.searchProducts("NonExistentItem999");
    expect(searchNoMatch.length).toBe(0);

    // findProductByBarcode safely handles null barcode in stored products
    const foundByBarcode = await productsStore.findProductByBarcode("8902002");
    expect(foundByBarcode?.id).toBe("prod_1");
  });

  it("accurately detects expired and selectable batches", () => {
    const refDate = new Date("2026-09-30T12:00:00Z");

    // Past expiry
    expect(isBatchExpired("2026-08-31", refDate)).toBe(true);
    expect(isBatchExpired("2026-08", refDate)).toBe(true);

    // Current month / future
    expect(isBatchExpired("2026-09-30", refDate)).toBe(false);
    expect(isBatchExpired("2026-10", refDate)).toBe(false);
    expect(isBatchExpired("2027-12-31", refDate)).toBe(false);

    // Selectability: allows out of stock by default when allowNegativeStock is true, but requires allowNegativeStock=false to block
    const validBatch: ProductBatch = {
      id: "b1",
      product_id: "p1",
      batch_no: "B1",
      expiry_date: "2027-01-01",
      stock_qty: 15,
    };
    expect(isBatchSelectable(validBatch, refDate)).toBe(true);

    const outOfStockBatch: ProductBatch = {
      ...validBatch,
      id: "b2",
      stock_qty: 0,
    };
    // Default allows out of stock
    expect(isBatchSelectable(outOfStockBatch, refDate, true)).toBe(true);
    // When selling negative stock is disabled
    expect(isBatchSelectable(outOfStockBatch, refDate, false)).toBe(false);

    const expiredBatch: ProductBatch = {
      ...validBatch,
      id: "b3",
      expiry_date: "2025-12-31",
      stock_qty: 25,
    };
    expect(isBatchSelectable(expiredBatch, refDate)).toBe(false);
    expect(isBatchSelectable(expiredBatch, refDate, true, true)).toBe(true);
  });

  it("formats raw ISO expiry timestamps as MM/YY without 1-day UTC conversion shift", () => {
    // 2027-10-09T18:30:00.000000Z is midnight Oct 10 2027 in India (+5:30)
    const rawIsoTimestamp = "2027-10-09T18:30:00.000000Z";
    expect(formatExpiryDisplay(rawIsoTimestamp)).toBe("10/27");

    const parts = parseExpiryDateParts(rawIsoTimestamp);
    expect(parts?.month).toBe("10");
    expect(parts?.year).toBe("27");
    expect(parts?.fullDateStr).toBe("2027-10-10");

    // Other standard formats
    expect(formatExpiryDisplay("2027-12-31")).toBe("12/27");
    expect(formatExpiryDisplay("2028-05")).toBe("05/28");
    expect(formatExpiryDisplay("06/29")).toBe("06/29");
    expect(formatExpiryDisplay(null)).toBe("—");
  });
});

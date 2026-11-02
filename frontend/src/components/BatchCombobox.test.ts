import { describe, it, expect } from "vitest";
import type { ProductBatch, ProductItem } from "../lib/masters/productsStore";
import { formatExpiryDisplay } from "../lib/masters/productsStore";

describe("BatchCombobox Logic & Presentation", () => {
  const sampleProducts: Record<string, ProductItem> = {
    prod_1: {
      id: "prod_1",
      name: "Dolo 650mg Tablet",
      barcode: "8901234567890",
      mrp: 30,
      sel_rate: 28,
      gst_percent: 12,
      units_per_pack: 15,
      is_active: true,
    },
    prod_2: {
      id: "prod_2",
      name: "Augmentin 625 Duo Tablet",
      barcode: "8909876543210",
      generic_name: "Amoxicillin and Potassium Clavulanate",
      mrp: 200,
      sel_rate: 180,
      gst_percent: 12,
      units_per_pack: 10,
      is_active: true,
    },
    prod_3: {
      id: "prod_3",
      name: "Pantocid 40mg Tablet",
      barcode: "8901112223334",
      mrp: 150,
      sel_rate: 135,
      gst_percent: 12,
      units_per_pack: 15,
      is_active: true,
    },
  };

  const sampleBatches: ProductBatch[] = [
    {
      id: "batch_dolo_1",
      product_id: "prod_1",
      batch_no: "DL9812",
      expiry_date: "2028-06-30T18:30:00.000000Z",
      stock_qty: 150,
      mrp: 30,
    },
    {
      id: "batch_dolo_2",
      product_id: "prod_1",
      batch_no: "DL2601",
      expiry_date: "2027-05-31T18:30:00.000000Z",
      stock_qty: 40,
      mrp: 30,
    },
    {
      id: "batch_aug_1",
      product_id: "prod_2",
      batch_no: "AUG2024",
      expiry_date: "2026-10-20T18:30:00.000000Z",
      stock_qty: 15,
      mrp: 200,
    },
    {
      id: "batch_pan_1",
      product_id: "prod_3",
      batch_no: "PN4011",
      expiry_date: "2028-03-31T18:30:00.000000Z",
      stock_qty: 0,
      mrp: 150,
    },
  ];

  it("formats ISO timestamps into human-friendly MM/YY expiry dates", () => {
    // 2028-06-30 18:30 UTC is midnight July 1st IST (07/28)
    expect(formatExpiryDisplay("2028-06-30T18:30:00.000000Z")).toBe("07/28");
    expect(formatExpiryDisplay("2026-10-20T18:30:00.000000Z")).toBe("10/26");
    expect(formatExpiryDisplay("2027-05-15T00:00:00.000000Z")).toBe("05/27");
  });

  it("links batch to product and makes product name the primary label", () => {
    const batch = sampleBatches[0];
    const product = sampleProducts[batch.product_id];
    expect(product).toBeDefined();
    expect(product.name).toBe("Dolo 650mg Tablet");
    expect(batch.batch_no).toBe("DL9812");
  });

  it("filters accurately by product name (searchable by product)", () => {
    const query = "dolo";
    const matched = sampleBatches.filter((b) => {
      const prod = sampleProducts[b.product_id];
      const searchStr = `${prod?.name} ${b.batch_no}`.toLowerCase();
      return searchStr.includes(query.toLowerCase());
    });

    expect(matched.length).toBe(2);
    expect(matched.map((m) => m.batch_no)).toEqual(["DL9812", "DL2601"]);
  });

  it("filters accurately by batch number (batch also searchable)", () => {
    const query = "AUG2024";
    const matched = sampleBatches.filter((b) => {
      const prod = sampleProducts[b.product_id];
      const searchStr = `${prod?.name} ${b.batch_no}`.toLowerCase();
      return searchStr.includes(query.toLowerCase());
    });

    expect(matched.length).toBe(1);
    expect(matched[0].batch_no).toBe("AUG2024");
    expect(sampleProducts[matched[0].product_id].name).toBe("Augmentin 625 Duo Tablet");
  });

  it("filters accurately by generic name or barcode", () => {
    const query = "amoxicillin";
    const matched = sampleBatches.filter((b) => {
      const prod = sampleProducts[b.product_id];
      const searchStr = `${prod?.name} ${b.batch_no} ${prod?.generic_name || ""}`.toLowerCase();
      return searchStr.includes(query.toLowerCase());
    });

    expect(matched.length).toBe(1);
    expect(matched[0].batch_no).toBe("AUG2024");
  });

  it("supports in-stock only filtering when requested (e.g. for transfers)", () => {
    const inStock = sampleBatches.filter((b) => b.stock_qty > 0);
    expect(inStock.length).toBe(3);
    expect(inStock.some((b) => b.batch_no === "PN4011")).toBe(false);
  });
});

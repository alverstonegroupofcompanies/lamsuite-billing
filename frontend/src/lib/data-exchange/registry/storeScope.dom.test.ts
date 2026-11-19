import { describe, it, expect, beforeEach } from "vitest";
import { getMockDatabase, sqliteStorage } from "../../db/sqliteStorage";
import { itemsDefinition } from "./definitions/items";
import { customersDefinition, suppliersDefinition } from "./definitions/parties";
import { groupsDefinition, unitsDefinition } from "./definitions/categorisation";
import { batchesDefinition } from "./definitions/batches";

/**
 * P-STORE-SCOPE (T10): the local import/export engine is store-scoped.
 * Imported rows are tagged with the active store; exports and duplicate
 * detection see only this store's catalog. Units stay shared by design
 * (the user's carve-out: "except common master items like units").
 */
describe("data-exchange registry store scoping", () => {
  beforeEach(() => {
    getMockDatabase().reset();
    window.localStorage.setItem("lamsuite_active_store_id", "store_A");
    getMockDatabase().setStore("store_A");
  });

  it("tags imported product rows with the active store", () => {
    const row = itemsDefinition.transformRow({ barcode: "IMP-100", name: "Imported", mrp: 12 });
    expect((row as any).store_id).toBe("store_A");
  });

  it("items export/duplicate-detection scope hides other stores' products but keeps legacy rows", async () => {
    await sqliteStorage.insertRecord("products", "p_a", {
      id: "p_a", name: "Store A Product", barcode: "IMP-A", mrp: 10, sel_rate: 9, gst_percent: 12, store_id: "store_A",
    });
    await sqliteStorage.insertRecord("products", "p_b", {
      id: "p_b", name: "Store B Product", barcode: "IMP-B", mrp: 10, sel_rate: 9, gst_percent: 12, store_id: "store_B",
    });
    await sqliteStorage.insertRecord("products", "p_legacy", {
      id: "p_legacy", name: "Legacy Product", barcode: "IMP-LEGACY", mrp: 10, sel_rate: 9, gst_percent: 12,
    });

    const barcodes = (await itemsDefinition.exportQuery()).map((r: any) => r.barcode);
    expect(barcodes).toContain("IMP-A");
    expect(barcodes).toContain("IMP-LEGACY");
    expect(barcodes).not.toContain("IMP-B");
  });

  it("party definitions are store-tagged and filtered", async () => {
    const row = customersDefinition.transformRow({ name: "Rahul", phone: "9847012345" });
    expect((row as any).store_id).toBe("store_A");

    await sqliteStorage.insertRecord("customers", "c_a", {
      id: "c_a", name: "A Customer", phone: "9847000001", store_id: "store_A",
    });
    await sqliteStorage.insertRecord("customers", "c_b", {
      id: "c_b", name: "B Customer", phone: "9847000002", store_id: "store_B",
    });

    const names = (await customersDefinition.exportQuery()).map((r: any) => r.name);
    expect(names).toContain("A Customer");
    expect(names).not.toContain("B Customer");

    const supp = suppliersDefinition.transformRow({ name: "Apex" });
    expect((supp as any).store_id).toBe("store_A");
  });

  it("groups and units are per-store (units carve-out reversed)", async () => {
    const groupRow = groupsDefinition.transformRow({ name: "Analgesics" });
    expect((groupRow as any).store_id).toBe("store_A");

    const unitRow = unitsDefinition.transformRow({ name: "STRIP", symbol: "STP" });
    expect((unitRow as any).store_id).toBe("store_A");

    await sqliteStorage.insertRecord("master_lookups", "g_a", {
      id: "g_a", type: "category", name: "A Group", store_id: "store_A",
    });
    await sqliteStorage.insertRecord("master_lookups", "g_b", {
      id: "g_b", type: "category", name: "B Group", store_id: "store_B",
    });
    await sqliteStorage.insertRecord("master_lookups", "u_a", {
      id: "u_a", type: "unit", name: "A Unit", symbol: "AU", store_id: "store_A",
    });
    await sqliteStorage.insertRecord("master_lookups", "u_b", {
      id: "u_b", type: "unit", name: "B Unit", symbol: "BU", store_id: "store_B",
    });

    const groupNames = (await groupsDefinition.exportQuery()).map((r: any) => r.name);
    expect(groupNames).toContain("A Group");
    expect(groupNames).not.toContain("B Group");

    const unitNames = (await unitsDefinition.exportQuery()).map((r: any) => r.name);
    expect(unitNames).toContain("A Unit");
    expect(unitNames).not.toContain("B Unit");
  });

  it("batch export follows the parent product's store", async () => {
    await sqliteStorage.insertRecord("products", "p_a", {
      id: "p_a", name: "A Product", barcode: "BC-A", mrp: 10, sel_rate: 9, gst_percent: 12, store_id: "store_A",
    });
    await sqliteStorage.insertRecord("products", "p_b", {
      id: "p_b", name: "B Product", barcode: "BC-B", mrp: 10, sel_rate: 9, gst_percent: 12, store_id: "store_B",
    });
    await sqliteStorage.insertRecord("product_batches", "bat_a", {
      id: "bat_a", product_id: "p_a", batch_no: "B1", expiry_date: "2030-01-01", stock_qty: 5,
    });
    await sqliteStorage.insertRecord("product_batches", "bat_b", {
      id: "bat_b", product_id: "p_b", batch_no: "B2", expiry_date: "2030-01-01", stock_qty: 5,
    });

    const batchNos = (await batchesDefinition.exportQuery()).map((r: any) => r.batch_no);
    expect(batchNos).toContain("B1");
    expect(batchNos).not.toContain("B2");
  });
});

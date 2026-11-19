import { describe, it, expect, beforeEach } from "vitest";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { unitsStore, DEFAULT_UNITS, type UnitMaster } from "./unitsStore";

/**
 * P-STORE-SCOPE carve-out reversed: units are store-scoped. Defaults are
 * seeded at billing app start, the set can be reset, and an assigned unit
 * cannot be deleted until its products are reassigned.
 */
describe("unitsStore store scoping, reset and delete guard", () => {
  beforeEach(() => {
    getMockDatabase().reset();
    window.localStorage.setItem("lamsuite_active_store_id", "store_A");
    getMockDatabase().setStore("store_A");
    sqliteStorage.getActiveStoreId();
  });

  const insertUnit = async (id: string, name: string, storeId?: string, extra: Record<string, unknown> = {}) => {
    await sqliteStorage.insertRecord("master_lookups", id, {
      id,
      type: "unit",
      name,
      symbol: name.slice(0, 3).toUpperCase(),
      precision: 0,
      is_active: 1,
      store_id: storeId,
      ...extra,
    });
  };

  const insertProduct = async (id: string, name: string, fields: Record<string, unknown>) => {
    await sqliteStorage.insertRecord("products", id, {
      id,
      name,
      barcode: `BC-${id}`,
      mrp: 10,
      sel_rate: 9,
      gst_percent: 12,
      units_per_pack: 1,
      is_active: true,
      ...fields,
    });
  };

  it("seeds default units at app start and tags them with the active store", async () => {
    const seeded = await unitsStore.seedDefaultsIfEmpty();

    expect(seeded.map((u) => u.name).sort()).toEqual(DEFAULT_UNITS.map((u) => u.name).sort());
    expect(seeded.every((u) => u.store_id === "store_A")).toBe(true);

    const row = await sqliteStorage.findById<any>("master_lookups", seeded[0].id);
    expect(row.store_id).toBe("store_A");
  });

  it("seeding is idempotent and auto-seeds on first read", async () => {
    const first = await unitsStore.getAllUnits(true);
    expect(first.length).toBe(DEFAULT_UNITS.length);

    const again = await unitsStore.seedDefaultsIfEmpty();
    expect(again.length).toBe(DEFAULT_UNITS.length);

    const all = (await sqliteStorage.findAll<any>("master_lookups")).filter((r: any) => r.type === "unit");
    expect(all.length).toBe(DEFAULT_UNITS.length);
  });

  it("hides foreign-store units and adopts legacy rows with no store_id", async () => {
    await insertUnit("u_foreign", "Vial", "store_B");
    await insertUnit("u_legacy", "Sachet"); // legacy: no store_id

    const visible = await unitsStore.getAllUnits(false);
    const names = visible.map((u) => u.name);

    expect(names).not.toContain("Vial");
    expect(names).toContain("Sachet");
  });

  it("resets: restores missing defaults, removes unused custom units, keeps assigned ones", async () => {
    await unitsStore.seedDefaultsIfEmpty();

    // Remove a default and add custom units — one referenced by a product.
    await sqliteStorage.deleteRecord("master_lookups", (await unitsStore.getAllUnits(false)).find((u) => u.name === "Strip")!.id);
    await unitsStore.upsertUnit({ name: "Dropper", symbol: "DRP" });
    const vial = await unitsStore.upsertUnit({ name: "Vial", symbol: "VIL" });
    await insertProduct("p1", "Inj Alpha", { unit_name: "Vial" });

    const summary = await unitsStore.resetToDefaults();

    expect(summary.seeded).toContain("Strip");
    expect(summary.removed).toContain("Dropper");
    expect(summary.kept).toContain("Vial");

    const names = (await unitsStore.getAllUnits(false)).map((u) => u.name);
    expect(names).toContain("Strip");
    expect(names).not.toContain("Dropper");
    expect(names).toContain("Vial");
    expect(vial).toBeTruthy();
  });

  it("finds product references by id, unit name and sub-unit name", async () => {
    await insertUnit("u_vial", "Vial", "store_A");
    await insertUnit("u_dropper", "Dropper", "store_A");
    await insertProduct("p_by_id", "Prod A", { unit_id: "u_vial" });
    await insertProduct("p_by_name", "Prod B", { unit_id: "Vial" });
    await insertProduct("p_by_unit_name", "Prod C", { unit_name: "VIAL" });
    await insertProduct("p_by_sub", "Prod D", { sub_unit_name: "vial" });
    await insertProduct("p_other", "Prod E", { unit_name: "Dropper" });

    const refs = await unitsStore.getUnitReferences("u_vial");
    expect(refs.sort()).toEqual(["Prod A", "Prod B", "Prod C", "Prod D"]);
    expect(await unitsStore.getUnitReferences("u_dropper")).toEqual(["Prod E"]);
  });

  it("reassigns referencing products to the replacement and deletes the source unit", async () => {
    await unitsStore.seedDefaultsIfEmpty();
    const vial = await unitsStore.upsertUnit({ name: "Vial", symbol: "VIL" });
    const box = (await unitsStore.getAllUnits(false)).find((u) => u.name === "Box")!;
    await insertProduct("p1", "Inj Alpha", { unit_id: "Vial" });
    await insertProduct("p2", "Inj Beta", { unit_name: "Vial", sub_unit_name: "Vial" });

    const moved = await unitsStore.reassignUnit(vial.id, box.id);

    expect(moved).toBe(2);
    expect(await unitsStore.getUnitById(vial.id)).toBeNull();

    const p1 = await sqliteStorage.findById<any>("products", "p1");
    const p2 = await sqliteStorage.findById<any>("products", "p2");
    expect(p1.unit_id).toBe("Box");
    expect(p2.unit_name).toBe("Box");
    expect(p2.sub_unit_name).toBe("Box");
  });

  it("rejects reassignment to the same unit or an unknown unit", async () => {
    const vial = await unitsStore.upsertUnit({ name: "Vial", symbol: "VIL" });

    await expect(unitsStore.reassignUnit(vial.id, vial.id)).rejects.toThrow(/different/i);
    await expect(unitsStore.reassignUnit(vial.id, "unt_missing")).rejects.toThrow(/not found/i);
  });

  it("keeps default symbol and precision when creating a missing default via reset", async () => {
    const summary = await unitsStore.resetToDefaults();
    expect(summary.seeded.length).toBe(DEFAULT_UNITS.length);

    const kg = (await unitsStore.getAllUnits(false)).find((u) => u.name === "Kilogram") as UnitMaster;
    expect(kg.symbol).toBe("KGS");
    expect(kg.precision).toBe(3);
  });
});

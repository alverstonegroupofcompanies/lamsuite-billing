import { describe, it, expect, beforeEach } from "vitest";
import { unitsStore, DEFAULT_UNITS } from "./unitsStore";
import { sqliteStorage } from "../db/sqliteStorage";

describe("UnitsStore", () => {
  beforeEach(async () => {
    // Clear master_lookups table in mock storage
    const records = await sqliteStorage.findAll<any>("master_lookups");
    for (const r of records) {
      if (r.type === "unit") {
        await sqliteStorage.deleteRecord("master_lookups", r.id);
      }
    }
  });

  it("seeds default units when table is empty", async () => {
    const units = await unitsStore.getAllUnits(true);
    expect(units.length).toBe(DEFAULT_UNITS.length);
    expect(units.some((u) => u.name === "Strip")).toBe(true);
    expect(units.some((u) => u.name === "Tablet")).toBe(true);
  });

  it("retrieves a unit by ID", async () => {
    const created = await unitsStore.upsertUnit({
      name: "Blister",
      symbol: "BLS",
      precision: 0,
      is_active: true,
    });

    const found = await unitsStore.getUnitById(created.id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe("Blister");
    expect(found?.symbol).toBe("BLS");
  });

  it("finds a unit by name or symbol case-insensitively", async () => {
    await unitsStore.upsertUnit({
      name: "Ampoule",
      symbol: "AMP",
      precision: 0,
      is_active: true,
    });

    const byName = await unitsStore.findUnitByNameOrSymbol("ampoule");
    expect(byName).not.toBeNull();
    expect(byName?.name).toBe("Ampoule");

    const bySymbol = await unitsStore.findUnitByNameOrSymbol("AMP");
    expect(bySymbol).not.toBeNull();
    expect(bySymbol?.name).toBe("Ampoule");
  });

  it("ensureUnitExists returns existing unit without duplicates", async () => {
    await unitsStore.upsertUnit({
      name: "Vial",
      symbol: "VIAL",
      precision: 0,
      is_active: true,
    });

    const countBefore = (await unitsStore.getAllUnits(false)).length;
    const unit = await unitsStore.ensureUnitExists("vial");

    expect(unit.name).toBe("Vial");
    const countAfter = (await unitsStore.getAllUnits(false)).length;
    expect(countAfter).toBe(countBefore);
  });

  it("ensureUnitExists creates the unit in master if not present", async () => {
    const foundBefore = await unitsStore.findUnitByNameOrSymbol("Sachet");
    expect(foundBefore).toBeNull();

    const created = await unitsStore.ensureUnitExists("Sachet", "SCH", 0);
    expect(created.name).toBe("Sachet");
    expect(created.symbol).toBe("SCH");
    expect(created.is_active).toBe(true);

    const foundAfter = await unitsStore.findUnitByNameOrSymbol("Sachet");
    expect(foundAfter).not.toBeNull();
    expect(foundAfter?.id).toBe(created.id);
  });

  it("updates and deletes units in master", async () => {
    const created = await unitsStore.upsertUnit({
      name: "Temporary Unit",
      symbol: "TEMP",
      precision: 1,
      is_active: true,
    });

    // Update
    await unitsStore.upsertUnit({
      ...created,
      name: "Updated Temp Unit",
      precision: 2,
    });

    const updated = await unitsStore.getUnitById(created.id);
    expect(updated?.name).toBe("Updated Temp Unit");
    expect(updated?.precision).toBe(2);

    // Delete
    const deleted = await unitsStore.deleteUnit(created.id);
    expect(deleted).toBe(true);

    const check = await unitsStore.getUnitById(created.id);
    expect(check).toBeNull();
  });
});

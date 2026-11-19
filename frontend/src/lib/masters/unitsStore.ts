import { sqliteStorage } from "../db/sqliteStorage";
import { syncQueueService } from "../sync/syncQueueService";

export interface UnitMaster {
  id: string;
  type: "unit";
  name: string;
  symbol: string;
  precision?: number;
  is_active: boolean;
  /** P-STORE-SCOPE: units belong to one store. Rows without it are legacy data on this device. */
  store_id?: string;
}

export const DEFAULT_UNITS: Omit<UnitMaster, "id" | "type">[] = [
  { name: "Strip", symbol: "STP", precision: 0, is_active: true },
  { name: "Tablet", symbol: "TAB", precision: 0, is_active: true },
  { name: "Tabs", symbol: "TAB", precision: 0, is_active: true },
  { name: "Capsule", symbol: "CAP", precision: 0, is_active: true },
  { name: "Bottle", symbol: "BTL", precision: 0, is_active: true },
  { name: "Box", symbol: "BOX", precision: 0, is_active: true },
  { name: "Pack", symbol: "PAC", precision: 0, is_active: true },
  { name: "Piece", symbol: "PCS", precision: 0, is_active: true },
  { name: "Pcs", symbol: "PCS", precision: 0, is_active: true },
  { name: "Kilogram", symbol: "KGS", precision: 3, is_active: true },
  { name: "Gram", symbol: "GMS", precision: 3, is_active: true },
  { name: "Litre", symbol: "LTR", precision: 2, is_active: true },
  { name: "Millilitre", symbol: "ML", precision: 2, is_active: true },
  { name: "Carton", symbol: "CTN", precision: 0, is_active: true },
  { name: "Jar", symbol: "JAR", precision: 0, is_active: true },
  { name: "Case", symbol: "CAS", precision: 0, is_active: true },
  { name: "Set", symbol: "SET", precision: 0, is_active: true },
];

export class UnitsStore {
  private activeStoreId(): string {
    return sqliteStorage.getActiveStoreId() || "";
  }

  /** Rows with no store_id are legacy pre-scope data on this device; they count as this store's. */
  private isForActiveStore(row: { store_id?: string } | null | undefined): boolean {
    if (!row || !row.store_id) return true;
    return String(row.store_id) === this.activeStoreId();
  }

  /**
   * Seed the default unit set for the active store when it has no unit rows.
   * Called on billing app start so the default units are always available.
   */
  async seedDefaultsIfEmpty(): Promise<UnitMaster[]> {
    const existing = await this.getAllUnits(false);
    if (existing.length > 0) return existing;

    const seeded: UnitMaster[] = [];
    const storeId = this.activeStoreId();
    for (const def of DEFAULT_UNITS) {
      const unit: UnitMaster = {
        id: `unt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "unit",
        name: def.name,
        symbol: def.symbol,
        precision: def.precision ?? 0,
        is_active: def.is_active,
        store_id: storeId || undefined,
      };
      await sqliteStorage.insertRecord("master_lookups", unit.id, {
        id: unit.id,
        type: "unit",
        name: unit.name,
        symbol: unit.symbol,
        precision: unit.precision,
        is_active: unit.is_active ? 1 : 0,
        store_id: unit.store_id,
      });
      seeded.push(unit);
    }
    return seeded;
  }

  /**
   * Restore the default unit set for the active store: missing defaults are
   * re-seeded, unused custom units removed, custom units still assigned to
   * products kept (an assigned unit can never be silently dropped).
   */
  async resetToDefaults(): Promise<{ seeded: string[]; removed: string[]; kept: string[] }> {
    const before = await this.getAllUnits(false);
    const defaultNames = new Set(DEFAULT_UNITS.map((d) => d.name.toLowerCase()));
    const existingNames = new Set(before.map((u) => u.name.toLowerCase()));

    const seeded: string[] = [];
    for (const def of DEFAULT_UNITS) {
      if (existingNames.has(def.name.toLowerCase())) continue;
      await this.upsertUnit({
        name: def.name,
        symbol: def.symbol,
        precision: def.precision ?? 0,
        is_active: def.is_active,
      });
      seeded.push(def.name);
    }

    const removed: string[] = [];
    const kept: string[] = [];
    for (const unit of await this.getAllUnits(false)) {
      if (defaultNames.has(unit.name.toLowerCase())) continue;
      const references = await this.getUnitReferences(unit.id);
      if (references.length > 0) {
        kept.push(unit.name);
        continue;
      }
      await this.deleteUnit(unit.id);
      removed.push(unit.name);
    }

    return { seeded, removed, kept };
  }

  /**
   * Get all units belonging to the active store
   */
  async getAllUnits(autoSeed = true): Promise<UnitMaster[]> {
    try {
      const records = await sqliteStorage.findAll<any>("master_lookups");
      const units = records
        .filter((r) => r && r.type === "unit" && this.isForActiveStore(r))
        .map((r) => ({
          id: String(r.id),
          type: "unit" as const,
          name: String(r.name || "").trim(),
          symbol: String(r.symbol || r.code || r.name || "").trim().toUpperCase(),
          precision: Number(r.precision ?? 0),
          is_active: r.is_active === 1 || r.is_active === true,
          store_id: r.store_id ? String(r.store_id) : undefined,
        }));

      if (units.length === 0 && autoSeed) {
        return await this.seedDefaultsIfEmpty();
      }

      return units;
    } catch (err) {
      console.error("Failed to fetch units from master_lookups:", err);
      return [];
    }
  }

  /**
   * Get unit by ID
   */
  async getUnitById(id: string): Promise<UnitMaster | null> {
    const units = await this.getAllUnits(false);
    return units.find((u) => u.id === id) || null;
  }

  /**
   * Find unit by name or symbol (case-insensitive)
   */
  async findUnitByNameOrSymbol(query: string): Promise<UnitMaster | null> {
    if (!query || !query.trim()) return null;
    const clean = query.trim().toLowerCase();
    const units = await this.getAllUnits(true);
    return (
      units.find(
        (u) =>
          u.name.toLowerCase() === clean ||
          u.symbol.toLowerCase() === clean
      ) || null
    );
  }

  /**
   * Products on this till that reference the unit — by its id, by the unit name
   * in unit_id/unit_name, or as the sub-unit. Deleting an assigned unit requires
   * reassigning these products to a replacement unit first.
   */
  async getUnitReferences(unitId: string): Promise<string[]> {
    const unit = await this.getUnitById(unitId);
    if (!unit) return [];
    const target = unit.name.toLowerCase();
    const products = await sqliteStorage.findAll<any>("products");
    return products
      .filter((p) =>
        p.unit_id === unit.id ||
        String(p.unit_id || "").trim().toLowerCase() === target ||
        String(p.unit_name || "").trim().toLowerCase() === target ||
        String(p.sub_unit_name || "").trim().toLowerCase() === target
      )
      .map((p) => String(p.name || p.id));
  }

  /**
   * Move every product referencing `fromUnitId` onto the replacement unit and
   * delete the source unit — the reassign-then-delete path for assigned units.
   */
  async reassignUnit(fromUnitId: string, toUnitId: string): Promise<number> {
    const from = await this.getUnitById(fromUnitId);
    const to = await this.getUnitById(toUnitId);
    if (!from || !to) throw new Error("Unit not found");
    if (fromUnitId === toUnitId) throw new Error("Choose a different replacement unit");

    const target = from.name.toLowerCase();
    const products = await sqliteStorage.findAll<any>("products");
    let count = 0;
    for (const p of products) {
      const byId = p.unit_id === from.id;
      const byName = String(p.unit_id || "").trim().toLowerCase() === target;
      const byUnitName = String(p.unit_name || "").trim().toLowerCase() === target;
      const bySubUnit = String(p.sub_unit_name || "").trim().toLowerCase() === target;
      if (!byId && !byName && !byUnitName && !bySubUnit) continue;

      const updated: Record<string, unknown> = { ...p };
      if (byId || byName) updated.unit_id = to.name;
      if (byUnitName) updated.unit_name = to.name;
      if (bySubUnit) updated.sub_unit_name = to.name;
      await sqliteStorage.insertRecord("products", p.id, updated);
      count++;
    }

    await this.deleteUnit(fromUnitId);
    return count;
  }

  /**
   * Ensure a unit exists in master; creates it if not found.
   */
  async ensureUnitExists(
    name: string,
    defaultSymbol?: string,
    precision = 0
  ): Promise<UnitMaster> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Unit name cannot be empty");
    }

    const existing = await this.findUnitByNameOrSymbol(trimmedName);
    if (existing) {
      return existing;
    }

    // Generate symbol from name if not provided (e.g. "Strip" -> "STP", "Bottle" -> "BTL", or first 3-4 chars)
    const symbol = (
      defaultSymbol ||
      trimmedName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4)
    ).toUpperCase();

    const newUnit: UnitMaster = {
      id: `unt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: "unit",
      name: trimmedName,
      symbol: symbol || "UNT",
      precision: Math.max(0, precision),
      is_active: true,
    };

    await this.upsertUnit(newUnit);
    return newUnit;
  }

  /**
   * Insert or update a unit in master_lookups
   */
  async upsertUnit(unit: Partial<UnitMaster> & { name: string }): Promise<UnitMaster> {
    const name = unit.name.trim();
    if (!name) throw new Error("Unit name is required");

    const id = unit.id || `unt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const symbol = (unit.symbol || name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4)).toUpperCase();
    const precision = Math.max(0, Number(unit.precision ?? 0));
    const is_active = unit.is_active !== false;
    const store_id = unit.store_id || this.activeStoreId() || undefined;

    const fullUnit: UnitMaster = {
      id,
      type: "unit",
      name,
      symbol,
      precision,
      is_active,
      store_id,
    };

    await sqliteStorage.insertRecord("master_lookups", id, {
      id,
      type: "unit",
      name,
      symbol,
      precision,
      is_active: is_active ? 1 : 0,
      store_id,
    });

    try {
      await syncQueueService.enqueue("unit", id, "update", {
        id,
        type: "unit",
        name,
        symbol,
        precision,
        is_active,
        store_id,
      } as unknown as Record<string, unknown>);
    } catch {
      // offline/background
    }

    return fullUnit;
  }

  /**
   * Delete a unit by ID from master_lookups
   */
  async deleteUnit(id: string): Promise<boolean> {
    const deleted = await sqliteStorage.deleteRecord("master_lookups", id);
    if (deleted) {
      try {
        await syncQueueService.enqueue("unit", id, "delete", { id, type: "unit" });
      } catch {
        // offline/background
      }
    }
    return deleted;
  }
}

export const unitsStore = new UnitsStore();

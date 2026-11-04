import { sqliteStorage } from "../db/sqliteStorage";
import { syncQueueService } from "../sync/syncQueueService";

export interface UnitMaster {
  id: string;
  type: "unit";
  name: string;
  symbol: string;
  precision?: number;
  is_active: boolean;
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
  /**
   * Seed standard units if master_lookups has no unit records
   */
  async seedDefaultsIfEmpty(): Promise<UnitMaster[]> {
    const existing = await this.getAllUnits(false);
    if (existing.length > 0) return existing;

    const seeded: UnitMaster[] = [];
    for (const def of DEFAULT_UNITS) {
      const unit: UnitMaster = {
        id: `unt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "unit",
        name: def.name,
        symbol: def.symbol,
        precision: def.precision ?? 0,
        is_active: def.is_active,
      };
      await sqliteStorage.insertRecord("master_lookups", unit.id, {
        id: unit.id,
        type: "unit",
        name: unit.name,
        symbol: unit.symbol,
        precision: unit.precision,
        is_active: unit.is_active ? 1 : 0,
      });
      seeded.push(unit);
    }
    return seeded;
  }

  /**
   * Get all units from master_lookups
   */
  async getAllUnits(autoSeed = true): Promise<UnitMaster[]> {
    try {
      const records = await sqliteStorage.findAll<any>("master_lookups");
      const units = records
        .filter((r) => r && r.type === "unit")
        .map((r) => ({
          id: String(r.id),
          type: "unit" as const,
          name: String(r.name || "").trim(),
          symbol: String(r.symbol || r.code || r.name || "").trim().toUpperCase(),
          precision: Number(r.precision ?? 0),
          is_active: r.is_active === 1 || r.is_active === true,
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

    const fullUnit: UnitMaster = {
      id,
      type: "unit",
      name,
      symbol,
      precision,
      is_active,
    };

    await sqliteStorage.insertRecord("master_lookups", id, {
      id,
      type: "unit",
      name,
      symbol,
      precision,
      is_active: is_active ? 1 : 0,
    });

    try {
      await syncQueueService.enqueue("unit", id, "update", {
        id,
        type: "unit",
        name,
        symbol,
        precision,
        is_active,
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

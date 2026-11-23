import { sqliteStorage } from "../db/sqliteStorage";
import { syncQueueService } from "../sync/syncQueueService";
import type {
  ChargeItcEligibility,
  ChargeSpreadMethod,
  ChargeTreatment,
} from "../tax-engine/taxEngine";

export type ChargeHeadAllowedSign = "positive" | "negative" | "both";

export interface ChargeHeadMaster {
  id: string;
  type: "charge_head";
  name: string;
  code: string;
  sac_code?: string;
  default_treatment: ChargeTreatment;
  default_spread_method: ChargeSpreadMethod;
  default_itc_eligibility: ChargeItcEligibility;
  allowed_sign: ChargeHeadAllowedSign;
  is_active: boolean;
  /** R12: charge heads belong to one store. Rows without it are legacy data on this device. */
  store_id?: string;
  /** True when the row came from the default set, so reset may drop it. */
  seeded: boolean;
}

export const DEFAULT_CHARGE_HEADS: Omit<
  ChargeHeadMaster,
  "id" | "type" | "store_id"
>[] = [
  {
    name: "Freight",
    code: "FREIGHT",
    sac_code: "996731",
    default_treatment: "add_to_cost",
    default_spread_method: "value",
    default_itc_eligibility: "eligible",
    allowed_sign: "positive",
    is_active: true,
    seeded: true,
  },
  {
    name: "Packing",
    code: "PACKING",
    default_treatment: "add_to_cost",
    default_spread_method: "value",
    default_itc_eligibility: "eligible",
    allowed_sign: "positive",
    is_active: true,
    seeded: true,
  },
  {
    name: "Loading/Unloading",
    code: "LOADING",
    default_treatment: "add_to_cost",
    default_spread_method: "quantity",
    default_itc_eligibility: "eligible",
    allowed_sign: "positive",
    is_active: true,
    seeded: true,
  },
  {
    name: "Insurance",
    code: "INSURANCE",
    default_treatment: "add_to_cost",
    default_spread_method: "value",
    default_itc_eligibility: "eligible",
    allowed_sign: "positive",
    is_active: true,
    seeded: true,
  },
  {
    name: "Other",
    code: "OTHER",
    default_treatment: "expense",
    default_spread_method: "value",
    default_itc_eligibility: "eligible",
    allowed_sign: "both",
    is_active: true,
    seeded: true,
  },
];

/** A head already used by a posted bill — the bill is named so the operator can reassign. */
export interface ChargeHeadReference {
  purchase_id: string;
  invoice_number: string;
  amount: number;
}

const TREATMENTS: ChargeTreatment[] = ["add_to_cost", "expense"];
const SPREAD_METHODS: ChargeSpreadMethod[] = ["value", "quantity", "weight"];
const ITC_VALUES: ChargeItcEligibility[] = [
  "eligible",
  "ineligible",
  "blocked",
  "partial",
];
const SIGNS: ChargeHeadAllowedSign[] = ["positive", "negative", "both"];

export class ChargeHeadsStore {
  private activeStoreId(): string {
    return sqliteStorage.getActiveStoreId() || "";
  }

  /** Rows with no store_id are legacy pre-scope data on this device; they count as this store's. */
  private isForActiveStore(row: { store_id?: string } | null | undefined): boolean {
    if (!row || !row.store_id) return true;
    return String(row.store_id) === this.activeStoreId();
  }

  private toMaster(row: any): ChargeHeadMaster {
    // A row pushed down from the server carries its presets nested under config.
    const cfg = row.config && typeof row.config === "object" ? row.config : {};
    const code = String(
      row.code || row.symbol || row.name || ""
    )
      .trim()
      .toUpperCase();

    return {
      id: String(row.id),
      type: "charge_head",
      name: String(row.name || "").trim(),
      code,
      sac_code: (row.sac_code ?? cfg.sac_code) ? String(row.sac_code ?? cfg.sac_code) : undefined,
      default_treatment: this.oneOf(
        row.default_treatment ?? cfg.default_treatment,
        TREATMENTS,
        "add_to_cost"
      ),
      default_spread_method: this.oneOf(
        row.default_spread_method ?? cfg.default_spread_method,
        SPREAD_METHODS,
        "value"
      ),
      default_itc_eligibility: this.oneOf(
        row.default_itc_eligibility ?? cfg.default_itc_eligibility,
        ITC_VALUES,
        "eligible"
      ),
      allowed_sign: this.oneOf(row.allowed_sign ?? cfg.allowed_sign, SIGNS, "positive"),
      is_active: row.is_active === 1 || row.is_active === true,
      store_id: row.store_id ? String(row.store_id) : undefined,
      seeded: (row.seeded ?? cfg.seeded) === true || (row.seeded ?? cfg.seeded) === 1,
    };
  }

  private oneOf<T extends string>(
    value: unknown,
    allowed: T[],
    fallback: T
  ): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
  }

  /**
   * A head prefills the POS grid, so an invalid preset is refused rather than
   * silently stored with a different meaning — the same rule the admin API applies.
   */
  private pick<T extends string>(
    value: T | undefined,
    fallbackValue: T | undefined,
    allowed: T[],
    def: T
  ): T {
    if (value === undefined || value === null || value === "") {
      return fallbackValue ?? def;
    }
    if (!allowed.includes(value)) {
      throw new Error(`Charge head preset must be one of: ${allowed.join(", ")}.`);
    }
    return value;
  }

  /**
   * Seed the default head set for the active store when it has no head rows.
   * Called on purchase-entry app start so the POS charges grid always has heads.
   */
  async seedDefaultsIfEmpty(): Promise<ChargeHeadMaster[]> {
    const existing = await this.getAllHeads(false);
    if (existing.length > 0) return existing;

    const seeded: ChargeHeadMaster[] = [];
    for (const def of DEFAULT_CHARGE_HEADS) {
      seeded.push(await this.upsertHead({ ...def, id: undefined, store_id: this.activeStoreId() || undefined }));
    }
    return seeded;
  }

  /**
   * Restore the default head set for the active store: missing defaults are
   * re-seeded, unused custom heads removed, custom heads still referenced by a
   * posted bill kept (a referenced head can never be silently dropped).
   */
  async resetToDefaults(): Promise<{ seeded: string[]; removed: string[]; kept: string[] }> {
    const before = await this.getAllHeads(false);
    const defaultNames = new Set(DEFAULT_CHARGE_HEADS.map((d) => d.name.toLowerCase()));
    const existingNames = new Set(before.map((h) => h.name.toLowerCase()));

    const seeded: string[] = [];
    for (const def of DEFAULT_CHARGE_HEADS) {
      if (existingNames.has(def.name.toLowerCase())) continue;
      await this.upsertHead({ ...def, id: undefined, store_id: this.activeStoreId() || undefined });
      seeded.push(def.name);
    }

    const removed: string[] = [];
    const kept: string[] = [];
    for (const head of await this.getAllHeads(false)) {
      if (defaultNames.has(head.name.toLowerCase())) continue;
      if ((await this.getHeadReferences(head.id)).length > 0) {
        kept.push(head.name);
        continue;
      }
      await this.deleteHead(head.id);
      removed.push(head.name);
    }

    return { seeded, removed, kept };
  }

  /** Charge heads belonging to the active store. */
  async getAllHeads(autoSeed = true): Promise<ChargeHeadMaster[]> {
    try {
      const records = await sqliteStorage.findAll<any>("master_lookups");
      const heads = records
        .filter((r) => r && r.type === "charge_head" && this.isForActiveStore(r))
        .map((r) => this.toMaster(r));

      if (heads.length === 0 && autoSeed) {
        return await this.seedDefaultsIfEmpty();
      }

      return heads;
    } catch (err) {
      console.error("Failed to fetch charge heads from master_lookups:", err);
      return [];
    }
  }

  async getHeadById(id: string): Promise<ChargeHeadMaster | null> {
    const heads = await this.getAllHeads(false);
    return heads.find((h) => h.id === id) || null;
  }

  /** Head by name or code, case-insensitive — how the POS grid resolves a typed head. */
  async findHeadByNameOrCode(query: string): Promise<ChargeHeadMaster | null> {
    if (!query || !query.trim()) return null;
    const clean = query.trim().toLowerCase();
    const heads = await this.getAllHeads(true);
    return (
      heads.find(
        (h) => h.name.toLowerCase() === clean || h.code.toLowerCase() === clean
      ) || null
    );
  }

  /**
   * Bills on this till whose charge lines still reference the head, by code or by
   * name. Deleting a referenced head requires reassigning those lines first (R12).
   */
  async getHeadReferences(headId: string): Promise<ChargeHeadReference[]> {
    const head = await this.getHeadById(headId);
    if (!head) return [];

    const name = head.name.toLowerCase();
    const rows = await sqliteStorage.findAll<any>("purchase_charges");
    const byBill = new Map<string, ChargeHeadReference>();
    for (const row of rows) {
      if (!row || !this.isForActiveStore(row)) continue;
      const code = String(row.head_code || "").trim().toUpperCase();
      const rowName = String(row.head_name || "").trim().toLowerCase();
      if (code !== head.code && rowName !== name) continue;

      const purchaseId = String(row.purchase_id || "");
      const total = Number(row.total_amount ?? row.amount ?? 0);
      const existing = byBill.get(purchaseId);
      if (existing) {
        existing.amount = Math.round((existing.amount + total) * 100) / 100;
        continue;
      }
      byBill.set(purchaseId, {
        purchase_id: purchaseId,
        invoice_number: String(row.invoice_number || "") || (await this.invoiceNumberFor(purchaseId)),
        amount: Math.round(total * 100) / 100,
      });
    }
    return [...byBill.values()];
  }

  private async invoiceNumberFor(purchaseId: string): Promise<string> {
    if (!purchaseId) return "";
    const doc = await sqliteStorage.findById<any>("purchase_documents", purchaseId);
    return String(doc?.invoice_number || doc?.bill_number || purchaseId);
  }

  /**
   * Move every charge line referencing `fromHeadId` onto the replacement head and
   * delete the source head. Only the head identity moves — posted amounts never change.
   */
  async reassignHead(fromHeadId: string, toHeadId: string): Promise<number> {
    const from = await this.getHeadById(fromHeadId);
    const to = await this.getHeadById(toHeadId);
    if (!from || !to) throw new Error("Charge head not found");
    if (fromHeadId === toHeadId) {
      throw new Error("The replacement charge head must be different from the head being deleted.");
    }

    const name = from.name.toLowerCase();
    const rows = await sqliteStorage.findAll<any>("purchase_charges");
    let count = 0;
    for (const row of rows) {
      if (!row || !this.isForActiveStore(row)) continue;
      const code = String(row.head_code || "").trim().toUpperCase();
      const rowName = String(row.head_name || "").trim().toLowerCase();
      if (code !== from.code && rowName !== name) continue;

      await sqliteStorage.insertRecord("purchase_charges", String(row.id), {
        ...row,
        head_code: to.code,
        head_name: to.name,
      });
      count++;
    }

    await this.deleteHead(fromHeadId);
    return count;
  }

  async upsertHead(
    head: Partial<ChargeHeadMaster> & { name: string }
  ): Promise<ChargeHeadMaster> {
    const name = head.name.trim();
    if (!name) throw new Error("Charge head name is required");

    const id =
      head.id || `chg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const code = String(head.code || name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4))
      .trim()
      .toUpperCase();

    // Never auto-seed here: seeding itself writes through this method.
    const rows = await this.getAllHeads(false);
    const existing = head.id
      ? rows.find((h) => h.id === head.id) || null
      : rows.find((h) => h.name.toLowerCase() === name.toLowerCase()) || null;

    const fullHead: ChargeHeadMaster = {
      id: existing?.id ?? id,
      type: "charge_head",
      name,
      code,
      sac_code: this.normalizeSac(head.sac_code ?? existing?.sac_code),
      default_treatment: this.pick(head.default_treatment, existing?.default_treatment, TREATMENTS, "add_to_cost"),
      default_spread_method: this.pick(head.default_spread_method, existing?.default_spread_method, SPREAD_METHODS, "value"),
      default_itc_eligibility: this.pick(
        head.default_itc_eligibility,
        existing?.default_itc_eligibility,
        ITC_VALUES,
        "eligible"
      ),
      allowed_sign: this.pick(head.allowed_sign, existing?.allowed_sign, SIGNS, "positive"),
      is_active: head.is_active !== false,
      store_id: head.store_id || existing?.store_id || this.activeStoreId() || undefined,
      // A customised default head stays resettable, so the seeded flag survives an edit.
      seeded: head.seeded ?? existing?.seeded ?? false,
    };

    const row = {
      ...fullHead,
      is_active: fullHead.is_active ? 1 : 0,
      // The server keeps presets under config; the till row stays flat for the grid.
      config: {
        sac_code: fullHead.sac_code ?? null,
        default_treatment: fullHead.default_treatment,
        default_spread_method: fullHead.default_spread_method,
        default_itc_eligibility: fullHead.default_itc_eligibility,
        allowed_sign: fullHead.allowed_sign,
        seeded: fullHead.seeded,
      },
    };

    await sqliteStorage.insertRecord(
      "master_lookups",
      fullHead.id,
      row as unknown as Record<string, unknown>
    );

    try {
      await syncQueueService.enqueue(
        "charge_head",
        fullHead.id,
        "update",
        row as unknown as Record<string, unknown>
      );
    } catch {
      // offline/background
    }

    return fullHead;
  }

  private normalizeSac(value?: string | null): string | undefined {
    const sac = String(value ?? "").trim();
    if (sac === "") return undefined;
    if (!/^\d{6}(\d{2})?$/.test(sac)) {
      throw new Error("Charge head SAC must be a 6 or 8 digit code.");
    }
    return sac;
  }

  async deleteHead(id: string): Promise<boolean> {
    const deleted = await sqliteStorage.deleteRecord("master_lookups", id);
    if (deleted) {
      try {
        await syncQueueService.enqueue("charge_head", id, "delete", {
          id,
          type: "charge_head",
        });
      } catch {
        // offline/background
      }
    }
    return deleted;
  }
}

export const chargeHeadsStore = new ChargeHeadsStore();

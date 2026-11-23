import { sqliteStorage } from "../db/sqliteStorage";
import { getResolvedApiBaseUrl } from "../../config/env";
import { counterSessionService } from "../auth/counterSessionService";

/**
 * GAP-01 / SPR-010 — the people this counter may put on a bill.
 *
 * The list is small, changes rarely and is needed the moment a cashier types,
 * so it is cached on the device and searched offline: a till with no network
 * still names its salespeople, and the server re-checks the choice when the
 * bill is ingested.
 */
export interface SalespersonMaster {
  id: string;
  store_id?: string;
  name: string;
  code?: string | null;
  phone?: string | null;
  counter_ids?: (string | number)[] | null;
  has_pin?: boolean;
  is_active?: boolean;
  archived_at?: number | string | null;
  cache_synced_at?: number;
  updated_at?: number;
  is_pharmacist?: boolean;
  reg_no?: string | null;
  registration_valid?: boolean | null;
  registration_refusal?: string | null;
}

const TABLE = "salespeople";

/** SQLite hands back 0 and 1 where the master wrote false and true. */
function flag(value: unknown, whenMissing = true): boolean {
  if (value === undefined || value === null) return whenMissing;
  if (typeof value === "string") return value !== "" && value !== "0";
  return Boolean(value);
}

export class SalespersonStore {
  private populating: Promise<{ count: number; source: string }> | null = null;

  async getAll(): Promise<SalespersonMaster[]> {
    const rows = await sqliteStorage.findAll<SalespersonMaster>(TABLE);
    return Array.isArray(rows) ? rows : [];
  }

  /** A person with no counter list may be carried by every counter of the store. */
  mayBeSelectedAt(salesperson: SalespersonMaster, counterId: string | null): boolean {
    const allowed = Array.isArray(salesperson.counter_ids) ? salesperson.counter_ids.map(String) : [];
    if (allowed.length === 0) return true;
    if (counterId === null) return true;
    return allowed.includes(String(counterId));
  }

  async selectableForCounter(counterId: string | null): Promise<SalespersonMaster[]> {
    const rows = await this.getAll();
    return rows
      .filter((row) => row.is_active !== false && !row.archived_at)
      .filter((row) => this.mayBeSelectedAt(row, counterId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Type-ahead over the cache: name, then code, then phone — exact before
   * prefix before substring, the order a cashier typing "rin" or "SP-01" expects.
   */
  async search(term: string, limit = 20): Promise<SalespersonMaster[]> {
    const clean = term.trim().toLowerCase();
    const pool = await this.selectableForCounter(counterSessionService.state().counterId);
    if (pool.length === 0) return [];
    if (!clean) return pool.slice(0, limit);

    const digits = clean.replace(/\D/g, "");
    const scored: { row: SalespersonMaster; score: number }[] = [];

    for (const row of pool) {
      const name = (row.name || "").toLowerCase();
      const code = (row.code || "").toLowerCase();
      const phone = (row.phone || "").replace(/\D/g, "");

      let score = 0;
      if (name === clean) score += 100;
      else if (name.startsWith(clean)) score += 60;
      else if (name.includes(clean)) score += 20;

      if (code === clean) score += 80;
      else if (code.startsWith(clean)) score += 40;

      if (digits.length >= 2 && phone) {
        if (phone === digits) score += 100;
        else if (phone.startsWith(digits)) score += 50;
      }

      if (score > 0) scored.push({ row, score });
    }

    return scored
      .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
      .slice(0, limit)
      .map((entry) => entry.row);
  }

  /**
   * Pull this counter's people from the server, then drop the ones the server
   * no longer lists, so an archived or reassigned person cannot be typed into
   * a new bill from a stale device cache.
   */
  async ensureSalespeoplePopulated(force = false): Promise<{ count: number; source: string }> {
    const existing = await this.getAll();
    if (!force && existing.length > 0) {
      return { count: existing.length, source: "sqlite_cache" };
    }

    if (this.populating && !force) return this.populating;

    this.populating = (async (): Promise<{ count: number; source: string }> => {
      const storeId =
        typeof window !== "undefined" && window.localStorage
          ? window.localStorage.getItem("lamsuite_active_store_id") || ""
          : "";

      try {
        const baseUrl = getResolvedApiBaseUrl();
        const res = await fetch(`${baseUrl}/api/salespeople/eligible`, {
          headers: {
            Accept: "application/json",
            ...(storeId ? { "X-Store-Id": storeId, "Store-Id": storeId } : {}),
          },
        });

        if (res.ok) {
          const payload = await res.json();
          const incoming = Array.isArray(payload.salespeople) ? payload.salespeople : [];
          await this.replaceCache(incoming, storeId);
          return { count: incoming.length, source: "salespeople_eligible" };
        }
      } catch {
        // Offline is the normal state of a till; the cache answers.
      }

      return { count: (await this.getAll()).length, source: "sqlite_cache" };
    })();

    try {
      return await this.populating;
    } finally {
      this.populating = null;
    }
  }

  /**
   * PHR-004 — who may vouch for a restricted drug. A registration belongs to
   * the store, not to a counter, so the counter list that limits who a till may
   * bill as says nothing here; and a row the server never judged
   * (registration_valid missing) is left to the server to refuse.
   */
  async pharmacists(storeId?: string): Promise<SalespersonMaster[]> {
    const rows = await this.getAll();
    return rows
      .filter((row) => flag(row.is_pharmacist, false))
      .filter((row) => flag(row.is_active))
      .filter((row) => !row.archived_at)
      .filter((row) => row.registration_valid !== false)
      .filter((row) => (storeId ? String(row.store_id ?? storeId) === String(storeId) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A sync delta carries the same rows; ingest them without a second call. */
  async ingest(rows: unknown[], storeId: string): Promise<number> {
    const incoming = (rows || []).map((row) => this.normalize(row as Record<string, unknown>, storeId));
    await this.replaceCache(incoming, storeId);
    return incoming.length;
  }

  private normalize(row: Record<string, unknown>, storeId: string): SalespersonMaster {
    return {
      id: String(row.id),
      store_id: String(row.store_id ?? storeId),
      name: String(row.name ?? ""),
      code: (row.code ?? null) as string | null,
      phone: (row.phone ?? null) as string | null,
      counter_ids: (Array.isArray(row.counter_ids) ? row.counter_ids : null) as (string | number)[] | null,
      has_pin: Boolean(row.has_pin),
      is_active: row.is_active === undefined ? true : Boolean(row.is_active),
      archived_at: (row.archived_at ?? null) as string | null,
      is_pharmacist: Boolean(row.is_pharmacist),
      reg_no: (row.reg_no ?? null) as string | null,
      registration_valid:
        row.registration_valid === undefined ? null : Boolean(row.registration_valid),
      registration_refusal: (row.registration_refusal ?? null) as string | null,
      cache_synced_at: Date.now(),
      updated_at: row.updated_at ? Number(new Date(String(row.updated_at)).getTime()) : Date.now(),
    };
  }

  private async replaceCache(rows: unknown[], storeId: string): Promise<void> {
    const incoming = rows.map((row) => this.normalize(row as Record<string, unknown>, storeId));
    const incomingIds = new Set(incoming.map((row) => row.id));
    const current = await this.getAll();

    for (const row of incoming) {
      await sqliteStorage.insertRecord(TABLE, row.id, row);
    }

    // Only this store's rows are purged: a device that has seen two stores must
    // not lose the other one's history it still has to print.
    for (const row of current) {
      if (storeId && String(row.store_id ?? storeId) !== String(storeId)) continue;
      if (incomingIds.has(row.id)) continue;
      await sqliteStorage.deleteRecord(TABLE, row.id).catch(() => {});
    }
  }

}

export const salespersonStore = new SalespersonStore();

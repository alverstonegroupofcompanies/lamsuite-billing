import { API_BASE_URL } from "../../config/env";
import { sqliteStorage } from "../db/sqliteStorage";
import { storeDeviceService } from "./storeDeviceService";
import { handleDeviceAuthFailure, isDeviceAuthFailure } from "./deviceAuthFailure";

/**
 * B8b / PRF-001 — the permission document the till works inside.
 *
 * There is no signed-in person at the POS: the counter's own document says what
 * this machine may show and do. It arrives with the claim and is re-handed by
 * every `/api/counter/context` read, is cached in the till's own store keyed by
 * the counter it belongs to, and is read back only as the controls the server
 * documents. The till keeps no copy of the owner's defaults, so a document that
 * names no modules leaves the store's own ceiling in place rather than guessing
 * what the owner meant — and a document that names some shuts the rest.
 */

export const COUNTER_PROFILE_TABLE = "counter_profile";

/** The controls CounterProfile documents; anything else is not carried. */
export const PROFILE_CONTROLS = [
  "modules",
  "screens",
  "cash_drawer",
  "discount",
  "price_override",
  "sell_beyond_stock",
  "edits",
  "cancellations",
  "returns",
  "purchase_entry",
  "stock_adjustments",
  "transfers",
  "reports",
  "settings_editable",
  "printers",
  "payment_modes_allowed",
  "salesperson",
  "approval_methods",
];

export type CounterProfileControls = Record<string, unknown>;

export interface CounterSessionState {
  counterId: string | null;
  storeId: string | null;
  counterCode: string;
  counterName: string;
  version: number;
  document: CounterProfileControls | null;
}

export interface CounterContextPayload {
  counter?: { id?: number | string | null; counter_code?: string | null; counter_name?: string | null } | null;
  store?: { id?: number | string | null } | null;
  profile?: { permissions?: CounterProfileControls | null; version?: number | string | null } | null;
}

interface ProfileRow {
  counter_id: string;
  store_id: string | null;
  version: number;
  profile_json: string;
  updated_at: number;
}

function emptyState(): CounterSessionState {
  return { counterId: null, storeId: null, counterCode: "", counterName: "", version: 0, document: null };
}

function versionOf(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function idOf(value: unknown): string | null {
  if (value === null || value === undefined || String(value) === "") return null;
  return String(value);
}

/** Only documented controls survive, so an answer cannot park a secret here. */
function documented(permissions: CounterProfileControls): CounterProfileControls {
  const kept: CounterProfileControls = {};
  for (const key of PROFILE_CONTROLS) {
    if (Object.prototype.hasOwnProperty.call(permissions, key)) kept[key] = permissions[key];
  }
  return kept;
}

function readRow(row: ProfileRow): CounterProfileControls | null {
  try {
    const parsed = JSON.parse(row.profile_json);
    return parsed && typeof parsed === "object" ? documented(parsed as CounterProfileControls) : null;
  } catch (_) {
    return null;
  }
}

function list(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : null;
}

export class CounterSessionService {
  private current = emptyState();
  private listeners: Array<(state: CounterSessionState) => void> = [];
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private checkingWatermark = false;

  state(): CounterSessionState {
    return { ...this.current };
  }

  subscribe(listener: (state: CounterSessionState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  hasDocument(): boolean {
    return this.current.document !== null;
  }

  /**
   * A module the owner left out of the document stays out. A till that holds no
   * document asks nothing of its own and defers to the store's `enabled_menu_items`
   * ceiling — granting is the server's, never the till's.
   */
  allowsModule(menuId: string): boolean {
    const modules = list(this.current.document?.modules);
    if (modules === null) return true;
    return modules.includes(menuId);
  }

  allowsReport(reportId: string): boolean {
    const reports = list(this.current.document?.reports);
    if (reports === null) return true;
    return reports.includes("*") || reports.includes(reportId);
  }

  /** Forgets the document without touching what is stored — a restart, not a revocation. */
  unload(): void {
    this.current = emptyState();
    this.notify();
  }

  /**
   * Reads the cached document back before any network call, so a till that
   * rebooted offline is still inside the surface its owner set. A counter with
   * no cached document has no surface to inherit: the ceiling applies until the
   * server answers.
   */
  async hydrate(counterId?: number | string | null): Promise<CounterSessionState> {
    const wanted = idOf(counterId ?? this.current.counterId);
    const rows = await sqliteStorage.findAll<ProfileRow>(COUNTER_PROFILE_TABLE);
    const row = rows.find((r) => (wanted === null ? true : String(r.counter_id) === wanted));

    if (row) {
      const same = String(row.counter_id) === String(this.current.counterId ?? "");
      this.current = {
        counterId: String(row.counter_id),
        storeId: row.store_id,
        counterCode: same ? this.current.counterCode : "",
        counterName: same ? this.current.counterName : "",
        version: row.version,
        document: readRow(row),
      };
      this.notify();
    } else if (wanted !== null) {
      this.current = emptyState();
      this.notify();
    }

    return this.state();
  }

  /**
   * Takes the document half of a claim or a context answer. An answer that
   * carries no document changes nothing for the counter already in hand — a
   * till never invents a surface the server did not name.
   */
  async applyContext(context: CounterContextPayload | null | undefined): Promise<CounterSessionState | null> {
    const counterId = idOf(context?.counter?.id);
    if (counterId === null) return null;

    const storeId = idOf(context?.store?.id);
    const counterCode = String(context?.counter?.counter_code ?? "");
    const counterName = String(context?.counter?.counter_name ?? "");
    const permissions = context?.profile?.permissions;

    if (!permissions || typeof permissions !== "object") {
      // A peer counter takes nothing from the counter this till was working for.
      if (this.current.counterId !== counterId) {
        this.current = { ...emptyState(), counterId, storeId, counterCode, counterName };
        this.notify();
      }
      return null;
    }

    const controls = documented(permissions);
    const version = versionOf(context?.profile?.version);

    const row: ProfileRow = {
      counter_id: counterId,
      store_id: storeId,
      version,
      profile_json: JSON.stringify(controls),
      updated_at: Date.now(),
    };
    await sqliteStorage.insertRecord(COUNTER_PROFILE_TABLE, counterId, row);

    this.current = {
      counterId,
      storeId,
      counterCode: counterCode || this.current.counterCode,
      counterName: counterName || this.current.counterName,
      version,
      document: controls,
    };
    this.notify();

    return this.state();
  }

  /**
   * The store server's answer for this counter. An unreachable server leaves
   * the last document in force: a till does not widen a surface because the
   * cloud is down, and does not narrow one either.
   */
  async refresh(): Promise<CounterSessionState | null> {
    const headers = { Accept: "application/json", ...(await storeDeviceService.getDeviceAuthHeaders()) };

    try {
      const res = await fetch(`${API_BASE_URL}/api/counter/context`, { method: "GET", headers });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (isDeviceAuthFailure(res.status, body)) await handleDeviceAuthFailure();
        return null;
      }
      return await this.applyContext((await res.json()) as CounterContextPayload);
    } catch (_) {
      return null;
    }
  }

  /**
   * PRF-004: the counter's watermark. The answer is a number, never the
   * document, so a till can find out whether it still holds what the owner set
   * without the profile crossing the wire on every poll. Null means the server
   * said nothing — an outage is not a change.
   */
  async fetchWatermark(): Promise<number | null> {
    const headers = { Accept: "application/json", ...(await storeDeviceService.getDeviceAuthHeaders()) };

    try {
      const res = await fetch(`${API_BASE_URL}/api/counter/profile-version`, { method: "GET", headers });
      if (!res.ok) {
        const failure = await res.json().catch(() => null);
        if (isDeviceAuthFailure(res.status, failure)) await handleDeviceAuthFailure();
        return null;
      }
      const body = await res.json();
      const version = versionOf(body?.permission_profile_version);
      return version > 0 ? version : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Come onto the version something else already read — a heartbeat answer, a
   * broadcast. Holding the same number the server is serving is the whole
   * check: a till that agrees does no work, and one that does not pulls the
   * document from its own context rather than trusting what arrived with the
   * notice.
   */
  async alignToVersion(version: unknown): Promise<CounterSessionState | null> {
    const seen = versionOf(version);
    if (seen === 0) return null;
    if (seen === this.current.version && this.current.document !== null) return this.state();
    return this.refresh();
  }

  /**
   * PRF-004's promise for an attached counter: within about five seconds of a
   * save, the till is working inside the new surface. Stream and heartbeat are
   * head starts; this poll is the guarantee. It is deliberately one timer for
   * the whole app, started once the till is running and stopped with it, and it
   * asks nothing of the server while the network is down.
   */
  startWatermarkWatch(intervalMs = 5000): void {
    const tick = async () => {
      if (this.checkingWatermark) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      this.checkingWatermark = true;
      try {
        const seen = await this.fetchWatermark();
        if (seen !== null && seen !== this.current.version) await this.refresh();
      } finally {
        this.checkingWatermark = false;
      }
    };

    if (this.watchTimer !== null) clearInterval(this.watchTimer);
    this.watchTimer = setInterval(() => {
      void tick();
    }, Math.max(1000, intervalMs));
    void tick();
  }

  stopWatermarkWatch(): void {
    if (this.watchTimer !== null) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  /** Wiped with the claim it belonged to (IS9). */
  async clear(counterId?: number | string | null): Promise<void> {
    const key = idOf(counterId ?? null);

    if (key === null) {
      await sqliteStorage.clearTable(COUNTER_PROFILE_TABLE);
      this.current = emptyState();
    } else {
      await sqliteStorage.deleteRecord(COUNTER_PROFILE_TABLE, key);
      if (String(this.current.counterId ?? "") === key) this.current = emptyState();
    }

    this.notify();
  }

  private notify(): void {
    const snapshot = this.state();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export const counterSessionService = new CounterSessionService();

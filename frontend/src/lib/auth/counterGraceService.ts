import { sqliteStorage } from "../db/sqliteStorage";

/**
 * CNT-011 — the offline grace clock.
 *
 * A counter keeps working for the window its owner set, measured from the last
 * time the store server heard from it. The server cannot reach a machine that
 * has gone dark, so every clean handshake hands the till an absolute deadline;
 * the till turns that into hours counted on its own clock and stops taking
 * documents when they run out. Running out is not a revocation: the credential
 * survives, and the next connection renews the window.
 */

export interface CounterGraceWindow {
  grace_hours?: number | null;
  last_seen_at?: string | null;
  grace_until?: string | null;
}

/** Whatever shape the answer came in: a claim, a context read or a handshake. */
export interface GraceArm {
  server_time?: string | null;
  offline?: CounterGraceWindow | null;
}

export type GraceReason = "unmeasured" | "within_grace" | "grace_expired";

export interface GraceState {
  allowed: boolean;
  reason: GraceReason;
  remaining_ms: number;
  grace_hours: number | null;
  deadline_ms: number | null;
}

interface CounterGraceRow {
  counter_key: string;
  grace_hours: number;
  grace_until: string;
  deadline_local_ms: number;
  armed_at: number;
  updated_at: number;
}

const TABLE = "counter_grace";

export const GRACE_EXPIRED_MESSAGE =
  "This counter has been offline longer than the store allows. Connect to the store server to keep billing.";

function toMs(value: unknown): number {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

export class CounterGraceService {
  private mirror = new Map<string, CounterGraceRow>();
  private activeKey: string | null = null;

  /** The counter this till is working for; its window is the one billing reads. */
  use(counterKey: string | number | null | undefined): void {
    const key = counterKey === null || counterKey === undefined ? "" : String(counterKey);
    this.activeKey = key === "" ? null : key;
  }

  activeCounterKey(): string | null {
    return this.activeKey;
  }

  /** Forgets the clock without touching what is stored — a restart, not a revocation. */
  unload(): void {
    this.mirror.clear();
    this.activeKey = null;
  }

  /** Reads the stored windows back in, so a till that rebooted offline is still counted down. */
  async hydrate(counterKey?: string | number | null): Promise<void> {
    const rows = await sqliteStorage.findAll<CounterGraceRow>(TABLE);
    this.mirror.clear();

    for (const row of rows) {
      if (row?.counter_key) this.mirror.set(String(row.counter_key), row);
    }

    if (counterKey !== undefined && counterKey !== null && String(counterKey) !== "") {
      this.use(counterKey);
    }
  }

  /**
   * Arms the window an answer granted. An answer that carries no deadline
   * changes nothing: a till never invents grace the store server did not give.
   */
  async arm(counterKey: string | number, answer: GraceArm | null | undefined): Promise<GraceState | null> {
    const deadline = toMs(answer?.offline?.grace_until);
    if (!Number.isFinite(deadline)) return null;

    const key = String(counterKey);
    const serverNow = toMs(answer?.server_time);
    const skewMs = Number.isFinite(serverNow) ? serverNow - Date.now() : 0;
    const now = Date.now();
    const row: CounterGraceRow = {
      counter_key: key,
      grace_hours: Number(answer?.offline?.grace_hours) || 0,
      grace_until: String(answer?.offline?.grace_until),
      // The deadline is the server's, but it is counted on this machine. A
      // workstation whose clock disagrees with the store's gets the hours the
      // owner granted — no more.
      deadline_local_ms: deadline - skewMs,
      armed_at: now,
      updated_at: now,
    };

    this.mirror.set(key, row);
    await sqliteStorage.insertRecord(TABLE, key, row);

    return this.state(key);
  }

  state(counterKey?: string | number | null): GraceState {
    const key = counterKey === undefined || counterKey === null ? this.activeKey : String(counterKey);
    const row = key === null ? undefined : this.mirror.get(key);

    if (!row) {
      return { allowed: true, reason: "unmeasured", remaining_ms: 0, grace_hours: null, deadline_ms: null };
    }

    const remaining = row.deadline_local_ms - Date.now();

    if (remaining <= 0) {
      return {
        allowed: false,
        reason: "grace_expired",
        remaining_ms: 0,
        grace_hours: row.grace_hours,
        deadline_ms: row.deadline_local_ms,
      };
    }

    return {
      allowed: true,
      reason: "within_grace",
      remaining_ms: remaining,
      grace_hours: row.grace_hours,
      deadline_ms: row.deadline_local_ms,
    };
  }

  /** The gate a document write passes through before it may be taken offline. */
  assertWorkAllowed(counterKey?: string | number | null): void {
    const state = this.state(counterKey);
    if (state.allowed) return;

    const error = new Error(GRACE_EXPIRED_MESSAGE);
    (error as { code?: string }).code = "counter_grace_expired";
    throw error;
  }

  /** Wiped with the claim it belonged to — a revocation or a remote reset. */
  async clear(counterKey?: string | number | null): Promise<void> {
    if (counterKey !== undefined && counterKey !== null && String(counterKey) !== "") {
      const key = String(counterKey);
      this.mirror.delete(key);
      if (this.activeKey === key) this.activeKey = null;
      await sqliteStorage.deleteRecord(TABLE, key);
      return;
    }

    this.mirror.clear();
    this.activeKey = null;
    await sqliteStorage.clearTable(TABLE);
  }
}

export const counterGraceService = new CounterGraceService();

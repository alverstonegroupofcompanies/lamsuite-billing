import { API_BASE_URL } from "../../config/env";
import { sqliteStorage } from "../db/sqliteStorage";
import { decryptStaffSecret, encryptStaffSecret } from "./offlineStaffVault";
import { staffCryptoService } from "./staffCryptoService";
import { storeDeviceService } from "./storeDeviceService";

/**
 * PRF-005 / B8a — the counter's idle lock, counted on the till.
 *
 * The owner sets the minutes and the counter's unlock PIN in the admin panel;
 * `/api/counter/context` hands this till both, and the screen locks when the
 * counter has been untouched for that long. What opens it again is the
 * counter's own PIN — never a staff or approver PIN, because the only credential
 * compared here is the one this counter owns (IS6). The hash needed to answer
 * while the store server is out of reach comes from the counter-scoped cache
 * endpoint and is written at rest encrypted, in the till's own store, never in
 * browser storage.
 */

export const DEFAULT_IDLE_LOCK_MINUTES = 5;

const LOCKING_TABLE = "counter_locking";
const CACHE_TABLE = "counter_unlock_cache";

/** The wrong-PIN wording the server uses, kept for the offline answer too. */
const WRONG_PIN_MESSAGE = "That is not this counter's unlock PIN.";
const NO_PIN_CACHED_MESSAGE =
  "This till has not been able to check this counter's unlock PIN while offline. Connect it to the store server.";
const OWNER_RESET_MESSAGE =
  "Too many wrong attempts on this counter. The store owner must reset its unlock PIN.";

export interface CounterContextPayload {
  counter?: { id?: number | string | null; counter_code?: string | null; counter_name?: string | null } | null;
  store?: { id?: number | string | null } | null;
  locking?: {
    idle_lock_minutes?: number | string | null;
    unlock?: { pin_set?: boolean; failed_attempts?: number; locked_until?: string | null } | null;
  } | null;
}

export interface CounterLockingState {
  counterId: string | null;
  storeId: string | null;
  counterName: string;
  counterCode: string;
  idleLockMinutes: number;
  pinSet: boolean;
  /** True while the counter itself is locked out until the owner resets it. */
  ownerResetRequired: boolean;
  isLocked: boolean;
}

export interface CounterUnlockResult {
  success: boolean;
  code?: string;
  error?: string;
  remainingAttempts?: number;
  verifiedBy?: "server" | "cached_hash";
}

interface LockingRow {
  counter_id: string;
  store_id: string | null;
  counter_name: string;
  counter_code: string;
  idle_lock_minutes: number;
  pin_set: boolean;
  locked_until: string | null;
  updated_at: number;
}

interface CachedHashRow {
  counter_id: string;
  store_id: string | null;
  algorithm: string;
  hash: string;
  cached_at: number;
}

function defaultState(): CounterLockingState {
  return {
    counterId: null,
    storeId: null,
    counterName: "this counter",
    counterCode: "",
    idleLockMinutes: DEFAULT_IDLE_LOCK_MINUTES,
    pinSet: true,
    ownerResetRequired: false,
    isLocked: false,
  };
}

function minutes(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_IDLE_LOCK_MINUTES;
}

function isFuture(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const at = Date.parse(String(iso));
  return Number.isFinite(at) && at > Date.now();
}

export class CounterLockingService {
  private current = defaultState();
  private listeners: Array<(state: CounterLockingState) => void> = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private stopWatch: (() => void) | null = null;

  state(): CounterLockingState {
    return { ...this.current };
  }

  subscribe(listener: (state: CounterLockingState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  idleTimeoutMs(): number {
    return this.current.idleLockMinutes * 60_000;
  }

  /** Takes the till back to its own defaults without deleting what is stored. */
  unload(): void {
    if (this.stopWatch) this.stopWatch();
    this.stopWatch = null;
    this.current = defaultState();
    this.notify();
  }

  /** Reads this counter's minutes back, so a till that rebooted offline is still the owner's. */
  async hydrate(): Promise<CounterLockingState> {
    const rows = await sqliteStorage.findAll<LockingRow>(LOCKING_TABLE);
    const wanted = this.current.counterId;
    const row = rows.find((r) => (wanted === null || String(r.counter_id) === String(wanted))) ?? rows[0];

    if (row) {
      this.current = {
        ...this.current,
        counterId: String(row.counter_id),
        storeId: row.store_id ?? null,
        counterName: row.counter_name || this.current.counterName,
        counterCode: row.counter_code || this.current.counterCode,
        idleLockMinutes: minutes(row.idle_lock_minutes),
        pinSet: row.pin_set !== false,
      };
      this.notify();
    }

    return this.state();
  }

  /**
   * The locking block of a `/api/counter/context` answer (or a claim, which
   * carries the same shape). A context that says nothing about locking changes
   * nothing: a till never invents minutes the owner did not set.
   */
  async applyContext(context: CounterContextPayload | null | undefined): Promise<CounterLockingState | null> {
    const locking = context?.locking;
    if (!locking || !locking.unlock) return null;

    const counterId = context?.counter?.id;
    if (counterId === null || counterId === undefined || String(counterId) === "") return null;

    const key = String(counterId);
    const row: LockingRow = {
      counter_id: key,
      store_id: context?.store?.id === undefined || context?.store?.id === null ? null : String(context.store.id),
      counter_name: String(context?.counter?.counter_name ?? ""),
      counter_code: String(context?.counter?.counter_code ?? ""),
      idle_lock_minutes: minutes(locking.idle_lock_minutes),
      pin_set: locking.unlock.pin_set === true,
      locked_until: locking.unlock.locked_until ?? null,
      updated_at: Date.now(),
    };

    await sqliteStorage.insertRecord(LOCKING_TABLE, key, row as unknown as Record<string, unknown>);

    const minutesChanged = row.idle_lock_minutes !== this.current.idleLockMinutes;

    this.current = {
      ...this.current,
      counterId: key,
      storeId: row.store_id,
      counterName: row.counter_name || this.current.counterName,
      counterCode: row.counter_code || this.current.counterCode,
      idleLockMinutes: row.idle_lock_minutes,
      pinSet: row.pin_set,
      ownerResetRequired: isFuture(row.locked_until),
    };
    this.notify();

    // A context read after the watch started is usually the owner's own minutes
    // arriving for the first time, or a change to them. Waiting for the next
    // keystroke would let a till idle past the lock the owner just asked for.
    if (minutesChanged && this.stopWatch) this.armIdleTimer();

    return this.state();
  }

  /**
   * Reads the counter's locking block and the one credential hash it may cache,
   * so the till knows the owner's minutes before it needs them.
   */
  async refresh(): Promise<CounterLockingState | null> {
    const headers = { Accept: "application/json", ...(await storeDeviceService.getDeviceAuthHeaders()) };

    let context: CounterContextPayload | null = null;
    try {
      const res = await fetch(`${API_BASE_URL}/api/counter/context`, { method: "GET", headers });
      if (res.ok) context = (await res.json()) as CounterContextPayload;
    } catch {
      return null;
    }

    const state = await this.applyContext(context);
    await this.cacheUnlockHash();

    return state;
  }

  /** Pulls the counter's own bcrypt hash into the till's encrypted local cache. */
  async cacheUnlockHash(): Promise<boolean> {
    const headers = { Accept: "application/json", ...(await storeDeviceService.getDeviceAuthHeaders()) };
    const key = this.current.counterId;
    if (!key) return false;

    let body: any = null;
    try {
      const res = await fetch(`${API_BASE_URL}/api/credentials/offline-cache`, { method: "GET", headers });
      if (!res.ok) return false;
      body = await res.json();
    } catch {
      return false;
    }

    const entry = (Array.isArray(body?.credentials) ? body.credentials : []).find(
      (credential: any) => credential?.kind === "counter_unlock"
    );

    // An owner who has not set a PIN, or cleared one, leaves nothing to verify
    // offline — a stale cache must not keep opening a counter that changed.
    if (!entry?.pin_set || !entry?.hash) {
      await sqliteStorage.deleteRecord(CACHE_TABLE, key);
      return false;
    }

    const row: CachedHashRow = {
      counter_id: key,
      store_id: body?.store_id === undefined || body?.store_id === null ? this.current.storeId : String(body.store_id),
      algorithm: String(entry.algorithm ?? "bcrypt"),
      hash: await encryptStaffSecret(String(entry.hash)),
      cached_at: Date.now(),
    };

    await sqliteStorage.insertRecord(CACHE_TABLE, key, row as unknown as Record<string, unknown>);
    return true;
  }

  /** Starts counting idle time; call once when the till reaches its screens. */
  startIdleWatch(): () => void {
    if (this.stopWatch) this.stopWatch();

    const activity = () => this.recordActivity();
    const events: Array<keyof WindowEventMap> = ["mousemove", "keydown", "click"];
    events.forEach((event) => window.addEventListener(event, activity));

    this.stopWatch = () => {
      events.forEach((event) => window.removeEventListener(event, activity));
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = null;
    };

    this.armIdleTimer();

    return this.stopWatch;
  }

  recordActivity(): void {
    if (this.current.isLocked) return;
    this.armIdleTimer();
  }

  lock(): void {
    if (this.current.isLocked) return;

    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.current = { ...this.current, isLocked: true };
    this.notify();
  }

  /**
   * Answers the lock screen. The counter is named by its device token and by
   * nothing in this request, so the body carries the PIN alone (IS1).
   */
  async unlock(pin: string): Promise<CounterUnlockResult> {
    const digits = String(pin ?? "");
    if (digits === "") return { success: false, error: "Enter this counter's unlock PIN." };

    if (typeof navigator === "undefined" || navigator.onLine) {
      const answered = await this.unlockOnline(digits);
      if (answered) return answered;
    }

    return await this.unlockOffline(digits);
  }

  /** Forgets the counter's lock settings and the hash cached for it. */
  async clear(counterId?: string | number | null): Promise<void> {
    const key = counterId === undefined || counterId === null ? this.current.counterId : String(counterId);

    if (key === null || key === undefined || String(key) === "") {
      await sqliteStorage.clearTable(LOCKING_TABLE);
      await sqliteStorage.clearTable(CACHE_TABLE);
    } else {
      await sqliteStorage.deleteRecord(LOCKING_TABLE, String(key));
      await sqliteStorage.deleteRecord(CACHE_TABLE, String(key));
    }

    this.current = defaultState();
    this.notify();
  }

  private async unlockOnline(pin: string): Promise<CounterUnlockResult | null> {
    try {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(await storeDeviceService.getDeviceAuthHeaders()),
      };
      const res = await fetch(`${API_BASE_URL}/api/counter/unlock`, {
        method: "POST",
        headers,
        body: JSON.stringify({ pin }),
      });
      const body: any = await res.json().catch(() => ({}));

      if (res.ok && body?.success) {
        this.openAgain();
        return { success: true, verifiedBy: "server" };
      }

      const code = String(body?.code ?? body?.error ?? `http_${res.status}`);
      const error = String(body?.error ?? body?.message ?? WRONG_PIN_MESSAGE);

      if (code === "counter_unlock_locked") {
        this.current = { ...this.current, ownerResetRequired: true };
        this.notify();
      }

      return {
        success: false,
        code,
        error: error || OWNER_RESET_MESSAGE,
        remainingAttempts: typeof body?.remaining_attempts === "number" ? body.remaining_attempts : undefined,
      };
    } catch {
      // Unreachable store server: the cached hash answers instead.
      return null;
    }
  }

  private async unlockOffline(pin: string): Promise<CounterUnlockResult> {
    const key = this.current.counterId;
    if (!key) return { success: false, code: "counter_unclaimed", error: NO_PIN_CACHED_MESSAGE };

    const row = await sqliteStorage.findById<CachedHashRow>(CACHE_TABLE, key);
    if (!row?.hash) return { success: false, code: "counter_offline_no_cached_pin", error: NO_PIN_CACHED_MESSAGE };

    const hash = await decryptStaffSecret(row.hash);
    if (!hash) return { success: false, code: "counter_offline_cache_unreadable", error: NO_PIN_CACHED_MESSAGE };

    // Only this counter's own hash is compared, so a staff or approver PIN has
    // nothing here to match against.
    if (!(await staffCryptoService.verifyPin(pin, hash))) {
      return { success: false, code: "INVALID_UNLOCK_PIN", error: WRONG_PIN_MESSAGE };
    }

    this.openAgain();
    return { success: true, verifiedBy: "cached_hash" };
  }

  private openAgain(): void {
    this.current = { ...this.current, isLocked: false, ownerResetRequired: false, pinSet: true };
    this.notify();
    this.armIdleTimer();
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.lock(), this.idleTimeoutMs());
  }

  private notify(): void {
    const snapshot = this.state();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export const counterLockingService = new CounterLockingService();

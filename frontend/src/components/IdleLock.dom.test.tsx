import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { LockOverlay } from "./LockOverlay";
import {
  counterLockingService,
  DEFAULT_IDLE_LOCK_MINUTES,
  type CounterContextPayload,
} from "../lib/auth/counterLockingService";
import { storeDeviceService } from "../lib/auth/storeDeviceService";
import { posCartService } from "../lib/billing/posCartService";
import { productsStore } from "../lib/masters/productsStore";
import { getMockDatabase, sqliteStorage } from "../lib/db/sqliteStorage";
import { resetMockHandlers } from "../lib/ipc/ipcBridge";
import { resetOfflineStaffVaultKeyCache } from "../lib/auth/offlineStaffVault";

/**
 * PRF-005 / B8a — the counter's own idle lock at the till.
 *
 * The owner's idle minutes for this counter decide when the screen locks, the
 * counter PIN is what opens it again (never a staff or approver PIN), the open
 * cart survives the whole cycle, and the credential the till can check while it
 * is offline is the counter's own bcrypt hash — held encrypted in the till's
 * store, never in browser storage and never in a request body.
 */

const COUNTER_PIN = "582913";
const STAFF_PIN = "4826";

// bcrypt cost 10 hashes of the two PINs, generated with the server's own
// password_hash(); the staff hash proves the domains stay disjoint (IS6).
const COUNTER_PIN_HASH = "$2y$10$KtWhbVNAZa57YaQHNc72P.EDKPpNmf/UpsV4HmyeuHlJKleFBeycG";
const STAFF_PIN_HASH = "$2y$10$3dpRLpA0eJ8KcQzOJH1AAOFynizzpvzAeibYq0x0U4TAlOVZ24kDm";

const MINUTE = 60_000;

function context(overrides: Partial<CounterContextPayload> = {}): CounterContextPayload {
  return {
    counter: { id: 12, counter_code: "C01", counter_name: "Front Counter", status: "active" },
    store: { id: 7, name: "LamStone Pharmacy Main", code: "STORE-07" },
    locking: {
      idle_lock_minutes: 2,
      unlock: { pin_set: true, failed_attempts: 0, locked_until: null },
    },
    ...overrides,
  } as CounterContextPayload;
}

function route(path: string, status: number, body: unknown) {
  return { path, reply: () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) };
}

/** Records every call so a test can read the exact URL, headers and body. */
function installFetch(routes: Array<ReturnType<typeof route>>) {
  const calls: Array<{ url: string; init: any }> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: any = {}) => {
      const url = typeof input === "string" ? input : String(input);
      const match = routes.find((r) => url.includes(r.path));
      calls.push({ url, init });
      if (!match) throw new TypeError(`Network access disabled in tests: ${url}`);
      return match.reply();
    })
  );

  return calls;
}

async function seedCart(): Promise<void> {
  await productsStore.upsertProduct({ id: "prod_lock", name: "Dolo 650", mrp: 50, gst_percent: 5 });
  await productsStore.upsertBatch({
    id: "batch_lock",
    product_id: "prod_lock",
    batch_no: "B1",
    expiry_date: "2028-12-31",
    stock_qty: 100,
    mrp: 50,
    selling_rate: 50,
  });
  const product = await productsStore.getProductById("prod_lock");
  const batch = await sqliteStorage.findById<any>("product_batches", "batch_lock");
  posCartService.addItem(product!, batch!, 2);
}

function enterPin(pin: string) {
  const field = screen.getByLabelText(/unlock pin/i) as HTMLInputElement;
  fireEvent.change(field, { target: { value: pin } });
  fireEvent.submit(field.closest("form")!);
}

describe("The counter's idle lock at the till (PRF-005)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    resetOfflineStaffVaultKeyCache();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();

    posCartService.clearCart();
    counterLockingService.unload();
    await counterLockingService.clear();
    localStorage.clear();

    vi.spyOn(storeDeviceService, "getDeviceAuthHeaders").mockResolvedValue({
      "X-Device-Token": "test-counter-device-token",
    });
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("locks after the idle minutes the owner set for this counter", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-11-21T09:00:00Z"));

    await counterLockingService.applyContext(context());
    counterLockingService.startIdleWatch();
    render(<LockOverlay />);

    expect(counterLockingService.idleTimeoutMs()).toBe(2 * MINUTE);

    act(() => void vi.advanceTimersByTime(MINUTE + 30_000));
    expect(counterLockingService.state().isLocked).toBe(false);

    // A keystroke restarts the count, so a working till never locks.
    fireEvent.keyDown(window, { key: "a" });
    act(() => void vi.advanceTimersByTime(MINUTE + 30_000));
    expect(counterLockingService.state().isLocked).toBe(false);

    act(() => void vi.advanceTimersByTime(30_000));
    expect(counterLockingService.state().isLocked).toBe(true);
    expect(screen.getByText(/Front Counter/i)).toBeInTheDocument();
  });

  it("keeps the till's own five minutes only while no counter context was read", () => {
    expect(counterLockingService.idleTimeoutMs()).toBe(DEFAULT_IDLE_LOCK_MINUTES * MINUTE);
  });

  it("counts the owner's minutes from the moment the context is read, not the next keystroke", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-11-21T09:00:00Z"));

    // The watch starts before the counter's own minutes are known.
    counterLockingService.startIdleWatch();
    await counterLockingService.applyContext(context());
    render(<LockOverlay />);

    expect(counterLockingService.idleTimeoutMs()).toBe(2 * MINUTE);

    act(() => void vi.advanceTimersByTime(2 * MINUTE + 1_000));
    expect(counterLockingService.state().isLocked).toBe(true);
    expect(screen.getByText(/Front Counter/i)).toBeInTheDocument();
  });

  it("keeps the owner's minutes across a till restart with the store server out of reach", async () => {
    await counterLockingService.applyContext(context());

    // The till restarts: the service holds nothing until it reads its own store.
    counterLockingService.unload();
    expect(counterLockingService.idleTimeoutMs()).toBe(DEFAULT_IDLE_LOCK_MINUTES * MINUTE);

    await counterLockingService.hydrate();
    expect(counterLockingService.idleTimeoutMs()).toBe(2 * MINUTE);
    expect(counterLockingService.state().counterName).toBe("Front Counter");
    expect(counterLockingService.state().counterCode).toBe("C01");
  });

  it("resumes the open cart on the counter PIN and sends nothing but the PIN", async () => {
    await seedCart();
    await counterLockingService.applyContext(context());
    const calls = installFetch([route("/api/counter/unlock", 200, { success: true, counter_id: 12 })]);

    counterLockingService.lock();
    render(<LockOverlay />);
    expect(screen.getByLabelText(/unlock pin/i)).toBeInTheDocument();

    enterPin(COUNTER_PIN);

    await waitFor(() => expect(counterLockingService.state().isLocked).toBe(false));
    expect(document.querySelector('[data-lock-overlay="true"]')).toBeNull();
    expect(posCartService.getLines()).toHaveLength(1);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/api/counter/unlock");
    expect(calls[0].init.headers["X-Device-Token"]).toBe("test-counter-device-token");
    expect(JSON.parse(calls[0].init.body)).toEqual({ pin: COUNTER_PIN });
  });

  it("stays locked with the server's reason and the attempts it counted", async () => {
    await counterLockingService.applyContext(context());
    installFetch([
      route("/api/counter/unlock", 422, {
        success: false,
        code: "INVALID_UNLOCK_PIN",
        error: "That is not this counter's unlock PIN.",
        remaining_attempts: 3,
      }),
    ]);

    counterLockingService.lock();
    render(<LockOverlay />);
    enterPin("111111");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not this counter/i));
    expect(screen.getByRole("alert").textContent).toMatch(/3 attempts left/i);
    expect(counterLockingService.state().isLocked).toBe(true);
    expect(screen.getByLabelText(/unlock pin/i)).toHaveValue("");
  });

  it("hands the counter to the owner once the attempts ran out", async () => {
    await counterLockingService.applyContext(context());
    installFetch([
      route("/api/counter/unlock", 423, {
        success: false,
        code: "counter_unlock_locked",
        error: "Too many wrong attempts on this counter. The store owner must reset its unlock PIN.",
        remaining_attempts: 0,
      }),
    ]);

    counterLockingService.lock();
    render(<LockOverlay />);
    enterPin("111111");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/owner must reset/i));
    expect(counterLockingService.state().isLocked).toBe(true);
    expect(screen.getByRole("button", { name: /unlock counter/i })).toBeDisabled();
  });

  it("says so when the counter has no unlock PIN yet", async () => {
    await counterLockingService.applyContext(context({
      locking: { idle_lock_minutes: 2, unlock: { pin_set: false, failed_attempts: 0, locked_until: null } },
    }));
    installFetch([
      route("/api/counter/unlock", 409, {
        success: false,
        code: "counter_unlock_pin_not_set",
        error: "This counter has no unlock PIN yet. Ask the store owner to set one in Admin Panel → Counters.",
      }),
      route("/api/credentials/offline-cache", 200, { success: true, credentials: [] }),
    ]);

    counterLockingService.lock();
    render(<LockOverlay />);
    expect(screen.getByText(/no unlock PIN yet/i)).toBeInTheDocument();
  });

  it("offline, opens on this counter's cached PIN and refuses a staff PIN", async () => {
    installFetch([
      route("/api/counter/context", 200, context({
        locking: { idle_lock_minutes: 2, unlock: { pin_set: true, failed_attempts: 0, locked_until: null } },
      })),
      route("/api/credentials/offline-cache", 200, {
        success: true,
        counter_id: 12,
        store_id: 7,
        credentials: [
          {
            kind: "counter_unlock",
            pin_set: true,
            algorithm: "bcrypt",
            hash: COUNTER_PIN_HASH,
            failed_attempts: 0,
            locked_until: null,
          },
          { kind: "approver_pins", pin_set: true, algorithm: "bcrypt", hash: STAFF_PIN_HASH },
        ],
      }),
    ]);

    await counterLockingService.refresh();
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });

    counterLockingService.lock();
    render(<LockOverlay />);

    enterPin(STAFF_PIN);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not this counter/i));
    expect(counterLockingService.state().isLocked).toBe(true);

    enterPin(COUNTER_PIN);
    await waitFor(() => expect(counterLockingService.state().isLocked).toBe(false));
    expect(document.querySelector('[data-lock-overlay="true"]')).toBeNull();
  });

  it("never leaves the PIN or its hash in browser storage", async () => {
    installFetch([
      route("/api/counter/context", 200, context()),
      route("/api/credentials/offline-cache", 200, {
        success: true,
        counter_id: 12,
        store_id: 7,
        credentials: [
          { kind: "counter_unlock", pin_set: true, algorithm: "bcrypt", hash: COUNTER_PIN_HASH },
        ],
      }),
    ]);

    await counterLockingService.refresh();

    for (const value of Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? "")) {
      expect(value).not.toContain(COUNTER_PIN);
      expect(value).not.toContain(COUNTER_PIN_HASH);
    }

    const rows = await sqliteStorage.findAll<any>("counter_unlock_cache");
    expect(rows).toHaveLength(1);
    expect(rows[0].counter_id).toBe("12");
    expect(rows[0].store_id).toBe("7");
    expect(rows[0].hash).not.toContain(COUNTER_PIN_HASH);
    expect(rows[0].hash).toMatch(/^vault:/);
  });

  it("drops the cached PIN and the minutes when the counter is let go", async () => {
    installFetch([
      route("/api/counter/context", 200, context()),
      route("/api/credentials/offline-cache", 200, {
        success: true,
        counter_id: 12,
        store_id: 7,
        credentials: [{ kind: "counter_unlock", pin_set: true, algorithm: "bcrypt", hash: COUNTER_PIN_HASH }],
      }),
    ]);

    await counterLockingService.refresh();
    expect(await sqliteStorage.findAll<any>("counter_unlock_cache")).toHaveLength(1);

    await counterLockingService.clear();
    expect(await sqliteStorage.findAll<any>("counter_unlock_cache")).toHaveLength(0);
    expect(await sqliteStorage.findAll<any>("counter_locking")).toHaveLength(0);
    expect(counterLockingService.idleTimeoutMs()).toBe(DEFAULT_IDLE_LOCK_MINUTES * MINUTE);
  });
});

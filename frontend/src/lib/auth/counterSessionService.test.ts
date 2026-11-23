import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  COUNTER_PROFILE_TABLE,
  counterSessionService,
  type CounterContextPayload,
} from "./counterSessionService";
import { storeDeviceService } from "./storeDeviceService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { resetMockHandlers } from "../ipc/ipcBridge";

/**
 * B8b / PRF-001 — the counter's permission document is what the till works
 * inside.
 *
 * There is no signed-in person at the POS any more, so the surface a machine
 * may show comes from the document the store server hands with the claim and
 * re-hands on every context read. The till only ever echoes documented
 * controls: it invents no defaults of its own, so a document that says nothing
 * about a control leaves the store ceiling in place rather than guessing what
 * the owner meant.
 */

function profile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    modules: ["dashboard", "pos", "bills", "reports"],
    screens: ["pos.billing"],
    cash_drawer: false,
    reports: ["*"],
    ...overrides,
  };
}

function context(overrides: Partial<CounterContextPayload> = {}): CounterContextPayload {
  return {
    counter: { id: 12, counter_code: "C01", counter_name: "Front Counter" },
    store: { id: 7, name: "LamStone Pharmacy Main", code: "STORE-07" },
    profile: { permissions: profile(), version: 3, updated_at: "2026-11-21T09:00:00+05:30" },
    ...overrides,
  } as CounterContextPayload;
}

function route(path: string, status: number, body: unknown) {
  return { path, reply: () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) };
}

/** Records every call so a test can read the exact URL and headers. */
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

async function cachedRows(): Promise<any[]> {
  return await sqliteStorage.findAll<any>(COUNTER_PROFILE_TABLE);
}

describe("The counter's permission document at the till (PRF-001)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();

    counterSessionService.unload();
    await counterSessionService.clear();
    localStorage.clear();

    vi.spyOn(storeDeviceService, "getDeviceAuthHeaders").mockResolvedValue({
      "X-Device-Token": "test-counter-device-token",
      "X-Device-UUID": "dev-7-C01",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("works inside the document that arrives with the claim", async () => {
    await counterSessionService.applyContext(context() as unknown as CounterContextPayload);

    expect(counterSessionService.allowsModule("pos")).toBe(true);
    expect(counterSessionService.allowsModule("bills")).toBe(true);
    // The owner granted four modules of fifteen; the rest stay shut at the till.
    expect(counterSessionService.allowsModule("purchases")).toBe(false);
    expect(counterSessionService.allowsModule("masters")).toBe(false);
    expect(counterSessionService.state().version).toBe(3);
    expect(counterSessionService.state().counterName).toBe("Front Counter");
  });

  it("a till that has never read a document works at the store ceiling", () => {
    expect(counterSessionService.hasDocument()).toBe(false);
    expect(counterSessionService.allowsModule("purchases")).toBe(true);
    expect(counterSessionService.allowsReport("gst_summary")).toBe(true);
  });

  it("changes nothing when an answer says nothing about the document", async () => {
    await counterSessionService.applyContext({ counter: { id: 12 }, store: { id: 7 } });

    expect(counterSessionService.hasDocument()).toBe(false);
    expect(await cachedRows()).toEqual([]);
    expect(counterSessionService.allowsModule("purchases")).toBe(true);
  });

  it("caches the document in the till's own store, keyed by its counter", async () => {
    await counterSessionService.applyContext(context());

    const rows = await cachedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].counter_id).toBe("12");
    expect(rows[0].store_id).toBe("7");
    expect(JSON.parse(rows[0].profile_json).modules).toEqual(["dashboard", "pos", "bills", "reports"]);
    expect(rows[0].version).toBe(3);
  });

  it("keeps an undocumented key — including a credential — out of the cache", async () => {
    await counterSessionService.applyContext(
      context({
        profile: {
          permissions: {
            modules: ["pos"],
            unlock_pin_hash: "$2y$10$someCounterHash",
            pin: "4321",
            discount_max_percent: 50,
          },
          version: 4,
        },
      })
    );

    const rows = await cachedRows();
    const stored = JSON.parse(rows[0].profile_json);

    expect(Object.keys(stored)).toEqual(["modules"]);
    expect(rows[0].version).toBe(4);
    for (const value of Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? "")) {
      expect(value).not.toContain("4321");
      expect(value).not.toContain("$2y$10$");
    }
  });

  it("reports on the controls the document names and defers on the ones it does not", async () => {
    await counterSessionService.applyContext(context({ profile: { permissions: { modules: ["pos"] }, version: 1 } }));
    expect(counterSessionService.allowsReport("gst_summary")).toBe(true);

    await counterSessionService.applyContext(
      context({ profile: { permissions: { modules: ["pos"], reports: ["sales_summary"] }, version: 2 } })
    );
    expect(counterSessionService.allowsReport("sales_summary")).toBe(true);
    expect(counterSessionService.allowsReport("gst_summary")).toBe(false);
  });

  it("boots offline from the document it cached last time", async () => {
    await counterSessionService.applyContext(context());
    counterSessionService.unload();

    installFetch([]);
    const state = await counterSessionService.hydrate(12);

    expect(state.version).toBe(3);
    expect(counterSessionService.allowsModule("purchases")).toBe(false);
    expect(counterSessionService.allowsModule("pos")).toBe(true);
  });

  it("reads the store server's document and tells the screens what changed", async () => {
    const calls = installFetch([
      route("/api/counter/context", 200, context({
        profile: { permissions: profile({ modules: ["pos"] }), version: 9 },
      })),
    ]);

    const seen: number[] = [];
    counterSessionService.subscribe((state) => seen.push(state.version));

    const state = await counterSessionService.refresh();

    expect(state?.version).toBe(9);
    expect(counterSessionService.allowsModule("bills")).toBe(false);
    expect(seen).toEqual([9]);
    expect(calls[0].url).toContain("/api/counter/context");
    expect(calls[0].init.headers["X-Device-Token"]).toBe("test-counter-device-token");
    // The counter authorises the till; a person's bearer token has no place here.
    expect(calls[0].init.headers["Authorization"]).toBeUndefined();
  });

  it("keeps working inside the last document when the server is out of reach", async () => {
    await counterSessionService.applyContext(context());

    installFetch([route("/api/counter/context", 503, { message: "edge down" })]);
    expect(await counterSessionService.refresh()).toBeNull();

    expect(counterSessionService.state().version).toBe(3);
    expect(counterSessionService.allowsModule("purchases")).toBe(false);
  });

  it("keeps one counter's document off its peer's till", async () => {
    await counterSessionService.applyContext(context());
    await counterSessionService.applyContext(
      context({ counter: { id: 88, counter_code: "C02", counter_name: "Back Counter" }, profile: null })
    );

    // A counter whose answer carries no document leaves the till at the ceiling
    // until it reads one — it does not inherit C01's narrow surface.
    expect(counterSessionService.hasDocument()).toBe(false);

    await counterSessionService.hydrate(12);
    expect(counterSessionService.allowsModule("purchases")).toBe(false);
    expect(counterSessionService.state().counterId).toBe("12");

    await counterSessionService.hydrate(88);
    expect(counterSessionService.allowsModule("purchases")).toBe(true);
  });

  it("is a different store's business, not this one's cache", async () => {
    await counterSessionService.applyContext(context());

    getMockDatabase().setStore("other_store");
    await counterSessionService.hydrate(12);

    expect(counterSessionService.hasDocument()).toBe(false);
    expect(counterSessionService.allowsModule("purchases")).toBe(true);
  });

  it("goes away with the claim it belonged to", async () => {
    await counterSessionService.applyContext(context());

    await counterSessionService.clear();

    expect(await cachedRows()).toEqual([]);
    expect(counterSessionService.hasDocument()).toBe(false);
    expect(counterSessionService.state().counterId).toBeNull();
    expect(counterSessionService.allowsModule("purchases")).toBe(true);
  });

  it("is wiped when the store server lets the counter go", async () => {
    await counterSessionService.applyContext(context());
    expect(await cachedRows()).toHaveLength(1);

    await storeDeviceService.lockAndResetWorkstation(false);

    expect(await cachedRows()).toEqual([]);
    expect(counterSessionService.hasDocument()).toBe(false);
  });

  it("is wiped by a remote reset along with the rest of the counter", async () => {
    await counterSessionService.applyContext(context());
    expect(await cachedRows()).toHaveLength(1);

    await storeDeviceService.remoteStoreReset("cloud admin issued a reset");

    expect(await cachedRows()).toEqual([]);
    expect(counterSessionService.hasDocument()).toBe(false);
  });

  it("SYNC-02: a rejected watermark asks the till to revalidate the claim", async () => {
    installFetch([
      route("/api/counter/profile-version", 403, {
        success: false,
        error: "DEVICE_AUTH_FAILED",
        message: "This counter has been locked or retired by the store administrator.",
      }),
    ]);
    const validateSpy = vi
      .spyOn(storeDeviceService, "validateDeviceSession")
      .mockResolvedValue({ valid: false, locked: true, reason: "This counter has been retired by the store owner." });

    const version = await counterSessionService.fetchWatermark();

    expect(version).toBeNull();
    expect(validateSpy).toHaveBeenCalledTimes(1);
  });
});

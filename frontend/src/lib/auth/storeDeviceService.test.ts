import { describe, it, expect, beforeEach, vi } from "vitest";
import { storeDeviceService } from "./storeDeviceService";
import { sqliteStorage, getMockDatabase } from "../db/sqliteStorage";
import { resetMockHandlers, invokeCommand } from "../ipc/ipcBridge";
import { DEFAULT_IDLE_LOCK_MINUTES, counterLockingService } from "./counterLockingService";

describe("Workstation session security (SEC-004)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    storeDeviceService.clearProfileCache();
    vi.restoreAllMocks();
  });

  // CNT-013: getting onto a till at all is the claim path, covered by
  // storeDeviceService.claim.test.ts and the backend RetiredRegistrationPathsTest.
  // What is left here is what a claimed workstation does when the server changes
  // its mind about it.

  it("4. Device session validation locks and resets device if server revokes or does not recognize token", async () => {
    // Pre-populate secure store with an active session
    await invokeCommand("secure_store_set", { key: "device_token", value: "lsd_revoked_token_123" });
    await invokeCommand("secure_store_set", {
      key: "store_device_profile",
      value: JSON.stringify({
        device_id: "dev_1",
        device_uuid: "dev_uuid_1",
        store_id: "1",
        is_active: true,
      }),
    });

    // Server returns 401 lock_and_reset
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        valid: false,
        status: "unrecognized",
        action: "lock_and_reset",
        message: "Device unrecognized or revoked by server.",
      }),
    } as any);

    const check = await storeDeviceService.validateDeviceSession();
    expect(check.valid).toBe(false);
    expect(check.locked).toBe(true);

    // Verify credentials wiped from secure store
    const tokenAfter = await invokeCommand("secure_store_get", { key: "device_token" });
    const profileAfter = await invokeCommand("secure_store_get", { key: "store_device_profile" });
    expect(tokenAfter).toBeNull();
    expect(profileAfter).toBeNull();
  });

  async function seedRegisteredDevice(): Promise<void> {
    await invokeCommand("secure_store_set", { key: "device_token", value: "lsd_registered_token" });
    await invokeCommand("secure_store_set", {
      key: "store_device_profile",
      value: JSON.stringify({
        device_id: "dev_1",
        device_uuid: "dev_uuid_1",
        store_id: "1",
        is_active: true,
      }),
    });
  }

  it("4a. Pending approval never locks the workstation or clears the active store", async () => {
    await seedRegisteredDevice();
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        valid: false,
        status: "pending_approval",
        action: "wait_for_approval",
        message: "Workstation is pending approval from store owner.",
      }),
    } as any);

    const check = await storeDeviceService.validateDeviceSession();
    expect(check.locked).toBe(false);
    expect(check.valid).toBe(false);
    expect(await invokeCommand("secure_store_get", { key: "device_token" })).toBe("lsd_registered_token");
    expect(await invokeCommand("secure_store_get", { key: "store_device_profile" })).toContain("dev_uuid_1");
  });

  it("4b. A transient 401 from an edge/proxy does not revoke the workstation", async () => {
    await seedRegisteredDevice();
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized" }),
    } as any);

    const check = await storeDeviceService.validateDeviceSession();
    expect(check.locked).toBe(false);
    expect(await invokeCommand("secure_store_get", { key: "device_token" })).toBe("lsd_registered_token");
  });

  it("4c. Server outage keeps the workstation usable", async () => {
    await seedRegisteredDevice();
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ message: "Service Unavailable" }),
    } as any);

    const check = await storeDeviceService.validateDeviceSession();
    expect(check.valid).toBe(true);
    expect(check.locked).toBe(false);
  });

  it("4d. A disabled store is reported without clearing local credentials", async () => {
    await seedRegisteredDevice();
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        valid: false,
        status: "store_inactive",
        action: "lock_and_reset",
        message: "Store license is suspended or deactivated.",
      }),
    } as any);

    const check = await storeDeviceService.validateDeviceSession();
    expect(check.locked).toBe(false);
    expect(await invokeCommand("secure_store_get", { key: "device_token" })).toBe("lsd_registered_token");
  });
});

/**
 * IS9 — the counter's lock caches are till-local caches like the series and the
 * grace clock: when the counter stops being this machine's, the owner's idle
 * minutes and the cached unlock credential go with it.
 */
describe("The counter's lock caches go with the counter (IS9)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    storeDeviceService.clearProfileCache();
    counterLockingService.unload();
    vi.restoreAllMocks();
  });

  async function seedCounterLockCaches(): Promise<void> {
    await counterLockingService.applyContext({
      counter: { id: 12, counter_code: "C01", counter_name: "Front Counter" },
      store: { id: 1 },
      locking: { idle_lock_minutes: 2, unlock: { pin_set: true, failed_attempts: 0, locked_until: null } },
    } as any);

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        counter_id: 12,
        store_id: 1,
        credentials: [
          { kind: "counter_unlock", pin_set: true, algorithm: "bcrypt", hash: "$2y$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        ],
      }),
    } as any);

    expect(await counterLockingService.cacheUnlockHash()).toBe(true);
    expect(await sqliteStorage.findAll("counter_unlock_cache")).toHaveLength(1);
    expect(counterLockingService.idleTimeoutMs()).toBe(2 * 60_000);
  }

  it("purges the idle minutes and cached unlock credential when the server takes the counter back", async () => {
    await seedCounterLockCaches();

    await storeDeviceService.lockAndResetWorkstation();

    expect(await sqliteStorage.findAll("counter_unlock_cache")).toHaveLength(0);
    expect(await sqliteStorage.findAll("counter_locking")).toHaveLength(0);
    expect(counterLockingService.idleTimeoutMs()).toBe(DEFAULT_IDLE_LOCK_MINUTES * 60_000);
  });

  it("purges them when a cloud admin wipes the store on this machine", async () => {
    await seedCounterLockCaches();

    await storeDeviceService.remoteStoreReset("QA wipe");

    expect(await sqliteStorage.findAll("counter_unlock_cache")).toHaveLength(0);
    expect(await sqliteStorage.findAll("counter_locking")).toHaveLength(0);
  });
});

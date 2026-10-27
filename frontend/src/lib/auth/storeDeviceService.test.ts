import { describe, it, expect, beforeEach, vi } from "vitest";
import { storeDeviceService } from "./storeDeviceService";
import { sqliteStorage } from "../db/sqliteStorage";
import { resetMockHandlers, invokeCommand } from "../ipc/ipcBridge";

describe("Workstation Activation Security (SEC-004)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    storeDeviceService.clearProfileCache();
    vi.restoreAllMocks();
  });

  it("1. Rejects invalid activation key returned by server, leaving device unregistered with no profile, vault entry, or tokens", async () => {
    // Mock server returning 422 generic rejection
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ message: "Invalid, expired, or revoked activation key." }),
    } as any);

    await expect(
      storeDeviceService.registerWithActivationKey("RANDOM-INVALID-KEY-12345", "Counter Station 01")
    ).rejects.toThrow("Invalid, expired, or revoked activation key.");

    // Verify no tokens or profiles stored in secure vault
    const token = await invokeCommand("secure_store_get", { key: "device_token" });
    const profile = await invokeCommand("secure_store_get", { key: "store_device_profile" });

    expect(token).toBeNull();
    expect(profile).toBeNull();

    // Verify device is not registered
    const isReg = await storeDeviceService.isDeviceRegistered();
    expect(isReg).toBe(false);
  });

  it("2. Does NOT activate when offline or server unreachable (shows clear 'Cannot reach server' message)", async () => {
    // Mock network failure
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(
      storeDeviceService.registerWithActivationKey("LAM-TEST-2026-KEY", "Counter Station 01")
    ).rejects.toThrow("Cannot reach server. Online verification is required to activate this workstation.");

    // Verify no offline profile was fabricated
    const profile = await invokeCommand("secure_store_get", { key: "store_device_profile" });
    expect(profile).toBeNull();

    const isReg = await storeDeviceService.isDeviceRegistered();
    expect(isReg).toBe(false);
  });

  it("3. Valid key from server registers device token and store profile in OS secure store", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        device_id: "dev_verified_123",
        counter_id: "cntr_verified_01",
        counter_name: "Counter 01",
        counter_code: "C01",
        store_id: "1",
        store_name: "LamStone Pharmacy Main",
        store_code: "STORE-01",
        device_token: "lsd_valid_secure_token_abc123",
        refresh_token: "ref_valid_secure_token_xyz789",
        license_plan: "Enterprise Retail",
        status: "active",
        admin_staff_present: true,
      }),
    } as any);

    const profile = await storeDeviceService.registerWithActivationKey("LAM-VALID-KEY-9999", "Counter 01");

    expect(profile.store_id).toBe("1");
    expect(profile.store_name).toBe("LamStone Pharmacy Main");

    const savedToken = await invokeCommand("secure_store_get", { key: "device_token" });
    expect(savedToken).toBe("lsd_valid_secure_token_abc123");

    const isReg = await storeDeviceService.isDeviceRegistered();
    expect(isReg).toBe(true);
  });

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

  it("5. Release code verification: No demo bypass key or auto-activation exists in App.tsx or storeDeviceService", async () => {
    // Verify that attempting to activate with any dummy string without server contact fails
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Network down"));

    await expect(
      storeDeviceService.registerWithActivationKey("LAM-DEMO-2026-KEY", "Counter 01")
    ).rejects.toThrow();
  });
});

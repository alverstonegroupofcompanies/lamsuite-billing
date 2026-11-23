import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { deviceSessionService } from "./deviceSessionService";
import { storeDeviceService } from "../auth/storeDeviceService";
import { storeRegistryService } from "../auth/storeRegistryService";
import { counterLockingService } from "../auth/counterLockingService";

describe("deviceSessionService - Centralized Logged-In Device Tracking (Item 2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    deviceSessionService.clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. getLoggedInDevices maps server data and defaults missing fields cleanly without fabrication", async () => {
    const mockApiResponse = {
      success: true,
      devices: [
        {
          id: "1",
          device_uuid: "uuid-101",
          session_id: "sess-101",
          device_name: "POS-Checkout-01",
          counter_name: "Counter 01",
          counter_code: "C01",
          user_name: "Cashier Reshma",
          user_role: "Cashier",
          ip_address: "103.24.12.5",
          location: "Kochi, Kerala, IN",
          login_time: "2026-10-29T10:00:00Z",
          sign_in_time: "2026-10-29T10:00:00Z",
          last_active: new Date(Date.now() - 30 * 1000).toISOString(),
          last_seen: new Date(Date.now() - 30 * 1000).toISOString(),
          status: "Active",
          app_version: "2.0.17",
          unsynced_items_count: 2,
          is_this_device: true,
          is_active: true,
        },
        {
          id: "2",
          device_uuid: "uuid-102",
          session_id: "sess-102",
          device_name: null,
          counter_name: null,
          counter_code: null,
          user_name: null,
          user_role: null,
          ip_address: null,
          location: null,
          login_time: null,
          sign_in_time: null,
          last_active: new Date(Date.now() - 300 * 1000).toISOString(),
          last_seen: new Date(Date.now() - 300 * 1000).toISOString(),
          status: "Offline",
          app_version: "2.0.17",
          unsynced_items_count: 0,
          is_this_device: false,
          is_active: false,
        },
      ],
      total: 2,
    };

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    } as Response);

    const devices = await deviceSessionService.getLoggedInDevices();
    expect(devices).toHaveLength(2);

    const dev1 = devices[0];
    expect(dev1.device_name).toBe("POS-Checkout-01");
    expect(dev1.counter_name).toBe("Counter 01");
    expect(dev1.user_name).toBe("Cashier Reshma");
    expect(dev1.user_role).toBe("Cashier");
    expect(dev1.ip_address).toBe("103.24.12.5");
    expect(dev1.location).toBe("Kochi, Kerala, IN");
    expect(dev1.status).toBe("Active");
    expect(dev1.is_this_device).toBe(true);
    expect(dev1.unsynced_items_count).toBe(2);

    const dev2 = devices[1];
    expect(dev2.device_name).toBeNull();
    expect(dev2.counter_name).toBeNull();
    expect(dev2.ip_address).toBeNull();
    expect(dev2.location).toBeNull();
    expect(dev2.status).toBe("Offline");
    expect(dev2.is_this_device).toBe(false);
  });

  it("2. Filters devices correctly by status and search query params", async () => {
    const mockApiResponse = {
      success: true,
      devices: [
        {
          id: "1",
          device_uuid: "uuid-1",
          device_name: "Dell All-in-One",
          counter_name: "Pharmacy Front Desk",
          status: "Active",
          is_active: true,
        },
      ],
      total: 1,
    };

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    } as Response);

    await deviceSessionService.getLoggedInDevices({ search: "Pharmacy", status: "Active" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("search=Pharmacy");
    expect(calledUrl).toContain("status=Active");
  });

  it("3. sendHeartbeat posts to centralized heartbeat endpoint", async () => {
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValueOnce({
      device_uuid: "uuid-test-123",
      device_name: "Counter 01",
      counter_name: "Front Cashier",
      store_id: "store_1",
    } as any);

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, timestamp: "2026-10-29T10:05:00Z" }),
    } as Response);

    const success = await deviceSessionService.sendHeartbeat();
    expect(success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/device-sessions/heartbeat");
  });

  it("4. notifyLogout sends logout payload to /api/device-sessions/logout", async () => {
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValueOnce({
      device_uuid: "uuid-test-123",
      store_id: "store_1",
    } as any);

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: "Logged out successfully" }),
    } as Response);

    const success = await deviceSessionService.notifyLogout();
    expect(success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/device-sessions/logout");
  });

  it("5. renameDevice, lockDevice, and revokeDevice call proper endpoints", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response);

    vi.spyOn(deviceSessionService, "getLoggedInDevices").mockResolvedValue([]);

    // Rename
    const renameRes = await deviceSessionService.renameDevice("10", { counter_name: "Counter 2" });
    expect(renameRes).toBe(true);
    expect(fetchSpy.mock.calls[0][0]).toContain("/api/device-sessions/10/rename");

    // Lock
    const lockRes = await deviceSessionService.lockDevice("10");
    expect(lockRes).toBe(true);
    expect(fetchSpy.mock.calls[1][0]).toContain("/api/device-sessions/10/lock");

    // Revoke
    const revokeRes = await deviceSessionService.revokeDevice("10", "Old machine");
    expect(revokeRes).toBe(true);
    expect(fetchSpy.mock.calls[2][0]).toContain("/api/device-sessions/10/revoke");
  });

  it("6. startHeartbeatTimer keeps the claimed counter present and stops cleanly", async () => {
    vi.useFakeTimers();
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValue({
      device_uuid: "uuid-timer",
      counter_id: "cntr_07",
    } as any);

    const heartbeatSpy = vi.spyOn(deviceSessionService, "sendHeartbeat").mockResolvedValue(true);

    const stop = deviceSessionService.startHeartbeatTimer(5000);

    // The beat reads the device profile first, so it lands a microtask later.
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeatSpy).toHaveBeenCalledTimes(1);

    // Fast-forward 10 seconds (2 intervals)
    await vi.advanceTimersByTimeAsync(10000);
    expect(heartbeatSpy).toHaveBeenCalledTimes(3);

    // Stop timer
    stop();

    // Fast-forward more time, should not invoke further
    await vi.advanceTimersByTimeAsync(10000);
    expect(heartbeatSpy).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it("6b. an unclaimed terminal sends no heartbeat", async () => {
    vi.useFakeTimers();
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValue({
      device_uuid: "uuid-unclaimed",
    } as any);

    const heartbeatSpy = vi.spyOn(deviceSessionService, "sendHeartbeat").mockResolvedValue(true);
    const stop = deviceSessionService.startHeartbeatTimer(5000);

    await vi.advanceTimersByTimeAsync(15000);
    expect(heartbeatSpy).not.toHaveBeenCalled();

    stop();
    vi.useRealTimers();
  });

  it("7. getLoggedInDevices passes store_id=all and maps public_ip and store metadata", async () => {
    const mockApiResponse = {
      success: true,
      caller_public_ip: "117.236.91.145",
      other_stores_active_count: 2,
      devices: [
        {
          id: "1",
          device_uuid: "uuid-1",
          device_name: "POS 1",
          store_id: "1",
          store_code: "STORE-01",
          store_name: "Palakkad Main",
          public_ip: "117.236.91.145",
          ip_address: "127.0.0.1",
          status: "Active",
          is_this_device: true,
          is_active: true,
        },
      ],
      total: 1,
    };

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    } as Response);

    const devices = await deviceSessionService.getLoggedInDevices({ store_id: "all" });
    expect(devices).toHaveLength(1);
    expect(devices[0].public_ip).toBe("117.236.91.145");
    expect(devices[0].store_code).toBe("STORE-01");

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("store_id=all");

    const meta = deviceSessionService.getMetadata();
    expect(meta.caller_public_ip).toBe("117.236.91.145");
    expect(meta.other_stores_active_count).toBe(2);
  });

  it("8. getLoggedInDevices does not fabricate a local device row when the server is unreachable", async () => {
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValue({
      device_id: "dev_local",
      device_uuid: "uuid_local",
      device_name: "Local PC",
      store_id: "4",
      store_name: "Local Store",
      counter_id: "cntr_1",
      counter_name: "Counter 1",
    } as any);
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const devices = await deviceSessionService.getLoggedInDevices();

    expect(devices).toEqual([]);
  });

  it("9. sendHeartbeat reports the claimed counter and no signed-in person", async () => {
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValueOnce({
      device_uuid: "uuid-test-123",
      device_name: "Counter 01",
      counter_name: "Front Cashier",
      counter_id: "cntr_07",
      counter_code: "C07",
      store_id: "4",
    } as any);

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response);

    await deviceSessionService.sendHeartbeat();

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.counter_id).toBe("cntr_07");
    expect(body.counter_code).toBe("C07");
    expect(body.store_id).toBe("4");
    // SEC-001: nobody signs in at the till, so presence carries no person.
    expect(body.user_id).toBeUndefined();
    expect(body.user_role).toBeUndefined();
  });

  it("10. heartbeat 409 force-logout locks the counter instead of ending a person's session", async () => {
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValueOnce({
      device_uuid: "uuid-test-123",
      store_id: "4",
    } as any);
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        success: false,
        force_logged_out: true,
        action: "sign_in_required",
        reason: "Signed in at another till",
        message: "This session was ended: Signed in at another till. Sign in again.",
      }),
    } as Response);
    const lockSpy = vi.spyOn(counterLockingService, "lock").mockReturnValue(undefined);
    const resetSpy = vi.spyOn(storeDeviceService, "lockAndResetWorkstation");

    const ok = await deviceSessionService.sendHeartbeat();

    expect(ok).toBe(false);
    expect(lockSpy).toHaveBeenCalledTimes(1);
    expect(resetSpy).not.toHaveBeenCalled();
  });

  it("12. roster prefers the paired numeric store over a local registry key", async () => {
    vi.spyOn(storeRegistryService, "getActiveStore").mockReturnValue({
      id: "store_main",
      name: "Main Store",
    } as any);
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValue({
      device_uuid: "uuid-paired",
      store_id: "4",
    } as any);

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, devices: [] }),
    } as Response);

    await deviceSessionService.getLoggedInDevices();

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("store_id=4");
    expect(calledUrl).not.toContain("store_main");
  });

  it("13. roster omits store_id when only a local registry key is available", async () => {
    vi.spyOn(storeRegistryService, "getActiveStore").mockReturnValue({
      id: "store_main",
      name: "Main Store",
    } as any);
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValue({
      device_uuid: "uuid-unpaired",
      store_id: "store_main",
    } as any);

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, devices: [] }),
    } as Response);

    const devices = await deviceSessionService.getLoggedInDevices();

    expect(devices).toEqual([]);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("store_id=");
  });

  it("14. roster surfaces the server error message instead of pretending nobody is signed in", async () => {
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValue({
      device_uuid: "uuid-paired",
      store_id: "4",
    } as any);
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ success: false, message: "Store not found." }),
    } as Response);

    const devices = await deviceSessionService.getLoggedInDevices();

    expect(devices).toEqual([]);
    expect(deviceSessionService.getLastError()).toBe("Store not found.");
  });

  it("15. a successful roster refresh clears the previous error", async () => {
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValue({
      device_uuid: "uuid-paired",
      store_id: "4",
    } as any);
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: "Server exploded" }),
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, devices: [] }),
    } as Response);

    await deviceSessionService.getLoggedInDevices();
    expect(deviceSessionService.getLastError()).toBe("Server exploded");

    await deviceSessionService.getLoggedInDevices();
    expect(deviceSessionService.getLastError()).toBeNull();
  });

  it("16. heartbeat does not send a local registry store key as store_id", async () => {
    vi.spyOn(storeRegistryService, "getActiveStore").mockReturnValue({
      id: "store_main",
      name: "Main Store",
    } as any);
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValue({
      device_uuid: "uuid-unpaired",
      store_id: "store_main",
    } as any);

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response);

    await deviceSessionService.sendHeartbeat();

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.store_id).toBeUndefined();
  });

  it("17. heartbeat 403 revocation locks and resets the workstation", async () => {
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValueOnce({
      device_uuid: "uuid-test-123",
      store_id: "4",
    } as any);
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        status: "revoked",
        action: "lock_and_reset",
        wipe_on_revocation: true,
      }),
    } as Response);
    const lockSpy = vi.spyOn(storeDeviceService, "lockAndResetWorkstation").mockResolvedValue(undefined);

    const ok = await deviceSessionService.sendHeartbeat();

    expect(ok).toBe(false);
    expect(lockSpy).toHaveBeenCalledWith(true);
  });

  it("18. heartbeat 401 DEVICE_AUTH_FAILED asks the till to revalidate the claim", async () => {
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValueOnce({
      device_uuid: "uuid-test-123",
      store_id: "4",
    } as any);
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: "DEVICE_AUTH_FAILED",
        message: "Device token is unrecognized or expired.",
      }),
    } as Response);
    const validateSpy = vi
      .spyOn(storeDeviceService, "validateDeviceSession")
      .mockResolvedValue({ valid: false, locked: true, reason: "Device token is unrecognized or expired." });

    const ok = await deviceSessionService.sendHeartbeat();

    expect(ok).toBe(false);
    expect(validateSpy).toHaveBeenCalledTimes(1);
  });

  it("19. heartbeat 5xx is a server fault, not a revocation", async () => {
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValueOnce({
      device_uuid: "uuid-test-123",
      store_id: "4",
    } as any);
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ success: false, message: "Upstream unavailable" }),
    } as Response);
    const validateSpy = vi.spyOn(storeDeviceService, "validateDeviceSession");

    const ok = await deviceSessionService.sendHeartbeat();

    expect(ok).toBe(false);
    expect(validateSpy).not.toHaveBeenCalled();
  });
});

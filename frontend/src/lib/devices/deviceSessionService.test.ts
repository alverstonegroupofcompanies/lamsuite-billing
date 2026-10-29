import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { deviceSessionService } from "./deviceSessionService";
import { storeDeviceService } from "../auth/storeDeviceService";

describe("deviceSessionService - Centralized Logged-In Device Tracking", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
          ip_address: "103.24.12.5",
          location: "Kochi, Kerala, IN",
          login_time: "2026-10-29T10:00:00Z",
          last_active: new Date(Date.now() - 30 * 1000).toISOString(),
          status: "Online",
          user_name: "Cashier Reshma",
        },
        {
          id: "2",
          device_uuid: "uuid-102",
          session_id: "sess-102",
          device_name: null,
          counter_name: null,
          counter_code: null,
          ip_address: null,
          location: null,
          login_time: null,
          last_active: new Date(Date.now() - 300 * 1000).toISOString(),
          status: "Offline",
          user_name: null,
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
    expect(dev1.ip_address).toBe("103.24.12.5");
    expect(dev1.location).toBe("Kochi, Kerala, IN");
    expect(dev1.status).toBe("Online");

    const dev2 = devices[1];
    expect(dev2.device_name).toBeNull();
    expect(dev2.counter_name).toBeNull();
    expect(dev2.ip_address).toBeNull();
    expect(dev2.location).toBeNull();
    expect(dev2.status).toBe("Offline");
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
          status: "Online",
        },
      ],
      total: 1,
    };

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    } as Response);

    await deviceSessionService.getLoggedInDevices({ search: "Pharmacy", status: "Online" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("search=Pharmacy");
    expect(calledUrl).toContain("status=Online");
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
    expect(calledUrl).toContain("/api/devices/heartbeat");
  });

  it("4. notifyLogout sends logout payload to /api/devices/logout", async () => {
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
    expect(calledUrl).toContain("/api/devices/logout");
  });

  it("5. expireDeviceSession sends revocation request to /api/devices/sessions/{id}/expire", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: "Device session expired successfully" }),
    } as Response);

    // Mock subsequent refresh call
    vi.spyOn(deviceSessionService, "getLoggedInDevices").mockResolvedValueOnce([]);

    const success = await deviceSessionService.expireDeviceSession("sess-999");
    expect(success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/devices/sessions/sess-999/expire");
  });

  it("6. startHeartbeatTimer runs periodic heartbeat and returns clean cancellation", async () => {
    vi.useFakeTimers();

    const heartbeatSpy = vi.spyOn(deviceSessionService, "sendHeartbeat").mockResolvedValue(true);

    const stop = deviceSessionService.startHeartbeatTimer(5000);

    // Initial immediate invocation
    expect(heartbeatSpy).toHaveBeenCalledTimes(1);

    // Fast-forward 10 seconds (2 intervals)
    vi.advanceTimersByTime(10000);
    expect(heartbeatSpy).toHaveBeenCalledTimes(3);

    // Stop timer
    stop();

    // Fast-forward more time, should not invoke further
    vi.advanceTimersByTime(10000);
    expect(heartbeatSpy).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });
});

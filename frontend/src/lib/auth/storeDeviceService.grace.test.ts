import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { storeDeviceService } from "./storeDeviceService";
import { counterGraceService } from "./counterGraceService";
import { sqliteStorage, getMockDatabase } from "../db/sqliteStorage";
import { resetMockHandlers, invokeCommand } from "../ipc/ipcBridge";

/**
 * CNT-011 at the workstation: the grace the store server granted is what keeps
 * a dark till billing, and the window closing is what stops it. A revoked
 * counter loses its credential on reconnect; a till that simply ran out of time
 * keeps the credential and waits for a connection.
 */

const HOUR = 60 * 60 * 1000;

async function seedCounter(serverCounterId = 11): Promise<void> {
  await invokeCommand("secure_store_set", { key: "device_token", value: "lsd_grace_token" });
  await invokeCommand("secure_store_set", {
    key: "store_device_profile",
    value: JSON.stringify({
      device_id: `cntr_${serverCounterId}`,
      device_uuid: "grace-device-uuid",
      store_id: "1",
      counter_id: `cntr_${serverCounterId}`,
      server_counter_id: serverCounterId,
      counter_code: "C01",
      is_active: true,
    }),
  });
}

/** The answer a live server gives when it shakes hands with this till. */
function handshake(graceHours: number): {
  valid: boolean;
  status: string;
  store_id: string;
  server_time: string;
  offline: { grace_hours: number; last_seen_at: string; grace_until: string };
} {
  const serverNow = Date.now();

  return {
    valid: true,
    status: "active",
    store_id: "1",
    server_time: new Date(serverNow).toISOString(),
    offline: {
      grace_hours: graceHours,
      last_seen_at: new Date(serverNow).toISOString(),
      grace_until: new Date(serverNow + graceHours * HOUR).toISOString(),
    },
  };
}

function json(body: unknown, init: { ok: boolean; status: number }) {
  return { ok: init.ok, status: init.status, json: async () => body } as any;
}

describe("Counter grace clock at the till (CNT-011)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T06:00:00Z"));

    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    storeDeviceService.clearProfileCache();
    await counterGraceService.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps billing while the window the server granted is open", async () => {
    await seedCounter();
    await storeDeviceService.getDeviceProfile();

    // An hour of contact, then the network drops for five of the six granted hours.
    vi.spyOn(global, "fetch").mockResolvedValueOnce(json(handshake(6), { ok: true, status: 200 }));
    expect((await storeDeviceService.validateDeviceSession()).valid).toBe(true);

    vi.advanceTimersByTime(5 * HOUR);
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const check = await storeDeviceService.validateDeviceSession();
    expect(check.valid).toBe(true);
    expect(check.locked).toBeFalsy();
    expect(await invokeCommand("secure_store_get", { key: "device_token" })).toBe("lsd_grace_token");
  });

  it("locks the till when the grace ran out, without touching the credential", async () => {
    await seedCounter();
    await storeDeviceService.getDeviceProfile();

    vi.spyOn(global, "fetch").mockResolvedValueOnce(json(handshake(24), { ok: true, status: 200 }));
    await storeDeviceService.validateDeviceSession();

    // A day and a half dark on a counter the owner gave twenty-four hours to.
    vi.advanceTimersByTime(30 * HOUR);
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const check = await storeDeviceService.validateDeviceSession();
    expect(check.valid).toBe(false);
    expect(check.locked).toBe(true);
    expect(check.reason).toMatch(/offline/i);

    // A spent window is not a revocation: the claim survives, so the next
    // connection puts this counter straight back to work.
    expect(await invokeCommand("secure_store_get", { key: "device_token" })).toBe("lsd_grace_token");
    expect(await invokeCommand("secure_store_get", { key: "store_device_profile" })).toBeTruthy();
  });

  it("starts billing again the moment a connection renews the window", async () => {
    await seedCounter(12);
    await storeDeviceService.getDeviceProfile();

    vi.spyOn(global, "fetch").mockResolvedValueOnce(json(handshake(1), { ok: true, status: 200 }));
    await storeDeviceService.validateDeviceSession();
    vi.advanceTimersByTime(2 * HOUR);

    vi.spyOn(global, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect((await storeDeviceService.validateDeviceSession()).locked).toBe(true);

    // Back online: the twelve hours the server just granted replace the spent one.
    vi.spyOn(global, "fetch").mockResolvedValueOnce(json(handshake(12), { ok: true, status: 200 }));
    const renewed = await storeDeviceService.validateDeviceSession();
    expect(renewed.valid).toBe(true);

    const state = counterGraceService.state("12");
    expect(state.allowed).toBe(true);
    expect(state.grace_hours).toBe(12);
    expect(state.reason).toBe("within_grace");

    const rows = await sqliteStorage.findAll<{ counter_key: string; grace_hours: number }>("counter_grace");
    expect(rows).toHaveLength(1);
    expect(rows[0].counter_key).toBe("12");
  });

  it("wipes the credential and the clock when the counter was revoked", async () => {
    await seedCounter(13);
    await storeDeviceService.getDeviceProfile();

    vi.spyOn(global, "fetch").mockResolvedValueOnce(json(handshake(6), { ok: true, status: 200 }));
    await storeDeviceService.validateDeviceSession();
    expect(counterGraceService.state("13").allowed).toBe(true);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      json(
        {
          valid: false,
          status: "revoked",
          action: "lock_and_reset",
          message: "This counter has been retired by the store owner.",
          reason: "Counter moved to the new shop",
        },
        { ok: false, status: 403 }
      )
    );

    const check = await storeDeviceService.validateDeviceSession();
    expect(check.locked).toBe(true);
    expect(await invokeCommand("secure_store_get", { key: "device_token" })).toBeNull();
    expect(counterGraceService.state("13").reason).toBe("unmeasured");
    expect(await sqliteStorage.findAll("counter_grace")).toEqual([]);
  });

  it("keeps the countdown running through an owner lock that is not a revocation", async () => {
    await seedCounter(14);
    await storeDeviceService.getDeviceProfile();

    vi.spyOn(global, "fetch").mockResolvedValueOnce(json(handshake(6), { ok: true, status: 200 }));
    await storeDeviceService.validateDeviceSession();

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      json(
        {
          valid: false,
          status: "locked",
          action: "counter_locked",
          message: "This counter is locked by the store owner. Connect again once it is unlocked.",
        },
        { ok: false, status: 403 }
      )
    );

    const check = await storeDeviceService.validateDeviceSession();
    expect(check.valid).toBe(false);
    expect(check.locked).toBe(false);
    expect(await invokeCommand("secure_store_get", { key: "device_token" })).toBe("lsd_grace_token");

    // A refusal renews nothing: the window the last clean handshake granted
    // keeps closing, so a counter locked while dark still stops working.
    expect(counterGraceService.state("14").grace_hours).toBe(6);
    vi.advanceTimersByTime(7 * HOUR);
    expect(counterGraceService.state("14").allowed).toBe(false);
  });

  it("starts the clock from the claim that opened the counter", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      json(
        {
          success: true,
          device_token: "lsd_claim_token",
          server_time: new Date().toISOString(),
          offline: {
            grace_hours: 3,
            last_seen_at: new Date().toISOString(),
            grace_until: new Date(Date.now() + 3 * HOUR).toISOString(),
          },
          counter: { id: 15, counter_code: "C01", counter_name: "Shop Counter" },
          store: { id: 1, name: "Grace Store", code: "GR" },
        },
        { ok: true, status: 200 }
      )
    );

    await storeDeviceService.claimCounter("LSC-ABC123");

    const state = counterGraceService.state("15");
    expect(state.allowed).toBe(true);
    expect(state.grace_hours).toBe(3);
    expect(counterGraceService.activeCounterKey()).toBe("15");
  });
});

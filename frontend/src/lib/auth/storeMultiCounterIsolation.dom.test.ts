import { describe, it, expect, beforeEach, vi } from "vitest";
import { storeDeviceService } from "./storeDeviceService";
import { storeRegistryService } from "./storeRegistryService";
import { sqliteStorage, getMockDatabase } from "../db/sqliteStorage";
import { resetMockHandlers, invokeCommand } from "../ipc/ipcBridge";

/**
 * CNT-008 — one workstation, one claimed counter per store.
 *
 * The machine is the same; the tenancy is not. Each store keeps its own token,
 * its own profile and its own local database, and whatever the till last worked
 * must follow the store it is standing in — never the counter it used before.
 */

function claimReply(storeId: number, counterId: number, code: string, name: string, token: string) {
  return {
    success: true,
    device_token: token,
    token_stored_as: "hash_only",
    counter: {
      id: counterId,
      counter_code: code,
      counter_name: name,
      location_name: "Shop floor",
      is_remote: false,
      is_digital_only: false,
    },
    store: { id: storeId, name: `LamStone ${name}`, code: `STORE-${storeId}` },
    message: "Counter activated.",
  };
}

const MAIN = {
  code: "LAM-C01-1111222233334444-AAAA555566667777",
  storeId: 7,
  counterId: 12,
  counterCode: "C01",
  counterName: "Front Counter",
  token: "lsd_claim_token_main_0000000000000001",
};

const NORTH = {
  code: "LAM-C01-9999888877776666-BBBB555566667777",
  storeId: 8,
  counterId: 21,
  counterCode: "C01",
  counterName: "North Counter",
  token: "lsd_claim_token_north_0000000000002",
};

async function claim(spec: typeof MAIN): Promise<void> {
  vi.spyOn(global, "fetch").mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => claimReply(spec.storeId, spec.counterId, spec.counterCode, spec.counterName, spec.token),
  } as unknown as Response);

  await storeDeviceService.claimCounter(spec.code);
}

async function vault(key: string): Promise<string | null> {
  return await invokeCommand<string | null>("secure_store_get", { key });
}

/** The counter rows sitting in one store's own local database. */
async function localCounters(storeId: string): Promise<any[]> {
  await sqliteStorage.switchStore(storeId, `stores/${storeId}/store.sqlite`);
  return await sqliteStorage.findAll<any>("store_counters");
}

describe("One claimed counter per store on one machine (CNT-008)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    const registry = storeRegistryService.getRegistry();
    registry.stores = [];
    registry.active_store_id = null;
    storeDeviceService.clearProfileCache();
    localStorage.clear();
    vi.restoreAllMocks();
    await invokeCommand("secure_store_delete", { key: "device_token" });
    await invokeCommand("secure_store_delete", { key: "store_device_profile" });
  });

  it("keeps a separate credential for the counter it works in each store", async () => {
    await claim(MAIN);
    await claim(NORTH);

    expect(await vault(`store:${MAIN.storeId}:device_token`)).toBe(MAIN.token);
    expect(await vault(`store:${NORTH.storeId}:device_token`)).toBe(NORTH.token);

    // Standing in the store it claimed last.
    expect(await storeDeviceService.getDeviceToken()).toBe(NORTH.token);
    expect((await storeDeviceService.getDeviceProfile())?.counter_name).toBe(NORTH.counterName);

    await storeRegistryService.switchActiveStore(String(MAIN.storeId), true);
    expect(await storeDeviceService.getDeviceToken()).toBe(MAIN.token);
    expect((await storeDeviceService.getDeviceProfile())?.counter_name).toBe(MAIN.counterName);

    await storeRegistryService.switchActiveStore(String(NORTH.storeId), true);
    expect(await storeDeviceService.getDeviceToken()).toBe(NORTH.token);
    expect((await storeDeviceService.getDeviceProfile())?.store_id).toBe(String(NORTH.storeId));
  });

  it("writes each counter into its own store's local database", async () => {
    await claim(MAIN);
    await claim(NORTH);

    const northRows = await localCounters(String(NORTH.storeId));
    expect(northRows.map((r) => r.counter_name)).toEqual([NORTH.counterName]);

    const mainRows = await localCounters(String(MAIN.storeId));
    expect(mainRows.map((r) => r.counter_name)).toEqual([MAIN.counterName]);
    expect(mainRows[0].store_id).toBe(String(MAIN.storeId));
  });

  it("hands the till the next store's counter when it releases the one it was on", async () => {
    await claim(MAIN);
    await claim(NORTH);

    await storeRegistryService.switchActiveStore(String(MAIN.storeId), true);
    await storeRegistryService.disconnectStore(String(MAIN.storeId), true);

    expect(await vault(`store:${MAIN.storeId}:device_token`)).toBeNull();
    expect(await vault("device_token")).toBe(NORTH.token);
    expect((await storeDeviceService.getDeviceProfile())?.counter_name).toBe(NORTH.counterName);
    expect(storeRegistryService.getStores().map((s) => s.id)).toEqual([String(NORTH.storeId)]);
  });

  it("leaves the counter it is working alone when another store disconnects", async () => {
    await claim(MAIN);
    await claim(NORTH);

    await storeRegistryService.switchActiveStore(String(MAIN.storeId), true);
    await storeRegistryService.disconnectStore(String(NORTH.storeId), true);

    expect(await vault("device_token")).toBe(MAIN.token);
    expect((await storeDeviceService.getDeviceProfile())?.counter_name).toBe(MAIN.counterName);
    expect(await vault(`store:${MAIN.storeId}:device_token`)).toBe(MAIN.token);
    expect((await localCounters(String(MAIN.storeId))).map((r) => r.counter_name)).toEqual([MAIN.counterName]);
  });

  it("refuses a second counter in the store this machine already works", async () => {
    await claim(MAIN);

    const twin = { ...MAIN, code: "LAM-C02-4444555566667777-CCCC555566667777", counterId: 13, counterName: "Back Counter" };
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        success: false,
        error: "device_on_another_counter",
        counter_name: MAIN.counterName,
        message: `This workstation already works "${MAIN.counterName}" in this store. Ask the owner to release that counter before claiming another one here.`,
      }),
    } as unknown as Response);

    await expect(storeDeviceService.claimCounter(twin.code)).rejects.toThrow(/already works "Front Counter"/);

    expect(await storeDeviceService.getDeviceToken()).toBe(MAIN.token);
    expect(storeRegistryService.getStores().map((s) => s.id)).toEqual([String(MAIN.storeId)]);
    expect((await localCounters(String(MAIN.storeId))).map((r) => r.counter_name)).toEqual([MAIN.counterName]);
  });

  it("will not register a second counter for the same store on this machine", async () => {
    await claim(MAIN);

    const second = {
      device_id: "cntr_13",
      device_uuid: "dev_7_13",
      device_name: "Back Counter",
      store_id: String(MAIN.storeId),
      store_name: "LamStone Main",
      store_code: "STORE-7",
      counter_id: "cntr_13",
      server_counter_id: 13,
      counter_name: "Back Counter",
      counter_code: "C02",
      is_hub: false,
      license_plan: "Pro",
      license_status: "active" as const,
      license_expires_at: "2027-12-31",
      registered_at: Date.now(),
      is_active: true,
    };

    await expect(
      storeRegistryService.registerStore(second as any, { deviceToken: "tok_second", refreshToken: "" })
    ).rejects.toThrow(/already works/i);

    expect(storeRegistryService.getStores().map((s) => s.counter_name)).toEqual([MAIN.counterName]);
    expect(await vault(`store:${MAIN.storeId}:device_token`)).toBe(MAIN.token);
  });
});

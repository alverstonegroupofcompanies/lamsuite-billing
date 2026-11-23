import { describe, it, expect, beforeEach, vi } from "vitest";
import { storeDeviceService } from "./storeDeviceService";
import { sqliteStorage, getMockDatabase } from "../db/sqliteStorage";
import { resetMockHandlers, invokeCommand } from "../ipc/ipcBridge";
import { getOrCreateClientDeviceUuid } from "./clientDeviceIdentifier";
import { storeRegistryService } from "./storeRegistryService";

/**
 * CNT-006: a code is the whole credential. The till sends the code and this
 * machine's identity, and takes the store, counter and profile from the reply.
 */

const CODE = "LAM-C01-1111222233334444-AAAA555566667777";
const TOKEN = "lsd_claim_token_0f1e2d3c4b5a6978";

const QR = JSON.stringify({
  v: 1,
  kind: "lam_suite_counter_claim",
  code: CODE,
  store_id: 7,
  counter_id: 12,
});

function claimReply() {
  return {
    success: true,
    device_token: TOKEN,
    token_stored_as: "hash_only",
    counter: {
      id: 12,
      counter_code: "C01",
      counter_name: "Front Counter",
      location_name: "Shop floor",
      is_remote: false,
      is_digital_only: false,
      printer_profile: { thermal: "EPSON" },
      receipt_customization: {},
    },
    store: { id: 7, name: "LamStone Pharmacy Main", code: "STORE-07" },
    message: "Counter activated. Keep this token on this machine only.",
  };
}

async function refusal(status: number, message: string, error?: string) {
  return {
    ok: false,
    status,
    json: async () => ({ success: false, error, message }),
  } as unknown as Response;
}

function claimBody(fetchSpy: ReturnType<typeof vi.spyOn>, callIndex = 0): any {
  const call = fetchSpy.mock.calls[callIndex];
  return JSON.parse(String((call[1] as any).body));
}

describe("Counter claim path (CNT-006, CNT-013)", () => {
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

  it("sends exactly the code and this machine's identity", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => claimReply(),
    } as unknown as Response);

    await storeDeviceService.claimCounter(CODE);

    const call = fetchSpy.mock.calls[0];
    expect(String(call[0])).toContain("/api/counters/claim");

    const body = claimBody(fetchSpy);
    expect(body.code).toBe(CODE);
    expect(body.device_uuid).toBe(getOrCreateClientDeviceUuid());
    // IS2: the store is read off the code, never off the request.
    expect(body).not.toHaveProperty("store_id");
    expect(body).not.toHaveProperty("activation_key");
    expect(body).not.toHaveProperty("counter_name");
    expect(body).not.toHaveProperty("is_hub");
  });

  it("scans a QR payload to the same claim as typing its code", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => claimReply(),
    } as unknown as Response);

    await storeDeviceService.claimCounter(`  ${QR}  `);

    expect(claimBody(fetchSpy).code).toBe(CODE);
  });

  it("keeps the code, the identity and the retry on one stable device uuid", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(await refusal(422, "That activation code is not valid here."))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => claimReply(),
      } as unknown as Response);

    await expect(storeDeviceService.claimCounter(CODE)).rejects.toThrow("not valid here");
    const failedUuid = claimBody(fetchSpy).device_uuid;

    await storeDeviceService.claimCounter(CODE);

    expect(claimBody(fetchSpy, 1).device_uuid).toBe(failedUuid);
  });

  it("vaults the token and names the counter the server answered with", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => claimReply(),
    } as unknown as Response);

    const profile = await storeDeviceService.claimCounter(CODE);

    expect(profile.store_id).toBe("7");
    expect(profile.store_name).toBe("LamStone Pharmacy Main");
    expect(profile.counter_name).toBe("Front Counter");
    expect(profile.counter_code).toBe("C01");
    expect(profile.is_active).toBe(true);

    expect(await invokeCommand("secure_store_get", { key: "device_token" })).toBe(TOKEN);

    const storedProfile = await invokeCommand<string>("secure_store_get", { key: "store_device_profile" });
    expect(JSON.parse(storedProfile).counter_id).toBe(profile.counter_id);

    // CNT-006: the token lives in the credential store, not in browser storage.
    expect(JSON.stringify(localStorage)).not.toContain(TOKEN);

    const counters = await sqliteStorage.findAll<any>("store_counters");
    expect(counters).toHaveLength(1);
    expect(counters[0].counter_code).toBe("C01");
    expect(counters[0].store_id).toBe("7");

    expect(await storeDeviceService.isDeviceRegistered()).toBe(true);
  });

  it("refuses a bad code without leaving any trace of an identity", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      await refusal(422, "That activation code is not valid here. Ask the store owner for a current counter code.")
    );

    await expect(storeDeviceService.claimCounter("LAM-C01-DEAD-BEEF")).rejects.toThrow(/not valid here/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect(await invokeCommand("secure_store_get", { key: "device_token" })).toBeNull();
    expect(await invokeCommand("secure_store_get", { key: "store_device_profile" })).toBeNull();
    expect(await sqliteStorage.findAll<any>("store_counters")).toHaveLength(0);
    expect(await storeDeviceService.isDeviceRegistered()).toBe(false);
  });

  it("says plainly when the counter is already on another workstation", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      await refusal(409, "This counter is already in use on another workstation.", "counter_already_claimed")
    );

    await expect(storeDeviceService.claimCounter(CODE)).rejects.toThrow(/already in use/);
    expect(await invokeCommand("secure_store_get", { key: "device_token" })).toBeNull();
  });

  it("surfaces the lockout instead of letting the till keep guessing", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      await refusal(429, "Too many failed activation attempts. Counter enrolment is locked for a few minutes.", "claim_locked")
    );

    await expect(storeDeviceService.claimCounter(CODE)).rejects.toThrow(/Too many failed/);
    expect(await sqliteStorage.findAll<any>("store_counters")).toHaveLength(0);
  });

  it("never fabricates a counter when the server cannot be reached", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(storeDeviceService.claimCounter(CODE)).rejects.toThrow(/reach/i);
    expect(await invokeCommand("secure_store_get", { key: "device_token" })).toBeNull();
    expect(await storeDeviceService.isDeviceRegistered()).toBe(false);
  });

  it("refuses an empty or QR-less input before spending a request", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    await expect(storeDeviceService.claimCounter("   ")).rejects.toThrow(/code/i);
    await expect(storeDeviceService.claimCounter('{"v":1,"kind":"other"}')).rejects.toThrow(/code/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { syncQueueService, type SyncQueueItem } from "./syncQueueService";
import { DeviceAuthError } from "../auth/deviceAuthFailure";
import { storeDeviceService } from "../auth/storeDeviceService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { invokeCommand, resetMockHandlers } from "../ipc/ipcBridge";

/**
 * SYNC-02 / CR Q1 — a till the owner re-issued while it was offline keeps the
 * bills it sold before then, and sends them to the owner through the one door
 * the server keeps open for a retired workstation.
 */

const STRANDED_URL = "/api/sync/push/stranded";

async function seedClaimedTill(): Promise<void> {
  await invokeCommand("secure_store_set", { key: "device_token", value: "lsd_c02_old_token" });
  await invokeCommand("secure_store_set", {
    key: "store_device_profile",
    value: JSON.stringify({
      device_id: "cntr_5",
      device_uuid: "uuid-c02",
      store_id: "5",
      counter_id: "5",
      counter_code: "C02",
      is_active: true,
    }),
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function pauseQueue(): Promise<void> {
  await syncQueueService.processQueue({
    pushBatch: async () => {
      throw new DeviceAuthError(401, "DEVICE_AUTH_FAILED", "Device token is unrecognized or expired.");
    },
  });
}

async function queueRows(): Promise<SyncQueueItem[]> {
  return sqliteStorage.findAll<SyncQueueItem>("sync_queue");
}

describe("Stranded offline bills on a retired till (SYNC-02)", () => {
  let now = 1_795_277_840_000;

  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    localStorage.clear();
    storeDeviceService.clearProfileCache();
    syncQueueService.resumeAfterClaim();
    vi.spyOn(syncQueueService, "isOnline").mockReturnValue(false);
    vi.spyOn(Date, "now").mockImplementation(() => now);
    // The authority that decides revocation; here it has already locked the till.
    vi.spyOn(storeDeviceService, "validateDeviceSession").mockResolvedValue({ valid: false, locked: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the old credential aside when a till is reset with bills still unsent", async () => {
    await seedClaimedTill();
    await syncQueueService.enqueue("invoice", "inv_1052", "create", { invoice_number: "C02-INV-1052" });

    await storeDeviceService.lockAndResetWorkstation(false);

    expect(await invokeCommand("secure_store_get", { key: "device_token" })).toBeNull();
    expect(await invokeCommand("secure_store_get", { key: "retired_device_token" })).toBe("lsd_c02_old_token");
    expect(localStorage.getItem("lamsuite_vault_retired_device_token")).toBeNull();
    expect(await queueRows()).toHaveLength(1);
  });

  it("keeps nothing when no bill is waiting", async () => {
    await seedClaimedTill();

    await storeDeviceService.lockAndResetWorkstation(false);

    expect(await invokeCommand("secure_store_get", { key: "retired_device_token" })).toBeNull();
  });

  it("sends the waiting bills to the owner, in the order they were saved, and then forgets the credential", async () => {
    await seedClaimedTill();
    for (const n of [1, 2, 3]) {
      await sqliteStorage.insertRecord("invoices", `inv_${n}`, {
        id: `inv_${n}`,
        invoice_number: `C02-INV-105${n}`,
        sync_state: "pending",
      });
      now += 1000;
      await syncQueueService.enqueue("invoice", `inv_${n}`, "create", { invoice_number: `C02-INV-105${n}` });
    }
    await storeDeviceService.lockAndResetWorkstation(false);

    const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push({ url: String(url), headers: init.headers as Record<string, string>, body });
        return json({
          success: true,
          results: { total: body.items.length, processed: body.items.length, failed: 0, errors: [] },
        });
      })
    );

    await pauseQueue();

    const stranded = calls.filter((call) => call.url.endsWith(STRANDED_URL));
    expect(stranded).toHaveLength(1);
    expect(stranded[0].headers["X-Device-Token"]).toBe("lsd_c02_old_token");
    expect(stranded[0].body.items.map((item: any) => item.payload.invoice_number)).toEqual([
      "C02-INV-1051",
      "C02-INV-1052",
      "C02-INV-1053",
    ]);

    expect((await queueRows()).every((row) => row.status === "synced")).toBe(true);
    const sent = await sqliteStorage.findById<{ sync_state: string }>("invoices", "inv_1");
    expect(sent?.sync_state).toBe("synced");
    expect(await invokeCommand("secure_store_get", { key: "retired_device_token" })).toBeNull();
  });

  it("keeps a bill the server refused on the till, with the reason, and does not resend it", async () => {
    await seedClaimedTill();
    const keptId = await syncQueueService.enqueue("invoice", "inv_ok", "create", { invoice_number: "C02-INV-1051" });
    now += 1000;
    const refusedId = await syncQueueService.enqueue("invoice", "inv_late", "create", { invoice_number: "C02-INV-1052" });
    await storeDeviceService.lockAndResetWorkstation(false);

    let strandedCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        strandedCalls++;
        const body = JSON.parse(String(init.body));
        return json({
          success: false,
          results: {
            total: body.items.length,
            processed: body.items.length - 1,
            failed: 1,
            errors: [{ id: refusedId, entity_type: "invoice", error: "Saved after this workstation was retired." }],
          },
        });
      })
    );

    await pauseQueue();

    const kept = await sqliteStorage.findById<SyncQueueItem>("sync_queue", keptId);
    const refused = await sqliteStorage.findById<SyncQueueItem & { stranded_refused?: boolean }>("sync_queue", refusedId);
    expect(kept?.status).toBe("synced");
    expect(refused?.status).not.toBe("synced");
    expect(refused?.last_error).toContain("retired");
    expect(refused?.stranded_refused).toBe(true);

    // Nothing left that the door would take: no more calls.
    await syncQueueService.processQueue();
    expect(strandedCalls).toBe(1);
  });

  it("drops the old credential once the door is closed, and keeps every bill", async () => {
    await seedClaimedTill();
    await syncQueueService.enqueue("invoice", "inv_1052", "create", { invoice_number: "C02-INV-1052" });
    await storeDeviceService.lockAndResetWorkstation(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ success: false, error: "DEVICE_AUTH_FAILED", message: "Retired too long ago." }, 401))
    );

    await pauseQueue();

    expect(await invokeCommand("secure_store_get", { key: "retired_device_token" })).toBeNull();
    const [row] = await queueRows();
    expect(row.status).not.toBe("synced");
  });

  it("tries again later when the network is down", async () => {
    await seedClaimedTill();
    await syncQueueService.enqueue("invoice", "inv_1052", "create", { invoice_number: "C02-INV-1052" });
    await storeDeviceService.lockAndResetWorkstation(false);

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    await pauseQueue();

    expect(await invokeCommand("secure_store_get", { key: "retired_device_token" })).toBe("lsd_c02_old_token");
    const [row] = await queueRows();
    expect(row.status).not.toBe("synced");
  });
});

describe("Bills an older build marked sent without the server taking them (SYNC-01)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    syncQueueService.resumeAfterClaim();
    vi.spyOn(syncQueueService, "isOnline").mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seedOrphan(): Promise<void> {
    await sqliteStorage.insertRecord("invoices", "inv_lost", {
      id: "inv_lost",
      invoice_number: "C01-INV-11002",
      sync_state: "pending",
    });
    await sqliteStorage.insertRecord("sync_queue", "sync_old", {
      id: "sync_old",
      entity_type: "invoice",
      entity_id: "inv_lost",
      action: "create",
      payload_json: JSON.stringify({ invoice_number: "C01-INV-11002", external_id: "ext_lost" }),
      status: "synced",
      retry_count: 0,
      created_at: 1_700_000_000_000,
    });
    // A bill the server really took is not touched.
    await sqliteStorage.insertRecord("invoices", "inv_fine", {
      id: "inv_fine",
      invoice_number: "C01-INV-11001",
      sync_state: "synced",
    });
  }

  it("counts them on a dry run and changes nothing", async () => {
    await seedOrphan();

    const report = await syncQueueService.requeueOrphanedDocuments({ dryRun: true });

    expect(report.found).toEqual(["inv_lost"]);
    expect(report.requeued).toBe(0);
    expect(await syncQueueService.getUnsentCount()).toBe(0);
  });

  it("queues them again with the payload and save time they had", async () => {
    await seedOrphan();

    const report = await syncQueueService.requeueOrphanedDocuments({ dryRun: false });
    expect(report.requeued).toBe(1);

    const pending = await syncQueueService.getPendingItems();
    expect(pending).toHaveLength(1);
    expect(pending[0].entity_id).toBe("inv_lost");
    expect(pending[0].created_at).toBe(1_700_000_000_000);
    expect(JSON.parse(pending[0].payload_json).external_id).toBe("ext_lost");

    // Running it twice does not queue the bill twice.
    await syncQueueService.requeueOrphanedDocuments({ dryRun: false });
    expect(await syncQueueService.getPendingItems()).toHaveLength(1);
  });
});

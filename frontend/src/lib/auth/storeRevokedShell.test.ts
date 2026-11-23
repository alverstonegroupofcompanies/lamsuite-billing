import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { storeRegistryService, type RegisteredStoreRecord } from "./storeRegistryService";
import { storeDeviceService } from "./storeDeviceService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { resetMockHandlers } from "../ipc/ipcBridge";

/**
 * SYNC-02 at the shell: a till retired by its owner must not be brought back
 * by the store's own licence check. The store is still active, but this
 * machine no longer holds one of its counters; only a fresh claim reopens it.
 * QA saw the shell return within seconds because the 4-second health check
 * copied the store's "active" licence back onto the retired record.
 */

const record: RegisteredStoreRecord = {
  id: "5",
  name: "QA Glow Cosmetics",
  alias: "QA-CS",
  code: "QA-CS",
  color: "#059669",
  color_badge: "emerald",
  db_path: "stores/5/store.sqlite",
  counter_id: "5",
  counter_name: "Second Counter",
  counter_code: "C02",
  is_hub: false,
  registered_at: 1,
  last_opened_at: 1,
  last_sync_at: 1,
  pending_sync_count: 0,
  sync_status: "synced",
  is_active: true,
  license_status: "active",
};

describe("A retired till stays retired (SYNC-02)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    storeDeviceService.clearProfileCache();
    (storeRegistryService as any).registry = {
      stores: [{ ...record }],
      active_store_id: record.id,
      auto_open_last: true,
    };
    (storeRegistryService as any).isLoaded = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks the store record revoked when the workstation is reset", async () => {
    await storeDeviceService.lockAndResetWorkstation(false);

    const [store] = (storeRegistryService as any).registry.stores as RegisteredStoreRecord[];
    expect(store.is_active).toBe(false);
    expect(store.sync_status).toBe("revoked");
  });

  it("is not reopened by the store's licence answering 'active'", async () => {
    await storeDeviceService.lockAndResetWorkstation(false);

    await storeRegistryService.setStoreActiveStatus("5", true);

    const [store] = (storeRegistryService as any).registry.stores as RegisteredStoreRecord[];
    expect(store.is_active).toBe(false);
    expect(store.sync_status).toBe("revoked");
  });

  it("still follows the store's licence while the counter is held", async () => {
    await storeRegistryService.setStoreActiveStatus("5", false, "Suspended");
    await storeRegistryService.setStoreActiveStatus("5", true);

    const [store] = (storeRegistryService as any).registry.stores as RegisteredStoreRecord[];
    expect(store.is_active).toBe(true);
    expect(store.sync_status).toBe("synced");
  });
});

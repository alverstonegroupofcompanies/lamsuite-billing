import { describe, it, expect, beforeEach, vi } from "vitest";
import { storeRegistryService, STORE_PRESET_COLORS } from "./storeRegistryService";
import { storeDeviceService, type StoreDeviceProfile } from "./storeDeviceService";
import { staffAuthService } from "./staffAuthService";
import { posCartService } from "../billing/posCartService";
import { staffCryptoService } from "./staffCryptoService";
import { sqliteStorage } from "../db/sqliteStorage";

describe("IAM Complete Architecture: Multi-Store Switcher & Offline Auth", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    posCartService.clearCart();
    storeDeviceService.clearProfileCache();

    // Reset local store registry with 2 clean stores
    const dummyStore1: StoreDeviceProfile = {
      device_id: "cntr_main_01",
      device_uuid: "uuid-pc-01",
      device_name: "Counter 01",
      store_id: "store_palakkad",
      store_name: "LamStone Pharmacy (Palakkad)",
      store_code: "PLK-01",
      counter_id: "cntr_main_01",
      counter_name: "Counter 01",
      counter_code: "C01",
      is_hub: true,
      license_plan: "Pro",
      license_status: "active",
      license_expires_at: "2027-12-31",
      registered_at: Date.now(),
      is_active: true,
    };

    const dummyStore2: StoreDeviceProfile = {
      device_id: "cntr_calicut_01",
      device_uuid: "uuid-pc-01",
      device_name: "Counter Calicut",
      store_id: "store_calicut",
      store_name: "LamStone Distribution (Calicut)",
      store_code: "CLT-02",
      counter_id: "cntr_calicut_01",
      counter_name: "Counter 01",
      counter_code: "C01",
      is_hub: false,
      license_plan: "Pro",
      license_status: "active",
      license_expires_at: "2027-12-31",
      registered_at: Date.now(),
      is_active: true,
    };

    (storeRegistryService as any).registry = {
      stores: [],
      active_store_id: null,
      auto_open_last: true,
    };

    await storeRegistryService.registerStore(dummyStore1, {
      deviceToken: "token_palakkad",
      refreshToken: "ref_palakkad",
    });

    await storeRegistryService.registerStore(dummyStore2, {
      deviceToken: "token_calicut",
      refreshToken: "ref_calicut",
    });
  });

  it("maintains isolated registry records and assigns distinct preset colors", () => {
    const stores = storeRegistryService.getStores();
    expect(stores.length).toBe(2);

    const s1 = stores.find((s) => s.id === "store_palakkad");
    const s2 = stores.find((s) => s.id === "store_calicut");

    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    expect(s1?.color).not.toBe(s2?.color);
    expect(s1?.db_path).toBe("stores/store_palakkad/store.sqlite");
    expect(s2?.db_path).toBe("stores/store_calicut/store.sqlite");
  });

  it("switches active store in <1s and points local storage to isolated partition", async () => {
    const startTime = performance.now();
    const switched = await storeRegistryService.switchActiveStore("store_calicut");
    const duration = performance.now() - startTime;

    expect(duration).toBeLessThan(1000);
    expect(switched.id).toBe("store_calicut");
    expect(storeRegistryService.getActiveStore()?.id).toBe("store_calicut");

    // Profile in memory is updated to target store
    const activeProfile = await storeDeviceService.getDeviceProfile();
    expect(activeProfile?.store_id).toBe("store_calicut");
    expect(activeProfile?.store_code).toBe("CLT-02");
  });

  it("blocks store switching when billing cart has unsaved items", async () => {
    await storeRegistryService.switchActiveStore("store_palakkad", true);

    // Add item to cart
    posCartService.addItem(
      { id: "prod_1", name: "Amoxicillin 500mg", mrp: 120, sel_rate: 100, gst_percent: 12 } as any,
      { id: "b_1", batch_no: "AMX-001", expiry_date: "2027-12-31", selling_rate: 100, mrp: 120 } as any,
      2
    );

    expect(posCartService.hasUnsavedItems()).toBe(true);

    // Attempting to switch without force throws UNSAVED_CART_ITEMS
    await expect(storeRegistryService.switchActiveStore("store_calicut")).rejects.toThrow("UNSAVED_CART_ITEMS");

    // Switching with force=true succeeds
    const forced = await storeRegistryService.switchActiveStore("store_calicut", true);
    expect(forced.id).toBe("store_calicut");
  });

  it("authenticates staff member with salted PIN hash locally during offline fallback", async () => {
    const activeStore = "store_palakkad";
    await storeRegistryService.switchActiveStore(activeStore, true);

    const pin = "7890";
    const pinHash = await staffCryptoService.hashPin(pin);
    const userId = "usr_tester_offline";

    await sqliteStorage.insertRecord("staff_users", userId, {
      id: userId,
      store_id: activeStore,
      username: "tester_offline",
      full_name: "Offline Operator",
      role: "cashier",
      password_hash: "mock_hash",
      pin_hash: pinHash,
      is_active: 1,
      must_change_password: 0,
      biometric_registered: 0,
      failed_attempts: 0,
      locked_until: null,
      permissions_json: JSON.stringify(["pos.bill"]),
      enabled_menus_json: JSON.stringify(["pos"]),
      updated_at: Date.now(),
    });

    // Valid PIN succeeds
    const res = await staffAuthService.authenticateWithPin("tester_offline", pin);
    expect(res.success).toBe(true);
    expect(res.user?.username).toBe("tester_offline");

    const session = staffAuthService.getCurrentSession();
    expect(session).not.toBeNull();
    expect(session?.user.username).toBe("tester_offline");

    // Invalid PIN fails and records attempt
    const failRes = await staffAuthService.authenticateWithPin("tester_offline", "0000");
    expect(failRes.success).toBe(false);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { storeRegistryService, type RegisteredStoreRecord } from "./storeRegistryService";
import { sqliteStorage } from "../db/sqliteStorage";
import { resetMockHandlers } from "../ipc/ipcBridge";
import { posCartService } from "../billing/posCartService";
import type { StoreDeviceProfile } from "./storeDeviceService";

describe("Tally-Style Multi-Store Workspace & Registry", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.clear();
    }
    // Reset registry in-memory
    const reg = storeRegistryService.getRegistry();
    reg.stores = [];
    reg.active_store_id = null;
    reg.auto_open_last = true;
    posCartService.clearCart();
  });

  it("1. Migrates legacy single-store setup without losing configuration", async () => {
    const legacyProfile: StoreDeviceProfile = {
      device_id: "cntr_legacy_01",
      device_uuid: "dev_uuid_12345",
      device_name: "Counter 01",
      store_id: "store_main",
      store_name: "LamStone Pharmacy & Clinic (Main Store)",
      store_code: "MAIN",
      counter_id: "cntr_legacy_01",
      counter_name: "Counter 01",
      counter_code: "C01",
      is_hub: true,
      license_plan: "Enterprise",
      license_status: "active",
      license_expires_at: "2027-12-31",
      registered_at: 1700000000000,
      is_active: true,
    };

    // Simulate existing legacy vault
    const { invokeCommand } = await import("../ipc/ipcBridge");
    await invokeCommand("secure_store_set", {
      key: "store_device_profile",
      value: JSON.stringify(legacyProfile),
    });
    await invokeCommand("secure_store_set", {
      key: "device_token",
      value: "jwt_legacy_token_999",
    });

    const registry = await storeRegistryService.loadRegistry();
    expect(registry.stores.length).toBe(1);
    expect(registry.active_store_id).toBe("store_main");
    expect(registry.stores[0].name).toContain("LamStone Pharmacy & Clinic");
    expect(registry.stores[0].alias).toBe("Main Store");

    // Check migrated scoped secure store token
    const migratedToken = await invokeCommand<string>("secure_store_get", {
      key: "store:store_main:device_token",
    });
    expect(migratedToken).toBe("jwt_legacy_token_999");
  });

  it("2. Prevents duplicate registration of the same store and counter", async () => {
    const profile: StoreDeviceProfile = {
      device_id: "cntr_main_01",
      device_uuid: "uuid_1",
      device_name: "Counter 01",
      store_id: "store_main",
      store_name: "LamStone Main Branch",
      store_code: "MAIN",
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

    await storeRegistryService.registerStore(profile, {
      deviceToken: "tok_1",
      refreshToken: "ref_1",
    });

    // Attempt registering same store + counter again
    await expect(
      storeRegistryService.registerStore(profile, {
        deviceToken: "tok_dup",
        refreshToken: "ref_dup",
      })
    ).rejects.toThrow(/already registered on this terminal/);
  });

  it("3. Guarantees complete data isolation when billing across stores in turn", async () => {
    // Register Store A
    const storeAProfile: StoreDeviceProfile = {
      device_id: "cntr_a_01",
      device_uuid: "uuid_a",
      device_name: "Counter 01",
      store_id: "store_alpha",
      store_name: "Store Alpha (Downtown)",
      store_code: "ALPHA",
      counter_id: "cntr_a_01",
      counter_name: "Counter 01",
      counter_code: "C01",
      is_hub: true,
      license_plan: "Pro",
      license_status: "active",
      license_expires_at: "2027-12-31",
      registered_at: Date.now(),
      is_active: true,
    };

    // Register Store B
    const storeBProfile: StoreDeviceProfile = {
      device_id: "cntr_b_01",
      device_uuid: "uuid_b",
      device_name: "Counter 01",
      store_id: "store_beta",
      store_name: "Store Beta (Uptown)",
      store_code: "BETA",
      counter_id: "cntr_b_01",
      counter_name: "Counter 01",
      counter_code: "C01",
      is_hub: true,
      license_plan: "Pro",
      license_status: "active",
      license_expires_at: "2027-12-31",
      registered_at: Date.now(),
      is_active: true,
    };

    await storeRegistryService.registerStore(storeAProfile, { deviceToken: "tok_a", refreshToken: "ref_a" });
    await storeRegistryService.registerStore(storeBProfile, { deviceToken: "tok_b", refreshToken: "ref_b" });

    // Switch to Store Alpha and bill an invoice
    await storeRegistryService.switchActiveStore("store_alpha");
    await sqliteStorage.insertRecord("invoices", "INV-ALPHA-001", {
      id: "INV-ALPHA-001",
      invoice_number: "INV-ALPHA-001",
      grand_total: 450,
      customer_name: "Customer Alpha",
    });

    const alphaInvoices = await sqliteStorage.findAll<any>("invoices");
    expect(alphaInvoices.length).toBe(1);
    expect(alphaInvoices[0].invoice_number).toBe("INV-ALPHA-001");

    // Switch to Store Beta
    await storeRegistryService.switchActiveStore("store_beta");
    const betaInvoicesInitial = await sqliteStorage.findAll<any>("invoices");
    // Store Beta must have 0 invoices (no data crossover from Store Alpha)
    expect(betaInvoicesInitial.length).toBe(0);

    // Bill an invoice in Store Beta
    await sqliteStorage.insertRecord("invoices", "INV-BETA-001", {
      id: "INV-BETA-001",
      invoice_number: "INV-BETA-001",
      grand_total: 980,
      customer_name: "Customer Beta",
    });

    const betaInvoicesAfter = await sqliteStorage.findAll<any>("invoices");
    expect(betaInvoicesAfter.length).toBe(1);
    expect(betaInvoicesAfter[0].invoice_number).toBe("INV-BETA-001");

    // Switch back to Store Alpha
    await storeRegistryService.switchActiveStore("store_alpha");
    const alphaInvoicesReloaded = await sqliteStorage.findAll<any>("invoices");
    expect(alphaInvoicesReloaded.length).toBe(1);
    expect(alphaInvoicesReloaded[0].invoice_number).toBe("INV-ALPHA-001");
  });

  it("4. Guards against switching stores when an unsaved cart has items", async () => {
    const storeProfile: StoreDeviceProfile = {
      device_id: "cntr_g_01",
      device_uuid: "uuid_g",
      device_name: "Counter 01",
      store_id: "store_guard_1",
      store_name: "Store Guard 1",
      store_code: "SG1",
      counter_id: "cntr_g_01",
      counter_name: "Counter 01",
      counter_code: "C01",
      is_hub: true,
      license_plan: "Pro",
      license_status: "active",
      license_expires_at: "2027-12-31",
      registered_at: Date.now(),
      is_active: true,
    };
    const storeProfile2: StoreDeviceProfile = {
      ...storeProfile,
      device_id: "cntr_g_02",
      store_id: "store_guard_2",
      store_name: "Store Guard 2",
      store_code: "SG2",
    };

    await storeRegistryService.registerStore(storeProfile, { deviceToken: "tok_g1", refreshToken: "ref_g1" });
    await storeRegistryService.registerStore(storeProfile2, { deviceToken: "tok_g2", refreshToken: "ref_g2" });

    // Set active store to store_guard_1
    await storeRegistryService.switchActiveStore("store_guard_1", true);

    // Put item in cart
    posCartService.addItem(
      {
        id: "prod_1",
        barcode: "123456",
        name: "Test Medicine",
        mrp: 100,
        sel_rate: 90,
        gst_percent: 12,
        units_per_pack: 10,
        current_stock: 50,
        is_active: true,
      },
      {
        id: "b_1",
        product_id: "prod_1",
        batch_no: "BATCH01",
        expiry_date: "2028-12-31",
        stock_qty: 50,
        mrp: 100,
        selling_rate: 90,
      },
      1
    );

    expect(posCartService.hasUnsavedItems()).toBe(true);

    // Attempting normal switch without force must throw UNSAVED_CART_ITEMS
    await expect(storeRegistryService.switchActiveStore("store_guard_2")).rejects.toThrow(
      "UNSAVED_CART_ITEMS"
    );

    // Switching with force=true should succeed and reset cart
    await storeRegistryService.switchActiveStore("store_guard_2", true);
    expect(storeRegistryService.getActiveStore()?.id).toBe("store_guard_2");
    expect(posCartService.hasUnsavedItems()).toBe(false);
  });

  it("5. Supports renaming/alias, color badge updating and disconnecting a store", async () => {
    const profile: StoreDeviceProfile = {
      device_id: "cntr_edit_01",
      device_uuid: "uuid_e",
      device_name: "Counter 01",
      store_id: "store_edit",
      store_name: "LamStone Wholesale Hub",
      store_code: "HUB",
      counter_id: "cntr_edit_01",
      counter_name: "Counter 01",
      counter_code: "C01",
      is_hub: true,
      license_plan: "Pro",
      license_status: "active",
      license_expires_at: "2027-12-31",
      registered_at: Date.now(),
      is_active: true,
    };

    await storeRegistryService.registerStore(profile, { deviceToken: "tok_e", refreshToken: "ref_e" });

    // Update alias and color
    await storeRegistryService.updateStoreMeta("store_edit", {
      alias: "Central Logistics Express",
      color_badge: "purple",
    });

    const store = storeRegistryService.getStores().find((s) => s.id === "store_edit");
    expect(store?.alias).toBe("Central Logistics Express");
    expect(store?.color_badge).toBe("purple");
    expect(store?.color).toBe("#7c3aed");

    // Disconnect store
    await storeRegistryService.disconnectStore("store_edit", true);
    expect(storeRegistryService.getStores().some((s) => s.id === "store_edit")).toBe(false);
  });
});

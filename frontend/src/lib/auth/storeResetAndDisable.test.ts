import { describe, it, expect, beforeEach, vi } from "vitest";
import { storeRegistryService, type RegisteredStoreRecord } from "./storeRegistryService";
import { sqliteStorage } from "../db/sqliteStorage";
import { posCartService } from "../billing/posCartService";
import { onlineTransactionService } from "../sync/onlineTransactionService";
import { companySettingsService } from "../settings/companySettingsService";

describe("Store Reset and Store Disabled Protection", () => {
  const dummyStore: RegisteredStoreRecord = {
    id: "store_test_reset",
    name: "Test Reset & Disable Store",
    alias: "Test Store",
    code: "TEST-RST",
    color: "#059669",
    color_badge: "emerald",
    db_path: "stores/store_test_reset/store.sqlite",
    counter_id: "cnt_rst_01",
    counter_name: "Counter 01",
    counter_code: "C01",
    is_hub: false,
    registered_at: Date.now(),
    last_opened_at: Date.now(),
    last_sync_at: Date.now(),
    pending_sync_count: 0,
    sync_status: "synced",
    is_active: true,
    license_status: "active",
  };

  beforeEach(async () => {
    (storeRegistryService as any).registry = {
      stores: [{ ...dummyStore }],
      active_store_id: dummyStore.id,
      auto_open_last: true,
    };
    (storeRegistryService as any).isLoaded = true;

    // Seed test product
    await sqliteStorage.insertRecord("products", "prod_1", {
      id: "prod_1",
      name: "Paracetamol 500mg",
      mrp: 50,
      sel_rate: 45,
      gst_percent: 12,
      is_active: true,
    });

    // Seed test batch
    await sqliteStorage.insertRecord("product_batches", "batch_1", {
      id: "batch_1",
      product_id: "prod_1",
      batch_no: "BATCH-01",
      stock_qty: 100,
      expiry_date: "2028-12-31",
      mrp: 50,
      selling_rate: 45,
    });

    posCartService.clearCart();
    await sqliteStorage.clearTable("invoices").catch(() => {});
    await sqliteStorage.clearTable("invoice_items").catch(() => {});
    await sqliteStorage.clearTable("sync_queue").catch(() => {});
  });

  it("1. Blocks billing when store is disabled in registry", async () => {
    // Disable store
    await storeRegistryService.setStoreActiveStatus(dummyStore.id, false, "Disabled by admin");
    expect(storeRegistryService.getActiveStore()?.is_active).toBe(false);

    // Try to finalize invoice in posCartService
    posCartService.addItem(
      {
        id: "prod_1",
        name: "Paracetamol 500mg",
        mrp: 50,
        sel_rate: 45,
        gst_percent: 12,
        is_active: true,
      } as any,
      {
        id: "batch_1",
        product_id: "prod_1",
        batch_no: "BATCH-01",
        stock_qty: 100,
        expiry_date: "2028-12-31",
        selling_rate: 45,
        mrp: 50,
      } as any,
      2
    );

    await expect(posCartService.finalizeInvoice("INV-TEST-01")).rejects.toThrow(
      /Cannot finalize invoice: Store is disabled by administration/
    );

    // Try to submit authoritative online invoice
    await expect(
      onlineTransactionService.submitAuthoritativeInvoice({
        store_id: dummyStore.id,
        items: [
          {
            product_id: "prod_1",
            qty: 1,
            unit_price: 45,
          },
        ],
      })
    ).rejects.toThrow(/Store is currently disabled by Admin/);
  });

  it("2. Wipes local transactional data on store reset while preserving catalog", async () => {
    // Insert some invoices, purchases, and stock transactions
    await sqliteStorage.insertRecord("invoices", "inv_1", {
      id: "inv_1",
      invoice_number: "INV-1001",
      grand_total: 100,
    });
    await sqliteStorage.insertRecord("invoice_items", "item_1", {
      id: "item_1",
      invoice_id: "inv_1",
      product_name: "Paracetamol",
    });
    await sqliteStorage.insertRecord("sync_queue", "sq_1", {
      id: "sq_1",
      entity_type: "invoice",
      action: "create",
    });

    // Verify records exist before reset
    const invsBefore = await sqliteStorage.findAll("invoices");
    expect(invsBefore.length).toBeGreaterThan(0);

    // Trigger store reset wipe (stub network so the settings re-push does not
    // enqueue a sync item in this offline-agnostic test)
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    try {
      await storeRegistryService.wipeStoreTransactionalData(dummyStore.id);
    } finally {
      fetchSpy.mockRestore();
    }

    // Verify transactional data was wiped
    const invsAfter = await sqliteStorage.findAll("invoices");
    expect(invsAfter.length).toBe(0);

    const itemsAfter = await sqliteStorage.findAll("invoice_items");
    expect(itemsAfter.length).toBe(0);

    const queueAfter = await sqliteStorage.findAll("sync_queue");
    expect(queueAfter.length).toBe(0);

    // Verify master catalog is preserved!
    const prods = await sqliteStorage.findAll("products");
    expect(prods.length).toBeGreaterThan(0);
  });

  it("3. Wipes products and batches when reset_products is enabled", async () => {
    // Seed test product & batch
    await sqliteStorage.insertRecord("products", "prod_del_1", {
      id: "prod_del_1",
      name: "Amox 250mg",
      is_active: true,
    });
    await sqliteStorage.insertRecord("product_batches", "batch_del_1", {
      id: "batch_del_1",
      product_id: "prod_del_1",
      stock_qty: 0,
    });

    const prodsBefore = await sqliteStorage.findAll("products");
    expect(prodsBefore.length).toBeGreaterThan(0);

    // Reset with reset_products: true
    await storeRegistryService.wipeStoreTransactionalData(dummyStore.id, {
      reset_products: true,
      reset_stock: true,
    });

    const prodsAfter = await sqliteStorage.findAll("products");
    expect(prodsAfter.length).toBe(0);

    const batchesAfter = await sqliteStorage.findAll("product_batches");
    expect(batchesAfter.length).toBe(0);
  });

  it("4. Deletes local party masters when reset_customers is enabled", async () => {
    await sqliteStorage.insertRecord("customers", "cust_reset_1", {
      id: "cust_reset_1",
      name: "Walk-in Customer",
      current_balance: 120,
      is_active: true,
    });
    await sqliteStorage.insertRecord("suppliers", "supp_reset_1", {
      id: "supp_reset_1",
      name: "Metro Wholesale",
      is_active: true,
    });
    await sqliteStorage.insertRecord("doctors", "doc_reset_1", {
      id: "doc_reset_1",
      name: "Dr. Rao",
    });
    await sqliteStorage.insertRecord("patients", "pat_reset_1", {
      id: "pat_reset_1",
      name: "Anita",
    });

    await storeRegistryService.wipeStoreTransactionalData(dummyStore.id, {
      reset_customers: true,
      reset_products: false,
    });

    expect((await sqliteStorage.findAll("customers")).length).toBe(0);
    expect((await sqliteStorage.findAll("suppliers")).length).toBe(0);
    expect((await sqliteStorage.findAll("doctors")).length).toBe(0);
    expect((await sqliteStorage.findAll("patients")).length).toBe(0);
    // Product catalog stays because reset_products is false
    expect((await sqliteStorage.findAll("products")).length).toBeGreaterThan(0);
  });

  it("5. Preserves local party masters when reset_customers is disabled", async () => {
    await sqliteStorage.insertRecord("customers", "cust_keep_1", {
      id: "cust_keep_1",
      name: "Retained Customer",
      is_active: true,
    });

    await storeRegistryService.wipeStoreTransactionalData(dummyStore.id, {
      reset_customers: false,
    });

    const customers = await sqliteStorage.findAll<any>("customers");
    expect(customers.some((c) => c.id === "cust_keep_1")).toBe(true);
  });

  it("6. Ignores reset events for stores not registered on this workstation", async () => {
    await sqliteStorage.insertRecord("customers", "cust_guard_1", {
      id: "cust_guard_1",
      name: "Must Survive",
      is_active: true,
    });

    await storeRegistryService.wipeStoreTransactionalData("9999", {
      reset_customers: true,
      reset_products: true,
    });

    const customers = await sqliteStorage.findAll<any>("customers");
    expect(customers.some((c) => c.id === "cust_guard_1")).toBe(true);
  });
});

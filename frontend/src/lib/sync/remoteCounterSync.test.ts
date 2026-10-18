import { describe, it, expect, beforeEach } from "vitest";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";
import { counterSequenceService } from "../auth/counterSequenceService";
import { multiCounterStockService } from "../stock/multiCounterStockService";
import { syncQueueService, type SyncApiClient } from "../sync/syncQueueService";
import { storeDeviceService } from "../auth/storeDeviceService";

describe("Remote Counter Offline Sync, Concurrent Batch Billing & Security Simulation", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  describe("1. Document Number Series Safety Across Counters", () => {
    it("leases independent prefixes and sequence blocks preventing duplicate bill numbers offline", async () => {
      // Counter 1: Shop Counter (C01-INV)
      const c1Inv1 = await counterSequenceService.getNextDocumentNumber("cntr_shop_01", "C01", "invoice");
      const c1Inv2 = await counterSequenceService.getNextDocumentNumber("cntr_shop_01", "C01", "invoice");

      // Counter 2: Remote Home Counter (C02-INV)
      const c2Inv1 = await counterSequenceService.getNextDocumentNumber("cntr_home_02", "C02", "invoice");
      const c2Inv2 = await counterSequenceService.getNextDocumentNumber("cntr_home_02", "C02", "invoice");

      expect(c1Inv1).toBe("C01-INV-1001");
      expect(c1Inv2).toBe("C01-INV-1002");
      expect(c2Inv1).toBe("C02-INV-1001");
      expect(c2Inv2).toBe("C02-INV-1002");

      // Verify no collision exists between shop and home counter invoices
      const set = new Set([c1Inv1, c1Inv2, c2Inv1, c2Inv2]);
      expect(set.size).toBe(4);
    });

    it("respects leased sequence boundaries and throws if leased block is exhausted offline", async () => {
      await counterSequenceService.configureSequence(
        "cntr_home_02",
        "invoice",
        "C02-INV",
        1001,
        1001,
        1002 // Range limited to 1001 and 1002
      );

      const inv1 = await counterSequenceService.getNextDocumentNumber("cntr_home_02", "C02", "invoice");
      const inv2 = await counterSequenceService.getNextDocumentNumber("cntr_home_02", "C02", "invoice");
      expect(inv1).toBe("C02-INV-1001");
      expect(inv2).toBe("C02-INV-1002");

      await expect(
        counterSequenceService.getNextDocumentNumber("cntr_home_02", "C02", "invoice")
      ).rejects.toThrow(/Leased sequence range exhausted/);
    });
  });

  describe("2. Concurrent Offline Billing of Same Batch & Reconciliation", () => {
    it("merges stock deltas from Shop Counter and Home Counter and flags negative deficit stock", async () => {
      // 1. Initial product and batch with 10 units in stock
      const prod: ProductItem = {
        id: "prod_amox_500",
        name: "Amoxicillin 500mg",
        barcode: "890123450001",
        mrp: 120,
        sel_rate: 100,
        gst_percent: 12,
        units_per_pack: 10,
        is_active: true,
      };
      await productsStore.upsertProduct(prod);

      const batch: ProductBatch = {
        id: "batch_amox_b1",
        product_id: "prod_amox_500",
        batch_no: "AMX-B1",
        expiry_date: "2027-10-31",
        stock_qty: 10,
        mrp: 120,
      };
      await productsStore.upsertBatch(batch);

      // 2. Both counters sell concurrently while offline:
      // Shop counter C01 sells 7 units
      const shopSaleDelta = {
        id: "stk_c01_sale_1",
        product_id: "prod_amox_500",
        batch_id: "batch_amox_b1",
        counter_id: "C01",
        qty_delta: -7,
        reference_type: "invoice",
        reference_id: "C01-INV-1001",
        created_at: Date.now() - 5000,
      };

      // Remote Home counter C02 sells 6 units (total 13 units sold vs 10 units in stock)
      const homeSaleDelta = {
        id: "stk_c02_sale_1",
        product_id: "prod_amox_500",
        batch_id: "batch_amox_b1",
        counter_id: "C02",
        qty_delta: -6,
        reference_type: "invoice",
        reference_id: "C02-INV-1001",
        created_at: Date.now() - 3000,
      };

      // Ingest shop sale first
      const res1 = await multiCounterStockService.syncMergeCounterStockDeltas([shopSaleDelta]);
      expect(res1.applied).toBe(1);

      // Ingest home sale second
      const res2 = await multiCounterStockService.syncMergeCounterStockDeltas([homeSaleDelta]);
      expect(res2.applied).toBe(1);

      // Reconcile batch stock
      const recon = await multiCounterStockService.computeBatchReconciledStock("batch_amox_b1", 10);
      expect(recon.total_deltas).toBe(-13);
      expect(recon.reconciled_stock).toBe(-3);
      expect(recon.is_negative).toBe(true);
      expect(recon.deficit_qty).toBe(3);
      expect(recon.counter_breakdown["C01"]).toBe(-7);
      expect(recon.counter_breakdown["C02"]).toBe(-6);

      // Verify cross-counter lookup includes accurate totals and breakdown
      const lookup = await multiCounterStockService.getCrossCounterStockLookup("prod_amox_500");
      expect(lookup.total_store_stock).toBe(-3);
      expect(lookup.batches[0].is_negative).toBe(true);
    });
  });

  describe("3. Security, Role Profiles & Device Revocation", () => {
    it("enforces per-counter permission restrictions on bill cancellation, price change, and stock adjustment", async () => {
      // Mock remote home counter with restricted role profile
      (storeDeviceService as any).activeProfile = {
        device_id: "cntr_home_02",
        device_uuid: "uuid_home_device_xyz",
        device_name: "Owner Home Counter",
        store_id: "1",
        store_name: "LamStone Pharmacy",
        store_code: "STORE-01",
        counter_id: "cntr_home_02",
        counter_name: "Owner Home Counter",
        counter_code: "C02",
        location_name: "Owner Residence",
        is_remote: true,
        is_hub: false,
        is_digital_only: true,
        role_profile: {
          allow_cancel: false,
          allow_price_change: false,
          allow_stock_adj: false,
          require_manager_pin: true,
        },
        manager_pin: "4321",
        license_plan: "Retail Remote",
        license_status: "active",
        license_expires_at: "2027-12-31",
        registered_at: Date.now(),
        is_active: true,
      };

      expect(storeDeviceService.canPerformAction("cancel_bill")).toBe(false);
      expect(storeDeviceService.canPerformAction("change_price")).toBe(false);
      expect(storeDeviceService.canPerformAction("adjust_stock")).toBe(false);

      expect(storeDeviceService.verifyManagerPin("0000")).toBe(false);
      expect(storeDeviceService.verifyManagerPin("4321")).toBe(true);
    });

    it("locks device and blocks sync when revoked remotely by the store owner", async () => {
      await storeDeviceService.lockStoreAccess("Device access revoked by store administrator");

      const lic = await storeDeviceService.checkLicenseStatus();
      expect(lic.valid).toBe(false);
      expect(lic.status).toBe("disabled");
      expect(lic.warning).toContain("revoked");
    });
  });
});

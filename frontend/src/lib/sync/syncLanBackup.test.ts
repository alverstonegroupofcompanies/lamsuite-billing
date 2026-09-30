import { describe, it, expect, beforeEach } from "vitest";
import { cloudDeltaSyncService, type MasterDeltaResponse } from "./cloudDeltaSyncService";
import { lanPeerService, type LanMasterSnapshot, type LanPeerInfo } from "../lan/lanPeerService";
import { backupService, type BackupPackage } from "../backup/backupService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductItem, type ProductBatch } from "../masters/productsStore";
import { partiesStore, type PartyMaster } from "../masters/partiesStore";

describe("Cloud Delta Sync, LAN Peer Sharing & Backup Recovery (SYNC-003, SYNC-005, SYNC-006)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  describe("SYNC-003: Cloud Master Delta Pull", () => {
    it("pulls delta updates since watermark and applies products, batches, and parties locally", async () => {
      const mockDeltaClient = {
        fetchMasterDeltas: async (watermark: number): Promise<MasterDeltaResponse> => {
          expect(watermark).toBe(0);
          return {
            watermark: 1727690000000,
            products: [
              {
                id: "prod_cloud_1",
                name: "Paracetamol 650mg",
                barcode: "8901234567890",
                mrp: 35,
                sel_rate: 30,
                gst_percent: 12,
                units_per_pack: 15,
                is_active: true,
              },
            ],
            batches: [
              {
                id: "batch_cloud_1",
                product_id: "prod_cloud_1",
                batch_no: "BATCH-C1",
                expiry_date: "2027-12-31",
                stock_qty: 150,
                mrp: 35,
              },
            ],
            parties: [
              {
                id: "party_cloud_1",
                type: "customer",
                name: "Apollo Clinic",
                gstin: "32AAAAA0000A1Z5",
                place_of_supply: "32",
              },
            ],
          };
        },
      };

      cloudDeltaSyncService.setWatermark(0);
      const res = await cloudDeltaSyncService.pullMasterDelta(mockDeltaClient);

      expect(res.success).toBe(true);
      expect(res.appliedProducts).toBe(1);
      expect(res.appliedBatches).toBe(1);
      expect(res.appliedParties).toBe(1);
      expect(res.newWatermark).toBe(1727690000000);

      // Verify product was saved in SQLite
      const prod = await sqliteStorage.findById<ProductItem>("products", "prod_cloud_1");
      expect(prod?.name).toBe("Paracetamol 650mg");

      // Verify batch was saved
      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", "batch_cloud_1");
      expect(batch?.stock_qty).toBe(150);

      // Verify party was saved as customer
      const party = await partiesStore.getCustomerById("party_cloud_1");
      expect(party?.name).toBe("Apollo Clinic");
    });
  });

  describe("SYNC-005: LAN Master Snapshot Sharing", () => {
    it("Main Station exports master snapshot and Secondary Counter pulls and ingests over LAN HTTP", async () => {
      // 1. Seed Main Station with data
      const prod: ProductItem = {
        id: "prod_lan_1",
        name: "Insulin Glargine",
        barcode: "8909876543210",
        mrp: 550,
        sel_rate: 500,
        gst_percent: 5,
        units_per_pack: 1,
        is_active: true,
      };
      await productsStore.upsertProduct(prod);

      const batch: ProductBatch = {
        id: "batch_lan_1",
        product_id: "prod_lan_1",
        batch_no: "INS-001",
        expiry_date: "2027-05-31",
        stock_qty: 25,
      };
      await productsStore.upsertBatch(batch);

      // Main station exports snapshot
      lanPeerService.configureStation("main_station", "Main Cash Counter 1", 8089);
      const snapshot = await lanPeerService.exportMasterSnapshot();

      expect(snapshot.products.length).toBe(1);
      expect(snapshot.batches.length).toBe(1);
      expect(snapshot.products[0].name).toBe("Insulin Glargine");

      // 2. Secondary station scenario: Clear local database to simulate fresh terminal
      getMockDatabase().reset();
      await sqliteStorage.initDatabase();

      // Verify secondary station is empty
      const beforeProducts = await sqliteStorage.findAll("products");
      expect(beforeProducts.length).toBe(0);

      // Secondary station discovers main station
      const mockMainInfo: LanPeerInfo = {
        station_id: snapshot.source_station_id,
        station_name: "Main Cash Counter 1",
        ip_address: "192.168.1.100",
        port: 8089,
        is_main: true,
        version: "2.0.0",
      };

      const discovered = await lanPeerService.discoverMainStation(mockMainInfo);
      expect(discovered).not.toBeNull();
      expect(discovered?.ip_address).toBe("192.168.1.100");

      // Mock LAN HTTP fetcher
      const mockFetcher = async (url: string) => {
        expect(url).toBe("http://192.168.1.100:8089/lan/v1/pull");
        return {
          ok: true,
          status: 200,
          json: async () => snapshot,
        };
      };

      const pullRes = await lanPeerService.pullMasterSnapshotFromMain(
        discovered!.ip_address,
        discovered!.port,
        mockFetcher
      );

      expect(pullRes.success).toBe(true);
      expect(pullRes.appliedCount).toBe(2); // 1 product + 1 batch

      // Verify secondary terminal now has the product and batch in local SQLite
      const syncedProd = await sqliteStorage.findById<ProductItem>("products", "prod_lan_1");
      expect(syncedProd?.name).toBe("Insulin Glargine");
    });
  });

  describe("SYNC-006: Database Backup & Disaster Recovery", () => {
    it("creates backup snapshot with manifest and restores all tables during recovery", async () => {
      // 1. Seed database with active data
      await sqliteStorage.insertRecord("invoices", "inv_bak_1", {
        id: "inv_bak_1",
        invoice_number: "INV-BAK-001",
        invoice_date: "2026-09-30",
        grand_total: 750,
      });

      await sqliteStorage.insertRecord("products", "prod_bak_1", {
        id: "prod_bak_1",
        name: "Cough Drops",
        barcode: "123456",
        mrp: 10,
        sel_rate: 10,
        gst_percent: 5,
      });

      // 2. Create backup snapshot
      const backup = await backupService.createBackupSnapshot("2.0.0");
      expect(backup.manifest.length).toBeGreaterThan(0);

      const invManifest = backup.manifest.find((m) => m.table_name === "invoices");
      expect(invManifest?.record_count).toBe(1);

      // 3. Serialize and deserialize (verifying JSON roundtrip)
      const serialized = backupService.serializeBackup(backup);
      const deserialized = backupService.deserializeBackup(serialized);
      expect(deserialized.backup_id).toBe(backup.backup_id);

      // 4. Simulate disaster: Wipe local database
      getMockDatabase().reset();
      await sqliteStorage.initDatabase();

      const wipedInvoices = await sqliteStorage.findAll("invoices");
      expect(wipedInvoices.length).toBe(0);

      // 5. Restore from backup
      const restoreRes = await backupService.restoreFromSnapshot(deserialized);
      expect(restoreRes.success).toBe(true);
      expect(restoreRes.totalRecordsRestored).toBeGreaterThanOrEqual(2);

      // 6. Verify restored records exist
      const restoredInv = await sqliteStorage.findById("invoices", "inv_bak_1");
      expect(restoredInv).not.toBeNull();
      expect((restoredInv as { invoice_number: string }).invoice_number).toBe("INV-BAK-001");
    });
  });
});

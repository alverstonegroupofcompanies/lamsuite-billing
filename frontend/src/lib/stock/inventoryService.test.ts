import { describe, it, expect, beforeEach } from "vitest";
import { inventoryService } from "./inventoryService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";

describe("Inventory Control & Stock Ledger (STK-001 - STK-006)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  describe("Stock Adjustments (STK-002)", () => {
    it("records negative stock adjustment (write-off due to damage) and logs ADJUSTMENT_OUT", async () => {
      const batchId = "batch_adjust_1";
      await productsStore.upsertBatch({
        id: batchId,
        product_id: "prod_syrup",
        batch_no: "SYR-99",
        expiry_date: "2027-06-30",
        stock_qty: 50,
      });

      const res = await inventoryService.recordStockAdjustment({
        product_id: "prod_syrup",
        batch_id: batchId,
        adjustment_qty: -10,
        reason: "Damaged",
        notes: "Broken bottles during shelf cleaning",
      });

      expect(res.success).toBe(true);

      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", batchId);
      expect(batch?.stock_qty).toBe(40);

      const stockTxs = await sqliteStorage.findAll<{
        event_type: string;
        qty_delta: number;
        notes: string;
      }>("stock_transactions");
      expect(stockTxs.length).toBe(1);
      expect(stockTxs[0].event_type).toBe("ADJUSTMENT_OUT");
      expect(stockTxs[0].qty_delta).toBe(-10);
      expect(stockTxs[0].notes).toContain("Damaged: Broken bottles");
    });

    it("records positive stock adjustment (found stock) and logs ADJUSTMENT_IN", async () => {
      const batchId = "batch_adjust_2";
      await productsStore.upsertBatch({
        id: batchId,
        product_id: "prod_ointment",
        batch_no: "ONT-01",
        expiry_date: "2028-01-01",
        stock_qty: 25,
      });

      const res = await inventoryService.recordStockAdjustment({
        product_id: "prod_ointment",
        batch_id: batchId,
        adjustment_qty: 5,
        reason: "Found Stock",
        notes: "Found extra box in storage rack B",
      });

      expect(res.success).toBe(true);

      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", batchId);
      expect(batch?.stock_qty).toBe(30);

      const stockTxs = await sqliteStorage.findAll<{
        event_type: string;
        qty_delta: number;
      }>("stock_transactions");
      expect(stockTxs[0].event_type).toBe("ADJUSTMENT_IN");
      expect(stockTxs[0].qty_delta).toBe(5);
    });
  });

  describe("Physical Inventory Reconciliation (STK-003)", () => {
    it("posts variance adjustments when physical count differs from system stock", async () => {
      const batchA = "batch_rec_a";
      const batchB = "batch_rec_b";

      await productsStore.upsertBatch({
        id: batchA,
        product_id: "prod_a",
        batch_no: "B-A1",
        expiry_date: "2027-12-31",
        stock_qty: 100, // Counted 95 -> -5 variance
      });

      await productsStore.upsertBatch({
        id: batchB,
        product_id: "prod_b",
        batch_no: "B-B1",
        expiry_date: "2027-12-31",
        stock_qty: 20, // Counted 20 -> 0 variance (no adjustment)
      });

      const result = await inventoryService.recordPhysicalReconciliation([
        { product_id: "prod_a", batch_id: batchA, counted_qty: 95 },
        { product_id: "prod_b", batch_id: batchB, counted_qty: 20 },
      ]);

      expect(result.success).toBe(true);
      expect(result.adjustmentsPosted).toBe(1);

      // Verify batch A updated to counted 95
      const updatedBatchA = await sqliteStorage.findById<ProductBatch>("product_batches", batchA);
      expect(updatedBatchA?.stock_qty).toBe(95);

      // Verify stock transaction
      const stockTxs = await sqliteStorage.findAll<{
        event_type: string;
        qty_delta: number;
      }>("stock_transactions");
      expect(stockTxs.length).toBe(1);
      expect(stockTxs[0].event_type).toBe("RECONCILIATION_ADJUSTMENT");
      expect(stockTxs[0].qty_delta).toBe(-5);
    });
  });

  describe("Inter-Store Transfers (STK-004)", () => {
    it("dispatches transfer out and reduces source batch stock", async () => {
      const batchId = "batch_transfer_1";
      await productsStore.upsertBatch({
        id: batchId,
        product_id: "prod_capsule",
        batch_no: "CAP-05",
        expiry_date: "2027-08-31",
        stock_qty: 80,
      });

      const res = await inventoryService.dispatchInterStoreTransfer({
        transfer_no: "TR-2026-001",
        source_store_id: "store_main",
        destination_store_id: "store_branch2",
        product_id: "prod_capsule",
        batch_id: batchId,
        transfer_qty: 30,
      });

      expect(res.success).toBe(true);

      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", batchId);
      expect(batch?.stock_qty).toBe(50);

      const stockTxs = await sqliteStorage.findAll<{
        event_type: string;
        qty_delta: number;
        reference_id: string;
      }>("stock_transactions");
      expect(stockTxs.length).toBe(1);
      expect(stockTxs[0].event_type).toBe("TRANSFER_OUT");
      expect(stockTxs[0].qty_delta).toBe(-30);
      expect(stockTxs[0].reference_id).toBe("TR-2026-001");
    });

    it("prevents transfer if transfer quantity exceeds available batch stock", async () => {
      const batchId = "batch_low_stock";
      await productsStore.upsertBatch({
        id: batchId,
        product_id: "prod_capsule",
        batch_no: "CAP-06",
        expiry_date: "2027-08-31",
        stock_qty: 10,
      });

      await expect(
        inventoryService.dispatchInterStoreTransfer({
          transfer_no: "TR-2026-002",
          source_store_id: "store_main",
          destination_store_id: "store_branch2",
          product_id: "prod_capsule",
          batch_id: batchId,
          transfer_qty: 15, // exceeds 10
        })
      ).rejects.toThrow("Insufficient stock");
    });
  });

  describe("Near-Expiry & Low Stock Queries (STK-005, STK-006)", () => {
    it("identifies batches nearing expiry within threshold days", async () => {
      const refDate = new Date("2026-10-01");

      // Batch 1: Expires in 30 days (2026-10-31) -> within 60 days
      await productsStore.upsertBatch({
        id: "b_near",
        product_id: "p1",
        batch_no: "BN-01",
        expiry_date: "2026-10-31",
        stock_qty: 15,
      });

      // Batch 2: Expires in 90 days (2026-12-30) -> beyond 60 days
      await productsStore.upsertBatch({
        id: "b_far",
        product_id: "p2",
        batch_no: "BF-01",
        expiry_date: "2026-12-30",
        stock_qty: 40,
      });

      // Batch 3: Zero stock (expired) -> should be ignored
      await productsStore.upsertBatch({
        id: "b_zero",
        product_id: "p3",
        batch_no: "BZ-01",
        expiry_date: "2026-10-15",
        stock_qty: 0,
      });

      const nearExpiry = await inventoryService.getBatchesNearExpiry(60, refDate);
      expect(nearExpiry.length).toBe(1);
      expect(nearExpiry[0].batch_no).toBe("BN-01");
    });

    it("identifies active products that reached or fell below reorder level", async () => {
      const lowProduct: ProductItem = {
        id: "prod_low",
        name: "Insulin Vial",
        barcode: "8901001",
        mrp: 150,
        sel_rate: 140,
        gst_percent: 5,
        units_per_pack: 1,
        current_stock: 4,
        reorder_level: 10,
        is_active: true,
      };

      const normalProduct: ProductItem = {
        id: "prod_normal",
        name: "Cough Syrup",
        barcode: "8901002",
        mrp: 60,
        sel_rate: 55,
        gst_percent: 12,
        units_per_pack: 1,
        current_stock: 50,
        reorder_level: 15,
        is_active: true,
      };

      await sqliteStorage.insertRecord("products", lowProduct.id, lowProduct);
      await sqliteStorage.insertRecord("products", normalProduct.id, normalProduct);

      const lowStock = await inventoryService.getLowStockProducts();
      expect(lowStock.length).toBe(1);
      expect(lowStock[0].id).toBe("prod_low");
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { counterSequenceService } from "../auth/counterSequenceService";
import { multiCounterStockService } from "../stock/multiCounterStockService";
import { documentLockService } from "./documentLockService";
import { distributedHeldBillService } from "./distributedHeldBillService";
import { cashShiftService } from "./cashShiftService";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";

describe("Multi-Counter Concurrent Billing & Synchronization Simulation", () => {
  beforeEach(async () => {
    await sqliteStorage.initDatabase();
    await sqliteStorage.clearTable("counter_sequences");
    await sqliteStorage.clearTable("stock_transactions");
    await sqliteStorage.clearTable("document_locks");
    await sqliteStorage.clearTable("distributed_held_bills");
    await sqliteStorage.clearTable("cash_shifts");
    await sqliteStorage.clearTable("store_day_closes");
  });

  it("simulates 3 counters billing the same batch concurrently offline: proves no duplicate numbers, no lost sales, correct commutative stock merge", async () => {
    const fy = "2026-27";
    const batchId = "batch_paracetamol_500";
    const productId = "prod_pcm_500";
    const initialOpeningStock = 20;

    // 1. Seed initial Product and Batch with 20 units
    const testProduct: ProductItem = {
      id: productId,
      barcode: "890123400001",
      name: "Paracetamol 500mg Strip",
      mrp: 40,
      sel_rate: 35,
      gst_percent: 12,
      current_stock: initialOpeningStock,
      units_per_pack: 1,
      is_active: true,
    };
    await productsStore.upsertProduct(testProduct);

    const testBatch: ProductBatch = {
      id: batchId,
      product_id: productId,
      batch_no: "PCM-2026-X1",
      expiry_date: "2028-12-31",
      stock_qty: initialOpeningStock,
      selling_rate: 35,
      mrp: 40,
    };
    await productsStore.upsertBatch(testBatch);

    // 2. Counters go OFFLINE. Counter 01, Counter 02, Counter 03 generate independent sequence numbers
    const invoiceNumC1 = await counterSequenceService.getNextDocumentNumber("cntr_01", "C01", "invoice", fy);
    const invoiceNumC2 = await counterSequenceService.getNextDocumentNumber("cntr_02", "C02", "invoice", fy);
    const invoiceNumC3 = await counterSequenceService.getNextDocumentNumber("cntr_03", "C03", "invoice", fy);

    // Verify 100% collision-free invoice numbers
    expect(invoiceNumC1).toBe("C01-INV-1001");
    expect(invoiceNumC2).toBe("C02-INV-1001");
    expect(invoiceNumC3).toBe("C03-INV-1001");

    const numberSet = new Set([invoiceNumC1, invoiceNumC2, invoiceNumC3]);
    expect(numberSet.size).toBe(3);

    // 3. Each counter bills from the same batch concurrently offline
    // Counter 01 sells 5 units
    const c1Events = [
      {
        id: "tx_c1_001",
        product_id: productId,
        batch_id: batchId,
        counter_id: "Counter 01",
        qty_delta: -5,
        reference_type: "INVOICE",
        reference_id: invoiceNumC1,
        created_at: Date.now() + 10,
      },
    ];

    // Counter 02 sells 7 units
    const c2Events = [
      {
        id: "tx_c2_001",
        product_id: productId,
        batch_id: batchId,
        counter_id: "Counter 02",
        qty_delta: -7,
        reference_type: "INVOICE",
        reference_id: invoiceNumC2,
        created_at: Date.now() + 20,
      },
    ];

    // Counter 03 sells 4 units
    const c3Events = [
      {
        id: "tx_c3_001",
        product_id: productId,
        batch_id: batchId,
        counter_id: "Counter 03",
        qty_delta: -4,
        reference_type: "INVOICE",
        reference_id: invoiceNumC3,
        created_at: Date.now() + 30,
      },
    ];

    // 4. Counters come back ONLINE and sync their ledger deltas in arbitrary order
    await multiCounterStockService.syncMergeCounterStockDeltas(c2Events); // C2 syncs first
    await multiCounterStockService.syncMergeCounterStockDeltas(c1Events); // C1 syncs second
    await multiCounterStockService.syncMergeCounterStockDeltas(c3Events); // C3 syncs third

    // 5. Verify commutative reconciliation
    // 20 - 5 - 7 - 4 = 4 remaining
    const reconciled = await multiCounterStockService.computeBatchReconciledStock(batchId, initialOpeningStock);

    expect(reconciled.opening_qty).toBe(20);
    expect(reconciled.total_deltas).toBe(-16);
    expect(reconciled.reconciled_stock).toBe(4);
    expect(reconciled.is_negative).toBe(false);
    expect(reconciled.deficit_qty).toBe(0);

    // Counter-wise audit trail breakdown
    expect(reconciled.counter_breakdown["Counter 01"]).toBe(-5);
    expect(reconciled.counter_breakdown["Counter 02"]).toBe(-7);
    expect(reconciled.counter_breakdown["Counter 03"]).toBe(-4);
  });

  it("handles negative stock allowance with deficit reconciliation when concurrent sales exceed batch stock", async () => {
    const batchId = "batch_negative_test";
    const productId = "prod_neg_test";
    const initialOpeningStock = 10;

    // C1 sells 6 units (-6)
    await multiCounterStockService.syncMergeCounterStockDeltas([
      {
        id: "tx_neg_c1",
        product_id: productId,
        batch_id: batchId,
        counter_id: "Counter 01",
        qty_delta: -6,
        reference_type: "INVOICE",
        reference_id: "C01-INV-1002",
        created_at: Date.now(),
      },
    ]);

    // C2 sells 8 units (-8) -> total sold = 14 (available was 10)
    await multiCounterStockService.syncMergeCounterStockDeltas([
      {
        id: "tx_neg_c2",
        product_id: productId,
        batch_id: batchId,
        counter_id: "Counter 02",
        qty_delta: -8,
        reference_type: "INVOICE",
        reference_id: "C02-INV-1002",
        created_at: Date.now() + 50,
      },
    ]);

    const result = await multiCounterStockService.computeBatchReconciledStock(batchId, initialOpeningStock);
    expect(result.reconciled_stock).toBe(-4); // 10 - 14 = -4
    expect(result.is_negative).toBe(true);
    expect(result.deficit_qty).toBe(4);
    expect(result.counter_breakdown["Counter 01"]).toBe(-6);
    expect(result.counter_breakdown["Counter 02"]).toBe(-8);
  });

  it("locks a bill being edited or cancelled on one counter from being modified concurrently on another", async () => {
    const invoiceId = "inv_test_lock_1001";

    // Counter 01 acquires edit lock
    const lock1 = await documentLockService.acquireLock(
      invoiceId,
      "invoice",
      "cntr_01",
      "usr_cashier_01",
      "Ananya Nair",
      300
    );
    expect(lock1.acquired).toBe(true);

    // Counter 02 attempts to edit or cancel the same bill concurrently -> blocked!
    const lock2 = await documentLockService.acquireLock(
      invoiceId,
      "invoice",
      "cntr_02",
      "usr_cashier_02",
      "Rahul Verma",
      300
    );
    expect(lock2.acquired).toBe(false);
    expect(lock2.lockedBy?.counterId).toBe("cntr_01");
    expect(lock2.lockedBy?.userName).toBe("Ananya Nair");

    // Counter 01 finishes and releases lock
    const released = await documentLockService.releaseLock(invoiceId, "cntr_01");
    expect(released).toBe(true);

    // Now Counter 02 can acquire lock
    const lock3 = await documentLockService.acquireLock(
      invoiceId,
      "invoice",
      "cntr_02",
      "usr_cashier_02",
      "Rahul Verma",
      300
    );
    expect(lock3.acquired).toBe(true);
  });

  it("handles race conditions when recalling the same held bill on two counters", async () => {
    // Hold bill from Counter 01
    const holdId = await distributedHeldBillService.holdBill(
      "cntr_01",
      "Counter 01",
      "Ananya Nair",
      { customer: "Walk-in", items: [{ name: "Dolo 650", qty: 2 }] },
      1,
      70,
      "Walk-in Customer"
    );

    expect(holdId).toBeDefined();

    // Counter 01 recalls the bill -> succeeds
    const claim1 = await distributedHeldBillService.claimHeldBill(holdId, "cntr_01");
    expect(claim1.success).toBe(true);
    expect(claim1.bill?.status).toBe("claimed");

    // Counter 02 attempts to recall the exact same bill -> fails with clear race conflict message
    const claim2 = await distributedHeldBillService.claimHeldBill(holdId, "cntr_02");
    expect(claim2.success).toBe(false);
    expect(claim2.error).toContain("already been recalled");
  });

  it("calculates per-counter shifts, drawer variance, and ties out store consolidated day close perfectly", async () => {
    const today = "2026-10-10";

    // Counter 01 opens shift: opening float 2000
    const shiftC1 = await cashShiftService.openShift(
      "cntr_01",
      "Counter 01",
      "usr_01",
      "Cashier 1",
      2000,
      "Morning Shift",
      today
    );
    // Sale on C1: 1500 Cash, 1000 UPI
    await cashShiftService.recordSaleTender("cntr_01", "Cash", 1500);
    await cashShiftService.recordSaleTender("cntr_01", "UPI", 1000);
    // Cash in on C1: 500
    await cashShiftService.recordCashMovement(shiftC1.id, "cash_in", 500, "Cash Float top-up");

    // Close Shift C1: expected cash = 2000 + 1500 + 500 = 4000. Physical counted = 4000 -> variance 0
    const closeC1 = await cashShiftService.closeShift(shiftC1.id, 4000);
    expect(closeC1.variance).toBe(0);

    // Counter 02 opens shift: opening float 1000
    const shiftC2 = await cashShiftService.openShift(
      "cntr_02",
      "Counter 02",
      "usr_02",
      "Cashier 2",
      1000,
      "Afternoon Shift",
      today
    );
    // Sale on C2: 800 Cash, 1200 Card
    await cashShiftService.recordSaleTender("cntr_02", "Cash", 800);
    await cashShiftService.recordSaleTender("cntr_02", "Card", 1200);

    // Close Shift C2: expected cash = 1000 + 800 = 1800. Physical counted = 1760 -> variance -40
    const closeC2 = await cashShiftService.closeShift(shiftC2.id, 1760);
    expect(closeC2.variance).toBe(-40);

    // Store Consolidated Day Close
    const storeClose = await cashShiftService.generateStoreConsolidatedDayClose(
      "store_main",
      today,
      "usr_admin",
      "Store Owner"
    );

    // Consolidated Tender breakdown ties out:
    // Cash: 1500 + 800 = 2300
    // UPI: 1000
    // Card: 1200
    // Gross: 4500
    expect(storeClose.consolidated_by_tender.Cash).toBe(2300);
    expect(storeClose.consolidated_by_tender.UPI).toBe(1000);
    expect(storeClose.consolidated_by_tender.Card).toBe(1200);
    expect(storeClose.consolidated_sales).toBe(4500);
    expect(storeClose.total_cash_variance).toBe(-40);
    expect(storeClose.counters_included).toContain("cntr_01");
    expect(storeClose.counters_included).toContain("cntr_02");
  });
});

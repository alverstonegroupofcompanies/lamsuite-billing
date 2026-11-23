import { describe, it, expect, beforeEach, vi } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { onlineTransactionService, type OnlineInvoicePayload } from "./onlineTransactionService";
import { counterSequenceService } from "../auth/counterSequenceService";
import { syncQueueService, type SyncApiClient } from "./syncQueueService";
import { distributedHeldBillService } from "../billing/distributedHeldBillService";
import { documentLockService } from "../billing/documentLockService";
import { offlineCapabilityGuard } from "../auth/offlineCapabilityGuard";

describe("LamSuite Billing Online-First Architecture & Resilient Offline Fallback", () => {
  beforeEach(async () => {
    (sqliteStorage as any).reset?.();
    await sqliteStorage.clearTable("sync_queue");
    await sqliteStorage.clearTable("offline_durable_queue");
    await sqliteStorage.clearTable("invoices");
    await sqliteStorage.clearTable("invoice_items");
    await sqliteStorage.clearTable("stock_transactions");
    await sqliteStorage.clearTable("distributed_held_bills");
    await sqliteStorage.clearTable("document_locks");

    onlineTransactionService.setBaseUrl("http://localhost:8000");
    (onlineTransactionService as any).connectionState = "online";

    // Seed master product and batch in local cache
    await sqliteStorage.insertRecord("products", "prod_pcm", {
      id: "prod_pcm",
      name: "Paracetamol 500mg",
      current_stock: 10,
      units_per_pack: 1,
      mrp: 20,
      sel_rate: 18,
    });

    await sqliteStorage.insertRecord("product_batches", "batch_pcm_01", {
      id: "batch_pcm_01",
      product_id: "prod_pcm",
      batch_no: "PCM-2026",
      expiry_date: "2027-12-31",
      stock_qty: 10,
      mrp: 20,
      selling_rate: 18,
    });
  });

  it("1. Normal Online Mode: Server confirms save and updates local SQLite cache", async () => {
    // Mock server 201 response
    const mockServerInvoice = {
      id: 991,
      invoice_number: "C01-INV-1001",
      subtotal: 36,
      tax_total: 4.32,
      round_off: -0.32,
      grand_total: 40,
      payment_mode: "Cash",
      external_id: "tx_test_online_1",
    };

    const mockFetch = vi.fn().mockImplementation((url: string, opts: any) => {
      if (url.includes("/api/invoices")) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({
              success: true,
              invoice: mockServerInvoice,
              affected_batches: [
                {
                  product_id: "prod_pcm",
                  batch_id: "batch_pcm_01",
                  batch_no: "PCM-2026",
                  remaining_stock: 8,
                },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: "ok" }) });
    });
    vi.stubGlobal("fetch", mockFetch);

    const payload: OnlineInvoicePayload = {
      external_id: "tx_test_online_1",
      counter_code: "C01",
      customer_name: "Walk-in Customer",
      payment_mode: "Cash",
      items: [
        {
          product_id: "prod_pcm",
          batch_id: "batch_pcm_01",
          batch_no: "PCM-2026",
          qty: 2,
          unit_price: 18,
        },
      ],
    };

    const res = await onlineTransactionService.submitAuthoritativeInvoice(payload);
    expect(res.success).toBe(true);
    expect(res.isOnline).toBe(true);
    expect(res.invoice.invoice_number).toBe("C01-INV-1001");

    // Local SQLite cache must be updated with the authoritative server record — as one row, keyed
    // by the id the server gave the bill, with the till's own idempotency key kept on it.
    const cachedInv = await sqliteStorage.findById("invoices", "991");
    expect(cachedInv).not.toBeNull();
    expect((cachedInv as any).server_id).toBe(991);
    expect((cachedInv as any).external_id).toBe("tx_test_online_1");
    const cachedRows = await sqliteStorage.findAll<any>("invoices");
    expect(cachedRows.filter((r) => r.invoice_number === "C01-INV-1001").length).toBe(1);

    // Remaining stock in local cache updated to 8
    const cachedBatch = await sqliteStorage.findById<any>("product_batches", "batch_pcm_01");
    expect(cachedBatch?.stock_qty).toBe(8);
  });

  it("2. Internet drops mid-bill: degrades seamlessly to Offline Fallback and saves to durable WAL", async () => {
    // Mock network failure on fetch
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Failed to fetch: Connection reset by peer"))
    );

    // Pre-lease a block in local counter sequence: 1001 to 1050
    const fy = counterSequenceService.getCurrentFinancialYear();
    await sqliteStorage.insertRecord("counter_sequences", `C01_invoice_${fy}`, {
      id: `C01_invoice_${fy}`,
      counter_id: "C01",
      doc_type: "invoice",
      financial_year: fy,
      prefix: "C01-INV",
      range_start: 1001,
      range_end: 1050,
      next_number: 1001,
    });

    const payload: OnlineInvoicePayload = {
      external_id: "tx_mid_bill_drop",
      counter_code: "C01",
      customer_name: "Emergency Offline Customer",
      payment_mode: "Cash",
      items: [
        {
          product_id: "prod_pcm",
          batch_id: "batch_pcm_01",
          qty: 1,
          unit_price: 18,
        },
      ],
    };

    const res = await onlineTransactionService.submitAuthoritativeInvoice(payload);
    expect(res.success).toBe(true);
    expect(res.isOnline).toBe(false);
    expect(res.isOfflineQueued).toBe(true);
    expect(res.invoice.invoice_number).toBe("C01-INV-1001");

    // Verify durable write-ahead queue (WAL) persisted on disk/SQLite
    const walEntry = await sqliteStorage.findById<any>("offline_durable_queue", "tx_mid_bill_drop");
    expect(walEntry).not.toBeNull();
    expect(walEntry?.document_number).toBe("C01-INV-1001");

    // Local batch stock deducted optimistically
    const cachedBatch = await sqliteStorage.findById<any>("product_batches", "batch_pcm_01");
    expect(cachedBatch?.stock_qty).toBe(9);
  });

  it("3. Leased block exhaustion while offline: refuses the bill instead of inventing a number", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network Down")));

    // Sequence where next_number exceeds range_end
    const fy = counterSequenceService.getCurrentFinancialYear();
    await sqliteStorage.insertRecord("counter_sequences", `C01_invoice_${fy}`, {
      id: `C01_invoice_${fy}`,
      counter_id: "C01",
      doc_type: "invoice",
      financial_year: fy,
      prefix: "C01-INV",
      range_start: 1001,
      range_end: 1005,
      next_number: 1006, // Block exhausted!
    });

    const payload: OnlineInvoicePayload = {
      external_id: "tx_exhausted_block",
      counter_code: "C01",
      customer_name: "Customer During Exhaustion",
      items: [
        {
          product_id: "prod_pcm",
          batch_id: "batch_pcm_01",
          qty: 1,
          unit_price: 18,
        },
      ],
    };

    const res = await onlineTransactionService.submitAuthoritativeInvoice(payload);
    expect(res.success).toBe(false);
    expect(res.isOnline).toBe(false);
    expect(res.invoice).toBeNull();
    expect(res.error).toMatch(/connect it to the store server/i);

    // The refused bill must not leave a WAL row, a local invoice, or a queued item.
    expect(await sqliteStorage.findById("offline_durable_queue", "tx_exhausted_block")).toBeNull();
    const localInvoices = await sqliteStorage.findAll<any>("invoices");
    expect(localInvoices.some((row) => row.external_id === "tx_exhausted_block")).toBe(false);
    expect(await onlineTransactionService.getPendingQueueCount()).toBe(0);
  });

  it("4. Full-day offline billing simulation: multiple bills queued and synced in order", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));

    const fy = counterSequenceService.getCurrentFinancialYear();
    await sqliteStorage.insertRecord("counter_sequences", `C01_invoice_${fy}`, {
      id: `C01_invoice_${fy}`,
      counter_id: "C01",
      doc_type: "invoice",
      financial_year: fy,
      prefix: "C01-INV",
      range_start: 1001,
      range_end: 1100,
      next_number: 1001,
    });

    // Generate 5 offline bills
    for (let i = 1; i <= 5; i++) {
      await onlineTransactionService.submitAuthoritativeInvoice({
        external_id: `tx_day_offline_${i}`,
        counter_code: "C01",
        customer_name: `Offline Customer ${i}`,
        items: [{ product_id: "prod_pcm", batch_id: "batch_pcm_01", qty: 1, unit_price: 18 }],
      });
    }

    const pending = await onlineTransactionService.getPendingQueueCount();
    expect(pending).toBe(5);

    // Reconnect and process queue via mock client
    let processedCount = 0;
    const pushedNumbers: string[] = [];
    const mockApiClient: SyncApiClient = {
      async pushBatch(items) {
        processedCount += items.length;
        pushedNumbers.push(...items.map((item) => String((item.payload as any)?.invoice_number ?? "")));
        return {
          success: true,
          results: { total: items.length, processed: items.length, failed: 0 },
        };
      },
    };

    const syncRes = await syncQueueService.processQueue(mockApiClient);
    expect(syncRes.processed).toBe(5);
    expect(processedCount).toBe(5);
    // The server must receive the bills in the order the till saved them, with
    // the numbers the counter issued — not re-ordered by retry timing.
    expect(pushedNumbers).toEqual([
      "C01-INV-1001",
      "C01-INV-1002",
      "C01-INV-1003",
      "C01-INV-1004",
      "C01-INV-1005",
    ]);

    const pendingAfter = await onlineTransactionService.getPendingQueueCount();
    expect(pendingAfter).toBe(0);
  });

  it("5. Offline capability guard restricts administrative actions", () => {
    (onlineTransactionService as any).connectionState = "offline";

    // Sales billing & holds are allowed
    expect(offlineCapabilityGuard.isOperationAllowed("create_sale").allowed).toBe(true);
    expect(offlineCapabilityGuard.isOperationAllowed("hold_bill").allowed).toBe(true);
    expect(offlineCapabilityGuard.isOperationAllowed("print_receipt").allowed).toBe(true);

    // Historical cancel & master edits are blocked
    const cancelGuard = offlineCapabilityGuard.isOperationAllowed("cancel_synced_bill");
    expect(cancelGuard.allowed).toBe(false);
    expect(cancelGuard.reason).toContain("live cloud connection");

    const masterGuard = offlineCapabilityGuard.isOperationAllowed("master_edit");
    expect(masterGuard.allowed).toBe(false);

    // Live reports are allowed with watermarked flag
    const reportGuard = offlineCapabilityGuard.isOperationAllowed("live_reports");
    expect(reportGuard.allowed).toBe(true);
    expect(reportGuard.isWatermarked).toBe(true);
  });

  it("6. Live cross-counter document locking", async () => {
    // Counter 1 locks invoice 501 on server
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, message: "Locked" }),
      })
    );

    const lock1 = await documentLockService.acquireLock("501", "invoice", "C01", "u1", "Cashier Alice");
    expect(lock1.acquired).toBe(true);

    // Counter 2 attempts to lock the same invoice: server returns 423
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 423,
        json: () =>
          Promise.resolve({
            success: false,
            message: "Invoice is currently being edited on Counter C01.",
            locked_by_counter_id: "C01",
          }),
      })
    );

    const lock2 = await documentLockService.acquireLock("501", "invoice", "C02", "u2", "Cashier Bob");
    expect(lock2.acquired).toBe(false);
    expect(lock2.message?.toLowerCase()).toContain("counter c01");
  });

  it("7. Billing screen response time under slow connection: sub-300ms local cache render", async () => {
    // Simulate slow network (900ms delay)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }), 900))
      )
    );

    const start = performance.now();

    // Query product & batch from local SQLite cache
    const prod = await sqliteStorage.findById("products", "prod_pcm");
    const batch = await sqliteStorage.findById("product_batches", "batch_pcm_01");

    const duration = performance.now() - start;

    expect(prod).not.toBeNull();
    expect(batch).not.toBeNull();
    // Cache read must complete in under 50ms (well within the 300ms SLA)
    expect(duration).toBeLessThan(50);
  });

  it("8. Offline bill with a ₹500 note on a ₹210 bill keeps ₹210 and returns the rest (PAY-02)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));

    const fy = counterSequenceService.getCurrentFinancialYear();
    await sqliteStorage.insertRecord("counter_sequences", `C01_invoice_${fy}`, {
      id: `C01_invoice_${fy}`,
      counter_id: "C01",
      doc_type: "invoice",
      financial_year: fy,
      prefix: "C01-INV",
      range_start: 2001,
      range_end: 2050,
      next_number: 2001,
    });

    const res = await onlineTransactionService.submitAuthoritativeInvoice({
      external_id: "tx_change_offline",
      counter_code: "C01",
      customer_name: "Walk-in Customer",
      payment_mode: "Cash",
      payments: [{ mode: "Cash", amount: 500 }],
      items: [
        {
          product_id: "prod_pcm",
          batch_id: "batch_pcm_01",
          qty: 1,
          unit_price: 210,
        },
      ],
    });
    expect(res.success).toBe(true);

    const stored = await sqliteStorage.findById<any>("invoices", res.invoice!.id);
    const payments = (await sqliteStorage.findAll<any>("invoice_payments")).filter(
      (row) => row.invoice_id === res.invoice!.id
    );

    // The bill collected what it was worth, not the note the customer handed over.
    expect(stored.grand_total).toBe(210);
    expect(stored.paid_amount).toBe(210);
    expect(stored.payment_status).toBe("paid");
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(210);
    expect(payments[0].tendered_amount).toBe(500);
    expect(payments[0].change_amount).toBe(290);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { syncQueueService, type SyncApiClient } from "./syncQueueService";
import { DeviceAuthError } from "../auth/deviceAuthFailure";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";

describe("Sync Queue Service (SYNC-002, SYNC-003)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    vi.spyOn(syncQueueService, "isOnline").mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enqueues an invoice with auto-generated idempotency key", async () => {
    const invoiceId = "inv_test_101";
    const queueId = await syncQueueService.enqueue("invoice", invoiceId, "create", {
      invoice_number: "INV-2026-101",
      grand_total: 450,
    });

    expect(queueId).toBeDefined();

    const pending = await syncQueueService.getPendingItems();
    expect(pending.length).toBe(1);
    expect(pending[0].entity_id).toBe(invoiceId);
    expect(pending[0].status).toBe("pending");

    const payload = JSON.parse(pending[0].payload_json);
    expect(payload.idempotency_key).toBe("invoice_inv_test_101");
    expect(payload.invoice_number).toBe("INV-2026-101");
  });

  it("calculates exponential backoff delay correctly", () => {
    expect(syncQueueService.calculateBackoffMs(0)).toBe(2000);
    expect(syncQueueService.calculateBackoffMs(1)).toBe(4000);
    expect(syncQueueService.calculateBackoffMs(2)).toBe(8000);
    expect(syncQueueService.calculateBackoffMs(3)).toBe(16000);
    expect(syncQueueService.calculateBackoffMs(10)).toBe(60000); // capped at 60s
  });

  it("processes queue items and marks them synced upon API success", async () => {
    await syncQueueService.enqueue("invoice", "inv_1", "create", { amount: 100 });
    await syncQueueService.enqueue("invoice", "inv_2", "create", { amount: 200 });

    const mockApi: SyncApiClient = {
      pushInvoices: async (items) => ({ success: true, ingested_count: items.length }),
      pushStockEvents: async () => ({ success: true, ingested_count: 0 }),
    };

    const result = await syncQueueService.processQueue(mockApi);
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);

    const pending = await syncQueueService.getPendingItems();
    expect(pending.length).toBe(0);
  });

  it("handles network failure by setting retry delay and keeping item pending", async () => {
    await syncQueueService.enqueue("invoice", "inv_err_1", "create", { amount: 300 });

    const failingApi: SyncApiClient = {
      pushInvoices: async () => {
        throw new Error("503 Service Unavailable");
      },
      pushStockEvents: async () => ({ success: true, ingested_count: 0 }),
    };

    const result = await syncQueueService.processQueue(failingApi);
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);

    const all = await sqliteStorage.findAll<{ status: string; retry_count: number; last_error: string }>("sync_queue");
    expect(all[0].status).toBe("failed");
    expect(all[0].retry_count).toBe(1);
    expect(all[0].last_error).toContain("503 Service Unavailable");
  });

  it("syncs a single specific item individually via syncSingleItem", async () => {
    const qId = await syncQueueService.enqueue("invoice", "inv_single_1", "create", { amount: 500 });

    const mockApi: SyncApiClient = {
      pushBatch: async (items) => ({
        success: true,
        results: { total: items.length, processed: items.length, failed: 0 },
      }),
    };

    const res = await syncQueueService.syncSingleItem(qId, mockApi);
    expect(res.success).toBe(true);

    const updated = await sqliteStorage.findById<{ status: string }>("sync_queue", qId);
    expect(updated?.status).toBe("synced");
  });

  it("flags the local document synced once the server has taken it", async () => {
    await sqliteStorage.insertRecord("invoices", "inv_flag_1", {
      id: "inv_flag_1",
      invoice_number: "INV-2026-901",
      grand_total: 988,
      sync_state: "pending",
      updated_at: 111,
    });
    await syncQueueService.enqueue("invoice", "inv_flag_1", "update", {
      id: "inv_flag_1",
      grand_total: 988,
      updated_at: 111,
    });

    const mockApi: SyncApiClient = {
      pushBatch: async (items) => ({
        success: true,
        results: { total: items.length, processed: items.length, failed: 0 },
      }),
    };

    await syncQueueService.processQueue(mockApi);

    const row = await sqliteStorage.findById<{ sync_state: string }>("invoices", "inv_flag_1");
    expect(row?.sync_state).toBe("synced");
  });

  it("keeps a document pending when it was edited again while the push was in flight", async () => {
    await sqliteStorage.insertRecord("purchase_documents", "pur_flag_2", {
      id: "pur_flag_2",
      invoice_number: "PUR-902",
      sync_state: "pending",
      updated_at: 222,
    });
    await syncQueueService.enqueue("purchase", "pur_flag_2", "update", {
      id: "pur_flag_2",
      updated_at: 111,
    });

    const mockApi: SyncApiClient = {
      pushBatch: async (items) => ({
        success: true,
        results: { total: items.length, processed: items.length, failed: 0 },
      }),
    };

    await syncQueueService.processQueue(mockApi);

    const row = await sqliteStorage.findById<{ sync_state: string }>("purchase_documents", "pur_flag_2");
    expect(row?.sync_state).toBe("pending");
  });

  it("deletes a queue item and clears synced items", async () => {
    const q1 = await syncQueueService.enqueue("invoice", "inv_del_1", "create", { amount: 100 });
    const q2 = await syncQueueService.enqueue("invoice", "inv_del_2", "create", { amount: 200 });

    const deleted = await syncQueueService.deleteQueueItem(q1);
    expect(deleted).toBe(true);

    const remaining = await sqliteStorage.findAll("sync_queue");
    expect(remaining.length).toBe(1);
    expect((remaining[0] as any).id).toBe(q2);
  });

  it("SYNC-01: flushes offline bills in the order they were saved, not in retry order", async () => {
    const base = 1_700_000_000_000;
    let now = base;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);

    const failing: SyncApiClient = {
      pushBatch: async () => {
        throw new Error("network unreachable");
      },
    };

    await syncQueueService.enqueue("invoice", "inv_ord_1", "create", { invoice_number: "C01-INV-11001" });
    await syncQueueService.processQueue(failing);

    now += 2100;
    await syncQueueService.enqueue("invoice", "inv_ord_2", "create", { invoice_number: "C01-INV-11002" });
    await syncQueueService.processQueue(failing);

    now += 4400;
    await syncQueueService.enqueue("invoice", "inv_ord_3", "create", { invoice_number: "C01-INV-11003" });
    await syncQueueService.processQueue(failing);

    const queued = await sqliteStorage.findAll<{ next_retry_at?: number }>("sync_queue");
    expect(queued).toHaveLength(3);
    // A transport failure retries the queue as one unit; per-item clocks are
    // what let the first bill fall behind the bills saved after it.
    expect(new Set(queued.map((row) => row.next_retry_at)).size).toBe(1);

    const sent: string[] = [];
    const recorder: SyncApiClient = {
      pushBatch: async (items) => {
        sent.push(...items.map((item) => String(item.payload.invoice_number)));
        return { success: true, results: { total: items.length, processed: items.length, failed: 0 } };
      },
    };

    for (const offset of [8_500, 10_600, 30_000]) {
      now = base + offset;
      await syncQueueService.processQueue(recorder);
    }

    expect(sent).toEqual(["C01-INV-11001", "C01-INV-11002", "C01-INV-11003"]);
    expect(await syncQueueService.getPendingItems()).toHaveLength(0);
    nowSpy.mockRestore();
  });

  it("SYNC-01: keeps the bills the server rejected in the queue", async () => {
    for (const id of ["inv_partial_1", "inv_partial_2", "inv_partial_3"]) {
      await sqliteStorage.insertRecord("invoices", id, {
        id,
        invoice_number: `C01-INV-1100${id.slice(-1)}`,
        sync_state: "pending",
        updated_at: 100,
      });
    }

    await syncQueueService.enqueue("invoice", "inv_partial_1", "create", { updated_at: 100 });
    await syncQueueService.enqueue("invoice", "inv_partial_2", "create", { updated_at: 100 });
    const rejectedId = await syncQueueService.enqueue("invoice", "inv_partial_3", "create", { updated_at: 100 });

    const partiallyFailing: SyncApiClient = {
      pushBatch: async (items) => ({
        success: false,
        results: {
          total: items.length,
          processed: items.length - 1,
          failed: 1,
          errors: [{ id: rejectedId, entity_type: "invoice", error: "Document period is closed" }],
        },
      }),
    };

    const res = await syncQueueService.processQueue(partiallyFailing);
    expect(res.processed).toBe(2);
    expect(res.failed).toBe(1);

    const rejected = await sqliteStorage.findById<{ status: string; last_error?: string }>("sync_queue", rejectedId);
    expect(rejected?.status).not.toBe("synced");
    expect(rejected?.last_error).toContain("period is closed");

    const rejectedInvoice = await sqliteStorage.findById<{ sync_state: string }>("invoices", "inv_partial_3");
    expect(rejectedInvoice?.sync_state).toBe("pending");

    const takenInvoice = await sqliteStorage.findById<{ sync_state: string }>("invoices", "inv_partial_1");
    expect(takenInvoice?.sync_state).toBe("synced");
  });

  it("SYNC-01: reports bills waiting to be sent even while a retry is pending", async () => {
    await sqliteStorage.insertRecord("sync_queue", "q_waiting", {
      id: "q_waiting",
      entity_type: "invoice",
      entity_id: "inv_waiting",
      action: "create",
      payload_json: "{}",
      status: "failed",
      retry_count: 2,
      created_at: Date.now(),
      next_retry_at: Date.now() + 60_000,
    });

    const events: Array<{ pendingCount: number; unsentCount: number; isProcessing: boolean }> = [];
    const unsubscribe = syncQueueService.subscribe((status) => events.push(status));

    await syncQueueService.processQueue({
      pushBatch: async (items) => ({
        success: true,
        results: { total: items.length, processed: items.length, failed: 0 },
      }),
    });
    unsubscribe();

    expect(await syncQueueService.getPendingItems()).toHaveLength(0);
    expect(await syncQueueService.getUnsentCount()).toBe(1);
    expect(events.at(-1)?.unsentCount).toBe(1);
  });

  it("SYNC-02: pauses the queue when the device credential is rejected", async () => {
    await syncQueueService.enqueue("invoice", "inv_auth_1", "create", { invoice_number: "C02-INV-1051" });

    const res = await syncQueueService.processQueue({
      pushBatch: async () => {
        throw new DeviceAuthError(401, "DEVICE_AUTH_FAILED", "Device token is unrecognized or expired.");
      },
    });
    expect(res.processed).toBe(0);

    const [queued] = await sqliteStorage.findAll<{ status: string; retry_count: number }>("sync_queue");
    expect(queued.status).toBe("pending");
    expect(queued.retry_count || 0).toBe(0);

    let attempted = 0;
    await syncQueueService.processQueue({
      pushBatch: async (items) => {
        attempted++;
        return { success: true, results: { total: items.length, processed: items.length, failed: 0 } };
      },
    });
    expect(attempted).toBe(0);
  });
});

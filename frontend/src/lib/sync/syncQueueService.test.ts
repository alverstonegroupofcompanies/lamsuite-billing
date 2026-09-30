import { describe, it, expect, beforeEach } from "vitest";
import { syncQueueService, type SyncApiClient } from "./syncQueueService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";

describe("Sync Queue Service (SYNC-002, SYNC-003)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
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
});

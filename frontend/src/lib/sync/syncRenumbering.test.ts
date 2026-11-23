import { describe, it, expect, beforeEach } from "vitest";
import { syncQueueService, type SyncApiClient } from "./syncQueueService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { applyServerRenumbering, type ServerRenumbering } from "../billing/documentIdentity";

/**
 * CNT-014: a till that numbered a bill in the dark sends a temporary marker,
 * and the counter's series gives it the book number. The marker must not stay
 * on the till's shelf once the server has answered.
 */

const TEMP = "TEMP-C01-48219074";

function renumbered(overrides: Partial<ServerRenumbering> = {}): ServerRenumbering {
  return {
    external_id: "offline_inv_1",
    from: TEMP,
    to: "C01-INV-1001",
    doc_type: "invoice",
    counter_id: 12,
    ...overrides,
  };
}

describe("Offline numbers reconciled on sync (CNT-014)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  it("files the local invoice under the number the counter issued", async () => {
    await sqliteStorage.insertRecord("invoices", "offline_inv_1", {
      id: "offline_inv_1",
      external_id: "offline_inv_1",
      invoice_number: TEMP,
      module_key: "invoice",
      store_id: "7",
      grand_total: 500,
      sync_state: "pending",
      updated_at: 1,
    });

    await syncQueueService.enqueue("invoice", "offline_inv_1", "create", {
      id: "offline_inv_1",
      external_id: "offline_inv_1",
      invoice_number: TEMP,
      updated_at: 1,
    });

    const api: SyncApiClient = {
      pushInvoices: async () => ({
        success: true,
        ingested_count: 1,
        renumbered: [renumbered()],
      }),
    };

    const result = await syncQueueService.processQueue(api);
    expect(result.processed).toBe(1);

    const row = await sqliteStorage.findById<any>("invoices", "offline_inv_1");
    expect(row.invoice_number).toBe("C01-INV-1001");
    expect(row.sync_state).toBe("synced");
  });

  it("renames the local purchase bill the same way", async () => {
    await sqliteStorage.insertRecord("purchase_documents", "offline_pur_1", {
      id: "offline_pur_1",
      external_id: "offline_pur_1",
      invoice_number: "TEMP-C01-PUR-1188",
      module_key: "purchase",
      store_id: "7",
      sync_state: "pending",
      updated_at: 1,
    });

    await syncQueueService.enqueue("purchase", "offline_pur_1", "create", {
      id: "offline_pur_1",
      external_id: "offline_pur_1",
      invoice_number: "TEMP-C01-PUR-1188",
      updated_at: 1,
    });

    const api: SyncApiClient = {
      pushBatch: async () => ({
        success: true,
        results: { total: 1, processed: 1, failed: 0 },
        renumbered: [
          renumbered({
            external_id: "offline_pur_1",
            from: "TEMP-C01-PUR-1188",
            to: "C01-PUR-1001",
            doc_type: "purchase_bill",
          }),
        ],
      }),
    };

    await syncQueueService.processQueue(api);

    const row = await sqliteStorage.findById<any>("purchase_documents", "offline_pur_1");
    expect(row.invoice_number).toBe("C01-PUR-1001");
  });

  it("leaves a document the server kept alone", async () => {
    const records = [
      { id: "a", external_id: "a", invoice_number: "C01-INV-1001" },
      { id: "b", external_id: "b", invoice_number: TEMP },
    ];

    const renamed = applyServerRenumbering(records, [renumbered({ external_id: "b", to: "C01-INV-1007" })]);

    expect(renamed).toEqual([
      { id: "a", external_id: "a", invoice_number: "C01-INV-1001" },
      { id: "b", external_id: "b", invoice_number: "C01-INV-1007" },
    ]);
    expect(renamed[0].id).toBe("a");
    expect(records[0].invoice_number).toBe("C01-INV-1001");
  });

  it("never renumbers by a stale marker when the number is already gone", () => {
    const records = [{ id: "a", external_id: "a", invoice_number: "C01-INV-1001" }];

    expect(applyServerRenumbering(records, [renumbered()])).toEqual(records);
  });
});

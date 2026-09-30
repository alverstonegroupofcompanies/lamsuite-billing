import { describe, it, expect, beforeEach } from "vitest";
import { sqliteStorage, getMockDatabase } from "./sqliteStorage";

describe("SQLite Storage Engine (SYNC-001, NFR-DATA-01)", () => {
  beforeEach(() => {
    getMockDatabase().reset();
  });

  it("initializes SQLite database and applies latest schema migration", async () => {
    const version = await sqliteStorage.initDatabase();
    expect(version).toBe(1);

    const currentVersion = await sqliteStorage.getDatabaseVersion();
    expect(currentVersion).toBe(1);
    expect(sqliteStorage.isInitialized()).toBe(true);
  });

  it("stores and retrieves invoice with items in local SQLite", async () => {
    await sqliteStorage.initDatabase();

    const invoiceId = "inv_001";
    const invoiceData = {
      id: invoiceId,
      invoice_number: "INV-2026-0001",
      invoice_date: "2026-09-30",
      customer_name: "Walk-in Customer",
      subtotal: 500,
      tax_total: 25,
      round_off: 0,
      grand_total: 525,
      paid_amount: 525,
      status: "issued",
      sync_state: "pending",
      external_id: "ext-uuid-1",
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await sqliteStorage.insertRecord("invoices", invoiceId, invoiceData);

    const retrieved = await sqliteStorage.findById("invoices", invoiceId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.invoice_number).toBe("INV-2026-0001");
    expect(retrieved?.grand_total).toBe(525);
    expect(retrieved?.sync_state).toBe("pending");
  });

  it("stores products, batches, and double-entry stock transactions", async () => {
    await sqliteStorage.initDatabase();

    const productId = "prod_paracetamol";
    await sqliteStorage.insertRecord("products", productId, {
      id: productId,
      barcode: "8901234567890",
      name: "Paracetamol 500mg",
      mrp: 30,
      sel_rate: 25,
      gst_percent: 12,
      units_per_pack: 10,
      current_stock: 100,
    });

    const batchId = "batch_b01";
    await sqliteStorage.insertRecord("product_batches", batchId, {
      id: batchId,
      product_id: productId,
      batch_no: "B2026-01",
      expiry_date: "2027-12-31",
      stock_qty: 100,
    });

    const txId = "stk_tx_001";
    await sqliteStorage.insertRecord("stock_transactions", txId, {
      id: txId,
      product_id: productId,
      batch_id: batchId,
      event_type: "SALE",
      qty_delta: -10,
      created_at: Date.now(),
    });

    const batch = await sqliteStorage.findById("product_batches", batchId);
    expect(batch?.batch_no).toBe("B2026-01");

    const tx = await sqliteStorage.findById("stock_transactions", txId);
    expect(tx?.qty_delta).toBe(-10);
    expect(tx?.event_type).toBe("SALE");
  });

  it("enqueues mutation into sync_queue table for cloud sync worker", async () => {
    await sqliteStorage.initDatabase();

    const queueId = "queue_001";
    await sqliteStorage.insertRecord("sync_queue", queueId, {
      id: queueId,
      entity_type: "invoice",
      entity_id: "inv_001",
      action: "create",
      payload_json: JSON.stringify({ invoice_number: "INV-2026-0001" }),
      status: "pending",
      retry_count: 0,
      created_at: Date.now(),
    });

    const pending = await sqliteStorage.findAll("sync_queue");
    expect(pending.length).toBe(1);
    expect(pending[0].entity_type).toBe("invoice");
    expect(pending[0].status).toBe("pending");
  });
});

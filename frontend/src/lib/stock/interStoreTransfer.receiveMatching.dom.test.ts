import { describe, it, expect, beforeEach } from "vitest";
import { sqliteStorage, getMockDatabase } from "../db/sqliteStorage";
import { interStoreTransferService, type InterStoreTransfer } from "./interStoreTransferService";

/**
 * P-STORE-SCOPE: a till receives a transfer into ITS OWN store. The transfer
 * lines reference the sending store's product ids, so receive must resolve
 * each line to the receiving store's product (barcode first, then create
 * locally) — never assume the source product id exists here.
 */
describe("InterStoreTransferService receive matching (P-STORE-SCOPE)", () => {
  beforeEach(() => {
    getMockDatabase().reset();
    window.localStorage.setItem("lamsuite_active_store_id", "store_B");
    getMockDatabase().setStore("store_B");
  });

  function dispatchedTransfer(lineOverrides: Partial<InterStoreTransfer["lines"][number]> = {}): InterStoreTransfer {
    return {
      id: "st_trx_1",
      transfer_no: "TRF-FE-1",
      transfer_date: "2026-11-19",
      source_store_id: "store_A",
      source_store_name: "Store A",
      source_store_gstin: "",
      source_store_address: "",
      source_store_state_code: "32",
      destination_store_id: "store_B",
      destination_store_name: "Store B",
      destination_store_gstin: "",
      destination_store_address: "",
      destination_store_state_code: "32",
      transport_details: {},
      status: "dispatched",
      default_rate_basis: "sel_rate",
      gst_treatment: "intra_state",
      lines: [
        {
          id: "line_1",
          line_no: 1,
          product_id: "prod_src_1",
          product_name: "Paracetamol 500mg",
          barcode: "SRC-100",
          hsn_code: "30049099",
          batch_id: "batch_src_1",
          batch_no: "B1",
          expiry_date: "2030-06-30",
          units_per_pack: 10,
          pack_unit_name: "pack",
          loose_unit_name: "pc",
          available_stock_packs: 0,
          available_stock_loose: 0,
          available_stock_total: 10,
          transfer_packs: 0,
          transfer_loose: 5,
          transfer_total_qty: 5,
          remaining_stock_total: 5,
          rate_basis: "sel_rate",
          unit_rate: 22,
          loose_rate: 2.2,
          mrp: 25.5,
          taxable_amount: 110,
          gst_percent: 12,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 0,
          total_amount: 110,
          is_near_expiry: false,
          is_expired: false,
          warnings: [],
          ...lineOverrides,
        },
      ],
      item_count: 1,
      total_transfer_qty: 5,
      total_transfer_packs: 0.5,
      taxable_subtotal: 110,
      total_tax: 0,
      cgst_total: 0,
      sgst_total: 0,
      igst_total: 0,
      grand_total: 110,
      audit_logs: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    } as InterStoreTransfer;
  }

  async function seedTransfer(lineOverrides: Partial<InterStoreTransfer["lines"][number]> = {}) {
    const transfer = dispatchedTransfer(lineOverrides);
    await sqliteStorage.insertRecord("stock_transfers", transfer.id, transfer as unknown as Record<string, unknown>);
    return transfer;
  }

  it("matches the receiving store's product by barcode", async () => {
    await sqliteStorage.insertRecord("products", "prod_mine_1", {
      id: "prod_mine_1",
      name: "My Paracetamol",
      barcode: "SRC-100",
      gst_percent: 12,
      units_per_pack: 10,
      mrp: 25.5,
      sel_rate: 22,
      current_stock: 0,
      store_id: "store_B",
      sync_state: "synced",
    });

    const transfer = await seedTransfer();
    const received = await interStoreTransferService.receiveTransfer(transfer.id, [{ line_id: "line_1", received_packs: 0, received_loose: 5 }], "Receiver");

    expect(received.status).toBe("received");
    expect(received.lines[0].dest_product_id).toBe("prod_mine_1");
    expect(received.lines[0].dest_match).toBe("barcode");

    const mine = await sqliteStorage.findById<any>("products", "prod_mine_1");
    expect(mine.current_stock).toBe(5);

    const batch = (await sqliteStorage.findAll<any>("product_batches")).find(
      (b) => b.product_id === "prod_mine_1" && b.batch_no === "B1"
    );
    expect(batch).toBeTruthy();
    expect(batch.stock_qty).toBe(5);
    expect(batch.expiry_date).toBe("2030-06-30");

    const tx = (await sqliteStorage.findAll<any>("stock_transactions")).find(
      (t) => t.event_type === "TRANSFER_IN"
    );
    expect(tx?.product_id).toBe("prod_mine_1");
    expect(tx?.qty_delta).toBe(5);
  });

  it("creates an independent product in my store when nothing matches", async () => {
    const transfer = await seedTransfer();
    const received = await interStoreTransferService.receiveTransfer(transfer.id, [{ line_id: "line_1", received_packs: 0, received_loose: 5 }], "Receiver");

    expect(received.status).toBe("received");
    expect(received.lines[0].dest_match).toBe("created");

    const createdId = received.lines[0].dest_product_id!;
    const created = await sqliteStorage.findById<any>("products", createdId);
    expect(created).toBeTruthy();
    expect(created.name).toBe("Paracetamol 500mg");
    expect(created.barcode).toBe("SRC-100");
    expect(created.store_id).toBe("store_B");
    expect(created.sync_state).toBe("pending");
    expect(created.current_stock).toBe(5);

    const batch = (await sqliteStorage.findAll<any>("product_batches")).find(
      (b) => b.product_id === createdId && b.batch_no === "B1"
    );
    expect(batch).toBeTruthy();
    expect(batch.stock_qty).toBe(5);
  });

  it("refuses to credit a barcode twin that disagrees on HSN or GST", async () => {
    await sqliteStorage.insertRecord("products", "prod_twin_1", {
      id: "prod_twin_1",
      name: "Glow Face Cream 50g",
      barcode: "SRC-100",
      hsn_sac_code: "33049910",
      gst_percent: 18,
      units_per_pack: 1,
      mrp: 499,
      sel_rate: 449,
      current_stock: 0,
      store_id: "store_B",
      sync_state: "synced",
    });

    const transfer = await seedTransfer();

    await expect(
      interStoreTransferService.receiveTransfer(transfer.id, [{ line_id: "line_1", received_packs: 0, received_loose: 5 }], "Receiver")
    ).rejects.toThrow(/Glow Face Cream 50g.*Paracetamol 500mg|Paracetamol 500mg.*Glow Face Cream 50g/);

    const twin = await sqliteStorage.findById<any>("products", "prod_twin_1");
    expect(twin.current_stock).toBe(0);
  });

  it("never matches or mutates a foreign store's product", async () => {
    getMockDatabase().setStore("store_A");
    await sqliteStorage.insertRecord("products", "prod_foreign_1", {
      id: "prod_foreign_1",
      name: "Store A Paracetamol",
      barcode: "SRC-100",
      current_stock: 42,
      store_id: "store_A",
    });
    await sqliteStorage.insertRecord("product_batches", "batch_foreign_1", {
      id: "batch_foreign_1",
      product_id: "prod_foreign_1",
      batch_no: "B1",
      expiry_date: "2030-06-30",
      stock_qty: 42,
      store_id: "store_A",
    });
    getMockDatabase().setStore("store_B");

    const transfer = await seedTransfer();
    await interStoreTransferService.receiveTransfer(transfer.id, [{ line_id: "line_1", received_packs: 0, received_loose: 5 }], "Receiver");

    const createdList = (await sqliteStorage.findAll<any>("products")).filter(
      (p) => p.store_id === "store_B" || !p.store_id
    );
    expect(createdList.some((p) => p.barcode === "SRC-100")).toBe(true);

    getMockDatabase().setStore("store_A");
    const foreign = await sqliteStorage.findById<any>("products", "prod_foreign_1");
    expect(foreign.current_stock).toBe(42);
    const foreignBatch = await sqliteStorage.findById<any>("product_batches", "batch_foreign_1");
    expect(foreignBatch.stock_qty).toBe(42);
    getMockDatabase().setStore("store_B");
  });
});

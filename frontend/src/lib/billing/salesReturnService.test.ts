import { describe, it, expect, beforeEach } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore } from "../masters/productsStore";
import { partiesStore } from "../masters/partiesStore";
import {
  salesReturnService,
  toBaseUnits,
  returnKey,
  buildReturnableQtyMap,
  type SalesReturnInput,
} from "./salesReturnService";

describe("salesReturnService - Credit Notes & Sales Returns", () => {
  const dummyProduct = {
    id: "prod_dolo_sr",
    name: "Dolo 650 Tablet",
    barcode: "8901234000111",
    mrp: 32.0,
    sel_rate: 30.0,
    gst_percent: 12,
    units_per_pack: 15,
    is_active: true,
  };

  const dummyBatch = {
    id: "batch_dolo_sr1",
    product_id: "prod_dolo_sr",
    batch_no: "DL2601",
    expiry_date: "2027-10",
    stock_qty: 100,
    selling_rate: 30.0,
  };

  beforeEach(async () => {
    await sqliteStorage.initDatabase();
    await sqliteStorage.clearTable("sales_returns");
    await sqliteStorage.clearTable("invoices");
    await sqliteStorage.clearTable("invoice_items");
    await sqliteStorage.clearTable("stock_transactions");
    await sqliteStorage.clearTable("products");
    await sqliteStorage.clearTable("product_batches");
    await sqliteStorage.clearTable("customers");

    await productsStore.upsertProduct(dummyProduct);
    await productsStore.upsertBatch({ ...dummyBatch });

    await partiesStore.upsertCustomer({
      id: "cust_test_sr",
      name: "Amit Sharma",
      phone: "9876543210",
      outstanding_balance: 500,
      credit_limit: 2000,
      is_active: true,
    });
  });

  it("successfully creates a sales return, restores batch stock, and records credit note", async () => {
    const input: SalesReturnInput = {
      original_invoice_number: "INV-2026-0001",
      original_invoice_date: "2026-10-01",
      customer_id: "cust_test_sr",
      customer_name: "Amit Sharma",
      customer_phone: "9876543210",
      refund_mode: "Cash",
      lines: [
        {
          product_id: "prod_dolo_sr",
          product_name: "Dolo 650 Tablet",
          hsn_code: "30049099",
          batch_id: "batch_dolo_sr1",
          batch_no: "DL2601",
          expiry_date: "2027-10",
          sold_qty: 4,
          return_qty: 1, // Return 1 of 4
          unit_price: 30.0,
          discount_percent: 0,
          gst_percent: 12,
          reason: "customer_return",
          condition: "restock",
        },
      ],
    };

    const res = await salesReturnService.createSalesReturn(input);
    expect(res.success).toBe(true);
    expect(res.returnNumber).toMatch(/^SR-/);

    // Stock should increase from 100 to 101
    const updatedBatch = await sqliteStorage.findById<any>("product_batches", "batch_dolo_sr1");
    expect(updatedBatch.stock_qty).toBe(101);

    // Financial check: 1 unit @ 30.0 = Taxable 30.00, GST 12% = 3.60, Total = 33.60 -> rounded 34.00
    expect(res.grandTotal).toBe(34);

    // Verify record in sales_returns
    const saved = await salesReturnService.getSalesReturnById(res.returnId);
    expect(saved).not.toBeNull();
    expect(saved?.lines.length).toBe(1);
    expect(saved?.status).toBe("completed");
    expect(saved?.refund_amount).toBe(34);
  });

  it("enforces hard limit: cannot return more than sold_qty - already_returned_qty", async () => {
    // 1st Return: Return 1 of 4 items
    const return1: SalesReturnInput = {
      original_invoice_number: "INV-2026-0002",
      customer_name: "Amit Sharma",
      refund_mode: "Cash",
      lines: [
        {
          product_id: "prod_dolo_sr",
          product_name: "Dolo 650 Tablet",
          batch_id: "batch_dolo_sr1",
          batch_no: "DL2601",
          sold_qty: 4,
          return_qty: 1,
          unit_price: 30.0,
          gst_percent: 12,
          reason: "customer_return",
          condition: "restock",
        },
      ],
    };
    await salesReturnService.createSalesReturn(return1);

    // 2nd Return attempt: try to return 4 more items (remaining is only 3) -> MUST FAIL
    const return2Excess: SalesReturnInput = {
      original_invoice_number: "INV-2026-0002",
      customer_name: "Amit Sharma",
      refund_mode: "Cash",
      lines: [
        {
          product_id: "prod_dolo_sr",
          product_name: "Dolo 650 Tablet",
          batch_id: "batch_dolo_sr1",
          batch_no: "DL2601",
          sold_qty: 4,
          return_qty: 4, // 1 already returned, so 4 is greater than 3!
          unit_price: 30.0,
          gst_percent: 12,
          reason: "customer_return",
          condition: "restock",
        },
      ],
    };

    await expect(salesReturnService.createSalesReturn(return2Excess)).rejects.toThrow(
      /Maximum available to return is 3/
    );

    // 3rd Return attempt: returning exactly 3 (the remainder) -> MUST SUCCEED
    const return3Valid: SalesReturnInput = {
      original_invoice_number: "INV-2026-0002",
      customer_name: "Amit Sharma",
      refund_mode: "Cash",
      lines: [
        {
          product_id: "prod_dolo_sr",
          product_name: "Dolo 650 Tablet",
          batch_id: "batch_dolo_sr1",
          batch_no: "DL2601",
          sold_qty: 4,
          return_qty: 3,
          unit_price: 30.0,
          gst_percent: 12,
          reason: "customer_return",
          condition: "restock",
        },
      ],
    };
    const res3 = await salesReturnService.createSalesReturn(return3Valid);
    expect(res3.success).toBe(true);

    // 4th Return attempt: trying to return even 1 more -> MUST FAIL (0 remaining)
    const return4Exhausted: SalesReturnInput = {
      original_invoice_number: "INV-2026-0002",
      customer_name: "Amit Sharma",
      refund_mode: "Cash",
      lines: [
        {
          product_id: "prod_dolo_sr",
          product_name: "Dolo 650 Tablet",
          batch_id: "batch_dolo_sr1",
          batch_no: "DL2601",
          sold_qty: 4,
          return_qty: 1,
          unit_price: 30.0,
          gst_percent: 12,
          reason: "customer_return",
          condition: "restock",
        },
      ],
    };
    await expect(salesReturnService.createSalesReturn(return4Exhausted)).rejects.toThrow(
      /Maximum available to return is 0/
    );
  });

  it("handles condition 'damaged_discard' without adding to sellable batch stock", async () => {
    const input: SalesReturnInput = {
      original_invoice_number: "INV-2026-0003",
      customer_name: "Amit Sharma",
      refund_mode: "Cash",
      lines: [
        {
          product_id: "prod_dolo_sr",
          product_name: "Dolo 650 Tablet",
          batch_id: "batch_dolo_sr1",
          batch_no: "DL2601",
          sold_qty: 2,
          return_qty: 2,
          unit_price: 30.0,
          gst_percent: 12,
          reason: "damaged",
          condition: "damaged_discard", // do NOT add to sellable stock
        },
      ],
    };

    await salesReturnService.createSalesReturn(input);

    // Stock should remain 100 (NOT 102)
    const batch = await sqliteStorage.findById<any>("product_batches", "batch_dolo_sr1");
    expect(batch.stock_qty).toBe(100);

    // Stock transaction should be logged as DAMAGED_RETURN
    const txs = await sqliteStorage.findAll<any>("stock_transactions");
    const damTx = txs.find((t) => t.event_type === "DAMAGED_RETURN");
    expect(damTx).toBeDefined();
    expect(damTx.qty_delta).toBe(0);
  });

  it("updates customer outstanding balance when refund mode is Credit Adjust", async () => {
    const input: SalesReturnInput = {
      original_invoice_number: "INV-2026-0004",
      customer_id: "cust_test_sr",
      customer_name: "Amit Sharma",
      refund_mode: "Credit Adjust",
      lines: [
        {
          product_id: "prod_dolo_sr",
          product_name: "Dolo 650 Tablet",
          batch_id: "batch_dolo_sr1",
          batch_no: "DL2601",
          sold_qty: 1,
          return_qty: 1,
          unit_price: 30.0,
          gst_percent: 12,
          reason: "customer_return",
          condition: "restock",
        },
      ],
    };

    const res = await salesReturnService.createSalesReturn(input);
    expect(res.grandTotal).toBe(34);

    // Customer outstanding was 500, now should be 500 - 34 = 466
    const cust = await partiesStore.getCustomerById("cust_test_sr");
    expect(cust?.outstanding_balance).toBe(466);
  });

  it("cancelling a sales return reverses stock and customer ledger adjustments", async () => {
    const input: SalesReturnInput = {
      original_invoice_number: "INV-2026-0005",
      customer_id: "cust_test_sr",
      customer_name: "Amit Sharma",
      refund_mode: "Credit Adjust",
      lines: [
        {
          product_id: "prod_dolo_sr",
          product_name: "Dolo 650 Tablet",
          batch_id: "batch_dolo_sr1",
          batch_no: "DL2601",
          sold_qty: 2,
          return_qty: 2,
          unit_price: 30.0,
          gst_percent: 12,
          reason: "customer_return",
          condition: "restock",
        },
      ],
    };

    const created = await salesReturnService.createSalesReturn(input);
    expect((await sqliteStorage.findById<any>("product_batches", "batch_dolo_sr1")).stock_qty).toBe(102);

    // Cancel the return
    const cancelRes = await salesReturnService.cancelSalesReturn(created.returnId, "Customer decided to keep items");
    expect(cancelRes.success).toBe(true);

    // Batch stock restored back to 100
    expect((await sqliteStorage.findById<any>("product_batches", "batch_dolo_sr1")).stock_qty).toBe(100);

    // Customer outstanding restored back to 500
    const cust = await partiesStore.getCustomerById("cust_test_sr");
    expect(cust?.outstanding_balance).toBe(500);

    // Return status marked cancelled
    const ret = await salesReturnService.getSalesReturnById(created.returnId);
    expect(ret?.status).toBe("cancelled");
    expect(ret?.cancellation_reason).toBe("Customer decided to keep items");
  });

  const queueItemFor = async (returnId: string) => {
    const queue = await sqliteStorage.findAll<any>("sync_queue");
    return queue
      .filter((q) => q.entity_id === returnId)
      .sort((a, b) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0))
      .pop();
  };

  const parsePayload = (item: any) => JSON.parse(item.payload_json ?? item.payload ?? "{}");

  const returnInput: SalesReturnInput = {
    original_invoice_number: "INV-2026-0009",
    customer_id: "cust_test_sr",
    customer_name: "Amit Sharma",
    refund_mode: "Cash",
    lines: [
      {
        product_id: "prod_dolo_sr",
        product_name: "Dolo 650 Tablet",
        hsn_code: "30049099",
        batch_id: "batch_dolo_sr1",
        batch_no: "DL2601",
        sold_qty: 4,
        return_qty: 1,
        unit_price: 30.0,
        gst_percent: 12,
        reason: "customer_return",
        condition: "restock",
      },
    ],
  };

  it("cancelling a pack return takes the same base units back out of stock", async () => {
    // 1 pack of 15 went back on the shelf when the return was booked; cancelling has to remove 15.
    const input: SalesReturnInput = {
      original_invoice_number: "INV-2026-0010",
      customer_name: "Amit Sharma",
      refund_mode: "Cash",
      lines: [
        {
          product_id: "prod_dolo_sr",
          product_name: "Dolo 650 Tablet",
          batch_id: "batch_dolo_sr1",
          batch_no: "DL2601",
          sold_qty: 30,
          return_qty: 1,
          loose_qty: 2,
          units_per_pack: 15,
          unit_price: 30.0,
          gst_percent: 12,
          reason: "customer_return",
          condition: "restock",
        },
      ],
    };

    const created = await salesReturnService.createSalesReturn(input);
    expect((await sqliteStorage.findById<any>("product_batches", "batch_dolo_sr1")).stock_qty).toBe(117);

    await salesReturnService.cancelSalesReturn(created.returnId, "Customer kept the goods");

    const batch = await sqliteStorage.findById<any>("product_batches", "batch_dolo_sr1");
    expect(batch.stock_qty).toBe(100);

    const reversal = (await sqliteStorage.findAll<any>("stock_transactions")).find(
      (t) => t.event_type === "RETURN_CANCELLED"
    );
    expect(reversal.qty_delta).toBe(-17);
  });

  it("pushes the credit note with its lines, not the bare return record", async () => {
    const created = await salesReturnService.createSalesReturn(returnInput);

    const queued = await queueItemFor(created.returnId);
    expect(queued).toBeDefined();
    expect(queued.entity_type).toBe("invoice");
    expect(queued.action).toBe("create");

    const payload = parsePayload(queued);
    expect(payload.module_key).toBe("credit_note");
    expect(payload.invoice_number).toBe(created.returnNumber);
    expect(payload.status).toBe("issued");
    expect(payload.original_invoice_number).toBe("INV-2026-0009");
    expect(payload.grand_total).toBe(created.grandTotal);

    expect(payload.items.length).toBe(1);
    expect(payload.items[0].qty).toBe(1);
    // The server has to be told which lines never went back on the shelf, or it restocks discards.
    expect(payload.items[0].stock_action).toBe("restock");
    expect(payload.items[0].taxable_amount).toBe(30);
    expect(payload.items[0].cgst_amount).toBe(1.8);
    expect(payload.items[0].sgst_amount).toBe(1.8);
    // The server only re-prices from lines it can see, and a line with no tax_amount reads as
    // untaxed in every GST report.
    expect(payload.items[0].tax_amount).toBe(3.6);
  });

  it("pushes a cancellation as header only so the credit note keeps its lines", async () => {
    const created = await salesReturnService.createSalesReturn(returnInput);
    await salesReturnService.cancelSalesReturn(created.returnId, "Entered in error");

    const queued = await queueItemFor(created.returnId);
    expect(queued.action).toBe("update");

    const payload = parsePayload(queued);
    expect(payload.status).toBe("cancelled");
    expect(payload.cancel_reason).toBe("Entered in error");
    expect(payload.invoice_number).toBe(created.returnNumber);
    expect(payload.items).toBeUndefined();
    expect(payload.grand_total).toBeUndefined();
  });

  it("converts packs and loose units into base units", () => {
    expect(toBaseUnits(2, 3, 10)).toBe(23);
    expect(toBaseUnits(undefined, undefined, undefined)).toBe(0);
    expect(toBaseUnits(1, 0, 0)).toBe(1);
  });

  it("builds returnable base units per product and batch", () => {
    const items = [
      { product_id: "p1", batch_no: "B1", qty: 3, loose_qty: 2, units_per_pack: 10 },
      { product_id: "p2", batch_no: "B2", qty: 1, loose_qty: 0, units_per_pack: 5 },
    ];
    const returned = new Map([[returnKey("p1", "B1"), 12]]);
    const map = buildReturnableQtyMap(items, returned);
    expect(map.get(returnKey("p1", "B1"))).toBe(20);
    expect(map.get(returnKey("p2", "B2"))).toBe(5);
  });

  it("counts credit notes against the original invoice in base units", async () => {
    await sqliteStorage.insertRecord("invoices", "cn_1", {
      id: "cn_1",
      module_key: "credit_note",
      invoice_number: "CN-100",
      invoice_date: "2026-10-01",
      original_invoice_number: "INV-CN-1",
      status: "issued",
      grand_total: 100,
    });
    await sqliteStorage.insertRecord("invoice_items", "cn_item_1", {
      id: "cn_item_1",
      invoice_id: "cn_1",
      product_id: "prod_dolo_sr",
      product_name: "Dolo 650 Tablet",
      batch_no: "DL2601",
      qty: 1,
      loose_qty: 2,
      units_per_pack: 15,
      unit_price: 30,
    });
    await sqliteStorage.insertRecord("invoices", "cn_cancelled", {
      id: "cn_cancelled",
      module_key: "credit_note",
      invoice_number: "CN-101",
      invoice_date: "2026-10-02",
      original_invoice_number: "INV-CN-1",
      status: "cancelled",
      grand_total: 30,
    });
    await sqliteStorage.insertRecord("invoice_items", "cn_item_cancelled", {
      id: "cn_item_cancelled",
      invoice_id: "cn_cancelled",
      product_id: "prod_dolo_sr",
      product_name: "Dolo 650 Tablet",
      batch_no: "DL2601",
      qty: 1,
      loose_qty: 0,
      units_per_pack: 15,
      unit_price: 30,
    });

    const map = await salesReturnService.getReturnedQtyMapForInvoice("INV-CN-1");
    expect(map.get(returnKey("prod_dolo_sr", "DL2601"))).toBe(17);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore } from "../masters/productsStore";
import { partiesStore } from "../masters/partiesStore";
import {
  salesReturnService,
  toBaseUnits,
  buildReturnableQtyMap,
  type SalesReturnInput,
} from "./salesReturnService";
import { returnKey } from "./salesReturnPricing";
import { onlineTransactionService } from "../sync/onlineTransactionService";
import { storeDeviceService } from "../auth/storeDeviceService";

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

  // A counter return always credits a bill the till can see, so the money tests seed
  // that bill and the credit is reversed from what the customer actually paid.
  const seedOriginal = async (
    invoiceNumber: string,
    line: {
      qty: number;
      unit_price: number;
      taxable_amount: number;
      cgst_amount: number;
      sgst_amount: number;
      total_amount: number;
    }
  ) => {
    const id = `inv_${invoiceNumber}`;
    const tax = Math.round((line.total_amount - line.taxable_amount) * 100) / 100;
    await sqliteStorage.insertRecord("invoices", id, {
      id,
      module_key: "invoice",
      invoice_number: invoiceNumber,
      invoice_date: "2026-11-01",
      customer_name: "Amit Sharma",
      status: "issued",
      subtotal: line.taxable_amount,
      taxable_subtotal: line.taxable_amount,
      tax_total: tax,
      cgst_total: line.cgst_amount,
      sgst_total: line.sgst_amount,
      grand_total: line.total_amount,
      paid_amount: line.total_amount,
      place_of_supply: "32-Kerala",
      store_state_code: "32",
    });
    await sqliteStorage.insertRecord("invoice_items", `item_${invoiceNumber}`, {
      id: `item_${invoiceNumber}`,
      invoice_id: id,
      product_id: "prod_dolo_sr",
      product_name: "Dolo 650 Tablet",
      batch_no: "DL2601",
      qty: line.qty,
      loose_qty: 0,
      units_per_pack: 1,
      unit_price: line.unit_price,
      gst_percent: 12,
      taxable_amount: line.taxable_amount,
      cgst_amount: line.cgst_amount,
      sgst_amount: line.sgst_amount,
      tax_amount: tax,
      total_amount: line.total_amount,
    });
  };

  it("successfully creates a sales return, restores batch stock, and records credit note", async () => {
    // 4 units sold at ₹30 each, GST-inclusive: 107.14 taxable + 12.86 tax = 120.00.
    await seedOriginal("INV-2026-0001", {
      qty: 4,
      unit_price: 30,
      taxable_amount: 107.14,
      cgst_amount: 6.43,
      sgst_amount: 6.43,
      total_amount: 120,
    });
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

    // Financial check: 30 is MRP-inclusive, so the credit is 26.79 + 3.21, not 30 + 12%.
    expect(res.grandTotal).toBe(30);

    // Verify record in sales_returns
    const saved = await salesReturnService.getSalesReturnById(res.returnId);
    expect(saved).not.toBeNull();
    expect(saved?.lines.length).toBe(1);
    expect(saved?.status).toBe("completed");
    expect(saved?.refund_amount).toBe(30);
  });

  it("refunds an inclusive-priced line at the value it was sold for", async () => {
    // 15 tablets sold for 90.00 inclusive of 12%: 80.36 taxable + 9.64 tax.
    await sqliteStorage.insertRecord("invoices", "inv_inc_1", {
      id: "inv_inc_1",
      module_key: "invoice",
      invoice_number: "INV-INC-1",
      invoice_date: "2026-11-01",
      status: "issued",
      subtotal: 90,
      taxable_subtotal: 80.36,
      tax_total: 9.64,
      cgst_total: 4.82,
      sgst_total: 4.82,
      grand_total: 90,
      paid_amount: 90,
      place_of_supply: "32-Kerala",
      store_state_code: "32",
    });
    await sqliteStorage.insertRecord("invoice_items", "inv_inc_item_1", {
      id: "inv_inc_item_1",
      invoice_id: "inv_inc_1",
      product_id: "prod_dolo_sr",
      product_name: "Dolo 650 Tablet",
      batch_no: "DL2601",
      qty: 1,
      loose_qty: 0,
      units_per_pack: 15,
      unit_price: 90,
      gst_percent: 12,
      taxable_amount: 80.36,
      cgst_amount: 4.82,
      sgst_amount: 4.82,
      tax_amount: 9.64,
      total_amount: 90,
    });

    const res = await salesReturnService.createSalesReturn({
      original_invoice_number: "INV-INC-1",
      customer_name: "Walk-in Customer",
      refund_mode: "Cash",
      lines: [
        {
          product_id: "prod_dolo_sr",
          product_name: "Dolo 650 Tablet",
          batch_id: "batch_dolo_sr1",
          batch_no: "DL2601",
          sold_qty: 15,
          return_qty: 5,
          unit_price: 90,
          gst_percent: 12,
          reason: "customer_return",
          condition: "restock",
        },
      ],
    });

    expect(res.grandTotal).toBe(30);

    const saved = await salesReturnService.getSalesReturnById(res.returnId);
    expect(saved?.lines[0].total_amount).toBe(30);
    expect(saved?.lines[0].taxable_amount).toBe(26.79);
    expect(saved?.lines[0].cgst_amount).toBe(1.61);
    expect(saved?.lines[0].sgst_amount).toBe(1.6);

    const mirror = await sqliteStorage.findById<any>("invoices", res.returnId);
    expect(mirror.grand_total).toBe(30);
    expect(mirror.taxable_subtotal).toBe(26.79);
    expect(mirror.round_off).toBe(0);
    expect(mirror.paid_amount).toBe(30);
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
    await seedOriginal("INV-2026-0004", {
      qty: 1,
      unit_price: 30,
      taxable_amount: 26.79,
      cgst_amount: 1.61,
      sgst_amount: 1.6,
      total_amount: 30,
    });
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
    expect(res.grandTotal).toBe(30);

    // Customer outstanding was 500, now should be 500 - 30 = 470
    const cust = await partiesStore.getCustomerById("cust_test_sr");
    expect(cust?.outstanding_balance).toBe(470);
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
    await seedOriginal("INV-2026-0009", {
      qty: 4,
      unit_price: 30,
      taxable_amount: 107.14,
      cgst_amount: 6.43,
      sgst_amount: 6.43,
      total_amount: 120,
    });
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
    expect(payload.items[0].taxable_amount).toBe(26.79);
    expect(payload.items[0].cgst_amount).toBe(1.61);
    expect(payload.items[0].sgst_amount).toBe(1.6);
    // The server only re-prices from lines it can see, and a line with no tax_amount reads as
    // untaxed in every GST report.
    expect(payload.items[0].tax_amount).toBe(3.21);
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

/**
 * A return only ever lived in the table of the till that typed it: a legacy migration, a note
 * raised at another counter or one posted in the admin panel existed in the backend and nowhere
 * in the till. These cover the read that fixed that.
 */
describe("salesReturnService - credit notes held on the server", () => {
  const serverNote = {
    id: 91,
    external_id: null,
    module_key: "credit_note",
    invoice_number: "CN-1-0042",
    invoice_date: "2026-11-20",
    original_invoice_number: "INV-1-0100",
    customer_name: "Ravi Verma",
    customer_phone: "9812300000",
    subtotal: 300,
    discount_total: 0,
    tax_total: 33.9,
    cgst_total: 16.95,
    sgst_total: 16.95,
    igst_total: 0,
    round_off: 0.1,
    grand_total: -334,
    paid_amount: -334,
    payment_mode: "Cash",
    status: "issued",
    created_at: "2026-11-20T09:30:00.000000Z",
    updated_at: "2026-11-20T09:30:00.000000Z",
    items: [
      {
        id: 501,
        product_id: 12,
        product_name: "Dolo 650 Tablet",
        batch_no: "DL2601",
        expiry_date: "2027-10",
        qty: 10,
        unit_price: 30,
        gst_percent: 12,
        taxable_amount: 267.86,
        cgst_amount: 16.07,
        sgst_amount: 16.07,
        total_amount: 300,
        stock_action: "restock",
      },
    ],
  };

  const untypedNote = {
    ...serverNote,
    id: 92,
    module_key: "",
    invoice_number: "MIG-CN-7",
    created_at: "2026-11-18 08:00:00",
    items: [],
  };

  const asked = (calls: any[][], url: string) => calls.some(([target]) => String(target).includes(url));

  beforeEach(async () => {
    await sqliteStorage.initDatabase();
    await sqliteStorage.clearTable("sales_returns");
    vi.spyOn(onlineTransactionService, "getEffectiveBaseUrl").mockReturnValue("http://server.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists the notes this till never held, with their lines", async () => {
    const calls: any[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (...args: any[]) => {
        calls.push(args);
        return { ok: true, json: async () => ({ data: [serverNote, untypedNote] }) };
      })
    );

    const list = await salesReturnService.getSalesReturns();

    expect(asked(calls, "/api/invoices?")).toBe(true);
    expect(String(calls[0][0])).toContain("module=credit_notes");
    expect(calls[0][1].headers["X-Store-Id"]).toBeTruthy();
    expect(list.map((r) => r.return_number)).toEqual(["CN-1-0042", "MIG-CN-7"]);

    const note = list[0];
    expect(note.customer_name).toBe("Ravi Verma");
    expect(note.original_invoice_number).toBe("INV-1-0100");
    expect(note.refund_mode).toBe("Cash");
    expect(note.refund_status).toBe("paid");
    expect(note.created_at).toBeGreaterThan(0);
    expect(note.lines).toHaveLength(1);
    expect(note.lines[0]).toMatchObject({
      product_name: "Dolo 650 Tablet",
      batch_no: "DL2601",
      return_qty: 10,
      unit_price: 30,
      condition: "restock",
      reason: "customer_return",
    });
  });

  it("authenticates the note read with this workstation's device token", async () => {
    // The till routes answer 401 without it, and a silent 401 is indistinguishable from a store
    // that has no credit notes — which is how the merged list first shipped looking empty.
    vi.spyOn(storeDeviceService, "getDeviceAuthHeaders").mockResolvedValue({
      "X-Device-Token": "tok-store-7",
      "X-Store-Id": "7",
      "Store-Id": "7",
    });
    const calls: any[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (...args: any[]) => {
        calls.push(args);
        return { ok: true, json: async () => ({ data: [serverNote] }) };
      })
    );

    const list = await salesReturnService.getSalesReturns();

    expect(list.map((r) => r.return_number)).toEqual(["CN-1-0042"]);
    expect(calls[0][1].headers["X-Device-Token"]).toBe("tok-store-7");
    expect(String(calls[0][0])).toContain("store_id=7");
  });

  it("keeps the till's own copy of a note the server also holds", async () => {
    await sqliteStorage.insertRecord("sales_returns", "sret_1", {
      id: "sret_1",
      return_number: "CN-1-0042",
      return_date: "2026-11-20",
      return_time: "09:30:00",
      customer_name: "Ravi Verma",
      lines: [
        {
          id: "sret_1_line",
          return_id: "sret_1",
          product_id: "prod_dolo_sr",
          product_name: "Dolo 650 Tablet",
          batch_id: "batch_dolo_sr1",
          batch_no: "DL2601",
          sold_qty: 10,
          return_qty: 10,
          unit_price: 30,
          gst_percent: 12,
          reason: "damaged",
          condition: "damaged_discard",
          discount_amount: 0,
          taxable_amount: 300,
          cgst_amount: 16.07,
          sgst_amount: 16.07,
          igst_amount: 0,
          total_amount: 334,
        },
      ],
      subtotal: 300,
      discount_total: 0,
      tax_total: 34,
      cgst_total: 17,
      sgst_total: 17,
      igst_total: 0,
      round_off: 0,
      grand_total: 334,
      refund_amount: 334,
      refund_mode: "Cash",
      refund_status: "paid",
      status: "completed",
      created_at: 1763600000000,
      updated_at: 1763600000000,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ ...serverNote, external_id: "sret_1" }] }),
      }))
    );

    const list = await salesReturnService.getSalesReturns();

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("sret_1");
    expect(list[0].lines[0].reason).toBe("damaged");
  });

  it("still answers from the local book when the server will not reply", async () => {
    await sqliteStorage.insertRecord("sales_returns", "sret_offline", {
      id: "sret_offline",
      return_number: "CN-OFF-1",
      return_date: "2026-11-25",
      return_time: "10:00:00",
      customer_name: "Walk-in Customer",
      lines: [],
      subtotal: 0,
      discount_total: 0,
      tax_total: 0,
      cgst_total: 0,
      sgst_total: 0,
      igst_total: 0,
      round_off: 0,
      grand_total: 10,
      refund_amount: 10,
      refund_mode: "Cash",
      refund_status: "paid",
      status: "completed",
      created_at: 1763900000000,
      updated_at: 1763900000000,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    const list = await salesReturnService.getSalesReturns();

    expect(list.map((r) => r.return_number)).toEqual(["CN-OFF-1"]);
  });
});

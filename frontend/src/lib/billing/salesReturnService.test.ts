import { describe, it, expect, beforeEach } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore } from "../masters/productsStore";
import { partiesStore } from "../masters/partiesStore";
import { salesReturnService, type SalesReturnInput } from "./salesReturnService";

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
    expect(res.returnNumber).toMatch(/^SR-\d{2}-\d{2}-\d{4}$/);

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
});

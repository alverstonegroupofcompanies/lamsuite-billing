import { describe, it, expect, beforeEach } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import {
  invoiceManagementService,
  type InvoiceRecord,
  type InvoiceItemRecord,
} from "./invoiceManagementService";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";
import { posCartService, type PosCartLine } from "./posCartService";
import { reportEngine } from "../reports/reportEngine";

describe("InvoiceManagementService", () => {
  const dummyProduct: ProductItem = {
    id: "prod_dolo_650",
    name: "Dolo 650 Tablet",
    barcode: "8901234567890",
    mrp: 32.0,
    sel_rate: 30.0,
    gst_percent: 12,
    units_per_pack: 15,
    is_active: true,
  };

  const dummyBatch: ProductBatch = {
    id: "batch_dolo_01",
    product_id: "prod_dolo_650",
    batch_no: "DL650-B1",
    expiry_date: "2027-12-31",
    stock_qty: 150, // 10 packs of 15
    mrp: 32.0,
    selling_rate: 30.0,
  };

  beforeEach(async () => {
    // Clear storage tables
    await sqliteStorage.clearTable("invoices");
    await sqliteStorage.clearTable("invoice_items");
    await sqliteStorage.clearTable("product_batches");
    await sqliteStorage.clearTable("products");
    await sqliteStorage.clearTable("stock_transactions");
    await sqliteStorage.clearTable("sync_queue");

    // Seed master product and batch
    await productsStore.upsertProduct(dummyProduct);
    await productsStore.upsertBatch({ ...dummyBatch });
  });

  it("lists invoices with search filtering across invoice number, customer, and line items", async () => {
    const now = Date.now();
    const todayStr = new Date().toISOString().slice(0, 10);

    const inv1: InvoiceRecord = {
      id: "inv_1",
      module_key: "invoice",
      invoice_number: "INV-1001",
      invoice_date: todayStr,
      customer_name: "Rahul Sharma",
      customer_phone: "9876543210",
      subtotal: 100,
      discount_total: 0,
      tax_total: 12,
      round_off: 0,
      grand_total: 112,
      paid_amount: 112,
      payment_mode: "Cash",
      status: "issued",
      created_at: now - 1000,
      updated_at: now - 1000,
    };

    const inv2: InvoiceRecord = {
      id: "inv_2",
      module_key: "invoice",
      invoice_number: "INV-1002",
      invoice_date: todayStr,
      customer_name: "Priya Nair",
      customer_phone: "9988776655",
      subtotal: 200,
      discount_total: 0,
      tax_total: 24,
      round_off: 0,
      grand_total: 224,
      paid_amount: 224,
      payment_mode: "UPI",
      status: "issued",
      created_at: now,
      updated_at: now,
    };

    await sqliteStorage.insertRecord("invoices", inv1.id, inv1 as unknown as Record<string, unknown>);
    await sqliteStorage.insertRecord("invoices", inv2.id, inv2 as unknown as Record<string, unknown>);

    const item1: InvoiceItemRecord = {
      id: "item_1",
      invoice_id: "inv_1",
      product_id: "prod_dolo_650",
      product_name: "Dolo 650 Tablet",
      batch_no: "DL650-B1",
      expiry_date: "2027-12-31",
      qty: 2,
      loose_qty: 0,
      units_per_pack: 15,
      unit_price: 30,
      gst_percent: 12,
      total_amount: 60,
    };
    await sqliteStorage.insertRecord("invoice_items", item1.id, item1 as unknown as Record<string, unknown>);

    // Search by customer name
    const resName = await invoiceManagementService.listInvoices({ searchQuery: "rahul" });
    expect(resName.length).toBe(1);
    expect(resName[0].invoice_number).toBe("INV-1001");

    // Search by product name in line items
    const resProd = await invoiceManagementService.listInvoices({ searchQuery: "dolo" });
    expect(resProd.length).toBe(1);
    expect(resProd[0].invoice_number).toBe("INV-1001");

    // Filter by payment mode
    const resUPI = await invoiceManagementService.listInvoices({ paymentMode: "UPI" });
    expect(resUPI.length).toBe(1);
    expect(resUPI[0].invoice_number).toBe("INV-1002");

    // Filter by dateRange: 'month'
    const resMonth = await invoiceManagementService.listInvoices({ dateRange: "month" });
    expect(resMonth.length).toBe(2);
  });

  it("computes structured diffs between original items and revised cart lines", () => {
    const origItems: InvoiceItemRecord[] = [
      {
        id: "item_1",
        invoice_id: "inv_1",
        product_id: "prod_dolo_650",
        product_name: "Dolo 650 Tablet",
        batch_no: "DL650-B1",
        expiry_date: "2027-12-31",
        qty: 2,
        loose_qty: 0,
        units_per_pack: 15,
        unit_price: 30,
        gst_percent: 12,
        total_amount: 60,
      },
    ];

    const revisedCartLines: PosCartLine[] = [
      {
        id: "cart_1",
        product: dummyProduct,
        selectedBatch: dummyBatch,
        qty: 5, // Modified quantity 2 -> 5
        loose_qty: 0,
        unit_price: 30,
        rate_basis: "sel_rate",
        discount_percent: 0,
        discount_amount: 0,
        calculated: {
          gross_amount: 150,
          discount_amount: 0,
          net_amount: 150,
          taxable_amount: 133.93,
          cgst_amount: 8.04,
          sgst_amount: 8.04,
          igst_amount: 0,
          total_tax: 16.07,
          total_amount: 150,
        },
      },
    ];

    const diff = invoiceManagementService.computeDiff(origItems, revisedCartLines);
    expect(diff.hasChanges).toBe(true);
    expect(diff.oldTotal).toBe(60);
    expect(diff.newTotal).toBe(150);
    expect(diff.totalDiff).toBe(90);
    expect(diff.changes.length).toBe(1);
    expect(diff.changes[0].type).toBe("MODIFIED");
    expect(diff.changes[0].oldQty).toBe(2);
    expect(diff.changes[0].newQty).toBe(5);
  });

  it("saves invoice revisions: reverses original stock, applies new stock, updates totals, and logs audit trail", async () => {
    const now = Date.now();
    const todayStr = new Date().toISOString().slice(0, 10);

    // Initial invoice: sold 2 packs (30 units) of Dolo 650
    // Initial batch stock starts at 150 - 30 = 120
    const currentBatch = await productsStore.getProductById("prod_dolo_650");
    await productsStore.upsertBatch({ ...dummyBatch, stock_qty: 120 });

    const originalInvoice: InvoiceRecord = {
      id: "inv_test_edit",
      module_key: "invoice",
      invoice_number: "INV-8888",
      invoice_date: todayStr,
      customer_name: "Original Customer",
      customer_phone: "9876543210",
      subtotal: 53.57,
      discount_total: 0,
      tax_total: 6.43,
      round_off: 0,
      grand_total: 60.0,
      paid_amount: 60.0,
      payment_mode: "Cash",
      status: "issued",
      created_at: now,
      updated_at: now,
    };
    await sqliteStorage.insertRecord("invoices", originalInvoice.id, originalInvoice as unknown as Record<string, unknown>);

    const origItem: InvoiceItemRecord = {
      id: "item_orig_1",
      invoice_id: "inv_test_edit",
      product_id: "prod_dolo_650",
      product_name: "Dolo 650 Tablet",
      batch_no: "DL650-B1",
      expiry_date: "2027-12-31",
      qty: 2,
      loose_qty: 0,
      units_per_pack: 15,
      unit_price: 30,
      gst_percent: 12,
      total_amount: 60,
    };
    await sqliteStorage.insertRecord("invoice_items", origItem.id, origItem as unknown as Record<string, unknown>);

    // Now edit invoice: revise quantity to 1 pack (15 units) instead of 2
    // Stock should be: 120 (current) + 30 (reversed) - 15 (new sale) = 135 base units
    const revisedLines: PosCartLine[] = [
      {
        id: "cart_line_rev",
        product: dummyProduct,
        selectedBatch: { ...dummyBatch, stock_qty: 120 },
        qty: 1,
        loose_qty: 0,
        unit_price: 30,
        rate_basis: "sel_rate",
        discount_percent: 0,
        discount_amount: 0,
        calculated: {
          gross_amount: 30,
          discount_amount: 0,
          net_amount: 30,
          taxable_amount: 26.79,
          cgst_amount: 1.61,
          sgst_amount: 1.61,
          igst_amount: 0,
          total_tax: 3.21,
          total_amount: 30,
        },
      },
    ];

    const res = await invoiceManagementService.saveInvoiceEdit("inv_test_edit", {
      lines: revisedLines,
      customerName: "Revised Customer Name",
      customerPhone: "9876543210",
      reason: "Customer reduced pack quantity",
      operatorUser: "Manager John",
    });

    expect(res.success).toBe(true);

    // Verify stock restored & adjusted
    const updatedBatches = await productsStore.getBatchesForProduct("prod_dolo_650", false);
    const updatedBatch = updatedBatches.find((b) => b.batch_no === "DL650-B1");
    expect(updatedBatch?.stock_qty).toBe(135);

    // Verify invoice updated with is_revised flag and audit log
    const updatedDetails = await invoiceManagementService.getInvoiceWithDetails("inv_test_edit");
    expect(updatedDetails?.invoice.is_revised).toBe(1);
    expect(updatedDetails?.invoice.customer_name).toBe("Revised Customer Name");
    expect(updatedDetails?.invoice.grand_total).toBe(30);
    expect(updatedDetails?.auditLog.length).toBe(1);
    expect(updatedDetails?.auditLog[0].action).toBe("EDITED");
    expect(updatedDetails?.auditLog[0].reason).toBe("Customer reduced pack quantity");

    // Verify reversal and new stock transactions
    const transactions = await sqliteStorage.findAll<any>("stock_transactions");
    const reversalTx = transactions.find((t) => t.event_type === "INVOICE_EDIT_REVERSAL");
    expect(reversalTx).toBeDefined();
    expect(reversalTx.qty_delta).toBe(30); // 2 packs * 15 restored
  });

  it("cancels invoice: restores batch stock, marks invoice cancelled, and retains record for audit/reports", async () => {
    const now = Date.now();
    const todayStr = new Date().toISOString().slice(0, 10);

    // Initial batch stock starts at 100 base units
    await productsStore.upsertBatch({ ...dummyBatch, stock_qty: 100 });

    const invoice: InvoiceRecord = {
      id: "inv_to_cancel",
      module_key: "invoice",
      invoice_number: "INV-9999",
      invoice_date: todayStr,
      customer_name: "Walk-in Customer",
      subtotal: 53.57,
      discount_total: 0,
      tax_total: 6.43,
      round_off: 0,
      grand_total: 60.0,
      paid_amount: 60.0,
      payment_mode: "Cash",
      status: "issued",
      created_at: now,
      updated_at: now,
    };
    await sqliteStorage.insertRecord("invoices", invoice.id, invoice as unknown as Record<string, unknown>);

    const item: InvoiceItemRecord = {
      id: "item_cancel_1",
      invoice_id: "inv_to_cancel",
      product_id: "prod_dolo_650",
      product_name: "Dolo 650 Tablet",
      batch_no: "DL650-B1",
      expiry_date: "2027-12-31",
      qty: 2, // 2 * 15 = 30 units
      loose_qty: 0,
      units_per_pack: 15,
      unit_price: 30,
      gst_percent: 12,
      total_amount: 60,
    };
    await sqliteStorage.insertRecord("invoice_items", item.id, item as unknown as Record<string, unknown>);

    const res = await invoiceManagementService.cancelInvoice(
      "inv_to_cancel",
      "Customer returned medicine unopened",
      "Pharmacist Dave"
    );
    expect(res.success).toBe(true);

    // Verify stock is restored: 100 + 30 = 130
    const updatedBatches = await productsStore.getBatchesForProduct("prod_dolo_650", false);
    const updatedBatch = updatedBatches.find((b) => b.batch_no === "DL650-B1");
    expect(updatedBatch?.stock_qty).toBe(130);

    // Verify invoice is marked cancelled, not deleted
    const cancelledDetails = await invoiceManagementService.getInvoiceWithDetails("inv_to_cancel");
    expect(cancelledDetails?.invoice.status).toBe("cancelled");
    expect(cancelledDetails?.invoice.cancel_reason).toBe("Customer returned medicine unopened");

    // Verify Cancelled Bills report in reportEngine
    const cancelledReport = await reportEngine.getCancelledBillsReport(todayStr, todayStr);
    expect(cancelledReport.length).toBe(1);
    expect(cancelledReport[0].invoice_number).toBe("INV-9999");
    expect(cancelledReport[0].cancel_reason).toBe("Customer returned medicine unopened");
  });

  it("enforces invoice locking rules and verifies manager PIN", () => {
    // Locked if cancelled
    const cancelledInv: InvoiceRecord = {
      id: "inv_c",
      module_key: "invoice",
      invoice_number: "INV-C",
      invoice_date: "2026-09-01",
      subtotal: 100,
      discount_total: 0,
      tax_total: 0,
      round_off: 0,
      grand_total: 100,
      paid_amount: 100,
      payment_mode: "Cash",
      status: "cancelled",
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    const lockCheck1 = invoiceManagementService.checkInvoiceLockStatus(cancelledInv);
    expect(lockCheck1.isLocked).toBe(true);
    expect(lockCheck1.lockReason).toContain("cancelled");

    // Locked if older than 30 days
    const oldInv: InvoiceRecord = {
      ...cancelledInv,
      status: "issued",
      invoice_date: "2025-01-01",
    };
    const lockCheck2 = invoiceManagementService.checkInvoiceLockStatus(oldInv, 30);
    expect(lockCheck2.isLocked).toBe(true);
    expect(lockCheck2.lockReason).toContain("limit");

    // PIN verification
    expect(invoiceManagementService.verifyManagerPin("1234")).toBe(true);
    expect(invoiceManagementService.verifyManagerPin("wrong")).toBe(false);
  });
});

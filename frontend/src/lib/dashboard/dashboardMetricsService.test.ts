import { describe, it, expect, beforeEach } from "vitest";
import { dashboardMetricsService } from "./dashboardMetricsService";
import { sqliteStorage } from "../db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../billing/invoiceManagementService";
import type { ProductBatch } from "../masters/productsStore";

describe("DashboardMetricsService", () => {
  beforeEach(async () => {
    await sqliteStorage.clearTable("invoices");
    await sqliteStorage.clearTable("invoice_items");
    await sqliteStorage.clearTable("product_batches");
    await sqliteStorage.clearTable("sync_queue");
  });

  it("returns zero metrics on a fresh / empty database", async () => {
    const res = await dashboardMetricsService.getDashboardMetrics("today");
    expect(res.netSales).toBe(0);
    expect(res.grossSales).toBe(0);
    expect(res.totalReturns).toBe(0);
    expect(res.billsIssuedCount).toBe(0);
    expect(res.averageTicket).toBe(0);
    expect(res.salesDeltaPercent).toBeNull();
    expect(res.payments.cash).toBe(0);
    expect(res.payments.upi).toBe(0);
    expect(res.payments.digitalPercent).toBe(0);
    expect(res.nearExpiry.count).toBe(0);
    expect(res.gst.slabs).toHaveLength(0);
    expect(res.gst.totalTaxAccrued).toBe(0);
    expect(res.recentDocuments).toHaveLength(0);
  });

  it("computes accurate sales, payment split, and GST on a retail cash sale", async () => {
    const todayStr = dashboardMetricsService.formatLocalDate(new Date());

    const inv: InvoiceRecord = {
      id: "inv_001",
      module_key: "invoice",
      invoice_number: "INV-26-27-0001",
      invoice_date: todayStr,
      subtotal: 476.19,
      discount_total: 0,
      tax_total: 23.81,
      round_off: 0,
      grand_total: 500.0,
      paid_amount: 500.0,
      payment_mode: "Cash",
      status: "issued",
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const item: InvoiceItemRecord = {
      id: "item_001",
      invoice_id: "inv_001",
      product_id: "prod_01",
      product_name: "Paracetamol 500mg",
      batch_no: "BATCH-01",
      expiry_date: "2027-12-31",
      qty: 10,
      unit_price: 50,
      gst_percent: 5,
      cgst_amount: 11.9,
      sgst_amount: 11.91,
      igst_amount: 0,
      total_amount: 500.0,
    };

    await sqliteStorage.insertRecord("invoices", inv.id, inv);
    await sqliteStorage.insertRecord("invoice_items", item.id, item);

    const res = await dashboardMetricsService.getDashboardMetrics("today");

    expect(res.netSales).toBe(500);
    expect(res.grossSales).toBe(500);
    expect(res.totalReturns).toBe(0);
    expect(res.billsIssuedCount).toBe(1);
    expect(res.averageTicket).toBe(500);
    expect(res.payments.cash).toBe(500);
    expect(res.payments.digitalPercent).toBe(0);
    expect(res.gst.slabs).toHaveLength(1);
    expect(res.gst.slabs[0].rate).toBe(5);
    expect(res.gst.totalTaxAccrued).toBe(23.81);
    expect(res.recentDocuments).toHaveLength(1);
    expect(res.recentDocuments[0].amount).toBe(500);
    expect(res.recentDocuments[0].documentType).toBe("invoice");
  });

  it("handles sales returns correctly with negative amounts and reduced net sales", async () => {
    const todayStr = dashboardMetricsService.formatLocalDate(new Date());

    const inv: InvoiceRecord = {
      id: "inv_001",
      module_key: "invoice",
      invoice_number: "INV-26-27-0001",
      invoice_date: todayStr,
      subtotal: 952.38,
      discount_total: 0,
      tax_total: 47.62,
      round_off: 0,
      grand_total: 1000.0,
      paid_amount: 1000.0,
      payment_mode: "UPI",
      status: "issued",
      created_at: Date.now() - 5000,
      updated_at: Date.now() - 5000,
    };

    const ret: InvoiceRecord = {
      id: "ret_001",
      module_key: "sales_return",
      invoice_number: "SR-26-27-0001",
      invoice_date: todayStr,
      subtotal: 190.48,
      discount_total: 0,
      tax_total: 9.52,
      round_off: 0,
      grand_total: 200.0,
      paid_amount: 200.0,
      payment_mode: "UPI",
      status: "issued",
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await sqliteStorage.insertRecord("invoices", inv.id, inv);
    await sqliteStorage.insertRecord("invoices", ret.id, ret);

    const res = await dashboardMetricsService.getDashboardMetrics("today");

    expect(res.grossSales).toBe(1000);
    expect(res.totalReturns).toBe(200);
    expect(res.netSales).toBe(800);
    expect(res.billsIssuedCount).toBe(1); // 1 sale bill
    expect(res.payments.upi).toBe(800); // 1000 - 200 refund
    expect(res.payments.digitalPercent).toBe(100);

    expect(res.recentDocuments).toHaveLength(2);
    expect(res.recentDocuments[0].documentNumber).toBe("SR-26-27-0001");
    expect(res.recentDocuments[0].amount).toBe(-200);
    expect(res.recentDocuments[0].documentType).toBe("sales_return");
  });

  it("excludes cancelled bills from revenue and counts", async () => {
    const todayStr = dashboardMetricsService.formatLocalDate(new Date());

    const inv: InvoiceRecord = {
      id: "inv_cancelled",
      module_key: "invoice",
      invoice_number: "INV-CAN-01",
      invoice_date: todayStr,
      subtotal: 300,
      discount_total: 0,
      tax_total: 0,
      round_off: 0,
      grand_total: 300,
      paid_amount: 300,
      payment_mode: "Cash",
      status: "cancelled",
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await sqliteStorage.insertRecord("invoices", inv.id, inv);
    const res = await dashboardMetricsService.getDashboardMetrics("today");

    expect(res.netSales).toBe(0);
    expect(res.billsIssuedCount).toBe(0);
    expect(res.payments.cash).toBe(0);
    expect(res.recentDocuments[0].paymentStatus).toBe("cancelled");
  });

  it("filters near expiry batches within threshold (e.g. 60 days) and ignores far dates", async () => {
    const today = new Date();

    const in40Days = new Date(today);
    in40Days.setDate(in40Days.getDate() + 40);

    const in90Days = new Date(today);
    in90Days.setDate(in90Days.getDate() + 90);

    const batch1: ProductBatch = {
      id: "batch_near",
      product_id: "p1",
      batch_no: "BN-01",
      expiry_date: dashboardMetricsService.formatLocalDate(in40Days),
      stock_qty: 15,
      mrp: 100,
      selling_rate: 90,
      purchase_rate: 70,
    };

    const batch2: ProductBatch = {
      id: "batch_far",
      product_id: "p2",
      batch_no: "BN-02",
      expiry_date: dashboardMetricsService.formatLocalDate(in90Days),
      stock_qty: 20,
      mrp: 120,
      selling_rate: 110,
      purchase_rate: 80,
    };

    const batchZeroStock: ProductBatch = {
      id: "batch_zero",
      product_id: "p3",
      batch_no: "BN-03",
      expiry_date: dashboardMetricsService.formatLocalDate(in40Days),
      stock_qty: 0,
      mrp: 50,
      selling_rate: 45,
      purchase_rate: 30,
    };

    await sqliteStorage.insertRecord("product_batches", batch1.id, batch1);
    await sqliteStorage.insertRecord("product_batches", batch2.id, batch2);
    await sqliteStorage.insertRecord("product_batches", batchZeroStock.id, batchZeroStock);

    const res = await dashboardMetricsService.getDashboardMetrics("today");
    expect(res.nearExpiry.count).toBe(1); // only batch1 (stock > 0 and <= 60d)
  });
});

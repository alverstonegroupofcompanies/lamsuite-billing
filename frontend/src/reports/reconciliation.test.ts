import { describe, it, expect, beforeEach } from "vitest";
import { sqliteStorage } from "../lib/db/sqliteStorage";
import { salesMetricsService } from "../lib/data-layer/financials/salesMetrics";
import { dashboardMetricsService } from "../lib/dashboard/dashboardMetricsService";
import { reportRegistry } from "./registry";
import { reportRunner } from "./engine/ReportRunner";

describe("Financial Data Layer & Reports Reconciliation (Zero Drift to the Paisa)", () => {
  const testDate = "2026-10-10";

  beforeEach(async () => {
    await sqliteStorage.clearTable("invoices");
    await sqliteStorage.clearTable("invoice_items");
    await sqliteStorage.clearTable("products");
    await sqliteStorage.clearTable("product_batches");

    // Seed 1: Active Retail Cash Bill (₹525 total: Taxable 500, GST 5% = 25)
    await sqliteStorage.insertRecord("invoices", "inv_001", {
      id: "inv_001",
      module_key: "invoice",
      invoice_number: "INV-1001",
      invoice_date: testDate,
      customer_name: "Walk-in Customer",
      customer_gstin: "",
      subtotal: 500,
      tax_total: 25,
      round_off: 0,
      grand_total: 525,
      paid_amount: 525,
      payment_mode: "Cash",
      status: "issued",
      created_at: 1700000000000,
    });
    await sqliteStorage.insertRecord("invoice_items", "item_001", {
      id: "item_001",
      invoice_id: "inv_001",
      product_id: "prod_01",
      product_name: "Paracetamol 500mg",
      hsn_code: "30049099",
      qty: 5,
      unit_price: 100,
      gst_percent: 5,
      cgst_amount: 12.5,
      sgst_amount: 12.5,
      igst_amount: 0,
      total_amount: 525,
    });

    // Seed 2: Active B2B UPI Bill (₹1,180 total: Taxable 1000, GST 18% = 180)
    await sqliteStorage.insertRecord("invoices", "inv_002", {
      id: "inv_002",
      module_key: "invoice",
      invoice_number: "INV-1002",
      invoice_date: testDate,
      customer_name: "Apollo Pharmacy",
      customer_gstin: "32AABCA1234F1Z5",
      subtotal: 1000,
      tax_total: 180,
      round_off: 0,
      grand_total: 1180,
      paid_amount: 1180,
      payment_mode: "UPI",
      status: "issued",
      created_at: 1700000010000,
    });
    await sqliteStorage.insertRecord("invoice_items", "item_002", {
      id: "item_002",
      invoice_id: "inv_002",
      product_id: "prod_02",
      product_name: "Multivitamin Syrup",
      hsn_code: "30049080",
      qty: 10,
      unit_price: 100,
      gst_percent: 18,
      cgst_amount: 90,
      sgst_amount: 90,
      igst_amount: 0,
      total_amount: 1180,
    });

    // Seed 3: Sales Return / Credit Note (₹105 total: Taxable 100, GST 5% = 5)
    await sqliteStorage.insertRecord("invoices", "inv_003", {
      id: "inv_003",
      module_key: "sales_return",
      invoice_number: "SR-001",
      invoice_date: testDate,
      customer_name: "Walk-in Customer",
      subtotal: 100,
      tax_total: 5,
      round_off: 0,
      grand_total: 105,
      paid_amount: 105,
      payment_mode: "Cash",
      status: "issued",
      created_at: 1700000020000,
    });
    await sqliteStorage.insertRecord("invoice_items", "item_003", {
      id: "item_003",
      invoice_id: "inv_003",
      product_id: "prod_01",
      product_name: "Paracetamol 500mg",
      hsn_code: "30049099",
      qty: 1,
      unit_price: 100,
      gst_percent: 5,
      cgst_amount: 2.5,
      sgst_amount: 2.5,
      igst_amount: 0,
      total_amount: 105,
    });

    // Seed 4: Voided / Cancelled Bill (₹600 total) - MUST NOT BE COUNTED
    await sqliteStorage.insertRecord("invoices", "inv_004", {
      id: "inv_004",
      module_key: "invoice",
      invoice_number: "INV-1003",
      invoice_date: testDate,
      customer_name: "Cancelled Customer",
      grand_total: 600,
      paid_amount: 0,
      payment_mode: "Cash",
      status: "cancelled",
      cancel_reason: "Customer changed mind",
      created_at: 1700000030000,
    });
  });

  it("ties out Gross Sales, Returns, and Net Sales to ₹0.00 between Dashboard and Daily Collection", async () => {
    // 1. Fetch Dashboard Metrics
    const dashboard = await dashboardMetricsService.getDashboardMetrics("custom", testDate, testDate);

    // 2. Run Daily Collection Report
    const dailyColReport = reportRegistry.get("daily-collection")!;
    const dailyResult = await reportRunner.executeReport(dailyColReport, {
      filters: { startDate: testDate, endDate: testDate },
    });

    // 3. Run Sales Register Report
    const salesRegReport = reportRegistry.get("sales-register")!;
    const salesResult = await reportRunner.executeReport(salesRegReport, {
      filters: { startDate: testDate, endDate: testDate },
    });

    // Calculation Breakdown:
    // Gross Sales = 525 (inv 1) + 1180 (inv 2) = ₹1,705.00
    // Total Returns = 105 (inv 3) = ₹105.00
    // Net Sales = 1705 - 105 = ₹1,600.00
    expect(dashboard.grossSales).toBe(1705.0);
    expect(dashboard.totalReturns).toBe(105.0);
    expect(dashboard.netSales).toBe(1600.0);

    // Verify Daily Collection rows tie out exactly
    const netSalesRow = dailyResult.rows.find((r) => r.category.includes("NET SALES"));
    expect(netSalesRow).toBeDefined();
    expect(netSalesRow!.amount).toBe(1600.0);

    const grossSalesRow = dailyResult.rows.find((r) => r.category.includes("Gross"));
    expect(grossSalesRow!.amount).toBe(1705.0);

    // Verify Sales Register sum of active bills matches gross sales
    const salesRegisterGrandTotal = salesResult.rows.reduce((sum, r) => sum + r.grand_total, 0);
    expect(salesRegisterGrandTotal).toBe(1705.0);
    expect(salesResult.summary.grand_total).toBe(1705.0);
  });

  it("ties out tender payments (Cash vs UPI) to the paisa", async () => {
    const dashboard = await dashboardMetricsService.getDashboardMetrics("custom", testDate, testDate);
    const metrics = await salesMetricsService.calculateFinancialMetrics({
      startDate: testDate,
      endDate: testDate,
    });

    // Cash: 525 (sale) - 105 (refund) = 420.00
    // UPI: 1180.00
    expect(dashboard.payments.cash).toBe(420.0);
    expect(metrics.byTender.cash).toBe(420.0);

    expect(dashboard.payments.upi).toBe(1180.0);
    expect(metrics.byTender.upi).toBe(1180.0);

    // Digital total = UPI = 1180.00
    expect(dashboard.payments.digitalTotal).toBe(1180.0);
  });

  it("ties out statutory GST tax liabilities between Dashboard, HSN Summary, and GSTR-1", async () => {
    const dashboard = await dashboardMetricsService.getDashboardMetrics("custom", testDate, testDate);

    // Run HSN Summary
    const hsnReport = reportRegistry.get("hsn-summary")!;
    const hsnResult = await reportRunner.executeReport(hsnReport, {
      filters: { startDate: testDate, endDate: testDate },
    });

    // Run GSTR-1 Report
    const gstr1Report = reportRegistry.get("gstr1-summary")!;
    const gstr1Result = await reportRunner.executeReport(gstr1Report, {
      filters: { startDate: testDate, endDate: testDate },
    });

    // Tax Breakdown:
    // Inv 1: Taxable 500, Tax 25 (12.5 CGST + 12.5 SGST)
    // Inv 2: Taxable 1000, Tax 180 (90 CGST + 90 SGST)
    // Inv 3 (return): Taxable -100, Tax -5 (-2.5 CGST + -2.5 SGST)
    // Net Taxable = 500 + 1000 - 100 = ₹1,400.00
    // Net Tax Accrued = 25 + 180 - 5 = ₹200.00 (CGST 100 + SGST 100)

    expect(dashboard.gst.totalTaxable).toBe(1400.0);
    expect(dashboard.gst.totalTaxAccrued).toBe(200.0);
    expect(dashboard.gst.totalCgst).toBe(100.0);
    expect(dashboard.gst.totalSgst).toBe(100.0);

    // HSN Summary total taxes must equal ₹200.00
    const hsnTotalTax = hsnResult.rows.reduce(
      (sum, r) => sum + r.central_tax + r.state_tax + r.integrated_tax,
      0
    );
    expect(hsnTotalTax).toBe(200.0);

    // GSTR-1 B2B (Table 4) must include Apollo Pharmacy
    const b2bRow = gstr1Result.rows.find((r) => r.section_table.includes("Table 4"));
    expect(b2bRow).toBeDefined();
    expect(b2bRow!.recipient_gstin).toBe("32AABCA1234F1Z5");
    expect(b2bRow!.taxable_value).toBe(1000.0);
  });

  it("ties out Purchase Inward Register with purchase_documents stored in database", async () => {
    await sqliteStorage.clearTable("purchase_documents");
    await sqliteStorage.clearTable("purchase_items");

    // Seed purchases exactly matching user's scenario
    await sqliteStorage.insertRecord("purchase_documents", "pur_001", {
      id: "pur_001",
      purchase_number: "PUR-26-27-0001",
      supplier_id: "sup_apollo",
      supplier_name: "Apollo Pharma Distributors Pvt Ltd",
      supplier_invoice_no: "INV-002",
      supplier_gstin: "32AABCA1234F1Z5",
      purchase_date: "2026-10-10",
      subtotal: 30000,
      tax_total: 1500,
      cgst_total: 750,
      sgst_total: 750,
      igst_total: 0,
      grand_total: 31500,
      paid_amount: 0,
      payment_status: "unpaid",
      status: "received",
      module_key: "purchase",
      created_at: 1700000000000,
    });

    await sqliteStorage.insertRecord("purchase_documents", "pur_002", {
      id: "pur_002",
      purchase_number: "PB-487294",
      supplier_id: "sup_alverstone",
      supplier_name: "Alverstone Drug House Pvt Ltd.",
      supplier_invoice_no: "ADH-26-27-0901",
      supplier_gstin: "32XYZPA9876C1Z1",
      purchase_date: "2026-10-08",
      subtotal: 10000,
      tax_total: 1200,
      cgst_total: 600,
      sgst_total: 600,
      igst_total: 0,
      grand_total: 11200,
      paid_amount: 0,
      payment_status: "unpaid",
      status: "issued",
      module_key: "purchase",
      created_at: 1700000000000,
    });

    const purchaseRegisterReport = reportRegistry.get("purchase-register")!;
    expect(purchaseRegisterReport).toBeDefined();

    // Query for 01/10/2026 to 13/10/2026 (matching user's screen date range)
    const result = await reportRunner.executeReport(purchaseRegisterReport, {
      filters: { startDate: "2026-10-01", endDate: "2026-10-13", paymentStatus: "all" },
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].purchase_number).toBe("PUR-26-27-0001");
    expect(result.rows[1].purchase_number).toBe("PB-487294");

    // Totals check
    const totalTaxable = result.rows.reduce((sum, r) => sum + r.subtotal, 0);
    const totalGrand = result.rows.reduce((sum, r) => sum + r.grand_total, 0);
    expect(totalTaxable).toBe(40000.0);
    expect(totalGrand).toBe(42700.0);

    // Search filter test
    const searchResult = await reportRunner.executeReport(purchaseRegisterReport, {
      filters: { startDate: "2026-10-01", endDate: "2026-10-13", paymentStatus: "all" },
      searchQuery: "Apollo",
    });
    expect(searchResult.rows).toHaveLength(1);
    expect(searchResult.rows[0].supplier_name).toBe("Apollo Pharma Distributors Pvt Ltd");
  });
});

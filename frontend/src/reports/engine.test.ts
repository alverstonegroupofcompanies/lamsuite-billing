import { describe, it, expect } from "vitest";
import { exportEngine } from "./engine/ExportEngine";
import { printFormatter } from "./engine/PrintFormatter";
import { reportRunner } from "./engine/ReportRunner";
import type { PrintableDocumentData, ReportModule } from "./types";

describe("Report Engine Components (Export, Print & Runner)", () => {
  it("generates CSV with UTF-8 BOM and proper escaping", () => {
    const headers = ["Invoice No", "Customer, Name", "Grand Total (₹)"];
    const rows = [
      ["INV-001", 'Acme "Health" Corp, Ltd', 1525.5],
      ["INV-002", "Simple Walk-in", 200],
    ];

    const csv = exportEngine.generateCsvContent(headers, rows);
    // Verify UTF-8 BOM
    expect(csv.startsWith("\uFEFF")).toBe(true);
    // Verify escaping of double quotes and commas
    expect(csv).toContain('"Acme ""Health"" Corp, Ltd"');
    expect(csv).toContain('"Customer, Name"');
  });

  it("formats Indian currency numbers accurately with lakh/crore grouping", () => {
    expect(printFormatter.formatIndianNumber(500)).toBe("500.00");
    expect(printFormatter.formatIndianNumber(12500)).toBe("12,500.00");
    expect(printFormatter.formatIndianNumber(152500.75)).toBe("1,52,500.75");
    expect(printFormatter.formatIndianNumber(10500000)).toBe("1,05,00,000.00");
  });

  it("generates strict 80-column Dot Matrix plain text ASCII", () => {
    const docData: PrintableDocumentData = {
      title: "Daily Collection Summary",
      subtitle: "Shift 1 Audit",
      storeDetails: {
        storeName: "LamStone Pharmacy",
        address: "Palakkad, Kerala",
        phone: "9876543210",
        gstin: "32AAAAA0000A1Z5",
      },
      filterSummary: [{ label: "DATE", value: "2026-10-10" }],
      generatedAt: "10/10/2026, 12:00:00 PM",
      headers: [
        { id: "category", label: "TENDER MODE", align: "left" },
        { id: "amount", label: "AMOUNT", align: "right" },
      ],
      rows: [
        { category: "Cash In Register", amount: 12500 },
        { category: "UPI Collections", amount: 35000 },
      ],
      totals: {
        category: "TOTAL",
        amount: 47500,
      },
    };

    const dotMatrixText = printFormatter.generateDotMatrixText(docData);
    const lines = dotMatrixText.split("\n");

    // Every single line must be exactly 80 characters or fewer
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      expect(line.length).toBeLessThanOrEqual(80);
      // Must not contain non-ASCII characters or graphical boxes
      expect(/^[\x20-\x7E]*$/.test(line)).toBe(true);
    }

    expect(dotMatrixText).toContain("LAMSTONE PHARMACY");
    expect(dotMatrixText).toContain("DAILY COLLECTION SUMMARY");
    expect(dotMatrixText).toContain("12,500.00");
    expect(dotMatrixText).toContain("47,500.00");
    expect(dotMatrixText).toContain("*** END OF REPORT ***");
  });

  it("computes automatic column totals for modules with totalType='sum'", async () => {
    const dummyModule: ReportModule<any, any, any> = {
      id: "dummy-test-report",
      title: "Dummy Test",
      description: "Test",
      category: "sales",
      permission: "reports.sales.view",
      menuVisibilityKey: "reports",
      supportedPrintLayouts: ["a4"],
      exportFormats: ["csv"],
      filters: [],
      columns: [
        { id: "id", header: "ID", accessor: (r: any) => r.id, isDefaultVisible: true },
        { id: "qty", header: "Qty", accessor: (r: any) => r.qty, isDefaultVisible: true, totalType: "sum" },
        { id: "amount", header: "Amount", accessor: (r: any) => r.amount, isDefaultVisible: true, totalType: "sum" },
      ],
      runQuery: async () => ({
        rows: [
          { id: 1, qty: 5, amount: 150.25 },
          { id: 2, qty: 10, amount: 250.5 },
        ],
        totalCount: 2,
      }),
    };

    const res = await reportRunner.executeReport(dummyModule, { filters: {} });
    expect(res.summary).toBeDefined();
    expect(res.summary.qty).toBe(15);
    expect(res.summary.amount).toBe(400.75);
  });

  it("accurately formats cells by type, preventing currency symbol on counts & shares", () => {
    // Number format (transactions / counts)
    expect(printFormatter.formatCellValue(3, "number")).toBe("3");
    expect(printFormatter.formatCellValue(0, "number")).toBe("0");
    expect(printFormatter.formatCellValue(1250, "number")).toBe("1,250");

    // Percentage format (share %)
    expect(printFormatter.formatCellValue(100, "percentage")).toBe("100.0%");
    expect(printFormatter.formatCellValue(-3.7, "percentage")).toBe("-3.7%");
    expect(printFormatter.formatCellValue(55.25, "percentage")).toBe("55.3%");

    // Currency format (amounts, positive & negative)
    expect(printFormatter.formatCellValue(25715, "currency")).toBe("₹25,715.00");
    expect(printFormatter.formatCellValue(-915, "currency")).toBe("-₹915.00");
    expect(printFormatter.formatCellValue(0, "currency")).toBe("₹0.00");

    // Currency for Dot Matrix (no ₹ symbol)
    expect(
      printFormatter.formatCellValue(25715, "currency", { isDotMatrix: true, currencyPrefix: "" })
    ).toBe("25,715.00");
    expect(
      printFormatter.formatCellValue(-915, "currency", { isDotMatrix: true, currencyPrefix: "" })
    ).toBe("-915.00");
  });

  it("serializes date ranges to clean human-readable strings without [object Object]", async () => {
    const dummyModule: ReportModule<any, any, any> = {
      id: "dummy-date-test",
      title: "Date Test Report",
      description: "Test",
      category: "sales",
      permission: "reports.sales.view",
      menuVisibilityKey: "reports",
      supportedPrintLayouts: ["a4"],
      exportFormats: ["csv"],
      filters: [],
      columns: [
        { id: "category", header: "Category", accessor: (r: any) => r.category, isDefaultVisible: true },
        { id: "count", header: "Count", accessor: (r: any) => r.count, format: "number", isDefaultVisible: true },
        { id: "amount", header: "Amount", accessor: (r: any) => r.amount, format: "currency", isDefaultVisible: true },
      ],
      runQuery: async () => ({ rows: [], totalCount: 0 }),
    };

    const doc = await reportRunner.preparePrintableDocument(
      dummyModule,
      { rows: [], totalCount: 0 },
      { date_range: { startDate: "2026-10-10", endDate: "2026-10-10" } }
    );

    // Verify filter summary
    expect(doc.filterSummary.length).toBe(1);
    expect(doc.filterSummary[0].label).toBe("DATE");
    expect(doc.filterSummary[0].value).toBe("10/10/2026");
    expect(JSON.stringify(doc.filterSummary)).not.toContain("[object Object]");

    // Verify headers have format passed through
    const countH = doc.headers.find((h) => h.id === "count");
    expect(countH?.format).toBe("number");
    const amtH = doc.headers.find((h) => h.id === "amount");
    expect(amtH?.format).toBe("currency");
  });

  it("renders thermal receipt and a4 HTML with negative amounts correctly signed (-₹)", () => {
    const docData: PrintableDocumentData = {
      title: "Daily Collection Summary",
      storeDetails: {
        storeName: "LamStone Pharmacy",
        address: "Palakkad, Kerala",
        phone: "9876543210",
      },
      filterSummary: [{ label: "DATE", value: "10/10/2026" }],
      generatedAt: "10/10/2026, 12:00:00 PM",
      headers: [
        { id: "mode", label: "Mode", align: "left" },
        { id: "count", label: "Txns", align: "center", format: "number" },
        { id: "amount", label: "Amount", align: "right", format: "currency" },
      ],
      rows: [
        { mode: "Gross Sales", count: 3, amount: 25715 },
        { mode: "Sales Returns", count: 1, amount: -915 },
      ],
      totals: {
        count: 3,
        amount: 24800,
      },
    };

    const a4Html = printFormatter.generatePrintHtml(docData, "a4");
    expect(a4Html).toContain("-₹915.00");
    expect(a4Html).not.toContain("₹-915.00");
    expect(a4Html).not.toContain("₹3.00"); // Txns must not be formatted as currency!

    const thermalHtml = printFormatter.generatePrintHtml(docData, "thermal");
    expect(thermalHtml).toContain("-₹915.00");
    expect(thermalHtml).not.toContain("₹-915.00");
  });

  it("formats A4 Landscape multi-column Purchase Register with proper colgroup, badges, and totals", () => {
    const purchaseDoc: PrintableDocumentData = {
      title: "Purchase Inward Register",
      storeDetails: {
        storeName: "LamSuite Pharmacy",
        address: "MG Road, Calicut, Kerala",
        phone: "9876543210",
        gstin: "32AABCU9603R1ZM",
      },
      filterSummary: [
        { label: "PERIOD", value: "01/10/2026 to 31/10/2026" },
        { label: "PAYMENT STATUS", value: "All Purchases" },
      ],
      generatedAt: "13/10/2026, 04:30:00 PM",
      headers: [
        { id: "purchase_number", label: "Voucher No", align: "left" },
        { id: "purchase_date", label: "Date", align: "center", format: "date" },
        { id: "supplier_name", label: "Supplier Name", align: "left" },
        { id: "supplier_invoice_no", label: "Supplier Bill No", align: "left" },
        { id: "subtotal", label: "Taxable Value (₹)", align: "right", format: "currency" },
        { id: "cgst_total", label: "CGST (₹)", align: "right", format: "currency" },
        { id: "sgst_total", label: "SGST (₹)", align: "right", format: "currency" },
        { id: "tax_total", label: "Tax Total (₹)", align: "right", format: "currency" },
        { id: "grand_total", label: "Invoice Value (₹)", align: "right", format: "currency" },
        { id: "payment_status", label: "Payment", align: "center", format: "badge" },
      ],
      rows: [
        {
          purchase_number: "PB-487294",
          purchase_date: "2026-10-13",
          supplier_name: "Alverstone Drug House Pvt Ltd.",
          supplier_invoice_no: "ADH-26-27-0001",
          subtotal: 10000,
          cgst_total: 600,
          sgst_total: 600,
          tax_total: 1200,
          grand_total: 11200,
          payment_status: "UNPAID",
        },
        {
          purchase_number: "PB-539102",
          purchase_date: "2026-10-13",
          supplier_name: "Metro Pharma Distributors",
          supplier_invoice_no: "MPD/26-27/9842",
          subtotal: 12500,
          cgst_total: 750,
          sgst_total: 750,
          tax_total: 1500,
          grand_total: 14000,
          payment_status: "PAID",
        },
      ],
      totals: {
        subtotal: 22500,
        cgst_total: 1350,
        sgst_total: 1350,
        tax_total: 2700,
        grand_total: 25200,
      },
    };

    // Auto-detects landscape for 10 columns
    const a4LandscapeHtml = printFormatter.generatePrintHtml(purchaseDoc, "a4");
    expect(a4LandscapeHtml).toContain("size: A4 landscape");
    expect(a4LandscapeHtml).toContain("width: 297mm");
    expect(a4LandscapeHtml).toContain("<colgroup>");
    expect(a4LandscapeHtml).toContain("col-code");
    expect(a4LandscapeHtml).toContain("col-date");
    expect(a4LandscapeHtml).toContain("col-name");
    expect(a4LandscapeHtml).toContain("col-num");
    expect(a4LandscapeHtml).toContain("badge-danger"); // UNPAID
    expect(a4LandscapeHtml).toContain("badge-success"); // PAID
    expect(a4LandscapeHtml).toContain("TOTAL (2 Bills)");
    expect(a4LandscapeHtml).toContain("₹22,500.00");
    expect(a4LandscapeHtml).toContain("₹1,350.00");
    expect(a4LandscapeHtml).toContain("₹2,700.00");
    expect(a4LandscapeHtml).toContain("₹25,200.00");
    expect(a4LandscapeHtml).toContain("13/10/2026");

    // Explicit A4 portrait test
    const a4PortraitHtml = printFormatter.generatePrintHtml(purchaseDoc, "a4-portrait");
    expect(a4PortraitHtml).toContain("size: A4 portrait");
    expect(a4PortraitHtml).toContain("width: 210mm");
  });

  it("compacts 10-column purchase register into 5 space-saving columns with items summary", () => {
    const purchaseDoc: PrintableDocumentData = {
      title: "Purchase Inward Register",
      storeDetails: {
        storeName: "LamSuite Pharmacy",
        address: "MG Road, Calicut, Kerala",
        phone: "9876543210",
        gstin: "32AABCU9603R1ZM",
      },
      filterSummary: [{ label: "PERIOD", value: "01/10/2026 to 31/10/2026" }],
      generatedAt: "13/10/2026, 04:30:00 PM",
      headers: [
        { id: "purchase_number", label: "Voucher No", align: "left" },
        { id: "purchase_date", label: "Date", align: "center", format: "date" },
        { id: "supplier_name", label: "Supplier Name", align: "left" },
        { id: "supplier_invoice_no", label: "Supplier Bill No", align: "left" },
        { id: "subtotal", label: "Taxable Value (₹)", align: "right", format: "currency" },
        { id: "cgst_total", label: "CGST (₹)", align: "right", format: "currency" },
        { id: "sgst_total", label: "SGST (₹)", align: "right", format: "currency" },
        { id: "tax_total", label: "Tax Total (₹)", align: "right", format: "currency" },
        { id: "grand_total", label: "Invoice Value (₹)", align: "right", format: "currency" },
        { id: "payment_status", label: "Payment", align: "center", format: "badge" },
      ],
      rows: [
        {
          purchase_number: "PB-487294",
          purchase_date: "2026-10-13",
          supplier_name: "Alverstone Drug House Pvt Ltd.",
          supplier_invoice_no: "ADH-26-27-0001",
          items_summary: "Azithral 500 (10), Dolo 650 (5)",
          subtotal: 10000,
          cgst_total: 600,
          sgst_total: 600,
          tax_total: 1200,
          grand_total: 11200,
          payment_status: "UNPAID",
        },
      ],
      totals: {
        subtotal: 10000,
        cgst_total: 600,
        sgst_total: 600,
        tax_total: 1200,
        grand_total: 11200,
      },
    };

    const compactDoc = printFormatter.createCompactDocument(purchaseDoc);
    expect(compactDoc.headers.length).toBe(5);
    expect(compactDoc.headers.map((h) => h.label)).toEqual([
      "VOUCHER / DATE",
      "SUPPLIER & DETAILS",
      "TAXABLE VALUE (₹)",
      "TAX / GST (₹)",
      "INVOICE VALUE & STATUS",
    ]);

    // Check row content
    const row = compactDoc.rows[0];
    expect(row.col_voucher_date).toContain("PB-487294");
    expect(row.col_voucher_date).toContain("13/10/2026");
    expect(row.col_party_details).toContain("Alverstone Drug House Pvt Ltd.");
    expect(row.col_party_details).toContain("Bill: <span class=\"font-mono\">ADH-26-27-0001</span>");
    expect(row.col_party_details).toContain("Items: Azithral 500 (10), Dolo 650 (5)");
    expect(row.col_taxable).toBe(10000);
    expect(row.col_gst_breakdown).toContain("₹1,200.00");
    expect(row.col_gst_breakdown).toContain("CGST: 600.00 | SGST: 600.00");
    expect(row.col_total_status).toContain("₹11,200.00");
    expect(row.col_total_status).toContain("badge-danger");
    expect(row.col_total_status).toContain("UNPAID");

    // Check totals
    expect(compactDoc.totals).toBeDefined();
    expect(compactDoc.totals?.col_taxable).toBe(10000);
    expect(compactDoc.totals?.col_gst_breakdown).toContain("₹1,200.00");
    expect(compactDoc.totals?.col_gst_breakdown).toContain("CGST: 600.00 | SGST: 600.00");
    expect(compactDoc.totals?.col_total_status).toContain("₹11,200.00");

    // Check generated compact HTML
    const compactHtml = printFormatter.generatePrintHtml(purchaseDoc, "a4-portrait", true);
    expect(compactHtml).toContain("SUPPLIER & DETAILS");
    expect(compactHtml).toContain("Items: Azithral 500 (10), Dolo 650 (5)");
    expect(compactHtml).toContain("CGST: 600.00 | SGST: 600.00");
  });

  it("guarantees fixed table layout, 100% colgroup sum, clean styling, and no blue links for 10-column Purchase Register", () => {
    const purchaseDoc: PrintableDocumentData = {
      title: "Purchase Inward Register",
      storeDetails: {
        storeName: "LamStone Pharmacy & Retail",
        address: "Main Road, Palakkad, Kerala - 678001",
        phone: "9876543210",
        gstin: "32AAAAA0000A1Z5",
      },
      filterSummary: [{ label: "PERIOD", value: "01/10/2026 to 13/10/2026" }],
      generatedAt: "13/10/2026, 4:55:01 PM",
      headers: [
        { id: "purchase_number", label: "VOUCHER NO", align: "left" },
        { id: "purchase_date", label: "DATE", align: "center", format: "date" },
        { id: "supplier_name", label: "SUPPLIER NAME", align: "left" },
        { id: "supplier_invoice_no", label: "SUPPLIER BILL NO", align: "left" },
        { id: "subtotal", label: "TAXABLE VALUE (₹)", align: "right", format: "currency" },
        { id: "cgst_total", label: "CGST (₹)", align: "right", format: "currency" },
        { id: "sgst_total", label: "SGST (₹)", align: "right", format: "currency" },
        { id: "tax_total", label: "TAX TOTAL (₹)", align: "right", format: "currency" },
        { id: "grand_total", label: "INVOICE VALUE (₹)", align: "right", format: "currency" },
        { id: "payment_status", label: "PAYMENT", align: "center", format: "badge" },
      ],
      rows: [
        {
          purchase_number: "PB-487294",
          purchase_date: "2026-10-08",
          supplier_name: "Alverstone Drug House Pvt Ltd.",
          supplier_invoice_no: "ADH-26-27-0001",
          subtotal: 10000,
          cgst_total: 600,
          sgst_total: 600,
          tax_total: 1200,
          grand_total: 11200,
          payment_status: "UNPAID",
        },
        {
          purchase_number: "PUR-26-27-0001",
          purchase_date: "2026-10-10",
          supplier_name: "Apollo Pharma Distributors Pvt Ltd",
          supplier_invoice_no: "INV-002",
          subtotal: 30000,
          cgst_total: 750,
          sgst_total: 750,
          tax_total: 1500,
          grand_total: 31500,
          payment_status: "UNPAID",
        },
      ],
      totals: {
        subtotal: 40000,
        cgst_total: 1350,
        sgst_total: 1350,
        tax_total: 2700,
        grand_total: 42700,
      },
    };

    // 1. A4 Portrait test
    const portraitHtml = printFormatter.generatePrintHtml(purchaseDoc, "a4-portrait");
    expect(portraitHtml).toContain("table-layout: fixed;");
    expect(portraitHtml).toContain("max-width: 210mm;");
    expect(portraitHtml).toContain("width: 210mm;");
    // Verify colgroup percentages sum to exactly 100%
    const colWidths = printFormatter.computeA4ColumnWidths(purchaseDoc.headers, false);
    const sumWidths = colWidths.map((w) => parseFloat(w)).reduce((a, b) => a + b, 0);
    expect(Math.round(sumWidths)).toBe(100);
    // Supplier name receives generous width
    const supplierWidth = parseFloat(colWidths[2]);
    expect(supplierWidth).toBeGreaterThanOrEqual(24);

    // Verify screen styling cleanup (no blue link, no branding chip)
    expect(portraitHtml).not.toContain("LamSuite Financials • Tax Audit");
    expect(portraitHtml).not.toContain("color: #1e3a8a;"); // Voucher link must not be blue!
    expect(portraitHtml).toContain("UNPAID");
    expect(portraitHtml).toContain("TOTAL (2 Bills)");
    expect(portraitHtml).toContain("colspan=\"4\"");
    expect(portraitHtml).toContain("border-right: 1px solid #cbd5e1;");
    expect(portraitHtml).toContain("border-right: 1px solid #e2e8f0;");
    expect(portraitHtml).toContain("border: 1px solid #94a3b8;");
    expect(portraitHtml).toContain("Page 1 of 1");

    // 2. Thermal 80mm test
    const thermalHtml = printFormatter.generatePrintHtml(purchaseDoc, "thermal");
    expect(thermalHtml).toContain("thermal-card");
    expect(thermalHtml).toContain("PB-487294");
    expect(thermalHtml).toContain("Alverstone Drug House Pvt Ltd.");
    expect(thermalHtml).toContain("₹11,200.00");

    // 3. Dot Matrix 80C and 132C test
    const dot80 = printFormatter.generateDotMatrixText(purchaseDoc, 80);
    const dot80Lines = dot80.split("\n");
    for (const line of dot80Lines) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
    expect(dot80).toContain("Rs.");
    expect(dot80).not.toContain("₹");

    const dot132 = printFormatter.generateDotMatrixText(purchaseDoc, 132);
    const dot132Lines = dot132.split("\n");
    for (const line of dot132Lines) {
      expect(line.length).toBeLessThanOrEqual(132);
    }
  });

  it("handles other multi-column reports: Sales Register, Stock Summary, and GSTR-1 with no overflow", () => {
    // 1. Sales Register (9 columns)
    const salesDoc: PrintableDocumentData = {
      title: "Sales Inward Register",
      storeDetails: {
        storeName: "LamStone Pharmacy",
        address: "Palakkad, Kerala",
        phone: "9876543210",
      },
      filterSummary: [{ label: "DATE", value: "10/10/2026" }],
      generatedAt: "10/10/2026, 6:00:00 PM",
      headers: [
        { id: "invoice_number", label: "Bill No", align: "left" },
        { id: "invoice_date", label: "Date", align: "center", format: "date" },
        { id: "customer_name", label: "Customer Name", align: "left" },
        { id: "payment_mode", label: "Payment", align: "center", format: "badge" },
        { id: "taxable_subtotal", label: "Taxable (₹)", align: "right", format: "currency" },
        { id: "cgst_amount", label: "CGST (₹)", align: "right", format: "currency" },
        { id: "sgst_amount", label: "SGST (₹)", align: "right", format: "currency" },
        { id: "tax_total", label: "Total Tax (₹)", align: "right", format: "currency" },
        { id: "grand_total", label: "Grand Total (₹)", align: "right", format: "currency" },
      ],
      rows: [
        {
          invoice_number: "INV-2026-001",
          invoice_date: "2026-10-10",
          customer_name: "Walk-in Patient",
          payment_mode: "Cash",
          taxable_subtotal: 500,
          cgst_amount: 30,
          sgst_amount: 30,
          tax_total: 60,
          grand_total: 560,
        },
      ],
      totals: {
        taxable_subtotal: 500,
        cgst_amount: 30,
        sgst_amount: 30,
        tax_total: 60,
        grand_total: 560,
      },
    };

    const salesHtml = printFormatter.generatePrintHtml(salesDoc, "a4-portrait");
    expect(salesHtml).toContain("table-layout: fixed;");
    expect(salesHtml).toContain("INV-2026-001");
    expect(salesHtml).toContain("₹560.00");

    // 2. Stock Summary (8 columns)
    const stockDoc: PrintableDocumentData = {
      title: "Stock Valuation Summary",
      storeDetails: {
        storeName: "LamStone Pharmacy",
        address: "Palakkad, Kerala",
        phone: "9876543210",
      },
      filterSummary: [{ label: "LOCATION", value: "Main Pharmacy Store" }],
      generatedAt: "10/10/2026, 6:00:00 PM",
      headers: [
        { id: "product_name", label: "Product / Medicine", align: "left" },
        { id: "batch_no", label: "Batch No", align: "center" },
        { id: "expiry_date", label: "Expiry", align: "center", format: "date" },
        { id: "qty", label: "Pack Stock", align: "right", format: "number" },
        { id: "purchase_rate", label: "Cost Price (₹)", align: "right", format: "currency" },
        { id: "sale_rate", label: "Sale Rate (₹)", align: "right", format: "currency" },
        { id: "mrp", label: "MRP (₹)", align: "right", format: "currency" },
        { id: "purchase_valuation", label: "Cost Valuation (₹)", align: "right", format: "currency" },
      ],
      rows: [
        {
          product_name: "Paracetamol 650mg Tablet IP (Dolo 650)",
          batch_no: "DL-9082",
          expiry_date: "2027-08-31",
          qty: 150,
          purchase_rate: 22.5,
          sale_rate: 30.0,
          mrp: 32.5,
          purchase_valuation: 3375.0,
        },
      ],
      totals: {
        qty: 150,
        purchase_valuation: 3375.0,
      },
    };

    const stockHtml = printFormatter.generatePrintHtml(stockDoc, "a4-portrait");
    expect(stockHtml).toContain("table-layout: fixed;");
    expect(stockHtml).toContain("Paracetamol 650mg Tablet IP (Dolo 650)");
    expect(stockHtml).toContain("₹3,375.00");

    // 3. GSTR-1 Summary (7 columns)
    const gstr1Doc: PrintableDocumentData = {
      title: "GSTR-1 Outward Supplies Summary",
      storeDetails: {
        storeName: "LamStone Pharmacy",
        address: "Palakkad, Kerala",
        phone: "9876543210",
        gstin: "32AAAAA0000A1Z5",
      },
      filterSummary: [{ label: "TAX PERIOD", value: "October 2026" }],
      generatedAt: "10/10/2026, 6:00:00 PM",
      headers: [
        { id: "rate_slab", label: "Tax Rate Slab", align: "left" },
        { id: "taxable_value", label: "Taxable Value (₹)", align: "right", format: "currency" },
        { id: "cgst_amount", label: "Central Tax (₹)", align: "right", format: "currency" },
        { id: "sgst_amount", label: "State Tax (₹)", align: "right", format: "currency" },
        { id: "igst_amount", label: "Integrated Tax (₹)", align: "right", format: "currency" },
        { id: "cess_amount", label: "Cess (₹)", align: "right", format: "currency" },
        { id: "total_invoice_value", label: "Total Value (₹)", align: "right", format: "currency" },
      ],
      rows: [
        {
          rate_slab: "GST @ 12% (Medicines)",
          taxable_value: 100000,
          cgst_amount: 6000,
          sgst_amount: 6000,
          igst_amount: 0,
          cess_amount: 0,
          total_invoice_value: 112000,
        },
      ],
      totals: {
        taxable_value: 100000,
        cgst_amount: 6000,
        sgst_amount: 6000,
        igst_amount: 0,
        cess_amount: 0,
        total_invoice_value: 112000,
      },
    };

    const gstr1Html = printFormatter.generatePrintHtml(gstr1Doc, "a4-portrait");
    expect(gstr1Html).toContain("GST @ 12% (Medicines)");
    expect(gstr1Html).toContain("₹1,12,000.00");
  });

  it("paginates cleanly and isolates grand totals row across 1, 2, 50, and 1,000 rows", () => {
    const storeDetails = {
      storeName: "LamStone Pharmacy",
      address: "Palakkad, Kerala",
      phone: "9876543210",
    };

    const headers = [
      { id: "id", label: "Sl No", align: "center" as const },
      { id: "item", label: "Item Description", align: "left" as const },
      { id: "amount", label: "Amount (₹)", align: "right" as const, format: "currency" as const },
    ];

    const generateRows = (count: number) => {
      const rows = [];
      for (let i = 1; i <= count; i++) {
        rows.push({ id: i, item: `Pharmaceutical Item #${i}`, amount: 100 * i });
      }
      return rows;
    };

    // Test 1 Row
    const doc1: PrintableDocumentData = {
      title: "Audit Test 1 Row",
      storeDetails,
      filterSummary: [],
      generatedAt: "10/10/2026, 12:00:00 PM",
      headers,
      rows: generateRows(1),
      totals: { amount: 100 },
    };
    const html1 = printFormatter.generatePrintHtml(doc1, "a4-portrait");
    expect(html1).toContain('id="page-1"');
    expect(html1).not.toContain('id="page-2"');
    expect(html1).toContain("Page 1 of 1");
    expect(html1).toContain("TOTAL (1 Record)");

    // Test 2 Rows
    const doc2: PrintableDocumentData = {
      title: "Audit Test 2 Rows",
      storeDetails,
      filterSummary: [],
      generatedAt: "10/10/2026, 12:00:00 PM",
      headers,
      rows: generateRows(2),
      totals: { amount: 300 },
    };
    const html2 = printFormatter.generatePrintHtml(doc2, "a4-portrait");
    expect(html2).toContain('id="page-1"');
    expect(html2).not.toContain('id="page-2"');
    expect(html2).toContain("Page 1 of 1");
    expect(html2).toContain("TOTAL (2 Records)");

    // Test 50 Rows (Must paginate to 2 pages)
    const doc50: PrintableDocumentData = {
      title: "Audit Test 50 Rows",
      storeDetails,
      filterSummary: [],
      generatedAt: "10/10/2026, 12:00:00 PM",
      headers,
      rows: generateRows(50),
      totals: { amount: 127500 },
    };
    const html50 = printFormatter.generatePrintHtml(doc50, "a4-portrait");
    expect(html50).toContain('id="page-1"');
    expect(html50).toContain('id="page-2"');
    expect(html50).toContain("Page 1 of 2");
    expect(html50).toContain("Page 2 of 2");
    expect(html50).toContain("running-header"); // Running header on page 2+
    // Grand totals row must appear ONLY on the last page
    const page1Content = html50.substring(html50.indexOf('id="page-1"'), html50.indexOf('id="page-2"'));
    const page2Content = html50.substring(html50.indexOf('id="page-2"'));
    expect(page1Content).not.toContain("TOTAL (50 Records)");
    expect(page2Content).toContain("TOTAL (50 Records)");

    // Test 1,000 Rows (Must paginate smoothly to ~36 pages without crash or overflow)
    const doc1000: PrintableDocumentData = {
      title: "Audit Test 1000 Rows",
      storeDetails,
      filterSummary: [],
      generatedAt: "10/10/2026, 12:00:00 PM",
      headers,
      rows: generateRows(1000),
      totals: { amount: 50050000 },
    };
    const html1000 = printFormatter.generatePrintHtml(doc1000, "a4-portrait");
    expect(html1000).toContain('id="page-1"');
    expect(html1000).toContain("TOTAL (1000 Records)");
    expect(html1000).toContain("page-sheet");
  });
});




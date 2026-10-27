import { describe, it, expect } from "vitest";
import { reportRegistry, REPORT_CATEGORIES } from "./registry";
import { canAccessReport } from "./permissions";

describe("ReportRegistry & Pluggable Modules", () => {
  it("registers all modern ERP report modules across all 8 business categories", () => {
    const all = reportRegistry.getAll();
    expect(all.length).toBe(31);

    const ids = all.map((r) => r.id);

    // 1. Sales & Invoicing (7)
    expect(ids).toContain("sales-register");
    expect(ids).toContain("daily-collection");
    expect(ids).toContain("cancelled-bills");
    expect(ids).toContain("item-wise-sales");
    expect(ids).toContain("customer-wise-sales");
    expect(ids).toContain("sales-return-register");
    expect(ids).toContain("discount-report");

    // 2. Statutory GST & Taxes (6)
    expect(ids).toContain("gstr1-summary");
    expect(ids).toContain("hsn-summary");
    expect(ids).toContain("gstr-3b-summary");
    expect(ids).toContain("gstr-2-itc");
    expect(ids).toContain("gst-slab-report");
    expect(ids).toContain("tax-reconciliation");

    // 3. Inventory & Warehouse (6)
    expect(ids).toContain("stock-summary");
    expect(ids).toContain("near-expiry");
    expect(ids).toContain("low-stock-reorder");
    expect(ids).toContain("slow-dead-stock");
    expect(ids).toContain("fast-moving-stock");
    expect(ids).toContain("stock-movement-ledger");

    // 4. Purchases & Inward (3)
    expect(ids).toContain("purchase-register");
    expect(ids).toContain("item-wise-purchase");
    expect(ids).toContain("purchase-return-register");

    // 5. Supplier Accounts (2)
    expect(ids).toContain("supplier-ageing");
    expect(ids).toContain("supplier-ledger");

    // 6. Customer Accounts (2)
    expect(ids).toContain("customer-ageing");
    expect(ids).toContain("customer-ledger");

    // 7. Profitability & Margins (2)
    expect(ids).toContain("gross-profit-report");
    expect(ids).toContain("daily-profit-summary");

    // 8. Pharmacy & Clinical (3)
    expect(ids).toContain("schedule-h-register");
    expect(ids).toContain("doctor-prescription-report");
    expect(ids).toContain("patient-history");
  });

  it("validates that all 30 reports comply with the standard pluggable interface", () => {
    const all = reportRegistry.getAll();
    for (const report of all) {
      expect(report.id).toBeTruthy();
      expect(report.title).toBeTruthy();
      expect(report.description).toBeTruthy();
      expect(report.category).toBeTruthy();
      expect(report.columns.length).toBeGreaterThan(0);
      expect(report.supportedPrintLayouts.length).toBeGreaterThan(0);
      expect(report.exportFormats.length).toBeGreaterThan(0);
      expect(typeof report.runQuery).toBe("function");
    }
  });

  it("filters reports by category accurately across all categories", () => {
    const categories = ["sales", "gst", "inventory", "purchase", "supplier", "customer", "profit", "pharmacy"] as const;

    for (const cat of categories) {
      const reports = reportRegistry.getByCategory(cat);
      expect(reports.length).toBeGreaterThan(0);
      expect(reports.every((r) => r.category === cat)).toBe(true);
    }

    expect(REPORT_CATEGORIES.length).toBe(8);
  });

  it("enforces role permissions and store menu items (RBAC)", () => {
    const salesReg = reportRegistry.get("sales-register")!;
    const scheduleH = reportRegistry.get("schedule-h-register")!;
    const dailyCol = reportRegistry.get("daily-collection")!;
    const grossProfit = reportRegistry.get("gross-profit-report")!;

    // Super admin has full access
    expect(canAccessReport(salesReg, "admin", ["reports"])).toBe(true);
    expect(canAccessReport(scheduleH, "admin", ["reports"])).toBe(true);
    expect(canAccessReport(grossProfit, "admin", ["reports"])).toBe(true);

    // Accountant has financial access but NOT pharmacy clinical register
    expect(canAccessReport(salesReg, "accountant", ["reports"])).toBe(true);
    expect(canAccessReport(scheduleH, "accountant", ["reports"])).toBe(false);

    // Cashier has access only to daily collection
    expect(canAccessReport(dailyCol, "cashier", ["reports"])).toBe(true);
    expect(canAccessReport(salesReg, "cashier", ["reports"])).toBe(false);
    expect(canAccessReport(grossProfit, "cashier", ["reports"])).toBe(false);

    // If store disables 'reports' menu item, access is blocked completely
    expect(canAccessReport(salesReg, "admin", ["pos", "bills"])).toBe(false);
  });

  it("searches reports by title, description, and keywords", () => {
    const resultsGst = reportRegistry.searchReports("gstr1", "admin", ["reports"]);
    expect(resultsGst.some((r) => r.id === "gstr1-summary")).toBe(true);

    const resultsFefo = reportRegistry.searchReports("fefo", "admin", ["reports"]);
    expect(resultsFefo.some((r) => r.id === "near-expiry")).toBe(true);

    const resultsProfit = reportRegistry.searchReports("margin", "admin", ["reports"]);
    expect(resultsProfit.some((r) => r.id === "gross-profit-report")).toBe(true);

    const resultsReorder = reportRegistry.searchReports("reorder", "admin", ["reports"]);
    expect(resultsReorder.some((r) => r.id === "low-stock-reorder")).toBe(true);

    const resultsRx = reportRegistry.searchReports("rx", "admin", ["reports"]);
    expect(resultsRx.some((r) => r.id === "doctor-prescription-report")).toBe(true);
  });
});

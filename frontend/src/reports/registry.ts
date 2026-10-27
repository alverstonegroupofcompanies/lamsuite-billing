import type { ReportModule, ReportCategory, ReportCategoryMeta } from "./types";
import { canAccessReport } from "./permissions";

// 1. Sales & Invoicing
import { salesRegisterReport } from "./sales/sales-register";
import { dailyCollectionReport } from "./sales/daily-collection";
import { cancelledBillsReport } from "./sales/cancelled-bills";
import { itemWiseSalesReport } from "./sales/item-wise-sales";
import { customerWiseSalesReport } from "./sales/customer-wise-sales";
import { salesReturnRegisterReport } from "./sales/sales-return-register";
import { discountReport } from "./sales/discount-report";

// 2. Statutory GST & Taxes
import { gstr1SummaryReport } from "./gst/gstr1-summary";
import { hsnSummaryReport } from "./gst/hsn-summary";
import { gstr3bSummaryReport } from "./gst/gstr-3b-summary";
import { gstr2ItcReport } from "./gst/gstr-2-itc";
import { gstSlabReport } from "./gst/gst-slab-report";
import { taxReconciliationReport } from "./gst/tax-reconciliation";

// 3. Inventory & Warehouse
import { stockSummaryReport } from "./inventory/stock-summary";
import { nearExpiryReport } from "./inventory/near-expiry";
import { lowStockReorderReport } from "./inventory/low-stock-reorder";
import { slowDeadStockReport } from "./inventory/slow-dead-stock";
import { fastMovingStockReport } from "./inventory/fast-moving-stock";
import { stockMovementLedgerReport } from "./inventory/stock-movement-ledger";

// 4. Purchases & Procurement
import { purchaseRegisterReport } from "./purchase/purchase-register";
import { itemWisePurchaseReport } from "./purchase/item-wise-purchase";
import { purchaseReturnRegisterReport } from "./purchase/purchase-return-register";

// 5. Supplier Accounts
import { supplierAgeingReport } from "./purchase/supplier-ageing";
import { supplierLedgerReport } from "./supplier/supplier-ledger";

// 6. Customer Accounts
import { customerAgeingReport } from "./customer/customer-ageing";
import { customerLedgerReport } from "./customer/customer-ledger";

// 7. Profitability & Margins
import { grossProfitReport } from "./profit/gross-profit-report";
import { dailyProfitSummaryReport } from "./profit/daily-profit-summary";

// 8. Pharmacy & Clinical
import { scheduleHReport } from "./pharmacy/schedule-h-register";
import { doctorPrescriptionReport } from "./pharmacy/doctor-prescription-report";
import { patientHistoryReport } from "./pharmacy/patient-history";

export const REPORT_CATEGORIES: ReportCategoryMeta[] = [
  {
    id: "sales",
    label: "Sales & Invoicing",
    description: "Detailed registers, item sales, discounts, returns, and daily cash collections",
    iconName: "Receipt",
  },
  {
    id: "gst",
    label: "Statutory GST & Taxes",
    description: "GSTR-1, GSTR-3B, GSTR-2 ITC, HSN summaries, and rate slab analysis",
    iconName: "Building",
  },
  {
    id: "inventory",
    label: "Inventory & FEFO",
    description: "Stock valuation, short-expiry alerts, reorder levels, velocity, and movement audit",
    iconName: "Package",
  },
  {
    id: "purchase",
    label: "Purchases & Inward",
    description: "Inward procurement registers, item-wise purchases, and debit notes",
    iconName: "Truck",
  },
  {
    id: "supplier",
    label: "Supplier Accounts",
    description: "Supplier payables ageing, vendor statements of account, and balance due",
    iconName: "Briefcase",
  },
  {
    id: "customer",
    label: "Customer Accounts",
    description: "Receivables ageing, udhari khata ledgers, and credit statements",
    iconName: "Users",
  },
  {
    id: "profit",
    label: "Profitability & Margins",
    description: "Gross margin analysis, cost of goods sold (COGS), and daily profit summary",
    iconName: "TrendingUp",
  },
  {
    id: "pharmacy",
    label: "Pharmacy & Clinical",
    description: "Schedule H/H1 inspection logs, doctor prescriptions, and patient history",
    iconName: "ShieldAlert",
  },
];

export class ReportRegistry {
  private reports = new Map<string, ReportModule>();

  constructor() {
    this.registerBuiltinReports();
  }

  private registerBuiltinReports() {
    // 1. Sales
    this.register(salesRegisterReport);
    this.register(dailyCollectionReport);
    this.register(cancelledBillsReport);
    this.register(itemWiseSalesReport);
    this.register(customerWiseSalesReport);
    this.register(salesReturnRegisterReport);
    this.register(discountReport);

    // 2. GST
    this.register(gstr1SummaryReport);
    this.register(hsnSummaryReport);
    this.register(gstr3bSummaryReport);
    this.register(gstr2ItcReport);
    this.register(gstSlabReport);
    this.register(taxReconciliationReport);

    // 3. Inventory
    this.register(stockSummaryReport);
    this.register(nearExpiryReport);
    this.register(lowStockReorderReport);
    this.register(slowDeadStockReport);
    this.register(fastMovingStockReport);
    this.register(stockMovementLedgerReport);

    // 4. Purchases
    this.register(purchaseRegisterReport);
    this.register(itemWisePurchaseReport);
    this.register(purchaseReturnRegisterReport);

    // 5. Supplier
    this.register(supplierAgeingReport);
    this.register(supplierLedgerReport);

    // 6. Customer
    this.register(customerAgeingReport);
    this.register(customerLedgerReport);

    // 7. Profit
    this.register(grossProfitReport);
    this.register(dailyProfitSummaryReport);

    // 8. Pharmacy
    this.register(scheduleHReport);
    this.register(doctorPrescriptionReport);
    this.register(patientHistoryReport);
  }

  /**
   * Register a new report module (Pluggable contract)
   */
  register(module: ReportModule) {
    this.reports.set(module.id, module);
  }

  /**
   * Get report by ID
   */
  get(id: string): ReportModule | undefined {
    return this.reports.get(id);
  }

  /**
   * List all registered reports
   */
  getAll(): ReportModule[] {
    return Array.from(this.reports.values());
  }

  /**
   * Get reports filtered by category
   */
  getByCategory(category: ReportCategory): ReportModule[] {
    return this.getAll().filter((r) => r.category === category);
  }

  /**
   * Get all reports accessible by current user role and store configuration
   */
  getAccessibleReports(
    userRole: string = "admin",
    enabledMenuItems: string[] = ["reports"]
  ): ReportModule[] {
    return this.getAll().filter((r) => canAccessReport(r, userRole, enabledMenuItems));
  }

  /**
   * Search reports by title, description, or keywords with permission filtering
   */
  searchReports(
    query: string,
    userRole: string = "admin",
    enabledMenuItems: string[] = ["reports"]
  ): ReportModule[] {
    const accessible = this.getAccessibleReports(userRole, enabledMenuItems);
    if (!query.trim()) return accessible;

    const q = query.toLowerCase().trim();
    return accessible.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        (r.keywords && r.keywords.some((k) => k.toLowerCase().includes(q)))
    );
  }
}

export const reportRegistry = new ReportRegistry();

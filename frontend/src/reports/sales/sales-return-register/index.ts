import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";

export interface SalesReturnRow {
  return_id: string;
  return_number: string;
  return_date: string;
  original_invoice_number: string;
  customer_name: string;
  customer_phone: string;
  return_reason: string;
  items_count: number;
  subtotal: number;
  tax_total: number;
  refund_amount: number;
  payment_mode: string;
}

export const salesReturnColumns: ReportColumn<SalesReturnRow>[] = [
  {
    id: "return_number",
    header: "Return Voucher No",
    accessor: (r) => r.return_number,
    align: "left",
    width: 140,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "return_date",
    header: "Date",
    accessor: (r) => r.return_date,
    align: "center",
    width: 100,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "original_invoice_number",
    header: "Original Bill No",
    accessor: (r) => r.original_invoice_number || "-",
    align: "left",
    width: 130,
    isDefaultVisible: true,
  },
  {
    id: "customer_name",
    header: "Customer",
    accessor: (r) => r.customer_name,
    align: "left",
    width: 180,
    isDefaultVisible: true,
  },
  {
    id: "return_reason",
    header: "Reason for Return",
    accessor: (r) => r.return_reason || "Customer Return",
    align: "left",
    width: 180,
    isDefaultVisible: true,
  },
  {
    id: "items_count",
    header: "Items",
    accessor: (r) => r.items_count,
    align: "center",
    width: 80,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "subtotal",
    header: "Taxable Value (₹)",
    accessor: (r) => r.subtotal,
    align: "right",
    width: 120,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "tax_total",
    header: "Tax Reversed (₹)",
    accessor: (r) => r.tax_total,
    align: "right",
    width: 120,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "refund_amount",
    header: "Refund Amount (₹)",
    accessor: (r) => r.refund_amount,
    align: "right",
    width: 135,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "payment_mode",
    header: "Refund Mode",
    accessor: (r) => r.payment_mode,
    align: "center",
    width: 110,
    isDefaultVisible: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const salesReturnFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Date Range",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
];

export const salesReturnReport: ReportModule<any, SalesReturnRow> = {
  id: "sales-return-register",
  title: "Sales Returns & Credit Notes Register",
  description: "Detailed register of returned merchandise, reversal of output tax liability, and customer refund vouchers.",
  category: "sales",
  permission: "reports.sales.view",
  menuVisibilityKey: "reports",
  keywords: ["sales return", "credit note", "refund", "reversal", "returned goods", "restock"],
  defaultSort: { column: "return_date", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: salesReturnFilters,
  columns: salesReturnColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    const itemsByInvoice = new Map<string, InvoiceItemRecord[]>();
    for (const item of allItems) {
      if (!itemsByInvoice.has(item.invoice_id)) {
        itemsByInvoice.set(item.invoice_id, []);
      }
      itemsByInvoice.get(item.invoice_id)!.push(item);
    }

    const returns = allInvoices.filter(
      (inv) =>
        inv.status !== "cancelled" &&
        (inv.module_key === "sales_return" || inv.module_key === "credit_note") &&
        inv.invoice_date >= dates.startDate &&
        inv.invoice_date <= dates.endDate
    );

    const rows: SalesReturnRow[] = returns.map((inv) => {
      const items = itemsByInvoice.get(inv.id) || [];
      const taxTot = Number(inv.tax_total) || 0;
      const grandTot = Number(inv.grand_total) || 0;
      const sub = Number(inv.subtotal) || (grandTot - taxTot);

      return {
        return_id: inv.id,
        return_number: inv.invoice_number,
        return_date: inv.invoice_date,
        original_invoice_number: (inv as any).original_invoice_number || "-",
        customer_name: inv.customer_name || "Counter Customer",
        customer_phone: (inv as any).customer_phone || "-",
        return_reason: (inv as any).cancel_reason || (inv as any).return_reason || "Customer Returned Product",
        items_count: items.length,
        subtotal: Math.round(sub * 100) / 100,
        tax_total: Math.round(taxTot * 100) / 100,
        refund_amount: Math.round(grandTot * 100) / 100,
        payment_mode: inv.payment_mode || "Cash",
      };
    });

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter(
        (r) =>
          r.return_number.toLowerCase().includes(q) ||
          r.customer_name.toLowerCase().includes(q) ||
          r.original_invoice_number.toLowerCase().includes(q)
      );
      return { rows: filtered, totalCount: filtered.length, page: 1, pageSize: filtered.length, totalPages: 1 };
    }

    return { rows, totalCount: rows.length, page: 1, pageSize: rows.length, totalPages: 1 };
  },
};

export const salesReturnRegisterReport = salesReturnReport;

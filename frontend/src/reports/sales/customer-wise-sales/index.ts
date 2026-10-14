import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord } from "../../../lib/billing/invoiceManagementService";

export interface CustomerWiseSalesRow {
  customer_id: string;
  customer_name: string;
  phone: string;
  gstin: string;
  invoice_count: number;
  total_spend: number;
  total_discount: number;
  avg_basket_value: number;
  last_visit_date: string;
}

export const customerWiseSalesColumns: ReportColumn<CustomerWiseSalesRow>[] = [
  {
    id: "customer_name",
    header: "Customer Name",
    accessor: (r) => r.customer_name,
    align: "left",
    width: 220,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "phone",
    header: "Mobile Number",
    accessor: (r) => r.phone,
    align: "center",
    width: 130,
    isDefaultVisible: true,
  },
  {
    id: "gstin",
    header: "Customer GSTIN",
    accessor: (r) => r.gstin,
    align: "center",
    width: 140,
    isDefaultVisible: false,
  },
  {
    id: "invoice_count",
    header: "Total Bills",
    accessor: (r) => r.invoice_count,
    align: "center",
    width: 100,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "total_spend",
    header: "Total Spend (₹)",
    accessor: (r) => r.total_spend,
    align: "right",
    width: 140,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "total_discount",
    header: "Discount Saved (₹)",
    accessor: (r) => r.total_discount,
    align: "right",
    width: 120,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "avg_basket_value",
    header: "Avg Basket (₹)",
    accessor: (r) => r.avg_basket_value,
    align: "right",
    width: 120,
    format: "currency",
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "last_visit_date",
    header: "Last Purchase",
    accessor: (r) => r.last_visit_date,
    align: "center",
    width: 110,
    isDefaultVisible: true,
    canSort: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const customerWiseSalesFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Date Range",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
];

export const customerWiseSalesReport: ReportModule<any, CustomerWiseSalesRow> = {
  id: "customer-wise-sales",
  title: "Customer-Wise Sales Summary",
  description: "Customer purchasing volume, frequency, average ticket size, and client lifetime revenue rankings.",
  category: "sales",
  permission: "reports.sales.view",
  menuVisibilityKey: "reports",
  keywords: ["customer sales", "top customers", "loyalty", "basket size", "patronage"],
  defaultSort: { column: "total_spend", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: customerWiseSalesFilters,
  columns: customerWiseSalesColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allCustomers = await sqliteStorage.findAll<any>("customers");

    const custMap = new Map<string, any>();
    for (const c of allCustomers) {
      custMap.set(c.id, c);
    }

    const filtered = allInvoices.filter(
      (inv) =>
        inv.status !== "cancelled" &&
        inv.invoice_date >= dates.startDate &&
        inv.invoice_date <= dates.endDate
    );

    const agg = new Map<string, {
      name: string;
      phone: string;
      gstin: string;
      count: number;
      spend: number;
      disc: number;
      lastDate: string;
    }>();

    for (const inv of filtered) {
      const isReturn = inv.module_key === "sales_return" || inv.module_key === "credit_note";
      const sign = isReturn ? -1 : 1;

      const cId = inv.customer_id || (inv.customer_name ? `name_${inv.customer_name}` : "walk_in");
      const c = custMap.get(inv.customer_id || "");
      const name = inv.customer_name || c?.name || "Counter Customer";
      const phone = (inv as any).customer_phone || c?.phone || "-";
      const gstin = inv.customer_gstin || c?.gstin || "-";

      const total = (Number(inv.grand_total) || 0) * sign;
      const disc = (Number(inv.discount_total) || 0) * sign;

      if (!agg.has(cId)) {
        agg.set(cId, {
          name,
          phone,
          gstin,
          count: 0,
          spend: 0,
          disc: 0,
          lastDate: inv.invoice_date,
        });
      }

      const rec = agg.get(cId)!;
      if (!isReturn) rec.count += 1;
      rec.spend += total;
      rec.disc += disc;
      if (inv.invoice_date > rec.lastDate) rec.lastDate = inv.invoice_date;
    }

    const rows: CustomerWiseSalesRow[] = Array.from(agg.entries()).map(([cId, v]) => {
      const avg = v.count > 0 ? Math.round((v.spend / v.count) * 100) / 100 : 0;
      return {
        customer_id: cId,
        customer_name: v.name,
        phone: v.phone,
        gstin: v.gstin,
        invoice_count: v.count,
        total_spend: Math.round(v.spend * 100) / 100,
        total_discount: Math.round(v.disc * 100) / 100,
        avg_basket_value: avg,
        last_visit_date: v.lastDate,
      };
    });

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const searchFiltered = rows.filter(
        (r) => r.customer_name.toLowerCase().includes(q) || r.phone.includes(q)
      );
      return { rows: searchFiltered, totalCount: searchFiltered.length, page: 1, pageSize: searchFiltered.length, totalPages: 1 };
    }

    return { rows, totalCount: rows.length, page: 1, pageSize: rows.length, totalPages: 1 };
  },
};

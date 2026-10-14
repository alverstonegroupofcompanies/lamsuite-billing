import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord } from "../../../lib/billing/invoiceManagementService";

export interface CustomerAgeingRow {
  customer_id: string;
  customer_name: string;
  phone: string;
  days_0_to_30: number;
  days_31_to_60: number;
  days_61_plus: number;
  total_outstanding: number;
  invoice_count: number;
  last_invoice_date: string;
}

export const customerAgeingColumns: ReportColumn<CustomerAgeingRow>[] = [
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
    accessor: (r) => r.phone || "-",
    align: "center",
    width: 130,
    isDefaultVisible: true,
  },
  {
    id: "days_0_to_30",
    header: "0-30 Days (₹)",
    accessor: (r) => r.days_0_to_30,
    align: "right",
    width: 120,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "days_31_to_60",
    header: "31-60 Days (₹)",
    accessor: (r) => r.days_31_to_60,
    align: "right",
    width: 120,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "days_61_plus",
    header: "61+ Days Overdue (₹)",
    accessor: (r) => r.days_61_plus,
    align: "right",
    width: 150,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_outstanding",
    header: "Total Due (₹)",
    accessor: (r) => r.total_outstanding,
    align: "right",
    width: 140,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "invoice_count",
    header: "Bills Due",
    accessor: (r) => r.invoice_count,
    align: "center",
    width: 90,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "last_invoice_date",
    header: "Last Bill Date",
    accessor: (r) => r.last_invoice_date,
    align: "center",
    width: 110,
    isDefaultVisible: true,
    canSort: true,
  },
];

const today = new Date().toISOString().slice(0, 10);

export const customerAgeingFilters: ReportFilterDef[] = [
  {
    id: "asOfDate",
    label: "As of Date",
    type: "date",
    defaultValue: today,
    required: true,
  },
];

export const customerAgeingReport: ReportModule<any, CustomerAgeingRow> = {
  id: "customer-ageing",
  title: "Customer Receivables & Ageing",
  description: "Outstanding customer balances segmented into 0-30, 31-60, and 61+ day ageing buckets.",
  category: "customer",
  permission: "reports.customer.view",
  menuVisibilityKey: "reports",
  keywords: ["customer", "ageing", "outstanding", "udhari", "due", "receivables", "credit"],
  defaultSort: { column: "total_outstanding", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: customerAgeingFilters,
  columns: customerAgeingColumns,
  runQuery: async (params) => {
    const asOfStr = params.filters.asOfDate || today;
    const refDate = new Date(asOfStr);

    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allCustomers = await sqliteStorage.findAll<any>("customers");

    const custMap = new Map<string, any>();
    for (const c of allCustomers) {
      custMap.set(c.id, c);
    }

    const unpaidInvoices = allInvoices.filter(
      (inv) =>
        inv.status !== "cancelled" &&
        inv.module_key === "invoice" &&
        Number(inv.paid_amount || 0) < Number(inv.grand_total || 0)
    );

    const agg = new Map<
      string,
      {
        customer_name: string;
        phone: string;
        d0_30: number;
        d31_60: number;
        d61_plus: number;
        total: number;
        count: number;
        lastDate: string;
      }
    >();

    for (const inv of unpaidInvoices) {
      const cId = inv.customer_id || "walk_in";
      const due = Number(inv.grand_total || 0) - Number(inv.paid_amount || 0);
      if (due <= 0) continue;

      const invDate = new Date(inv.invoice_date);
      const diffDays = Math.max(0, Math.floor((refDate.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24)));

      if (!agg.has(cId)) {
        const cust = custMap.get(cId);
        agg.set(cId, {
          customer_name: inv.customer_name || cust?.name || "Counter Customer",
          phone: cust?.phone || "-",
          d0_30: 0,
          d31_60: 0,
          d61_plus: 0,
          total: 0,
          count: 0,
          lastDate: inv.invoice_date,
        });
      }

      const rec = agg.get(cId)!;
      rec.total += due;
      rec.count += 1;
      if (inv.invoice_date > rec.lastDate) {
        rec.lastDate = inv.invoice_date;
      }

      if (diffDays <= 30) {
        rec.d0_30 += due;
      } else if (diffDays <= 60) {
        rec.d31_60 += due;
      } else {
        rec.d61_plus += due;
      }
    }

    const rows: CustomerAgeingRow[] = Array.from(agg.entries()).map(([cId, v]) => ({
      customer_id: cId,
      customer_name: v.customer_name,
      phone: v.phone,
      days_0_to_30: Math.round(v.d0_30 * 100) / 100,
      days_31_to_60: Math.round(v.d31_60 * 100) / 100,
      days_61_plus: Math.round(v.d61_plus * 100) / 100,
      total_outstanding: Math.round(v.total * 100) / 100,
      invoice_count: v.count,
      last_invoice_date: v.lastDate,
    }));

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter(
        (r) => r.customer_name.toLowerCase().includes(q) || r.phone.includes(q)
      );
      return {
        rows: filtered,
        totalCount: filtered.length,
        page: 1,
        pageSize: filtered.length,
        totalPages: 1,
      };
    }

    return {
      rows,
      totalCount: rows.length,
      page: 1,
      pageSize: rows.length,
      totalPages: 1,
    };
  },
};

import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { PurchaseDocumentRecord } from "../../../lib/purchases/purchaseService";

export interface SupplierAgeingRow {
  supplier_id: string;
  supplier_name: string;
  phone: string;
  days_0_to_30: number;
  days_31_to_60: number;
  days_61_to_90: number;
  days_91_plus: number;
  total_payable: number;
  bill_count: number;
  last_purchase_date: string;
}

export const supplierAgeingColumns: ReportColumn<SupplierAgeingRow>[] = [
  {
    id: "supplier_name",
    header: "Supplier / Distributor",
    accessor: (r) => r.supplier_name,
    align: "left",
    width: 220,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "phone",
    header: "Contact",
    accessor: (r) => r.phone || "-",
    align: "center",
    width: 120,
    isDefaultVisible: true,
  },
  {
    id: "days_0_to_30",
    header: "0-30 Days (₹)",
    accessor: (r) => r.days_0_to_30,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "days_31_to_60",
    header: "31-60 Days (₹)",
    accessor: (r) => r.days_31_to_60,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "days_61_to_90",
    header: "61-90 Days (₹)",
    accessor: (r) => r.days_61_to_90,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "days_91_plus",
    header: "91+ Days Overdue (₹)",
    accessor: (r) => r.days_91_plus,
    align: "right",
    width: 140,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_payable",
    header: "Total Payable (₹)",
    accessor: (r) => r.total_payable,
    align: "right",
    width: 140,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "bill_count",
    header: "Invoices Due",
    accessor: (r) => r.bill_count,
    align: "center",
    width: 95,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "last_purchase_date",
    header: "Last Inward Date",
    accessor: (r) => r.last_purchase_date,
    align: "center",
    width: 115,
    format: "date",
    isDefaultVisible: true,
    canSort: true,
  },
];

const today = new Date().toISOString().slice(0, 10);

export const supplierAgeingFilters: ReportFilterDef[] = [
  {
    id: "asOfDate",
    label: "As of Date",
    type: "date",
    defaultValue: today,
    required: true,
  },
];

export const supplierAgeingReport: ReportModule<any, SupplierAgeingRow> = {
  id: "supplier-ageing",
  title: "Supplier Payables & Ageing",
  description: "Accounts payable ageing breakdown (0-30, 31-60, 61-90, 91+ days) for supplier payment scheduling.",
  category: "supplier",
  permission: "reports.purchase.view",
  menuVisibilityKey: "reports",
  keywords: ["supplier", "payables", "ageing", "distributor", "bills due", "credit period", "accounts payable"],
  defaultSort: { column: "total_payable", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: supplierAgeingFilters,
  columns: supplierAgeingColumns,
  runQuery: async (params) => {
    const asOfStr = params.filters.asOfDate || today;
    const refDate = new Date(asOfStr);

    const [allPurchasesDocs, allPurchasesAlt, allSuppliers] = await Promise.all([
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents").catch(() => []),
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchases").catch(() => []),
      sqliteStorage.findAll<any>("suppliers").catch(() => []),
    ]);

    const purchaseMap = new Map<string, PurchaseDocumentRecord>();
    for (const p of allPurchasesAlt) {
      if (p && (p.id || p.purchase_number)) purchaseMap.set(p.id || p.purchase_number, p);
    }
    for (const p of allPurchasesDocs) {
      if (p && (p.id || p.purchase_number)) purchaseMap.set(p.id || p.purchase_number, p);
    }
    const allPurchases = Array.from(purchaseMap.values());

    const supMap = new Map<string, any>();
    for (const s of allSuppliers) {
      supMap.set(s.id, s);
    }

    const unpaid = allPurchases.filter(
      (p) =>
        (p.status || "").toLowerCase() !== "cancelled" &&
        Number(p.paid_amount || 0) < Number(p.grand_total || 0)
    );

    const agg = new Map<
      string,
      {
        supplier_name: string;
        phone: string;
        d0_30: number;
        d31_60: number;
        d61_90: number;
        d91_plus: number;
        total: number;
        count: number;
        lastDate: string;
      }
    >();

    for (const p of unpaid) {
      const sId = p.supplier_id;
      const due = Number(p.grand_total || 0) - Number(p.paid_amount || 0);
      if (due <= 0) continue;

      const pDate = new Date(p.purchase_date);
      const diffDays = Math.max(0, Math.floor((refDate.getTime() - pDate.getTime()) / (1000 * 60 * 60 * 24)));

      if (!agg.has(sId)) {
        const s = supMap.get(sId);
        agg.set(sId, {
          supplier_name: p.supplier_name || s?.name || "Supplier",
          phone: s?.phone || "-",
          d0_30: 0,
          d31_60: 0,
          d61_90: 0,
          d91_plus: 0,
          total: 0,
          count: 0,
          lastDate: p.purchase_date,
        });
      }

      const rec = agg.get(sId)!;
      rec.total += due;
      rec.count += 1;
      if (p.purchase_date > rec.lastDate) {
        rec.lastDate = p.purchase_date;
      }

      if (diffDays <= 30) {
        rec.d0_30 += due;
      } else if (diffDays <= 60) {
        rec.d31_60 += due;
      } else if (diffDays <= 90) {
        rec.d61_90 += due;
      } else {
        rec.d91_plus += due;
      }
    }

    const rows: SupplierAgeingRow[] = Array.from(agg.entries()).map(([sId, v]) => ({
      supplier_id: sId,
      supplier_name: v.supplier_name,
      phone: v.phone,
      days_0_to_30: Math.round(v.d0_30 * 100) / 100,
      days_31_to_60: Math.round(v.d31_60 * 100) / 100,
      days_61_to_90: Math.round(v.d61_90 * 100) / 100,
      days_91_plus: Math.round(v.d91_plus * 100) / 100,
      total_payable: Math.round(v.total * 100) / 100,
      bill_count: v.count,
      last_purchase_date: v.lastDate,
    }));

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter(
        (r) => r.supplier_name.toLowerCase().includes(q) || r.phone.includes(q)
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

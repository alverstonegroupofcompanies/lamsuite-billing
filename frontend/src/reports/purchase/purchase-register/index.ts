import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { PurchaseDocumentRecord } from "../../../lib/purchases/purchaseService";
import {
  chargeHeadsLabel,
  indexChargeRegister,
  type PurchaseChargeRecord,
  type PurchaseChargeSummary,
} from "../../../lib/reports/purchaseChargeRegister";

/**
 * REP-007: the register reads a bill as two blocks — the goods the header calls `subtotal`, and
 * the charges the supplier billed on top of it. The header tax already carries the charge GST
 * (PUR-001), so the charge block is taken back out of it rather than added to it, and a bill keyed
 * before CR-C contributes its freight scalar as one Freight head (PUR-017).
 */
const chargeSummary = (row: any): PurchaseChargeSummary | null =>
  (row?.charge_summary as PurchaseChargeSummary) || null;

const chargeOf = (row: any, pick: (s: PurchaseChargeSummary) => number) => {
  const summary = chargeSummary(row);
  return summary ? pick(summary) : 0;
};

export const purchaseRegisterColumns: ReportColumn<PurchaseDocumentRecord>[] = [
  {
    id: "purchase_number",
    header: "Voucher No",
    accessor: (r) => r.purchase_number,
    align: "left",
    width: 120,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "purchase_date",
    header: "Date",
    accessor: (r) => r.purchase_date,
    align: "center",
    width: 100,
    format: "date",
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "supplier_name",
    header: "Supplier Name",
    accessor: (r) => r.supplier_name,
    align: "left",
    width: 200,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "supplier_invoice_no",
    header: "Supplier Bill No",
    accessor: (r) => r.supplier_invoice_no,
    align: "left",
    width: 130,
    isDefaultVisible: true,
  },
  {
    id: "items_summary",
    header: "Items Purchased",
    accessor: (r) => (r as any).items_summary || "-",
    align: "left",
    width: 220,
    isDefaultVisible: false,
  },
  {
    id: "supplier_gstin",
    header: "GSTIN",
    accessor: (r) => r.supplier_gstin || "-",
    align: "center",
    width: 140,
    isDefaultVisible: false,
  },
  {
    id: "subtotal",
    header: "Taxable Value (₹)",
    accessor: (r) => r.subtotal,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "cgst_total",
    header: "CGST (₹)",
    accessor: (r) => {
      const v = Number(r.cgst_total);
      if (!isNaN(v) && v > 0) return v;
      if (r.is_interstate) return 0;
      const tax = Number(r.tax_total);
      if (!isNaN(tax) && tax > 0 && (!r.igst_total || Number(r.igst_total) === 0)) {
        return Math.round((tax / 2 + Number.EPSILON) * 100) / 100;
      }
      return 0;
    },
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "sgst_total",
    header: "SGST (₹)",
    accessor: (r) => {
      const v = Number(r.sgst_total);
      if (!isNaN(v) && v > 0) return v;
      if (r.is_interstate) return 0;
      const tax = Number(r.tax_total);
      if (!isNaN(tax) && tax > 0 && (!r.igst_total || Number(r.igst_total) === 0)) {
        return Math.round((tax / 2 + Number.EPSILON) * 100) / 100;
      }
      return 0;
    },
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "igst_total",
    header: "IGST (₹)",
    accessor: (r) => {
      const v = Number(r.igst_total);
      if (!isNaN(v) && v > 0) return v;
      if (r.is_interstate && r.tax_total) return Number(r.tax_total);
      return 0;
    },
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "tax_total",
    header: "Tax Total (₹)",
    accessor: (r) => r.tax_total,
    align: "right",
    width: 105,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "charge_taxable",
    header: "Charge Taxable (₹)",
    accessor: (r) => chargeOf(r, (s) => s.charge_taxable),
    align: "right",
    width: 125,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "charge_tax",
    header: "Charge Tax (₹)",
    accessor: (r) => chargeOf(r, (s) => s.charge_tax),
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "charge_total",
    header: "Charges (₹)",
    accessor: (r) => chargeOf(r, (s) => s.charge_total),
    align: "right",
    width: 105,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "charge_add_to_cost",
    header: "Added To Cost (₹)",
    accessor: (r) =>
      chargeOf(r, (s) =>
        s.by_head
          .filter((head) => head.in_payable && head.treatment === "add_to_cost")
          .reduce((sum, head) => sum + head.total, 0)
      ),
    align: "right",
    width: 125,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "charge_expensed",
    header: "Expensed (₹)",
    accessor: (r) =>
      chargeOf(r, (s) =>
        s.by_head
          .filter((head) => head.in_payable && head.treatment === "expense")
          .reduce((sum, head) => sum + head.total, 0)
      ),
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "charge_separately_paid",
    header: "Paid Separately (₹)",
    // PUR-013: money already handed to a transporter is the bill's cost but not its payable.
    accessor: (r) => chargeOf(r, (s) => s.separately_paid.total),
    align: "right",
    width: 135,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "charge_heads",
    header: "Charge Heads",
    accessor: (r) => {
      const summary = chargeSummary(r);
      return summary && summary.by_head.length ? chargeHeadsLabel(summary.by_head) : "-";
    },
    align: "left",
    width: 240,
    isDefaultVisible: true,
  },
  {
    id: "landed_value",
    header: "Landed Value (₹)",
    // The goods taxable plus what add-to-cost charges spread onto it — the taxable half of payable.
    accessor: (r) => chargeOf(r, (s) => s.landed_value),
    align: "right",
    width: 125,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "grand_total",
    header: "Invoice Value (₹)",
    accessor: (r) => r.grand_total,
    align: "right",
    width: 135,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "payment_status",
    header: "Payment",
    accessor: (r) => (r.payment_status || "unpaid").toUpperCase(),
    align: "center",
    width: 100,
    format: "badge",
    badgeStyle: (_, r) => {
      const status = r.payment_status || "unpaid";
      if (status === "paid") return "success";
      if (status === "partial") return "warning";
      return "danger";
    },
    isDefaultVisible: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const purchaseRegisterFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Date Range",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
  {
    id: "paymentStatus",
    label: "Payment Status",
    type: "select",
    defaultValue: "all",
    options: [
      { label: "All Purchases", value: "all" },
      { label: "Unpaid / Due", value: "unpaid" },
      { label: "Partially Paid", value: "partial" },
      { label: "Fully Paid", value: "paid" },
    ],
  },
  {
    id: "hasCharges",
    label: "Bill Charges",
    type: "select",
    defaultValue: "all",
    options: [
      { label: "All Bills", value: "all" },
      { label: "With Charges", value: "with" },
      { label: "Without Charges", value: "without" },
    ],
  },
];

export const purchaseRegisterReport: ReportModule<any, PurchaseDocumentRecord> = {
  id: "purchase-register",
  title: "Purchase Inward Register",
  description: "Inward tax register that shows each supplier bill as two blocks — goods taxable and tax apart from the charges billed on top, by head — plus landed value, payable and payment status.",
  category: "purchase",
  permission: "reports.purchase.view",
  menuVisibilityKey: "reports",
  keywords: ["purchase", "inward", "supplier bills", "itc", "gstr2", "procurement", "charges", "landed cost", "freight"],
  defaultSort: { column: "purchase_date", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: purchaseRegisterFilters,
  columns: purchaseRegisterColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const startDateStr = String(dates.startDate || "").trim().slice(0, 10);
    const endDateStr = String(dates.endDate || "").trim().slice(0, 10);

    const [allPurchasesDocs, allPurchasesAlt, allPurchaseItems, allCharges] = await Promise.all([
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents").catch(() => []),
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchases").catch(() => []),
      sqliteStorage.findAll<any>("purchase_items").catch(() => []),
      sqliteStorage.findAll<PurchaseChargeRecord>("purchase_charges").catch(() => []),
    ]);

    const itemsByPurchaseId = new Map<string, string[]>();
    for (const item of allPurchaseItems) {
      if (item && item.purchase_id && item.product_name) {
        const list = itemsByPurchaseId.get(item.purchase_id) || [];
        const qtyStr = item.pack_qty ? ` (${item.pack_qty})` : "";
        list.push(`${item.product_name}${qtyStr}`);
        itemsByPurchaseId.set(item.purchase_id, list);
      }
    }

    const purchaseMap = new Map<string, PurchaseDocumentRecord>();
    for (const p of allPurchasesAlt) {
      if (p && (p.id || p.purchase_number)) purchaseMap.set(p.id || p.purchase_number, p);
    }
    for (const p of allPurchasesDocs) {
      if (p && (p.id || p.purchase_number)) purchaseMap.set(p.id || p.purchase_number, p);
    }
    const allPurchases = Array.from(purchaseMap.values());

    for (const p of allPurchases) {
      let itemsList = itemsByPurchaseId.get(p.id) || itemsByPurchaseId.get(p.purchase_number);
      if ((!itemsList || itemsList.length === 0) && (p as any).lines && Array.isArray((p as any).lines)) {
        itemsList = (p as any).lines.map((l: any) => `${l.product_name || "Item"}${l.pack_qty ? ` (${l.pack_qty})` : ""}`);
      }
      (p as any).items_summary = itemsList && itemsList.length > 0 ? itemsList.join(", ") : "";
    }

    let filtered = allPurchases.filter((p) => {
      if (!p) return false;
      const status = (p.status || "").toLowerCase();
      if (status === "cancelled") return false;

      const pDate = String(p.purchase_date || "").trim().slice(0, 10);
      if (startDateStr && pDate < startDateStr) return false;
      if (endDateStr && pDate > endDateStr) return false;
      return true;
    });

    if (params.filters.paymentStatus && params.filters.paymentStatus !== "all") {
      const targetStatus = String(params.filters.paymentStatus).toLowerCase();
      filtered = filtered.filter(
        (p) => (p.payment_status || "unpaid").toLowerCase() === targetStatus
      );
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          (p.purchase_number && p.purchase_number.toLowerCase().includes(q)) ||
          (p.supplier_name && p.supplier_name.toLowerCase().includes(q)) ||
          (p.supplier_invoice_no && p.supplier_invoice_no.toLowerCase().includes(q))
      );
    }

    // Charges are read once and grouped, so a register over thousands of bills stays one pass.
    const chargeIndex = indexChargeRegister(
      filtered as unknown as Parameters<typeof indexChargeRegister>[0],
      allCharges,
      allPurchaseItems
    );
    for (const row of filtered) {
      (row as any).charge_summary = chargeIndex.byBill.get((row as any).id) || null;
    }

    const chargesFilter = String(params.filters.hasCharges || "all");
    if (chargesFilter !== "all") {
      filtered = filtered.filter((p) => {
        const summary = (p as any).charge_summary as PurchaseChargeSummary | null;
        const count = summary?.charge_count ?? 0;
        return chargesFilter === "with" ? count > 0 : count === 0;
      });
    }

    return {
      rows: filtered,
      totalCount: filtered.length,
      page: 1,
      pageSize: filtered.length,
      totalPages: 1,
    };
  },
};

import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { PurchaseDocumentRecord, PurchaseItemRecord } from "../../../lib/purchases/purchaseService";

export interface ItemWisePurchaseRow {
  product_id: string;
  product_name: string;
  hsn_code: string;
  pack_qty: number;
  free_qty: number;
  total_units: number;
  avg_purchase_rate: number;
  discount_amount: number;
  taxable_amount: number;
  total_tax: number;
  total_cost: number;
  supplier_count: number;
}

export const itemWisePurchaseColumns: ReportColumn<ItemWisePurchaseRow>[] = [
  {
    id: "product_name",
    header: "Product / Medicine Name",
    accessor: (r) => r.product_name,
    align: "left",
    width: 220,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "hsn_code",
    header: "HSN / SAC",
    accessor: (r) => r.hsn_code || "-",
    align: "center",
    width: 110,
    isDefaultVisible: true,
  },
  {
    id: "pack_qty",
    header: "Billed Packs",
    accessor: (r) => r.pack_qty,
    align: "right",
    width: 105,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "free_qty",
    header: "Free Packs",
    accessor: (r) => r.free_qty,
    align: "right",
    width: 95,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_units",
    header: "Total Units",
    accessor: (r) => r.total_units,
    align: "right",
    width: 100,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "avg_purchase_rate",
    header: "Avg Rate (₹)",
    accessor: (r) => r.avg_purchase_rate,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
  },
  {
    id: "discount_amount",
    header: "Discount (₹)",
    accessor: (r) => r.discount_amount,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "taxable_amount",
    header: "Taxable Value (₹)",
    accessor: (r) => r.taxable_amount,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "total_tax",
    header: "Input Tax (₹)",
    accessor: (r) => r.total_tax,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_cost",
    header: "Landed Cost (₹)",
    accessor: (r) => r.total_cost,
    align: "right",
    width: 135,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const itemWisePurchaseFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Purchase Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
];

export const itemWisePurchaseReport: ReportModule<any, ItemWisePurchaseRow> = {
  id: "item-wise-purchase",
  title: "Item-Wise Inward Procurement Register",
  description: "Comprehensive product purchase report tracking billed vs free quantities, effective purchase rates, and landed procurement costs.",
  category: "purchase",
  permission: "reports.purchase.view",
  menuVisibilityKey: "reports",
  keywords: ["item purchase", "procurement", "product purchase", "free quantity", "purchase rate", "cost analysis"],
  defaultSort: { column: "total_cost", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: itemWisePurchaseFilters,
  columns: itemWisePurchaseColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const startDateStr = String(dates.startDate || "").trim().slice(0, 10);
    const endDateStr = String(dates.endDate || "").trim().slice(0, 10);

    const [allPurchasesDocs, allPurchasesAlt, allPurchaseItems] = await Promise.all([
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents").catch(() => []),
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchases").catch(() => []),
      sqliteStorage.findAll<PurchaseItemRecord>("purchase_items").catch(() => []),
    ]);

    const purchaseDedupMap = new Map<string, PurchaseDocumentRecord>();
    for (const p of allPurchasesAlt) {
      if (p && (p.id || p.purchase_number)) purchaseDedupMap.set(p.id || p.purchase_number, p);
    }
    for (const p of allPurchasesDocs) {
      if (p && (p.id || p.purchase_number)) purchaseDedupMap.set(p.id || p.purchase_number, p);
    }
    const allPurchases = Array.from(purchaseDedupMap.values());

    const activePurchases = allPurchases.filter((p) => {
      if (!p) return false;
      const status = (p.status || "").toLowerCase();
      if (status === "cancelled") return false;

      const pDate = String(p.purchase_date || "").trim().slice(0, 10);
      if (startDateStr && pDate < startDateStr) return false;
      if (endDateStr && pDate > endDateStr) return false;
      return true;
    });
    const purchaseMap = new Map(activePurchases.map((p) => [p.id, p]));

    // Synthesize items from p.lines / p.items if purchase_items table does not have rows for this purchase
    const recordedDocIds = new Set(allPurchaseItems.map((i) => i.purchase_id));
    const combinedItems: PurchaseItemRecord[] = [...allPurchaseItems];
    for (const p of activePurchases) {
      if (!recordedDocIds.has(p.id) && (p as any).lines && Array.isArray((p as any).lines)) {
        for (const line of (p as any).lines) {
          combinedItems.push({
            id: line.id || `line_${Math.random()}`,
            purchase_id: p.id,
            product_id: line.product_id || line.product_name,
            product_name: line.product_name,
            hsn_code: line.hsn_code,
            batch_id: line.batch_id || "",
            batch_no: line.batch_no || "",
            mfg_date: line.mfg_date,
            expiry_date: line.expiry_date || "",
            pack_qty: line.pack_qty ?? line.qty ?? 1,
            loose_qty: line.loose_qty || 0,
            free_qty: line.free_qty || 0,
            units_per_pack: line.units_per_pack || 1,
            total_units: line.total_units || line.pack_qty || 1,
            purchase_rate: line.purchase_rate || line.rate || 0,
            discount_percent: line.discount_percent || 0,
            discount_amount: line.discount_amount || 0,
            effective_unit_cost: line.effective_unit_cost || line.purchase_rate || 0,
            gst_percent: line.gst_percent || 0,
            cgst_amount: line.cgst_amount || 0,
            sgst_amount: line.sgst_amount || 0,
            igst_amount: line.igst_amount || 0,
            tax_amount: line.tax_amount || 0,
            total_amount: line.total_amount || line.amount || 0,
          });
        }
      }
    }

    const prodMap = new Map<
      string,
      {
        name: string;
        hsn: string;
        packQty: number;
        freeQty: number;
        totalUnits: number;
        discount: number;
        taxable: number;
        tax: number;
        cost: number;
        suppliers: Set<string>;
      }
    >();

    for (const item of combinedItems) {
      if (!purchaseMap.has(item.purchase_id)) continue;
      const p = purchaseMap.get(item.purchase_id)!;
      const isReturn = p.module_key === "purchase_return" || p.module_key === "debit_note";
      const sign = isReturn ? -1 : 1;

      const pQty = (Number(item.pack_qty) || 0) * sign;
      const fQty = (Number(item.free_qty) || 0) * sign;
      const tUnits = (Number(item.total_units || item.pack_qty) || 0) * sign;
      const rate = Number(item.purchase_rate) || 0;
      const disc = (Number(item.discount_amount) || 0) * sign;

      const taxable = (Number((item as any).taxable_amount) || (pQty * rate - disc)) * sign;
      const gstRate = Number((item as any).gst_percent || (item as any).gst_rate) || 0;
      const tax = (Number((item as any).total_tax) || (taxable * gstRate) / 100) * sign;
      const cost = taxable + tax;

      const cur = prodMap.get(item.product_id) || {
        name: item.product_name,
        hsn: item.hsn_code || "",
        packQty: 0,
        freeQty: 0,
        totalUnits: 0,
        discount: 0,
        taxable: 0,
        tax: 0,
        cost: 0,
        suppliers: new Set<string>(),
      };

      cur.packQty += pQty;
      cur.freeQty += fQty;
      cur.totalUnits += tUnits;
      cur.discount += disc;
      cur.taxable += taxable;
      cur.tax += tax;
      cur.cost += cost;
      cur.suppliers.add(p.supplier_id);

      prodMap.set(item.product_id, cur);
    }

    const round = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

    const rows: ItemWisePurchaseRow[] = Array.from(prodMap.entries()).map(([id, data]) => {
      const avgRate = data.packQty > 0 ? round(data.taxable / data.packQty) : 0;
      return {
        product_id: id,
        product_name: data.name,
        hsn_code: data.hsn,
        pack_qty: round(data.packQty),
        free_qty: round(data.freeQty),
        total_units: round(data.totalUnits),
        avg_purchase_rate: avgRate,
        discount_amount: round(data.discount),
        taxable_amount: round(data.taxable),
        total_tax: round(data.tax),
        total_cost: round(data.cost),
        supplier_count: data.suppliers.size,
      };
    });

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter(
        (r) =>
          r.product_name.toLowerCase().includes(q) ||
          r.hsn_code.toLowerCase().includes(q)
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

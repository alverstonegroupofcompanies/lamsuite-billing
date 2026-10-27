import { sqliteStorage } from "../../db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../billing/invoiceManagementService";

export interface DateRangeFilter {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export interface TenderBreakdown {
  cash: number;
  upi: number;
  card: number;
  bankTransfer: number;
  credit: number;
  other: number;
  digitalTotal: number;
  digitalPercent: number;
  totalCollected: number;
}

export interface GstSlabSummary {
  rate: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTax: number;
}

export interface FinancialMetricsSummary {
  grossSales: number;
  totalReturns: number;
  netSales: number;
  billsIssuedCount: number;
  returnsCount: number;
  averageTicket: number;
  byTender: TenderBreakdown;
  taxes: {
    totalTaxable: number;
    totalCgst: number;
    totalSgst: number;
    totalIgst: number;
    totalTax: number;
    totalRoundOff: number;
  };
  gstSlabs: GstSlabSummary[];
}

export interface SalesRegisterRow {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  customer_name: string;
  customer_gstin: string;
  place_of_supply: string;
  payment_mode: string;
  taxable_subtotal: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  tax_total: number;
  round_off: number;
  grand_total: number;
  status: string;
  module_key: string;
  created_at: number;
}

export interface CancelledBillRow {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  customer_name: string;
  customer_phone?: string;
  grand_total: number;
  payment_mode: string;
  cancel_reason: string;
  cancelled_at: number;
  user_counter?: string;
}

export interface HsnSummaryRow {
  hsn_code: string;
  description: string;
  uqc: string;
  total_qty: number;
  total_value: number;
  taxable_value: number;
  gst_rate: number;
  integrated_tax: number;
  central_tax: number;
  state_tax: number;
  cess_amount: number;
}

/**
 * Standard rounding to 2 decimal places (Paisa precision)
 */
export function round2(num: number): number {
  return Math.round((Number(num) || 0) * 100) / 100;
}

export class SalesMetricsService {
  /**
   * Helper to normalize payment mode category
   */
  normalizeTender(mode: string | undefined): "cash" | "upi" | "card" | "bankTransfer" | "credit" | "other" {
    if (!mode) return "other";
    const lower = mode.toLowerCase().trim();
    if (lower === "cash") return "cash";
    if (lower === "upi" || lower.includes("gpay") || lower.includes("phonepe") || lower.includes("paytm") || lower.includes("qr")) return "upi";
    if (lower === "card" || lower.includes("visa") || lower.includes("pos") || lower.includes("debit") || lower.includes("credit card")) return "card";
    if (lower.includes("bank") || lower.includes("neft") || lower.includes("rtgs") || lower.includes("imps") || lower.includes("transfer")) return "bankTransfer";
    if (lower === "credit" || lower.includes("udhari") || lower.includes("due") || lower.includes("ledger")) return "credit";
    return "other";
  }

  /**
   * Unified calculation of sales & financial metrics.
   * Guaranteed to tie out to the paisa between Dashboard and Reports.
   */
  async calculateFinancialMetrics(filter: DateRangeFilter): Promise<FinancialMetricsSummary> {
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    // Group items by invoice_id
    const itemsByInvoice = new Map<string, InvoiceItemRecord[]>();
    for (const item of allItems) {
      if (!itemsByInvoice.has(item.invoice_id)) {
        itemsByInvoice.set(item.invoice_id, []);
      }
      itemsByInvoice.get(item.invoice_id)!.push(item);
    }

    // Filter active invoices in range
    const inRangeActive = allInvoices.filter(
      (inv) =>
        inv.status !== "cancelled" &&
        inv.invoice_date >= filter.startDate &&
        inv.invoice_date <= filter.endDate
    );

    let grossSales = 0;
    let totalReturns = 0;
    let billsIssuedCount = 0;
    let returnsCount = 0;

    let cashAmount = 0;
    let upiAmount = 0;
    let cardAmount = 0;
    let bankTransferAmount = 0;
    let creditAmount = 0;
    let otherAmount = 0;

    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalRoundOff = 0;

    // Track GST Slabs: 0, 5, 12, 18, 28
    const slabMap = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
    [0, 5, 12, 18, 28].forEach((r) => slabMap.set(r, { taxable: 0, cgst: 0, sgst: 0, igst: 0 }));

    for (const inv of inRangeActive) {
      const gTotal = Number(inv.grand_total) || 0;
      const isReturn = inv.module_key === "sales_return" || inv.module_key === "credit_note";

      if (isReturn) {
        totalReturns += gTotal;
        returnsCount += 1;
      } else {
        grossSales += gTotal;
        billsIssuedCount += 1;
      }

      totalRoundOff += Number(inv.round_off) || 0;

      // Tender calculation (sales positive, returns negative)
      const tenderCategory = this.normalizeTender(inv.payment_mode);
      const sign = isReturn ? -1 : 1;
      const tenderAmt = gTotal * sign;

      switch (tenderCategory) {
        case "cash": cashAmount += tenderAmt; break;
        case "upi": upiAmount += tenderAmt; break;
        case "card": cardAmount += tenderAmt; break;
        case "bankTransfer": bankTransferAmount += tenderAmt; break;
        case "credit": creditAmount += tenderAmt; break;
        default: otherAmount += tenderAmt; break;
      }

      // Process invoice items for tax breakdown
      const invItems = itemsByInvoice.get(inv.id) || [];
      if (invItems.length > 0) {
        for (const item of invItems) {
          const signItem = isReturn ? -1 : 1;
          const taxable = (item.taxable_amount !== undefined && item.taxable_amount !== null
            ? Number(item.taxable_amount)
            : ((Number(item.total_amount) || 0) - (Number(item.cgst_amount) || 0) - (Number(item.sgst_amount) || 0) - (Number(item.igst_amount) || 0))) * signItem;
          const cgst = (Number(item.cgst_amount) || 0) * signItem;
          const sgst = (Number(item.sgst_amount) || 0) * signItem;
          const igst = (Number(item.igst_amount) || 0) * signItem;
          const rate = Math.round(Number(item.gst_percent) || 0);

          totalTaxable += taxable;
          totalCgst += cgst;
          totalSgst += sgst;
          totalIgst += igst;

          if (!slabMap.has(rate)) {
            slabMap.set(rate, { taxable: 0, cgst: 0, sgst: 0, igst: 0 });
          }
          const entry = slabMap.get(rate)!;
          entry.taxable += taxable;
          entry.cgst += cgst;
          entry.sgst += sgst;
          entry.igst += igst;
        }
      } else {
        // Fallback to invoice header tax
        const signItem = isReturn ? -1 : 1;
        const sub = (Number(inv.taxable_subtotal ?? inv.subtotal) || (gTotal - (Number(inv.tax_total) || 0))) * signItem;
        const cgst = (Number(inv.cgst_total ?? (inv.tax_type === "inter_state" ? 0 : (Number(inv.tax_total) || 0) / 2))) * signItem;
        const sgst = (Number(inv.sgst_total ?? (inv.tax_type === "inter_state" ? 0 : (Number(inv.tax_total) || 0) / 2))) * signItem;
        const igst = (Number(inv.igst_total ?? (inv.tax_type === "inter_state" ? (Number(inv.tax_total) || 0) : 0))) * signItem;
        totalTaxable += sub;
        totalCgst += cgst;
        totalSgst += sgst;
        totalIgst += igst;
      }
    }

    grossSales = round2(grossSales);
    totalReturns = round2(totalReturns);
    const netSales = round2(grossSales - totalReturns);
    const avgTicket = billsIssuedCount > 0 ? round2(grossSales / billsIssuedCount) : 0;

    const digitalTotal = round2(upiAmount + cardAmount + bankTransferAmount);
    const totalCollected = round2(cashAmount + upiAmount + cardAmount + bankTransferAmount + creditAmount + otherAmount);
    const digitalPercent = totalCollected > 0 ? round2((digitalTotal / totalCollected) * 100) : 0;

    const gstSlabs: GstSlabSummary[] = Array.from(slabMap.entries())
      .map(([rate, v]) => ({
        rate,
        taxableValue: round2(v.taxable),
        cgstAmount: round2(v.cgst),
        sgstAmount: round2(v.sgst),
        igstAmount: round2(v.igst),
        totalTax: round2(v.cgst + v.sgst + v.igst),
      }))
      .filter((s) => Math.abs(s.taxableValue) > 0.001 || Math.abs(s.totalTax) > 0.001)
      .sort((a, b) => a.rate - b.rate);

    return {
      grossSales,
      totalReturns,
      netSales,
      billsIssuedCount,
      returnsCount,
      averageTicket: avgTicket,
      byTender: {
        cash: round2(cashAmount),
        upi: round2(upiAmount),
        card: round2(cardAmount),
        bankTransfer: round2(bankTransferAmount),
        credit: round2(creditAmount),
        other: round2(otherAmount),
        digitalTotal,
        digitalPercent,
        totalCollected,
      },
      taxes: {
        totalTaxable: round2(totalTaxable),
        totalCgst: round2(totalCgst),
        totalSgst: round2(totalSgst),
        totalIgst: round2(totalIgst),
        totalTax: round2(totalCgst + totalSgst + totalIgst),
        totalRoundOff: round2(totalRoundOff),
      },
      gstSlabs,
    };
  }

  /**
   * Fetch paginated Sales Register records
   */
  async getSalesRegisterData(params: {
    startDate: string;
    endDate: string;
    paymentMode?: string;
    status?: string;
    searchQuery?: string;
    page?: number;
    pageSize?: number;
    sortColumn?: string;
    sortDirection?: "asc" | "desc";
  }): Promise<{
    rows: SalesRegisterRow[];
    totalCount: number;
    summary: {
      totalTaxable: number;
      totalCgst: number;
      totalSgst: number;
      totalIgst: number;
      totalTax: number;
      totalGrand: number;
      count: number;
    };
  }> {
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    // Group items by invoice_id
    const itemsByInvoice = new Map<string, InvoiceItemRecord[]>();
    for (const item of allItems) {
      if (!itemsByInvoice.has(item.invoice_id)) {
        itemsByInvoice.set(item.invoice_id, []);
      }
      itemsByInvoice.get(item.invoice_id)!.push(item);
    }

    let filtered = allInvoices.filter(
      (inv) =>
        inv.invoice_date >= params.startDate &&
        inv.invoice_date <= params.endDate &&
        inv.module_key === "invoice"
    );

    if (params.status && params.status !== "all") {
      filtered = filtered.filter((inv) => inv.status === params.status);
    } else {
      // Default: exclude cancelled unless explicitly requested
      filtered = filtered.filter((inv) => inv.status !== "cancelled");
    }

    if (params.paymentMode && params.paymentMode !== "all") {
      const target = params.paymentMode.toLowerCase();
      filtered = filtered.filter((inv) => inv.payment_mode?.toLowerCase() === target);
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (inv) =>
          inv.invoice_number?.toLowerCase().includes(q) ||
          inv.customer_name?.toLowerCase().includes(q) ||
          inv.customer_gstin?.toLowerCase().includes(q)
      );
    }

    // Map to SalesRegisterRow
    const rows: SalesRegisterRow[] = filtered.map((inv) => {
      const invItems = itemsByInvoice.get(inv.id) || [];
      let taxable = 0;
      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      if (invItems.length > 0) {
        for (const item of invItems) {
          taxable += item.taxable_amount !== undefined && item.taxable_amount !== null
            ? Number(item.taxable_amount)
            : ((Number(item.total_amount) || 0) - (Number(item.cgst_amount) || 0) - (Number(item.sgst_amount) || 0) - (Number(item.igst_amount) || 0));
          cgst += Number(item.cgst_amount) || 0;
          sgst += Number(item.sgst_amount) || 0;
          igst += Number(item.igst_amount) || 0;
        }
      } else {
        taxable = Number(inv.taxable_subtotal ?? inv.subtotal) || 0;
        cgst = Number(inv.cgst_total ?? (inv.tax_type === "inter_state" ? 0 : (Number(inv.tax_total) || 0) / 2));
        sgst = Number(inv.sgst_total ?? (inv.tax_type === "inter_state" ? 0 : (Number(inv.tax_total) || 0) / 2));
        igst = Number(inv.igst_total ?? (inv.tax_type === "inter_state" ? (Number(inv.tax_total) || 0) : 0));
      }

      return {
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        customer_name: inv.customer_name || "Counter Customer",
        customer_gstin: inv.customer_gstin || "-",
        place_of_supply: inv.place_of_supply || "32-Kerala",
        payment_mode: inv.payment_mode || "Cash",
        taxable_subtotal: round2(taxable),
        cgst_amount: round2(cgst),
        sgst_amount: round2(sgst),
        igst_amount: round2(igst),
        tax_total: round2(cgst + sgst + igst),
        round_off: round2(Number(inv.round_off) || 0),
        grand_total: round2(Number(inv.grand_total) || 0),
        status: inv.status || "issued",
        module_key: inv.module_key || "invoice",
        created_at: Number(inv.created_at) || 0,
      };
    });

    // Compute grand totals across all matching rows
    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalTax = 0;
    let totalGrand = 0;

    for (const r of rows) {
      totalTaxable += r.taxable_subtotal;
      totalCgst += r.cgst_amount;
      totalSgst += r.sgst_amount;
      totalIgst += r.igst_amount;
      totalTax += r.tax_total;
      totalGrand += r.grand_total;
    }

    // Sorting
    const sortCol = params.sortColumn || "invoice_date";
    const sortDir = params.sortDirection || "desc";
    rows.sort((a: any, b: any) => {
      let va = a[sortCol];
      let vb = b[sortCol];
      if (typeof va === "string") {
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      va = Number(va) || 0;
      vb = Number(vb) || 0;
      return sortDir === "asc" ? va - vb : vb - va;
    });

    // Pagination
    const totalCount = rows.length;
    let paginatedRows = rows;
    if (params.page && params.pageSize) {
      const start = (params.page - 1) * params.pageSize;
      paginatedRows = rows.slice(start, start + params.pageSize);
    }

    return {
      rows: paginatedRows,
      totalCount,
      summary: {
        totalTaxable: round2(totalTaxable),
        totalCgst: round2(totalCgst),
        totalSgst: round2(totalSgst),
        totalIgst: round2(totalIgst),
        totalTax: round2(totalTax),
        totalGrand: round2(totalGrand),
        count: totalCount,
      },
    };
  }

  /**
   * Fetch Cancelled Bills report data
   */
  async getCancelledBillsData(params: {
    startDate: string;
    endDate: string;
    searchQuery?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    rows: CancelledBillRow[];
    totalCount: number;
    summary: { totalAmount: number; count: number };
  }> {
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");

    let filtered = allInvoices.filter(
      (inv) =>
        inv.invoice_date >= params.startDate &&
        inv.invoice_date <= params.endDate &&
        inv.status === "cancelled"
    );

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (inv) =>
          inv.invoice_number?.toLowerCase().includes(q) ||
          inv.customer_name?.toLowerCase().includes(q)
      );
    }

    const rows: CancelledBillRow[] = filtered.map((inv: any) => ({
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      customer_name: inv.customer_name || "Counter Customer",
      customer_phone: inv.customer_phone || "-",
      grand_total: round2(Number(inv.grand_total) || 0),
      payment_mode: inv.payment_mode || "Cash",
      cancel_reason: inv.cancel_reason || "Customer cancelled order",
      cancelled_at: inv.cancelled_at || inv.updated_at || inv.created_at,
      user_counter: inv.user_counter || "Main Counter",
    }));

    rows.sort((a, b) => b.cancelled_at - a.cancelled_at);

    const totalCount = rows.length;
    const totalAmount = round2(rows.reduce((sum, r) => sum + r.grand_total, 0));

    let paginated = rows;
    if (params.page && params.pageSize) {
      const start = (params.page - 1) * params.pageSize;
      paginated = rows.slice(start, start + params.pageSize);
    }

    return {
      rows: paginated,
      totalCount,
      summary: { totalAmount, count: totalCount },
    };
  }

  /**
   * Fetch HSN Summary data
   */
  async getHsnSummaryData(params: {
    startDate: string;
    endDate: string;
  }): Promise<HsnSummaryRow[]> {
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    const validInvoicesMap = new Map<string, InvoiceRecord>();
    for (const inv of allInvoices) {
      if (
        inv.status !== "cancelled" &&
        inv.invoice_date >= params.startDate &&
        inv.invoice_date <= params.endDate
      ) {
        validInvoicesMap.set(inv.id, inv);
      }
    }

    const filteredItems = allItems.filter((it) => validInvoicesMap.has(it.invoice_id));

    // Group items by (hsn_code, gst_percent)
    const map = new Map<string, HsnSummaryRow>();

    for (const item of filteredItems) {
      const inv = validInvoicesMap.get(item.invoice_id)!;
      const isReturn = inv.module_key === "sales_return" || inv.module_key === "credit_note";
      const sign = isReturn ? -1 : 1;

      const hsn = item.hsn_code ? item.hsn_code.trim() : "30049099";
      const rate = Math.round(Number(item.gst_percent) || 0);
      const key = `${hsn}_${rate}`;

      const totalVal = (Number(item.total_amount) || 0) * sign;
      const cgst = (Number(item.cgst_amount) || 0) * sign;
      const sgst = (Number(item.sgst_amount) || 0) * sign;
      const igst = (Number(item.igst_amount) || 0) * sign;
      const cess = (Number((item as any).cess_amount) || 0) * sign;
      const taxable = (item.taxable_amount !== undefined && item.taxable_amount !== null
        ? Number(item.taxable_amount) * sign
        : totalVal - cgst - sgst - igst - cess);
      const qty = ((Number(item.qty) || 0) + (Number(item.loose_qty) || 0)) * sign;

      if (!map.has(key)) {
        map.set(key, {
          hsn_code: hsn,
          description: item.product_name || "Medicines / Retail Items",
          uqc: "NOS",
          total_qty: 0,
          total_value: 0,
          taxable_value: 0,
          gst_rate: rate,
          integrated_tax: 0,
          central_tax: 0,
          state_tax: 0,
          cess_amount: 0,
        });
      }

      const rec = map.get(key)!;
      rec.total_qty += qty;
      rec.total_value += totalVal;
      rec.taxable_value += taxable;
      rec.central_tax += cgst;
      rec.state_tax += sgst;
      rec.integrated_tax += igst;
    }

    const result = Array.from(map.values()).map((r) => ({
      ...r,
      total_qty: round2(r.total_qty),
      total_value: round2(r.total_value),
      taxable_value: round2(r.taxable_value),
      central_tax: round2(r.central_tax),
      state_tax: round2(r.state_tax),
      integrated_tax: round2(r.integrated_tax),
    }));

    result.sort((a, b) => a.hsn_code.localeCompare(b.hsn_code) || a.gst_rate - b.gst_rate);
    return result;
  }
}

export const salesMetricsService = new SalesMetricsService();

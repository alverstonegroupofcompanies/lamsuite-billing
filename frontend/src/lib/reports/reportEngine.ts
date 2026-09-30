import { sqliteStorage } from "../db/sqliteStorage";
import { inventoryService } from "../stock/inventoryService";
import type { ProductBatch, ProductItem } from "../masters/productsStore";

export interface InvoiceRecord {
  id: string;
  module_key: string; // 'invoice' | 'credit_note' | 'sales_return'
  invoice_number: string;
  invoice_date: string; // YYYY-MM-DD
  due_date?: string;
  customer_id?: string;
  customer_name?: string;
  customer_gstin?: string;
  place_of_supply?: string; // State code or name, e.g. "32" or "32-Kerala"
  subtotal: number;
  discount_total: number;
  tax_total: number;
  round_off: number;
  grand_total: number;
  paid_amount: number;
  payment_mode: string; // 'Cash' | 'UPI' | 'Card' | 'Credit' | 'Bank Transfer' | 'Cheque'
  status: string; // 'issued' | 'cancelled'
  original_invoice_number?: string;
  created_at: number;
}

export interface InvoiceItemRecord {
  id: string;
  invoice_id: string;
  product_id: string;
  product_name: string;
  hsn_code?: string;
  batch_no?: string;
  expiry_date?: string;
  qty: number;
  loose_qty?: number;
  units_per_pack?: number;
  unit_price: number;
  mrp?: number;
  discount_percent?: number;
  discount_amount?: number;
  gst_percent: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;
}

export interface SalesRegisterEntry {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  customer_name: string;
  customer_gstin: string;
  payment_mode: string;
  taxable_subtotal: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  tax_total: number;
  round_off: number;
  grand_total: number;
  status: string;
}

export interface DailyCollectionSummary {
  date_range: { start_date: string; end_date: string };
  total_invoices_count: number;
  gross_sales: number;
  total_returns: number;
  net_sales: number;
  by_tender: {
    cash: number;
    upi: number;
    card: number;
    credit: number;
    other: number;
  };
  total_taxable: number;
  total_cgst: number;
  total_sgst: number;
  total_igst: number;
  total_round_off: number;
}

export interface Gstr1B2BEntry {
  gstin: string;
  customer_name: string;
  invoice_number: string;
  invoice_date: string;
  invoice_value: number;
  place_of_supply: string;
  reverse_charge: "N" | "Y";
  taxable_value: number;
  integrated_tax: number;
  central_tax: number;
  state_tax: number;
  cess_amount: number;
}

export interface Gstr1B2CLargeEntry {
  invoice_number: string;
  invoice_date: string;
  invoice_value: number;
  place_of_supply: string;
  taxable_value: number;
  rate: number;
  integrated_tax: number;
  cess_amount: number;
}

export interface Gstr1B2CSmallEntry {
  place_of_supply: string;
  rate: number;
  taxable_value: number;
  integrated_tax: number;
  central_tax: number;
  state_tax: number;
  cess_amount: number;
}

export interface Gstr1CreditDebitNoteEntry {
  gstin?: string;
  customer_name: string;
  note_number: string;
  note_date: string;
  original_invoice_number: string;
  note_type: "C" | "D"; // Credit or Debit
  note_value: number;
  taxable_value: number;
  integrated_tax: number;
  central_tax: number;
  state_tax: number;
}

export interface Gstr1SummaryReport {
  tax_period: { start_date: string; end_date: string };
  store_state_code: string;
  table_4_b2b: Gstr1B2BEntry[];
  table_5_b2c_large: Gstr1B2CLargeEntry[];
  table_7_b2c_small: Gstr1B2CSmallEntry[];
  table_9_credit_debit_notes: Gstr1CreditDebitNoteEntry[];
  totals: {
    total_taxable: number;
    total_igst: number;
    total_cgst: number;
    total_sgst: number;
    total_invoice_value: number;
  };
}

export interface HsnSummaryEntry {
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

export interface CustomerOutstandingEntry {
  customer_id: string;
  customer_name: string;
  phone?: string;
  total_outstanding: number;
  aging: {
    days_0_to_30: number;
    days_31_to_60: number;
    days_61_plus: number;
  };
  invoice_count: number;
  last_invoice_date: string;
}

export class ReportEngine {
  private defaultStoreStateCode = "32"; // Default Kerala state code

  setDefaultStoreStateCode(code: string) {
    this.defaultStoreStateCode = code.padStart(2, "0");
  }

  getDefaultStoreStateCode(): string {
    return this.defaultStoreStateCode;
  }

  // --- REP-001: Sales Register & Daily Collection Summary ---

  async getSalesRegister(startDate: string, endDate: string): Promise<SalesRegisterEntry[]> {
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const items = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    // Group items by invoice_id to calculate taxes
    const itemsByInvoice = new Map<string, InvoiceItemRecord[]>();
    for (const item of items) {
      if (!itemsByInvoice.has(item.invoice_id)) {
        itemsByInvoice.set(item.invoice_id, []);
      }
      itemsByInvoice.get(item.invoice_id)!.push(item);
    }

    const filtered = allInvoices.filter(
      (inv) => inv.invoice_date >= startDate && inv.invoice_date <= endDate && inv.module_key === "invoice"
    );

    return filtered.map((inv) => {
      const lineItems = itemsByInvoice.get(inv.id) || [];
      const cgst = Math.round(lineItems.reduce((sum, item) => sum + (item.cgst_amount || 0), 0) * 100) / 100;
      const sgst = Math.round(lineItems.reduce((sum, item) => sum + (item.sgst_amount || 0), 0) * 100) / 100;
      const igst = Math.round(lineItems.reduce((sum, item) => sum + (item.igst_amount || 0), 0) * 100) / 100;

      return {
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        customer_name: inv.customer_name || "Walk-in Customer",
        customer_gstin: inv.customer_gstin || "",
        payment_mode: inv.payment_mode || "Cash",
        taxable_subtotal: inv.subtotal,
        cgst_amount: cgst,
        sgst_amount: sgst,
        igst_amount: igst,
        tax_total: inv.tax_total,
        round_off: inv.round_off,
        grand_total: inv.grand_total,
        status: inv.status,
      };
    });
  }

  async getDailyCollectionSummary(startDate: string, endDate: string): Promise<DailyCollectionSummary> {
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const filtered = allInvoices.filter(
      (inv) => inv.invoice_date >= startDate && inv.invoice_date <= endDate && inv.status !== "cancelled"
    );

    const summary: DailyCollectionSummary = {
      date_range: { start_date: startDate, end_date: endDate },
      total_invoices_count: 0,
      gross_sales: 0,
      total_returns: 0,
      net_sales: 0,
      by_tender: {
        cash: 0,
        upi: 0,
        card: 0,
        credit: 0,
        other: 0,
      },
      total_taxable: 0,
      total_cgst: 0,
      total_sgst: 0,
      total_igst: 0,
      total_round_off: 0,
    };

    const items = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");
    const itemsMap = new Map<string, InvoiceItemRecord[]>();
    for (const item of items) {
      if (!itemsMap.has(item.invoice_id)) itemsMap.set(item.invoice_id, []);
      itemsMap.get(item.invoice_id)!.push(item);
    }

    for (const inv of filtered) {
      const isReturn = inv.module_key === "credit_note" || inv.module_key === "sales_return";
      const sign = isReturn ? -1 : 1;

      if (!isReturn) {
        summary.total_invoices_count += 1;
        summary.gross_sales = Math.round((summary.gross_sales + inv.grand_total) * 100) / 100;
      } else {
        summary.total_returns = Math.round((summary.total_returns + inv.grand_total) * 100) / 100;
      }

      summary.total_taxable = Math.round((summary.total_taxable + sign * inv.subtotal) * 100) / 100;
      summary.total_round_off = Math.round((summary.total_round_off + sign * inv.round_off) * 100) / 100;

      // Tender breakdown
      const mode = (inv.payment_mode || "Cash").toLowerCase();
      const amount = isReturn ? -inv.grand_total : inv.grand_total;

      if (mode === "cash") summary.by_tender.cash = Math.round((summary.by_tender.cash + amount) * 100) / 100;
      else if (mode === "upi") summary.by_tender.upi = Math.round((summary.by_tender.upi + amount) * 100) / 100;
      else if (mode === "card") summary.by_tender.card = Math.round((summary.by_tender.card + amount) * 100) / 100;
      else if (mode === "credit") summary.by_tender.credit = Math.round((summary.by_tender.credit + amount) * 100) / 100;
      else summary.by_tender.other = Math.round((summary.by_tender.other + amount) * 100) / 100;

      // Tax components
      const invItems = itemsMap.get(inv.id) || [];
      for (const item of invItems) {
        summary.total_cgst = Math.round((summary.total_cgst + sign * (item.cgst_amount || 0)) * 100) / 100;
        summary.total_sgst = Math.round((summary.total_sgst + sign * (item.sgst_amount || 0)) * 100) / 100;
        summary.total_igst = Math.round((summary.total_igst + sign * (item.igst_amount || 0)) * 100) / 100;
      }
    }

    summary.net_sales = Math.round((summary.gross_sales - summary.total_returns) * 100) / 100;
    return summary;
  }

  // --- REP-002: GSTR-1 Compliance Summary ---

  async getGstr1Summary(
    startDate: string,
    endDate: string,
    customStoreStateCode?: string
  ): Promise<Gstr1SummaryReport> {
    const storeState = (customStoreStateCode || this.defaultStoreStateCode).padStart(2, "0");
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    const itemsByInvoice = new Map<string, InvoiceItemRecord[]>();
    for (const item of allItems) {
      if (!itemsByInvoice.has(item.invoice_id)) itemsByInvoice.set(item.invoice_id, []);
      itemsByInvoice.get(item.invoice_id)!.push(item);
    }

    const filtered = allInvoices.filter(
      (inv) => inv.invoice_date >= startDate && inv.invoice_date <= endDate && inv.status !== "cancelled"
    );

    const report: Gstr1SummaryReport = {
      tax_period: { start_date: startDate, end_date: endDate },
      store_state_code: storeState,
      table_4_b2b: [],
      table_5_b2c_large: [],
      table_7_b2c_small: [],
      table_9_credit_debit_notes: [],
      totals: {
        total_taxable: 0,
        total_igst: 0,
        total_cgst: 0,
        total_sgst: 0,
        total_invoice_value: 0,
      },
    };

    // Helper to extract 2-digit state code from GSTIN or place_of_supply
    const extractStateCode = (gstin?: string, placeOfSupply?: string): string => {
      if (gstin && gstin.trim().length >= 2 && /^\d{2}/.test(gstin.trim())) {
        return gstin.trim().slice(0, 2);
      }
      if (placeOfSupply) {
        const match = placeOfSupply.trim().match(/^(\d{2})/);
        if (match) return match[1];
      }
      return storeState; // fallback to intra-state
    };

    // Temporary map for Table 7 grouping: "stateCode_rate" -> aggregated
    const b2cSmallMap = new Map<string, Gstr1B2CSmallEntry>();

    for (const inv of filtered) {
      const invItems = itemsByInvoice.get(inv.id) || [];
      const hasGstin = Boolean(inv.customer_gstin && inv.customer_gstin.trim().length === 15);
      const isReturn = inv.module_key === "credit_note" || inv.module_key === "sales_return";
      const targetState = extractStateCode(inv.customer_gstin, inv.place_of_supply);
      const isInterState = targetState !== storeState;

      const cgstTotal = Math.round(invItems.reduce((s, i) => s + (i.cgst_amount || 0), 0) * 100) / 100;
      const sgstTotal = Math.round(invItems.reduce((s, i) => s + (i.sgst_amount || 0), 0) * 100) / 100;
      const igstTotal = Math.round(invItems.reduce((s, i) => s + (i.igst_amount || 0), 0) * 100) / 100;

      if (isReturn) {
        // Table 9: Credit/Debit Notes
        report.table_9_credit_debit_notes.push({
          gstin: hasGstin ? inv.customer_gstin : undefined,
          customer_name: inv.customer_name || "Customer",
          note_number: inv.invoice_number,
          note_date: inv.invoice_date,
          original_invoice_number: inv.original_invoice_number || "N/A",
          note_type: "C",
          note_value: inv.grand_total,
          taxable_value: inv.subtotal,
          integrated_tax: igstTotal,
          central_tax: cgstTotal,
          state_tax: sgstTotal,
        });
        continue;
      }

      // Track positive sales totals
      report.totals.total_taxable = Math.round((report.totals.total_taxable + inv.subtotal) * 100) / 100;
      report.totals.total_cgst = Math.round((report.totals.total_cgst + cgstTotal) * 100) / 100;
      report.totals.total_sgst = Math.round((report.totals.total_sgst + sgstTotal) * 100) / 100;
      report.totals.total_igst = Math.round((report.totals.total_igst + igstTotal) * 100) / 100;
      report.totals.total_invoice_value =
        Math.round((report.totals.total_invoice_value + inv.grand_total) * 100) / 100;

      if (hasGstin) {
        // Table 4: B2B Invoices
        report.table_4_b2b.push({
          gstin: inv.customer_gstin!,
          customer_name: inv.customer_name || "B2B Customer",
          invoice_number: inv.invoice_number,
          invoice_date: inv.invoice_date,
          invoice_value: inv.grand_total,
          place_of_supply: targetState,
          reverse_charge: "N",
          taxable_value: inv.subtotal,
          integrated_tax: igstTotal,
          central_tax: cgstTotal,
          state_tax: sgstTotal,
          cess_amount: 0,
        });
      } else if (isInterState && inv.grand_total > 250000) {
        // Table 5: B2C Large (> ₹2.5 Lakhs inter-state unregistered)
        for (const item of invItems) {
          const itemTaxable = Math.round((item.total_amount - (item.igst_amount || 0)) * 100) / 100;
          report.table_5_b2c_large.push({
            invoice_number: inv.invoice_number,
            invoice_date: inv.invoice_date,
            invoice_value: inv.grand_total,
            place_of_supply: targetState,
            taxable_value: itemTaxable,
            rate: item.gst_percent,
            integrated_tax: item.igst_amount || 0,
            cess_amount: 0,
          });
        }
      } else {
        // Table 7: B2C Small (intra-state or inter-state <= ₹2.5 Lakhs)
        for (const item of invItems) {
          const key = `${targetState}_${item.gst_percent}`;
          const itemTaxable = Math.round((item.total_amount - (item.cgst_amount + item.sgst_amount + item.igst_amount)) * 100) / 100;

          if (!b2cSmallMap.has(key)) {
            b2cSmallMap.set(key, {
              place_of_supply: targetState,
              rate: item.gst_percent,
              taxable_value: 0,
              integrated_tax: 0,
              central_tax: 0,
              state_tax: 0,
              cess_amount: 0,
            });
          }

          const entry = b2cSmallMap.get(key)!;
          entry.taxable_value = Math.round((entry.taxable_value + itemTaxable) * 100) / 100;
          entry.central_tax = Math.round((entry.central_tax + (item.cgst_amount || 0)) * 100) / 100;
          entry.state_tax = Math.round((entry.state_tax + (item.sgst_amount || 0)) * 100) / 100;
          entry.integrated_tax = Math.round((entry.integrated_tax + (item.igst_amount || 0)) * 100) / 100;
        }
      }
    }

    report.table_7_b2c_small = Array.from(b2cSmallMap.values()).sort(
      (a, b) => a.place_of_supply.localeCompare(b.place_of_supply) || a.rate - b.rate
    );

    return report;
  }

  // --- REP-003: HSN / SAC Summary ---

  async getHsnSummary(startDate: string, endDate: string): Promise<HsnSummaryEntry[]> {
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    const validInvoiceIds = new Set(
      allInvoices
        .filter(
          (inv) =>
            inv.invoice_date >= startDate &&
            inv.invoice_date <= endDate &&
            inv.status !== "cancelled" &&
            inv.module_key === "invoice"
        )
        .map((inv) => inv.id)
    );

    // Group by `[hsn_code, gst_percent]`
    const summaryMap = new Map<string, HsnSummaryEntry>();

    for (const item of allItems) {
      if (!validInvoiceIds.has(item.invoice_id)) continue;

      const hsn = (item.hsn_code || "OTHER").trim();
      const rate = item.gst_percent || 0;
      const key = `${hsn}_${rate}`;

      const totalTax = Math.round(((item.cgst_amount || 0) + (item.sgst_amount || 0) + (item.igst_amount || 0)) * 100) / 100;
      const taxable = Math.round((item.total_amount - totalTax) * 100) / 100;
      const totalUnits = (item.qty || 0) + (item.loose_qty ? item.loose_qty / (item.units_per_pack || 1) : 0);

      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          hsn_code: hsn,
          description: item.product_name,
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

      const entry = summaryMap.get(key)!;
      entry.total_qty = Math.round((entry.total_qty + totalUnits) * 100) / 100;
      entry.taxable_value = Math.round((entry.taxable_value + taxable) * 100) / 100;
      entry.total_value = Math.round((entry.total_value + item.total_amount) * 100) / 100;
      entry.central_tax = Math.round((entry.central_tax + (item.cgst_amount || 0)) * 100) / 100;
      entry.state_tax = Math.round((entry.state_tax + (item.sgst_amount || 0)) * 100) / 100;
      entry.integrated_tax = Math.round((entry.integrated_tax + (item.igst_amount || 0)) * 100) / 100;
    }

    return Array.from(summaryMap.values()).sort(
      (a, b) => a.hsn_code.localeCompare(b.hsn_code) || a.gst_rate - b.gst_rate
    );
  }

  // --- REP-004: Inventory Health & Expiry Reports ---

  async getNearExpiryBatches(thresholdDays = 60, refDate = new Date()): Promise<ProductBatch[]> {
    return inventoryService.getBatchesNearExpiry(thresholdDays, refDate);
  }

  async getLowStockAlerts(): Promise<ProductItem[]> {
    return inventoryService.getLowStockProducts();
  }

  // --- REP-005: Customer Outstanding & Aging Ledger ---

  async getCustomerOutstandingLedger(asOfDate = new Date()): Promise<CustomerOutstandingEntry[]> {
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const activeInvoices = allInvoices.filter(
      (inv) =>
        inv.module_key === "invoice" &&
        inv.status !== "cancelled" &&
        (inv.payment_mode.toLowerCase() === "credit" || inv.paid_amount < inv.grand_total)
    );

    const asOfMs = asOfDate.getTime();
    const customerMap = new Map<string, CustomerOutstandingEntry>();

    for (const inv of activeInvoices) {
      const custId = inv.customer_id || "walk_in";
      const custName = inv.customer_name || "Walk-in Customer";
      const balance = Math.round((inv.grand_total - (inv.paid_amount || 0)) * 100) / 100;

      if (balance <= 0) continue;

      const invDateMs = new Date(inv.invoice_date).getTime();
      const ageDays = Math.max(0, Math.floor((asOfMs - invDateMs) / (1000 * 60 * 60 * 24)));

      if (!customerMap.has(custId)) {
        customerMap.set(custId, {
          customer_id: custId,
          customer_name: custName,
          total_outstanding: 0,
          aging: {
            days_0_to_30: 0,
            days_31_to_60: 0,
            days_61_plus: 0,
          },
          invoice_count: 0,
          last_invoice_date: inv.invoice_date,
        });
      }

      const entry = customerMap.get(custId)!;
      entry.total_outstanding = Math.round((entry.total_outstanding + balance) * 100) / 100;
      entry.invoice_count += 1;
      if (inv.invoice_date > entry.last_invoice_date) {
        entry.last_invoice_date = inv.invoice_date;
      }

      if (ageDays <= 30) {
        entry.aging.days_0_to_30 = Math.round((entry.aging.days_0_to_30 + balance) * 100) / 100;
      } else if (ageDays <= 60) {
        entry.aging.days_31_to_60 = Math.round((entry.aging.days_31_to_60 + balance) * 100) / 100;
      } else {
        entry.aging.days_61_plus = Math.round((entry.aging.days_61_plus + balance) * 100) / 100;
      }
    }

    return Array.from(customerMap.values()).sort((a, b) => b.total_outstanding - a.total_outstanding);
  }

  // --- REP-006: High-Speed Local Export (CSV Builder) ---

  exportToCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
    const escapeCell = (val: string | number | boolean | null | undefined): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return `"${str}"`;
    };

    const headerLine = headers.map(escapeCell).join(",");
    const bodyLines = rows.map((row) => row.map(escapeCell).join(","));

    return [headerLine, ...bodyLines].join("\r\n");
  }
}

export const reportEngine = new ReportEngine();

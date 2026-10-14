import { sqliteStorage } from "../db/sqliteStorage";
import { companySettingsService } from "../settings/companySettingsService";
import { billingTenderService } from "../billing/billingTenderService";
import { salesMetricsService } from "../data-layer/financials/salesMetrics";
import type { InvoiceRecord, InvoiceItemRecord } from "../billing/invoiceManagementService";
import type { ProductBatch } from "../masters/productsStore";
import type { SyncQueueItem } from "../sync/syncQueueService";

export interface GstSlabBreakdown {
  rate: number; // 0, 5, 12, 18, 28
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTax: number;
}

export interface RecentDocumentItem {
  id: string;
  documentNumber: string;
  documentType: "invoice" | "sales_return" | "credit_note";
  date: string;
  time: string;
  customerName: string;
  amount: number; // positive for sale, negative for return
  paymentMode: string;
  paymentStatus: "paid" | "partial" | "unpaid" | "cancelled";
  rawRecord: InvoiceRecord;
}

export interface DashboardMetricsResult {
  period: {
    type: "today" | "yesterday" | "this_week" | "this_month" | "custom";
    startDate: string;
    endDate: string;
    label: string;
  };
  netSales: number;
  grossSales: number;
  totalReturns: number;
  previousPeriodSales: number;
  salesDeltaPercent: number | null; // null if no previous period data
  billsIssuedCount: number;
  averageTicket: number;
  payments: {
    cash: number;
    upi: number;
    card: number;
    bankTransfer: number;
    credit: number;
    other: number;
    digitalTotal: number;
    digitalPercent: number;
  };
  nearExpiry: {
    thresholdDays: number;
    count: number;
  };
  gst: {
    slabs: GstSlabBreakdown[];
    totalTaxable: number;
    totalCgst: number;
    totalSgst: number;
    totalIgst: number;
    totalTaxAccrued: number;
  };
  recentDocuments: RecentDocumentItem[];
  heldBillsCount: number;
  syncStatus: {
    isOnline: boolean;
    pendingCount: number;
    lastSyncedText: string;
  };
}

export class DashboardMetricsService {
  /**
   * Helper to format a Date as YYYY-MM-DD in local time
   */
  formatLocalDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Get start and end dates based on period type
   */
  getDateRange(periodType: "today" | "yesterday" | "this_week" | "this_month" | "custom", customStart?: string, customEnd?: string) {
    const now = new Date();
    const todayStr = this.formatLocalDate(now);

    if (periodType === "yesterday") {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = this.formatLocalDate(yesterday);
      return {
        startDate: yesterdayStr,
        endDate: yesterdayStr,
        prevStartDate: this.formatLocalDate(new Date(yesterday.getTime() - 86400000)),
        prevEndDate: this.formatLocalDate(new Date(yesterday.getTime() - 86400000)),
        label: "Yesterday",
      };
    }

    if (periodType === "this_week") {
      const dayOfWeek = now.getDay(); // 0 is Sunday, 1 is Monday
      const distanceToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const startOfWeek = new Date(now);
      startOfWeek.setDate(startOfWeek.getDate() - distanceToMonday);
      const startOfWeekStr = this.formatLocalDate(startOfWeek);

      const prevWeekEnd = new Date(startOfWeek);
      prevWeekEnd.setDate(prevWeekEnd.getDate() - 1);
      const prevWeekStart = new Date(prevWeekEnd);
      prevWeekStart.setDate(prevWeekStart.getDate() - 6);

      return {
        startDate: startOfWeekStr,
        endDate: todayStr,
        prevStartDate: this.formatLocalDate(prevWeekStart),
        prevEndDate: this.formatLocalDate(prevWeekEnd),
        label: "This Week",
      };
    }

    if (periodType === "this_month") {
      const startOfMonthStr = `${todayStr.slice(0, 7)}-01`;
      const prevMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      const prevMonthStart = `${this.formatLocalDate(prevMonthLastDay).slice(0, 7)}-01`;
      const prevMonthEnd = this.formatLocalDate(prevMonthLastDay);

      return {
        startDate: startOfMonthStr,
        endDate: todayStr,
        prevStartDate: prevMonthStart,
        prevEndDate: prevMonthEnd,
        label: "This Month",
      };
    }

    if (periodType === "custom" && customStart && customEnd) {
      return {
        startDate: customStart,
        endDate: customEnd,
        prevStartDate: "",
        prevEndDate: "",
        label: `${customStart} to ${customEnd}`,
      };
    }

    // Default "today"
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = this.formatLocalDate(yesterday);

    return {
      startDate: todayStr,
      endDate: todayStr,
      prevStartDate: yesterdayStr,
      prevEndDate: yesterdayStr,
      label: "Today",
    };
  }

  /**
   * Compute comprehensive dashboard metrics directly from SQLite database
   */
  async getDashboardMetrics(
    periodType: "today" | "yesterday" | "this_week" | "this_month" | "custom" = "today",
    customStart?: string,
    customEnd?: string
  ): Promise<DashboardMetricsResult> {
    const range = this.getDateRange(periodType, customStart, customEnd);
    const settings = await companySettingsService.loadSettings();
    const nearExpiryThresholdDays = 60; // Standard FEFO alert window

    // 1. Fetch Invoices & Invoice Items from SQLite
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    // Build items map by invoice ID
    const itemsByInvoice = new Map<string, InvoiceItemRecord[]>();
    for (const item of allItems) {
      if (!itemsByInvoice.has(item.invoice_id)) {
        itemsByInvoice.set(item.invoice_id, []);
      }
      itemsByInvoice.get(item.invoice_id)!.push(item);
    }

    // Filter current period active invoices
    const currentInvoices = allInvoices.filter(
      (inv) =>
        inv.status !== "cancelled" &&
        inv.invoice_date >= range.startDate &&
        inv.invoice_date <= range.endDate
    );

    // Filter previous period active invoices for accurate comparison
    const previousInvoices = range.prevStartDate
      ? allInvoices.filter(
          (inv) =>
            inv.status !== "cancelled" &&
            inv.invoice_date >= range.prevStartDate &&
            inv.invoice_date <= range.prevEndDate
        )
      : [];

    // 2. Calculate Gross Sales, Returns, Net Sales & Bills count via unified data layer
    const metrics = await salesMetricsService.calculateFinancialMetrics({
      startDate: range.startDate,
      endDate: range.endDate,
    });

    const grossSales = metrics.grossSales;
    const totalReturns = metrics.totalReturns;
    const netSales = metrics.netSales;
    const billsIssuedCount = metrics.billsIssuedCount;
    const averageTicket = metrics.averageTicket;

    const cashAmount = metrics.byTender.cash;
    const upiAmount = metrics.byTender.upi;
    const cardAmount = metrics.byTender.card;
    const bankTransferAmount = metrics.byTender.bankTransfer;
    const creditAmount = metrics.byTender.credit;
    const otherAmount = metrics.byTender.other;

    // Previous period sales for delta calculation
    let previousPeriodSales = 0;
    if (range.prevStartDate) {
      const prevMetrics = await salesMetricsService.calculateFinancialMetrics({
        startDate: range.prevStartDate,
        endDate: range.prevEndDate,
      });
      previousPeriodSales = prevMetrics.netSales;
    }

    let salesDeltaPercent: number | null = null;
    if (previousPeriodSales > 0) {
      salesDeltaPercent = Math.round(((netSales - previousPeriodSales) / previousPeriodSales) * 100);
    }

    // Digital percentage calculation
    const digitalTotal = metrics.byTender.digitalTotal;
    const digitalPercent = metrics.byTender.digitalPercent;

    // 3. Batches near expiry
    const allBatches = await sqliteStorage.findAll<ProductBatch>("product_batches");
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + nearExpiryThresholdDays);
    const thresholdDateStr = this.formatLocalDate(thresholdDate);

    const nearExpiryCount = allBatches.filter(
      (b) =>
        b.expiry_date &&
        b.expiry_date <= thresholdDateStr &&
        (Number(b.stock_qty) || 0) > 0
    ).length;

    // 4. GST Slabs from unified metrics
    const slabs: GstSlabBreakdown[] = metrics.gstSlabs.map((s) => ({
      rate: s.rate,
      taxableValue: s.taxableValue,
      cgstAmount: s.cgstAmount,
      sgstAmount: s.sgstAmount,
      igstAmount: s.igstAmount,
      totalTax: s.totalTax,
    }));

    const totalTaxAccrued = metrics.taxes.totalTax;

    // 5. Recent completed invoices list
    const sortedAll = [...allInvoices].sort((a, b) => {
      const timeA = a.created_at || new Date(a.invoice_date).getTime();
      const timeB = b.created_at || new Date(b.invoice_date).getTime();
      return timeB - timeA;
    });

    const recentDocuments: RecentDocumentItem[] = sortedAll.slice(0, 15).map((inv) => {
      const isReturn =
        inv.module_key === "credit_note" ||
        inv.module_key === "sales_return" ||
        (inv.invoice_number && (inv.invoice_number.startsWith("SR-") || inv.invoice_number.startsWith("CN-") || inv.invoice_number.startsWith("CDN-")));

      const docType = isReturn
        ? inv.module_key === "credit_note"
          ? "credit_note"
          : "sales_return"
        : "invoice";

      const rawAmount = Number(inv.grand_total) || 0;
      const signedAmount = isReturn ? -rawAmount : rawAmount;

      let paymentStatus: "paid" | "partial" | "unpaid" | "cancelled" = "paid";
      if (inv.status === "cancelled") {
        paymentStatus = "cancelled";
      } else if (inv.payment_mode?.toLowerCase() === "credit" || (Number(inv.paid_amount) || 0) < rawAmount) {
        paymentStatus = "unpaid";
      }

      let timeStr = "";
      if (inv.created_at) {
        timeStr = new Date(inv.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }

      return {
        id: inv.id,
        documentNumber: inv.invoice_number,
        documentType: docType,
        date: inv.invoice_date,
        time: timeStr,
        customerName: inv.customer_name || "Walk-in Customer",
        amount: signedAmount,
        paymentMode: inv.payment_mode || "Cash",
        paymentStatus,
        rawRecord: inv,
      };
    });

    // 6. Held bills count
    const heldBillsCount = billingTenderService.listHeldBills().length;

    // 7. Sync status
    const syncQueue = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
    const pendingCount = syncQueue.filter((q) => q.status === "pending" || q.status === "in_progress").length;
    const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
    const lastSyncedText = isOnline
      ? pendingCount === 0
        ? "All data in sync"
        : `${pendingCount} item(s) queued`
      : "Offline Active";

    return {
      period: {
        type: periodType,
        startDate: range.startDate,
        endDate: range.endDate,
        label: range.label,
      },
      netSales,
      grossSales,
      totalReturns,
      previousPeriodSales,
      salesDeltaPercent,
      billsIssuedCount,
      averageTicket,
      payments: {
        cash: Math.max(0, cashAmount),
        upi: Math.max(0, upiAmount),
        card: Math.max(0, cardAmount),
        bankTransfer: Math.max(0, bankTransferAmount),
        credit: Math.max(0, creditAmount),
        other: Math.max(0, otherAmount),
        digitalTotal,
        digitalPercent,
      },
      nearExpiry: {
        thresholdDays: nearExpiryThresholdDays,
        count: nearExpiryCount,
      },
      gst: {
        slabs,
        totalTaxable: Math.max(0, metrics.taxes.totalTaxable),
        totalCgst: Math.max(0, metrics.taxes.totalCgst),
        totalSgst: Math.max(0, metrics.taxes.totalSgst),
        totalIgst: Math.max(0, metrics.taxes.totalIgst),
        totalTaxAccrued: metrics.taxes.totalTax,
      },
      recentDocuments,
      heldBillsCount,
      syncStatus: {
        isOnline,
        pendingCount,
        lastSyncedText,
      },
    };
  }
}

export const dashboardMetricsService = new DashboardMetricsService();

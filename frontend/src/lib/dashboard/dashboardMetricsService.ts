import { sqliteStorage } from "../db/sqliteStorage";
import { companySettingsService } from "../settings/companySettingsService";
import { billingTenderService } from "../billing/billingTenderService";
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

    // 2. Calculate Gross Sales, Returns, Net Sales & Bills count
    let grossSales = 0;
    let totalReturns = 0;
    let billsIssuedCount = 0;

    let cashAmount = 0;
    let upiAmount = 0;
    let cardAmount = 0;
    let bankTransferAmount = 0;
    let creditAmount = 0;
    let otherAmount = 0;

    const slabMap = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
    let totalTaxableAccrued = 0;
    let totalCgstAccrued = 0;
    let totalSgstAccrued = 0;
    let totalIgstAccrued = 0;

    for (const inv of currentInvoices) {
      const isReturn =
        inv.module_key === "credit_note" ||
        inv.module_key === "sales_return" ||
        (inv.invoice_number && (inv.invoice_number.startsWith("SR-") || inv.invoice_number.startsWith("CN-") || inv.invoice_number.startsWith("CDN-")));

      const invoiceTotal = Number(inv.grand_total) || 0;
      const sign = isReturn ? -1 : 1;

      if (!isReturn) {
        billsIssuedCount += 1;
        grossSales = Math.round((grossSales + invoiceTotal) * 100) / 100;
      } else {
        totalReturns = Math.round((totalReturns + invoiceTotal) * 100) / 100;
      }

      // Payments split
      const mode = (inv.payment_mode || "Cash").toLowerCase().trim();
      const amountWithSign = sign * invoiceTotal;

      if (mode.includes("cash")) {
        cashAmount = Math.round((cashAmount + amountWithSign) * 100) / 100;
      } else if (mode.includes("upi")) {
        upiAmount = Math.round((upiAmount + amountWithSign) * 100) / 100;
      } else if (mode.includes("card")) {
        cardAmount = Math.round((cardAmount + amountWithSign) * 100) / 100;
      } else if (mode.includes("bank") || mode.includes("cheque") || mode.includes("neft")) {
        bankTransferAmount = Math.round((bankTransferAmount + amountWithSign) * 100) / 100;
      } else if (mode.includes("credit")) {
        creditAmount = Math.round((creditAmount + amountWithSign) * 100) / 100;
      } else {
        otherAmount = Math.round((otherAmount + amountWithSign) * 100) / 100;
      }

      // Tax & GST Slabs calculation
      const lineItems = itemsByInvoice.get(inv.id) || [];
      for (const line of lineItems) {
        const rate = Number(line.gst_percent) || 0;
        const cgst = (Number(line.cgst_amount) || 0) * sign;
        const sgst = (Number(line.sgst_amount) || 0) * sign;
        const igst = (Number(line.igst_amount) || 0) * sign;
        const lineTax = cgst + sgst + igst;
        const lineTotal = (Number(line.total_amount) || 0) * sign;
        const lineTaxable = lineTotal - lineTax;

        if (!slabMap.has(rate)) {
          slabMap.set(rate, { taxable: 0, cgst: 0, sgst: 0, igst: 0 });
        }
        const slab = slabMap.get(rate)!;
        slab.taxable = Math.round((slab.taxable + lineTaxable) * 100) / 100;
        slab.cgst = Math.round((slab.cgst + cgst) * 100) / 100;
        slab.sgst = Math.round((slab.sgst + sgst) * 100) / 100;
        slab.igst = Math.round((slab.igst + igst) * 100) / 100;

        totalTaxableAccrued = Math.round((totalTaxableAccrued + lineTaxable) * 100) / 100;
        totalCgstAccrued = Math.round((totalCgstAccrued + cgst) * 100) / 100;
        totalSgstAccrued = Math.round((totalSgstAccrued + sgst) * 100) / 100;
        totalIgstAccrued = Math.round((totalIgstAccrued + igst) * 100) / 100;
      }
    }

    const netSales = Math.max(0, Math.round((grossSales - totalReturns) * 100) / 100);
    const averageTicket = billsIssuedCount > 0 ? Math.round((netSales / billsIssuedCount) * 100) / 100 : 0;

    // Previous period sales for delta calculation
    let prevGross = 0;
    let prevReturns = 0;
    for (const inv of previousInvoices) {
      const isReturn =
        inv.module_key === "credit_note" ||
        inv.module_key === "sales_return" ||
        (inv.invoice_number && (inv.invoice_number.startsWith("SR-") || inv.invoice_number.startsWith("CN-") || inv.invoice_number.startsWith("CDN-")));
      const val = Number(inv.grand_total) || 0;
      if (!isReturn) prevGross += val;
      else prevReturns += val;
    }
    const previousPeriodSales = Math.max(0, Math.round((prevGross - prevReturns) * 100) / 100);

    let salesDeltaPercent: number | null = null;
    if (previousPeriodSales > 0) {
      salesDeltaPercent = Math.round(((netSales - previousPeriodSales) / previousPeriodSales) * 100);
    }

    // Digital percentage calculation
    const digitalTotal = Math.max(0, Math.round((upiAmount + cardAmount + bankTransferAmount + otherAmount) * 100) / 100);
    const totalCollected = Math.max(0, Math.round((cashAmount + digitalTotal) * 100) / 100);
    const digitalPercent = totalCollected > 0 ? Math.round((digitalTotal / totalCollected) * 100) : 0;

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

    // 4. GST Slabs sorting & filtering
    const slabs: GstSlabBreakdown[] = Array.from(slabMap.entries())
      .filter(([_, data]) => Math.abs(data.taxable) > 0.001 || Math.abs(data.cgst + data.sgst + data.igst) > 0.001)
      .map(([rate, data]) => {
        const totalTax = Math.round((data.cgst + data.sgst + data.igst) * 100) / 100;
        return {
          rate,
          taxableValue: Math.max(0, data.taxable),
          cgstAmount: Math.max(0, data.cgst),
          sgstAmount: Math.max(0, data.sgst),
          igstAmount: Math.max(0, data.igst),
          totalTax: Math.max(0, totalTax),
        };
      })
      .sort((a, b) => a.rate - b.rate);

    const totalTaxAccrued = Math.max(0, Math.round((totalCgstAccrued + totalSgstAccrued + totalIgstAccrued) * 100) / 100);

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
        totalTaxable: Math.max(0, totalTaxableAccrued),
        totalCgst: Math.max(0, totalCgstAccrued),
        totalSgst: Math.max(0, totalSgstAccrued),
        totalIgst: Math.max(0, totalIgstAccrued),
        totalTaxAccrued,
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

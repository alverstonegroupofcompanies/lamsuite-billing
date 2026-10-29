import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord } from "../../../lib/billing/invoiceManagementService";

export interface CustomerLedgerRow {
  entry_date: string;
  customer_name: string;
  phone?: string;
  voucher_type: "INVOICE" | "PAYMENT" | "CREDIT NOTE";
  voucher_no: string;
  debit_amount: number; // invoices issued (increases balance due)
  credit_amount: number; // payment received or credit note (reduces balance)
  running_balance: number; // net receivable
  payment_mode?: string;
  notes?: string;
}

export const customerLedgerColumns: ReportColumn<CustomerLedgerRow>[] = [
  {
    id: "entry_date",
    header: "Date",
    accessor: (r) => r.entry_date,
    align: "center",
    width: 100,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "customer_name",
    header: "Customer Name",
    accessor: (r) => r.customer_name,
    align: "left",
    width: 200,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "phone",
    header: "Mobile",
    accessor: (r) => r.phone || "-",
    align: "center",
    width: 120,
    isDefaultVisible: true,
  },
  {
    id: "voucher_type",
    header: "Type",
    accessor: (r) => r.voucher_type,
    align: "center",
    width: 120,
    format: "badge",
    badgeStyle: (val) => {
      if (val === "INVOICE") return "warning";
      if (val === "PAYMENT") return "success";
      return "info";
    },
    isDefaultVisible: true,
  },
  {
    id: "voucher_no",
    header: "Bill / Receipt No",
    accessor: (r) => r.voucher_no,
    align: "left",
    width: 135,
    isDefaultVisible: true,
  },
  {
    id: "debit_amount",
    header: "Debit / Bill (₹)",
    accessor: (r) => (r.debit_amount > 0 ? r.debit_amount : "-"),
    align: "right",
    width: 125,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "credit_amount",
    header: "Credit / Paid (₹)",
    accessor: (r) => (r.credit_amount > 0 ? r.credit_amount : "-"),
    align: "right",
    width: 125,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "running_balance",
    header: "Balance Due (₹)",
    accessor: (r) => r.running_balance,
    align: "right",
    width: 135,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const customerLedgerFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Statement Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
  {
    id: "customerName",
    label: "Customer Search",
    type: "text",
    defaultValue: "",
    placeholder: "Filter by customer name or phone...",
  },
];

export const customerLedgerReport: ReportModule<any, CustomerLedgerRow> = {
  id: "customer-ledger",
  title: "Customer Ledger & Udhari Khata Statement",
  description: "Detailed chronological customer account statement tracking bills raised, credit payments received, return notes, and running balance due.",
  category: "customer",
  permission: "reports.customer.view",
  menuVisibilityKey: "reports",
  keywords: ["customer ledger", "udhari khata", "receivables", "credit customer", "statement of account", "customer balance"],
  defaultSort: { column: "entry_date", direction: "asc" },
  supportedPrintLayouts: ["a4", "thermal", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: customerLedgerFilters,
  columns: customerLedgerColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const [allInvoices, partyEntries, allPayments] = await Promise.all([
      sqliteStorage.findAll<InvoiceRecord>("invoices").catch(() => []),
      sqliteStorage.findAll<any>("party_ledger_entries").catch(() => []),
      sqliteStorage.findAll<any>("invoice_payments").catch(() => []),
    ]);

    const paymentsByInvoice = new Map<string, any[]>();
    for (const p of allPayments) {
      if (!paymentsByInvoice.has(p.invoice_id)) {
        paymentsByInvoice.set(p.invoice_id, []);
      }
      paymentsByInvoice.get(p.invoice_id)!.push(p);
    }

    const rows: CustomerLedgerRow[] = [];

    if (partyEntries.length > 0) {
      const customerEntries = partyEntries.filter(
        (e: any) =>
          e.party_type === "customer" &&
          e.entry_date >= dates.startDate &&
          e.entry_date <= dates.endDate
      );

      for (const e of customerEntries) {
        rows.push({
          entry_date: e.entry_date,
          customer_name: e.party_name || e.party_id,
          phone: e.phone,
          voucher_type: (e.reference_type === "invoice"
            ? "INVOICE"
            : e.reference_type === "payment"
            ? "PAYMENT"
            : "CREDIT NOTE") as any,
          voucher_no: e.reference_number || e.reference_id,
          debit_amount: Number(e.debit_amount) || 0,
          credit_amount: Number(e.credit_amount) || 0,
          running_balance: Number(e.running_balance) || 0,
          payment_mode: e.payment_mode,
          notes: e.notes,
        });
      }
    } else {
      // Reconstruct from invoices
      for (const inv of allInvoices) {
        if (inv.status === "cancelled") continue;
        if (inv.invoice_date < dates.startDate || inv.invoice_date > dates.endDate) continue;

        const isReturn = inv.module_key === "sales_return" || inv.module_key === "credit_note";
        const grand = Number(inv.grand_total) || 0;
        const paid = Number(inv.paid_amount) || 0;

        if (isReturn) {
          rows.push({
            entry_date: inv.invoice_date,
            customer_name: inv.customer_name || "Counter Customer",
            phone: inv.customer_phone,
            voucher_type: "CREDIT NOTE",
            voucher_no: inv.invoice_number,
            debit_amount: 0,
            credit_amount: grand,
            running_balance: 0,
            notes: "Return credit note",
          });
        } else {
          // Billed amount is debit
          rows.push({
            entry_date: inv.invoice_date,
            customer_name: inv.customer_name || "Counter Customer",
            phone: inv.customer_phone,
            voucher_type: "INVOICE",
            voucher_no: inv.invoice_number,
            debit_amount: grand,
            credit_amount: 0,
            running_balance: 0,
            notes: inv.payment_mode ? `Payment mode: ${inv.payment_mode}` : undefined,
          });

          // Immediate payments received are credited to reduce balance
          const invPayments = (paymentsByInvoice.get(inv.id) || []).filter(
            (p) => p.status !== "refunded" && p.payment_mode.toLowerCase() !== "credit"
          );

          if (invPayments.length > 0) {
            for (const p of invPayments) {
              const pAmt = Number(p.amount) || 0;
              if (pAmt > 0) {
                rows.push({
                  entry_date: inv.invoice_date,
                  customer_name: inv.customer_name || "Counter Customer",
                  phone: inv.customer_phone,
                  voucher_type: "PAYMENT",
                  voucher_no: p.reference_no ? `RCPT-${p.reference_no}` : `RCPT-${inv.invoice_number}`,
                  debit_amount: 0,
                  credit_amount: pAmt,
                  running_balance: 0,
                  payment_mode: p.payment_mode,
                  notes: `Paid via ${p.payment_mode}${p.reference_no ? ` [Ref: ${p.reference_no}]` : ""}`,
                });
              }
            }
          } else if (paid > 0 && inv.payment_mode?.toLowerCase() !== "credit") {
            rows.push({
              entry_date: inv.invoice_date,
              customer_name: inv.customer_name || "Counter Customer",
              phone: inv.customer_phone,
              voucher_type: "PAYMENT",
              voucher_no: `RCPT-${inv.invoice_number}`,
              debit_amount: 0,
              credit_amount: paid,
              running_balance: 0,
              payment_mode: inv.payment_mode,
              notes: inv.payment_mode ? `Paid via ${inv.payment_mode}` : "Payment received",
            });
          }
        }
      }
    }

    // Sort chronologically
    rows.sort((a, b) => a.entry_date.localeCompare(b.entry_date));

    let balance = 0;
    for (const r of rows) {
      balance = balance + r.debit_amount - r.credit_amount;
      r.running_balance = Math.round(balance * 100) / 100;
    }

    let filtered = rows;
    if (params.filters.customerName) {
      const c = String(params.filters.customerName).toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.customer_name.toLowerCase().includes(c) ||
          (r.phone && r.phone.toLowerCase().includes(c))
      );
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.customer_name.toLowerCase().includes(q) ||
          (r.phone && r.phone.toLowerCase().includes(q)) ||
          r.voucher_no.toLowerCase().includes(q)
      );
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

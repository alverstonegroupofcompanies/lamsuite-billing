import React, { useState, useEffect } from "react";
import {
  FileBarChart,
  Download,
  Calendar,
  Receipt,
  FileSpreadsheet,
  Users,
  Building,
  CheckCircle,
} from "lucide-react";
import {
  reportEngine,
  type DailyCollectionSummary,
  type SalesRegisterEntry,
  type Gstr1SummaryReport,
  type HsnSummaryEntry,
  type CustomerOutstandingEntry,
  type CancelledBillEntry,
} from "../lib/reports/reportEngine";

export const ReportsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"daily" | "register" | "gstr1" | "hsn" | "aging" | "cancelled">("daily");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));

  // Reports data states
  const [dailySummary, setDailySummary] = useState<DailyCollectionSummary | null>(null);
  const [salesRegister, setSalesRegister] = useState<SalesRegisterEntry[]>([]);
  const [gstr1Report, setGstr1Report] = useState<Gstr1SummaryReport | null>(null);
  const [hsnSummary, setHsnSummary] = useState<HsnSummaryEntry[]>([]);
  const [customerAging, setCustomerAging] = useState<CustomerOutstandingEntry[]>([]);
  const [cancelledBills, setCancelledBills] = useState<CancelledBillEntry[]>([]);

  useEffect(() => {
    loadReports();
  }, [startDate, endDate, activeTab]);

  const loadReports = async () => {
    if (activeTab === "daily") {
      const res = await reportEngine.getDailyCollectionSummary(startDate, endDate);
      setDailySummary(res);
    } else if (activeTab === "register") {
      const res = await reportEngine.getSalesRegister(startDate, endDate);
      setSalesRegister(res);
    } else if (activeTab === "gstr1") {
      const res = await reportEngine.getGstr1Summary(startDate, endDate);
      setGstr1Report(res);
    } else if (activeTab === "hsn") {
      const res = await reportEngine.getHsnSummary(startDate, endDate);
      setHsnSummary(res);
    } else if (activeTab === "aging") {
      const res = await reportEngine.getCustomerOutstandingLedger(new Date());
      setCustomerAging(res);
    } else if (activeTab === "cancelled") {
      const res = await reportEngine.getCancelledBillsReport(startDate, endDate);
      setCancelledBills(res);
    }
  };

  const handleExportCsv = () => {
    let headers: string[] = [];
    let rows: any[][] = [];
    let filename = `report_${activeTab}_${startDate}.csv`;

    if (activeTab === "register") {
      headers = ["Bill No", "Date", "Customer", "GSTIN", "Payment Mode", "Taxable", "CGST", "SGST", "IGST", "Grand Total"];
      rows = salesRegister.map((r) => [
        r.invoice_number,
        r.invoice_date,
        r.customer_name,
        r.customer_gstin,
        r.payment_mode,
        r.taxable_subtotal,
        r.cgst_amount,
        r.sgst_amount,
        r.igst_amount,
        r.grand_total,
      ]);
    } else if (activeTab === "hsn") {
      headers = ["HSN Code", "Description", "Rate %", "Total Qty", "Taxable Value", "CGST", "SGST", "IGST", "Total Value"];
      rows = hsnSummary.map((h) => [
        h.hsn_code,
        h.description,
        h.gst_rate,
        h.total_qty,
        h.taxable_value,
        h.central_tax,
        h.state_tax,
        h.integrated_tax,
        h.total_value,
      ]);
    } else if (activeTab === "aging") {
      headers = ["Customer Name", "0-30 Days", "31-60 Days", "61+ Days", "Total Outstanding", "Invoices Count"];
      rows = customerAging.map((c) => [
        c.customer_name,
        c.aging.days_0_to_30,
        c.aging.days_31_to_60,
        c.aging.days_61_plus,
        c.total_outstanding,
        c.invoice_count,
      ]);
    } else if (activeTab === "cancelled") {
      headers = ["Bill No", "Date", "Customer", "Mobile", "Payment Mode", "Amount", "Cancellation Reason", "Operator"];
      rows = cancelledBills.map((b) => [
        b.invoice_number,
        b.invoice_date,
        b.customer_name,
        b.customer_phone,
        b.payment_mode,
        b.grand_total,
        b.cancel_reason,
        b.user_counter,
      ]);
    } else {
      // Daily summary export
      headers = ["Metric", "Amount (₹)"];
      rows = [
        ["Gross Sales", dailySummary?.gross_sales || 0],
        ["Sales Returns", dailySummary?.total_returns || 0],
        ["Net Sales", dailySummary?.net_sales || 0],
        ["Cash Tender", dailySummary?.by_tender.cash || 0],
        ["UPI Tender", dailySummary?.by_tender.upi || 0],
        ["Card Tender", dailySummary?.by_tender.card || 0],
        ["Credit Tender", dailySummary?.by_tender.credit || 0],
        ["Total Taxable", dailySummary?.total_taxable || 0],
        ["Total CGST", dailySummary?.total_cgst || 0],
        ["Total SGST", dailySummary?.total_sgst || 0],
        ["Total IGST", dailySummary?.total_igst || 0],
      ];
    }

    const csvContent = reportEngine.exportToCsv(headers, rows);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4 font-sans">
      {/* Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Reports & Indian GST Compliance</h2>
          <p className="text-xs text-slate-500">
            Real-time local reporting for daily sales, statutory GSTR-1 returns, HSN summaries, and credit aging.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-xs font-medium focus:outline-none"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-xs font-medium focus:outline-none"
            />
          </div>

          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-1">
        <button
          onClick={() => setActiveTab("daily")}
          className={`border-b-2 px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === "daily" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Daily Collection Summary
        </button>
        <button
          onClick={() => setActiveTab("register")}
          className={`border-b-2 px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === "register" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Sales Register
        </button>
        <button
          onClick={() => setActiveTab("gstr1")}
          className={`border-b-2 px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === "gstr1" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          GSTR-1 Compliance (Tables 4, 5, 7, 9)
        </button>
        <button
          onClick={() => setActiveTab("hsn")}
          className={`border-b-2 px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === "hsn" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          HSN / SAC Tax Summary
        </button>
        <button
          onClick={() => setActiveTab("aging")}
          className={`border-b-2 px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === "aging" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Customer Outstanding Aging
        </button>
        <button
          onClick={() => setActiveTab("cancelled")}
          className={`border-b-2 px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === "cancelled" ? "border-red-600 text-red-600" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Cancelled Bills
        </button>
      </div>

      {/* Tab 1: Daily Collection */}
      {activeTab === "daily" && dailySummary && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Gross Sales</span>
              <p className="mt-1 text-2xl font-black text-slate-800">₹ {dailySummary.gross_sales.toFixed(2)}</p>
              <p className="text-[11px] text-slate-500 mt-1">{dailySummary.total_invoices_count} invoices issued</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Sales Returns</span>
              <p className="mt-1 text-2xl font-black text-red-600">₹ {dailySummary.total_returns.toFixed(2)}</p>
              <p className="text-[11px] text-slate-500 mt-1">Debit / Credit notes</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Net Collection</span>
              <p className="mt-1 text-2xl font-black text-emerald-600">₹ {dailySummary.net_sales.toFixed(2)}</p>
              <p className="text-[11px] text-slate-500 mt-1">Realized revenue</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Total GST Accrued</span>
              <p className="mt-1 text-2xl font-black text-blue-700">
                ₹ {(dailySummary.total_cgst + dailySummary.total_sgst + dailySummary.total_igst).toFixed(2)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">CGST + SGST + IGST</p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-800 mb-3">Tender Mode Breakdown</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div className="rounded bg-slate-50 p-3">
                <span className="text-slate-500 block">Total Cash</span>
                <span className="text-lg font-bold text-slate-800">₹ {dailySummary.by_tender.cash.toFixed(2)}</span>
              </div>
              <div className="rounded bg-slate-50 p-3">
                <span className="text-slate-500 block">Total UPI (GPay/PhonePe)</span>
                <span className="text-lg font-bold text-slate-800">₹ {dailySummary.by_tender.upi.toFixed(2)}</span>
              </div>
              <div className="rounded bg-slate-50 p-3">
                <span className="text-slate-500 block">Total Card (POS Machine)</span>
                <span className="text-lg font-bold text-slate-800">₹ {dailySummary.by_tender.card.toFixed(2)}</span>
              </div>
              <div className="rounded bg-slate-50 p-3">
                <span className="text-slate-500 block">Total Customer Credit</span>
                <span className="text-lg font-bold text-slate-800">₹ {dailySummary.by_tender.credit.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Sales Register */}
      {activeTab === "register" && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Bill No</th>
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-4 py-2.5 font-semibold">Customer Name</th>
                  <th className="px-4 py-2.5 font-semibold">GSTIN</th>
                  <th className="px-4 py-2.5 font-semibold">Tender</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Taxable</th>
                  <th className="px-4 py-2.5 font-semibold text-right">CGST</th>
                  <th className="px-4 py-2.5 font-semibold text-right">SGST</th>
                  <th className="px-4 py-2.5 font-semibold text-right font-bold">Grand Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {salesRegister.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      No invoices found for this date range
                    </td>
                  </tr>
                ) : (
                  salesRegister.map((inv) => (
                    <tr key={inv.invoice_id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-bold text-blue-600">{inv.invoice_number}</td>
                      <td className="px-4 py-2.5 text-slate-500">{inv.invoice_date}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{inv.customer_name}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">{inv.customer_gstin || "-"}</td>
                      <td className="px-4 py-2.5 text-slate-600">{inv.payment_mode}</td>
                      <td className="px-4 py-2.5 text-right font-mono">₹ {inv.taxable_subtotal.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">₹ {inv.cgst_amount.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">₹ {inv.sgst_amount.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-slate-900 font-mono">
                        ₹ {inv.grand_total.toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: GSTR-1 Compliance */}
      {activeTab === "gstr1" && gstr1Report && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-800 mb-2">Table 4: B2B Invoices (Registered Customers)</h3>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 font-semibold">GSTIN</th>
                  <th className="px-3 py-2 font-semibold">Customer</th>
                  <th className="px-3 py-2 font-semibold">Invoice No</th>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold text-right">Taxable</th>
                  <th className="px-3 py-2 font-semibold text-right">CGST</th>
                  <th className="px-3 py-2 font-semibold text-right">SGST</th>
                  <th className="px-3 py-2 font-semibold text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gstr1Report.table_4_b2b.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-400">
                      No B2B invoices in this period
                    </td>
                  </tr>
                ) : (
                  gstr1Report.table_4_b2b.map((b) => (
                    <tr key={b.invoice_number}>
                      <td className="px-3 py-2 font-mono font-bold text-slate-800">{b.gstin}</td>
                      <td className="px-3 py-2">{b.customer_name}</td>
                      <td className="px-3 py-2 font-bold text-blue-600">{b.invoice_number}</td>
                      <td className="px-3 py-2 text-slate-500">{b.invoice_date}</td>
                      <td className="px-3 py-2 text-right">₹ {b.taxable_value.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">₹ {b.central_tax.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">₹ {b.state_tax.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-bold">₹ {b.invoice_value.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-800 mb-2">Table 7: B2C Small (Retail Consumers)</h3>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 font-semibold">Place of Supply (State)</th>
                  <th className="px-3 py-2 font-semibold text-center">GST Rate %</th>
                  <th className="px-3 py-2 font-semibold text-right">Taxable Value</th>
                  <th className="px-3 py-2 font-semibold text-right">Central Tax (CGST)</th>
                  <th className="px-3 py-2 font-semibold text-right">State Tax (SGST)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gstr1Report.table_7_b2c_small.map((s, idx) => (
                  <tr key={idx}>
                    <td className="px-3 py-2 font-medium">{s.place_of_supply}</td>
                    <td className="px-3 py-2 text-center font-bold">{s.rate}%</td>
                    <td className="px-3 py-2 text-right font-mono">₹ {s.taxable_value.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">₹ {s.central_tax.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">₹ {s.state_tax.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: HSN Summary */}
      {activeTab === "hsn" && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">HSN Code</th>
                <th className="px-4 py-2.5 font-semibold">Description</th>
                <th className="px-4 py-2.5 font-semibold text-center">UQC</th>
                <th className="px-4 py-2.5 font-semibold text-right">Total Qty</th>
                <th className="px-4 py-2.5 font-semibold text-center">Rate %</th>
                <th className="px-4 py-2.5 font-semibold text-right">Taxable Value</th>
                <th className="px-4 py-2.5 font-semibold text-right">CGST</th>
                <th className="px-4 py-2.5 font-semibold text-right">SGST</th>
                <th className="px-4 py-2.5 font-semibold text-right font-bold">Total Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {hsnSummary.map((h, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono font-bold text-slate-800">{h.hsn_code}</td>
                  <td className="px-4 py-2.5">{h.description}</td>
                  <td className="px-4 py-2.5 text-center font-semibold text-slate-500">{h.uqc}</td>
                  <td className="px-4 py-2.5 text-right font-bold">{h.total_qty}</td>
                  <td className="px-4 py-2.5 text-center font-semibold">{h.gst_rate}%</td>
                  <td className="px-4 py-2.5 text-right font-mono">₹ {h.taxable_value.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">₹ {h.central_tax.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">₹ {h.state_tax.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-900 font-mono">
                    ₹ {h.total_value.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 5: Customer Outstanding Aging */}
      {activeTab === "aging" && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Customer</th>
                <th className="px-4 py-2.5 font-semibold text-right">0-30 Days</th>
                <th className="px-4 py-2.5 font-semibold text-right">31-60 Days</th>
                <th className="px-4 py-2.5 font-semibold text-right">61+ Days</th>
                <th className="px-4 py-2.5 font-semibold text-right font-bold">Total Outstanding</th>
                <th className="px-4 py-2.5 font-semibold text-center">Invoices</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customerAging.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <CheckCircle className="mx-auto h-8 w-8 text-emerald-300 mb-1" />
                    <p className="font-medium">No customer credit balances outstanding</p>
                  </td>
                </tr>
              ) : (
                customerAging.map((c) => (
                  <tr key={c.customer_id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-bold text-slate-800">{c.customer_name}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-emerald-600">
                      ₹ {c.aging.days_0_to_30.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-amber-600">
                      ₹ {c.aging.days_31_to_60.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-red-600 font-bold">
                      ₹ {c.aging.days_61_plus.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-black text-slate-900 font-mono">
                      ₹ {c.total_outstanding.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-center font-bold text-blue-600">{c.invoice_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "cancelled" && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Bill No</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold">Customer</th>
                <th className="px-4 py-2.5 font-semibold">Tender</th>
                <th className="px-4 py-2.5 font-semibold text-right">Reversed Amount</th>
                <th className="px-4 py-2.5 font-semibold">Cancellation Reason</th>
                <th className="px-4 py-2.5 font-semibold text-center">Operator</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cancelledBills.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <CheckCircle className="mx-auto h-8 w-8 text-emerald-300 mb-1" />
                    <p className="font-medium">No cancelled invoices found in this date range</p>
                  </td>
                </tr>
              ) : (
                cancelledBills.map((b) => (
                  <tr key={b.invoice_id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono font-bold text-red-600">{b.invoice_number}</td>
                    <td className="px-4 py-2.5 text-slate-600">{b.invoice_date}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">
                      {b.customer_name}
                      {b.customer_phone ? <span className="ml-1 text-[11px] font-normal text-slate-400">({b.customer_phone})</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{b.payment_mode}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-red-600">
                      ₹ {b.grand_total.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 italic max-w-xs truncate" title={b.cancel_reason}>
                      {b.cancel_reason}
                    </td>
                    <td className="px-4 py-2.5 text-center font-medium text-slate-500">{b.user_counter}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

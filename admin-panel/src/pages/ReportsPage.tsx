import React, { useEffect, useState } from "react";
import { api } from "../services/api";
import { formatINR, formatIndianNumber, formatDate } from "../utils/formatters";
import { useAuth } from "../context/AuthContext";
import {
  FileBarChart2,
  Calendar,
  FileSpreadsheet,
  Download,
  Receipt,
  Building,
  Users,
  Stethoscope,
  Mail,
  RefreshCw,
} from "lucide-react";

export const ReportsPage: React.FC = () => {
  const { activeStore } = useAuth();
  const [activeTab, setActiveTab] = useState<"sales" | "gstr1" | "aging" | "pharmacy" | "scheduled">("sales");

  const [startDate, setStartDate] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0]
  );
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);

  const [salesReport, setSalesReport] = useState<any>(null);
  const [gstr1Report, setGstr1Report] = useState<any>(null);
  const [agingReport, setAgingReport] = useState<any>(null);
  const [pharmacyReport, setPharmacyReport] = useState<any>(null);
  const [scheduledReports, setScheduledReports] = useState<any[]>([]);

  const [isLoading, setIsLoading] = useState(true);

  const fetchReports = async () => {
    setIsLoading(true);
    try {
      if (activeTab === "sales") {
        const res = await api.get("/admin/reports/sales", { start_date: startDate, end_date: endDate });
        setSalesReport(res);
      } else if (activeTab === "gstr1") {
        const res = await api.get("/admin/reports/gstr1", { start_date: startDate, end_date: endDate });
        setGstr1Report(res);
      } else if (activeTab === "aging") {
        const res = await api.get("/admin/reports/customer-aging");
        setAgingReport(res);
      } else if (activeTab === "pharmacy") {
        const res = await api.get("/admin/reports/pharmacy", { start_date: startDate, end_date: endDate });
        setPharmacyReport(res);
      } else if (activeTab === "scheduled") {
        const res = await api.get<{ schedules: any[] }>("/admin/reports/scheduled");
        setScheduledReports(res.schedules || []);
      }
    } catch (err) {
      console.error("Failed to load reports:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [activeTab, startDate, endDate, activeStore]);

  const exportCsv = (filename: string, rows: any[]) => {
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]).join(",");
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows.map((r) => Object.values(r).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${filename}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Title & Date Range Picker */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Financial & Statutory GST Reports
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cross-store consolidated summaries, Table 12 HSN tax computations, customer credit aging, and Schedule H1 logs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-1.5 rounded-xl text-xs font-medium shadow-2xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent focus:outline-hidden text-slate-700 dark:text-slate-200"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent focus:outline-hidden text-slate-700 dark:text-slate-200"
            />
          </div>

          <button
            onClick={() => exportCsv(`report_${activeTab}`, [salesReport || gstr1Report || {}])}
            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-2xs transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-4 text-xs font-semibold overflow-x-auto pb-0.5">
        {[
          { id: "sales", label: "Daily Sales & Collection", icon: Receipt },
          { id: "gstr1", label: "GSTR-1 Statutory Summary", icon: FileBarChart2 },
          { id: "aging", label: "Customer Dues Aging", icon: Users },
          { id: "pharmacy", label: "Rx & Schedule H1 Register", icon: Stethoscope },
          { id: "scheduled", label: "Scheduled Email Digests", icon: Mail },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-2.5 flex items-center gap-1.5 border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? "border-brand-600 text-brand-600 dark:text-brand-400 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center text-xs text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin mr-2 text-brand-600" />
          Compiling statutory report dataset...
        </div>
      ) : activeTab === "sales" && salesReport ? (
        /* Sales Report */
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
              <span className="text-[11px] text-slate-500">Gross Sales</span>
              <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                {formatINR(salesReport.gross_sales)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
              <span className="text-[11px] text-slate-500">Total Taxable Value</span>
              <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                {formatINR(salesReport.total_taxable)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
              <span className="text-[11px] text-slate-500">Total GST Collected</span>
              <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                {formatINR(salesReport.total_tax)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
              <span className="text-[11px] text-slate-500">Net Final Sales</span>
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                {formatINR(salesReport.net_sales)}
              </div>
            </div>
          </div>

          {/* Tender Breakdown */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-4">
              Payment Tender Distribution
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Object.entries(salesReport.by_tender || {}).map(([mode, amt]) => (
                <div key={mode} className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] uppercase font-bold text-slate-400">{mode}</span>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-100 font-mono mt-1">
                    {formatINR(amt as number)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : activeTab === "gstr1" && gstr1Report ? (
        /* GSTR-1 View */
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
              <div className="text-xs font-bold text-slate-500">Table 4: B2B Invoices</div>
              <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                {formatINR(gstr1Report.table_4_b2b?.taxable_value)}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                Count: {gstr1Report.table_4_b2b?.count} registered customer invoices
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
              <div className="text-xs font-bold text-slate-500">Table 7: B2C Small Invoices</div>
              <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                {formatINR(gstr1Report.table_7_b2cs?.taxable_value)}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                Count: {gstr1Report.table_7_b2cs?.count} retail consumer bills
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
              <div className="text-xs font-bold text-slate-500">Table 13: Document Numbers Issued</div>
              <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                {gstr1Report.table_13_docs?.total_number} Documents
              </div>
              <div className="text-[10px] text-slate-400 mt-1 font-mono">
                {gstr1Report.table_13_docs?.from_doc} to {gstr1Report.table_13_docs?.to_doc} (Cancelled: {gstr1Report.table_13_docs?.cancelled_number})
              </div>
            </div>
          </div>

          {/* Table 12 HSN Summary */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Table 12: HSN Summary of Outward Supplies
              </h3>
            </div>
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">HSN / SAC</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-center">Total Quantity</th>
                  <th className="px-4 py-3 text-right">Taxable Value</th>
                  <th className="px-4 py-3 text-right">CGST (₹)</th>
                  <th className="px-4 py-3 text-right">SGST (₹)</th>
                  <th className="px-4 py-3 text-right">Total Tax (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                {gstr1Report.table_12_hsn?.map((h: any, i: number) => (
                  <tr key={i}>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{h.hsn_code}</td>
                    <td className="px-4 py-3 font-sans">{h.description}</td>
                    <td className="px-4 py-3 text-center">{formatIndianNumber(h.total_qty)}</td>
                    <td className="px-4 py-3 text-right">{formatINR(h.taxable_value)}</td>
                    <td className="px-4 py-3 text-right">{formatINR(h.cgst_amount)}</td>
                    <td className="px-4 py-3 text-right">{formatINR(h.sgst_amount)}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">
                      {formatINR(h.total_tax)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === "aging" && agingReport ? (
        /* Aging View */
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 dark:text-white text-sm">
              Customer Aging Analysis & Outstanding Accounts
            </h3>
            <span className="font-mono text-xs font-bold text-red-500">
              Total Dues: {formatINR(agingReport.total_outstanding)}
            </span>
          </div>
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Customer Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3 text-right">0-30 Days</th>
                <th className="px-4 py-3 text-right">31-60 Days</th>
                <th className="px-4 py-3 text-right">61-90 Days</th>
                <th className="px-4 py-3 text-right">90+ Days</th>
                <th className="px-4 py-3 text-right">Total Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
              {agingReport.customers?.map((c: any) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-sans font-bold text-slate-900 dark:text-white">{c.name}</td>
                  <td className="px-4 py-3 text-slate-500">{c.phone}</td>
                  <td className="px-4 py-3 text-right text-emerald-600">{formatINR(c.bracket_0_30)}</td>
                  <td className="px-4 py-3 text-right text-amber-600">{formatINR(c.bracket_31_60)}</td>
                  <td className="px-4 py-3 text-right text-orange-600">{formatINR(c.bracket_61_90)}</td>
                  <td className="px-4 py-3 text-right text-red-600 font-bold">{formatINR(c.bracket_90_plus)}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">
                    {formatINR(c.current_balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : activeTab === "pharmacy" && pharmacyReport ? (
        /* Pharmacy Doctor Sales */
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-slate-900 dark:text-white text-sm">
              Prescription Sales by Registered Doctors
            </h3>
          </div>
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Doctor Name</th>
                <th className="px-4 py-3">Medical Reg No</th>
                <th className="px-4 py-3 text-center">Prescriptions Dispensed</th>
                <th className="px-4 py-3 text-right">Total Medication Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {pharmacyReport.doctor_sales?.map((d: any, i: number) => (
                <tr key={i}>
                  <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{d.doctor_name}</td>
                  <td className="px-4 py-3 font-mono text-slate-500">{d.doctor_reg_no || "—"}</td>
                  <td className="px-4 py-3 text-center font-mono font-bold">{d.rx_count}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                    {formatINR(d.total_value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Scheduled Email Reports */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scheduledReports.map((sch) => (
            <div key={sch.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 dark:text-white text-sm">{sch.name}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                  Active
                </span>
              </div>
              <p className="text-xs text-slate-500">Recipients: {sch.recipients?.join(", ")}</p>
              <div className="text-[10px] font-mono text-slate-400">Frequency: {sch.frequency}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

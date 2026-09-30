import React from "react";
import { Link } from "react-router-dom";
import {
  TrendingUp,
  Receipt,
  AlertTriangle,
  CreditCard,
  PlusCircle,
  PackagePlus,
  RefreshCw,
} from "lucide-react";

export const DashboardPage: React.FC = () => {
  return (
    <div className="space-y-4">
      {/* Top Action Ribbon */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Store Dashboard</h2>
          <p className="text-xs text-slate-500">Live POS metrics, stock indicators, and quick shortcuts.</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/pos"
            className="flex items-center gap-2 rounded bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <PlusCircle className="h-4 w-4" />
            <span>New Bill (F1)</span>
          </Link>
          <Link
            to="/purchases"
            className="flex items-center gap-2 rounded bg-slate-700 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
          >
            <PackagePlus className="h-4 w-4" />
            <span>Inward Purchase (F2)</span>
          </Link>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Today's Sales</span>
            <div className="rounded bg-blue-50 p-2 text-blue-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-800">₹ 24,850.00</p>
          <p className="text-xs text-emerald-600 font-medium mt-1">↑ 14% vs yesterday</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bills Issued</span>
            <div className="rounded bg-emerald-50 p-2 text-emerald-600">
              <Receipt className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-800">42</p>
          <p className="text-xs text-slate-500 mt-1">Average ticket ₹591.60</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">UPI / Cash Split</span>
            <div className="rounded bg-indigo-50 p-2 text-indigo-600">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-xl font-bold text-slate-800">₹16.2k / ₹8.6k</p>
          <p className="text-xs text-slate-500 mt-1">65% Digital Collections</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Near Expiry (60d)</span>
            <div className="rounded bg-amber-50 p-2 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-600">7 Batches</p>
          <Link to="/reports" className="text-xs text-blue-600 hover:underline mt-1 inline-block">
            View expiry report →
          </Link>
        </div>
      </div>

      {/* Main Grid: Recent Invoices & Quick Reports */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent Invoices Table (2 cols) */}
        <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-bold text-slate-800">Recent Completed Invoices</h3>
            <button className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
              <RefreshCw className="h-3 w-3" />
              <span>Refresh</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2 font-semibold">Bill No</th>
                  <th className="px-4 py-2 font-semibold">Time</th>
                  <th className="px-4 py-2 font-semibold">Customer</th>
                  <th className="px-4 py-2 font-semibold">Items</th>
                  <th className="px-4 py-2 font-semibold text-right">Amount</th>
                  <th className="px-4 py-2 font-semibold">Tender</th>
                  <th className="px-4 py-2 font-semibold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-bold text-blue-600">INV-2026-0042</td>
                  <td className="px-4 py-2.5 text-slate-500">11:58 AM</td>
                  <td className="px-4 py-2.5 text-slate-700 font-medium">Walk-in Customer</td>
                  <td className="px-4 py-2.5 text-slate-600">3</td>
                  <td className="px-4 py-2.5 font-bold text-slate-800 text-right">₹ 420.00</td>
                  <td className="px-4 py-2.5 text-slate-600">UPI (GPay)</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      PAID
                    </span>
                  </td>
                </tr>
                <tr className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-bold text-blue-600">INV-2026-0041</td>
                  <td className="px-4 py-2.5 text-slate-500">11:42 AM</td>
                  <td className="px-4 py-2.5 text-slate-700 font-medium">Dr. Rajesh Menon</td>
                  <td className="px-4 py-2.5 text-slate-600">5</td>
                  <td className="px-4 py-2.5 font-bold text-slate-800 text-right">₹ 1,150.00</td>
                  <td className="px-4 py-2.5 text-slate-600">Cash</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      PAID
                    </span>
                  </td>
                </tr>
                <tr className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-bold text-blue-600">INV-2026-0040</td>
                  <td className="px-4 py-2.5 text-slate-500">11:15 AM</td>
                  <td className="px-4 py-2.5 text-slate-700 font-medium">Suresh Kumar</td>
                  <td className="px-4 py-2.5 text-slate-600">2</td>
                  <td className="px-4 py-2.5 font-bold text-slate-800 text-right">₹ 315.00</td>
                  <td className="px-4 py-2.5 text-slate-600">Credit</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                      CREDIT
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Reports & System Info (1 col) */}
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-bold text-slate-800 mb-3">Statutory GST Quick View</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Intra-State Taxable (5%):</span>
                <span className="font-semibold text-slate-800">₹ 8,400.00</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Intra-State Taxable (12%):</span>
                <span className="font-semibold text-slate-800">₹ 12,200.00</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Intra-State Taxable (18%):</span>
                <span className="font-semibold text-slate-800">₹ 4,250.00</span>
              </div>
              <div className="flex justify-between py-1 font-bold text-blue-700 pt-1">
                <span>Total Tax Accrued:</span>
                <span>₹ 2,649.00</span>
              </div>
            </div>
            <Link
              to="/reports"
              className="mt-3 block text-center rounded bg-slate-100 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
            >
              Generate GSTR-1 Summary →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

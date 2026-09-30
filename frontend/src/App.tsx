import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { PosBillingPage } from "./pages/PosBillingPage";

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/pos" element={<PosBillingPage />} />
          <Route
            path="/purchases"
            element={
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-800">Purchase Management (Task 4.1)</h2>
                <p className="text-xs text-slate-500 mt-1">Inward supplier bills, batch receipts, and purchase returns.</p>
              </div>
            }
          />
          <Route
            path="/stock"
            element={
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-800">Stock & Inventory Ledger (Task 5.1)</h2>
                <p className="text-xs text-slate-500 mt-1">Double-entry stock movement log, reconciliation, and transfers.</p>
              </div>
            }
          />
          <Route
            path="/reports"
            element={
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-800">Reports & Indian GST (Task 6.1)</h2>
                <p className="text-xs text-slate-500 mt-1">GSTR-1, HSN summary, sales registers, and customer aging.</p>
              </div>
            }
          />
          <Route
            path="/masters"
            element={
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-800">Master Data (Task 2.1)</h2>
                <p className="text-xs text-slate-500 mt-1">Products, barcodes, suppliers, customers, and clinical entities.</p>
              </div>
            }
          />
          <Route
            path="/settings"
            element={
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-800">Settings & Terminal Config (Task 1.4)</h2>
                <p className="text-xs text-slate-500 mt-1">Printer profiles, store sequences, GSTIN, and cloud sync status.</p>
              </div>
            }
          />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
};

export default App;

import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { PosBillingPage } from "./pages/PosBillingPage";
import { PurchasesPage } from "./pages/PurchasesPage";
import { StockLedgerPage } from "./pages/StockLedgerPage";
import { ReportsPage } from "./pages/ReportsPage";
import { MastersPage } from "./pages/MastersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { BillsPage } from "./pages/BillsPage";
import { SalesReturnPage } from "./pages/SalesReturnPage";
import { PurchaseReturnPage } from "./pages/PurchaseReturnPage";
import { CustomerDebitNotePage } from "./pages/CustomerDebitNotePage";

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/pos" element={<PosBillingPage />} />
          <Route path="/bills" element={<BillsPage />} />
          <Route path="/purchases" element={<PurchasesPage />} />
          <Route path="/stock" element={<StockLedgerPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/masters" element={<MastersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/returns/sales" element={<SalesReturnPage />} />
          <Route path="/returns/purchases" element={<PurchaseReturnPage />} />
          <Route path="/returns/debit-notes" element={<CustomerDebitNotePage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
};

export default App;

import { describe, it, expect, beforeEach } from "vitest";
import { supplierLedgerService, type SupplierMaster } from "./supplierLedgerService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";

describe("Supplier Ledger & Ageing Service", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  it("creates supplier and records double-entry purchase credits and payments", async () => {
    const supplier: SupplierMaster = {
      id: "sup_101",
      name: "MedLife Distributors",
      phone: "9876543210",
      gstin: "32AAAAA0000A1Z5",
      credit_period_days: 30,
      opening_balance: 1000,
      outstanding_balance: 1000,
      is_active: true,
    };
    await supplierLedgerService.upsertSupplier(supplier);

    // Record purchase credit of ₹5000
    await supplierLedgerService.recordPurchaseCredit({
      supplier_id: "sup_101",
      supplier_name: "MedLife Distributors",
      purchase_id: "pb_1",
      purchase_number: "PB-01",
      purchase_date: "2026-10-01",
      amount: 5000,
    });

    let stmt = await supplierLedgerService.getSupplierStatement("sup_101");
    expect(stmt.summary.openingBalance).toBe(1000);
    expect(stmt.summary.totalPurchases).toBe(5000);
    expect(stmt.summary.closingBalance).toBe(6000);

    // Record supplier payment of ₹4000
    const payRes = await supplierLedgerService.recordSupplierPayment({
      supplier_id: "sup_101",
      supplier_name: "MedLife Distributors",
      payment_date: "2026-10-05",
      amount: 4000,
      payment_mode: "Bank Transfer",
      reference_no: "UTR123456",
    });
    expect(payRes.success).toBe(true);

    stmt = await supplierLedgerService.getSupplierStatement("sup_101");
    expect(stmt.summary.totalPayments).toBe(4000);
    expect(stmt.summary.closingBalance).toBe(2000);
  });

  it("calculates ageing buckets accurately", async () => {
    const supplier: SupplierMaster = {
      id: "sup_ageing",
      name: "Ageing Vendor",
      credit_period_days: 30,
      outstanding_balance: 0,
      is_active: true,
    };
    await supplierLedgerService.upsertSupplier(supplier);

    // Invoice 1: 45 days old (overdue by 15 days -> 1-30 bucket)
    await sqliteStorage.insertRecord("purchase_documents", "doc_1", {
      id: "doc_1",
      purchase_number: "PB-D1",
      supplier_id: "sup_ageing",
      supplier_name: "Ageing Vendor",
      purchase_date: "2026-08-15",
      grand_total: 1000,
      paid_amount: 0,
      payment_status: "unpaid",
      status: "received",
    });

    const ageing = await supplierLedgerService.getSupplierAgeingAnalysis("2026-10-01");
    const supAge = ageing.find((a) => a.supplier_id === "sup_ageing");
    expect(supAge).toBeDefined();
    expect(supAge?.days_1_30).toBe(1000);
    expect(supAge?.total_outstanding).toBe(1000);
  });
});

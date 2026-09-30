import { describe, it, expect, beforeEach } from "vitest";
import { billingTenderService, type PaymentTenderLine } from "./billingTenderService";

describe("Billing Tender & Held Bills (POS-005, POS-006)", () => {
  beforeEach(() => {
    billingTenderService.clearHeldBills();
  });

  describe("Split Tender Payments", () => {
    it("handles multi-mode split tender (Cash + UPI) matching grand total", () => {
      const grandTotal = 1500;
      const payments: PaymentTenderLine[] = [
        { mode: "Cash", amount: 500 },
        { mode: "UPI", amount: 1000, reference_no: "UPI_TXN_99182" },
      ];

      const res = billingTenderService.calculateTenderBalance(grandTotal, payments);
      expect(res.totalPaid).toBe(1500);
      expect(res.balanceDue).toBe(0);
      expect(res.isFullyPaid).toBe(true);
    });

    it("identifies remaining balance for customer credit ledger", () => {
      const grandTotal = 1000;
      const payments: PaymentTenderLine[] = [{ mode: "Cash", amount: 400 }];

      const res = billingTenderService.calculateTenderBalance(grandTotal, payments);
      expect(res.totalPaid).toBe(400);
      expect(res.balanceDue).toBe(600);
      expect(res.isFullyPaid).toBe(false);
    });
  });

  describe("Hold & Recall Bills", () => {
    it("holds multiple draft bills and recalls them successfully", () => {
      const holdId1 = billingTenderService.holdBill({ items: ["prod_1"] }, 1, 150, "Customer A");
      const holdId2 = billingTenderService.holdBill({ items: ["prod_2", "prod_3"] }, 2, 450, "Customer B");

      const heldList = billingTenderService.listHeldBills();
      expect(heldList.length).toBe(2);
      expect(heldList[0].id).toBe(holdId2); // Most recent first

      // Recall Customer A
      const recalled = billingTenderService.recallBill(holdId1);
      expect(recalled?.customer_name).toBe("Customer A");
      expect(recalled?.grand_total).toBe(150);

      // Remaining held bills
      expect(billingTenderService.listHeldBills().length).toBe(1);
    });
  });
});

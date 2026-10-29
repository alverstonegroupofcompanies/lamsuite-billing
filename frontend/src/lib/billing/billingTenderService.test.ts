import { describe, it, expect, beforeEach } from "vitest";
import { billingTenderService, type PaymentTenderLine } from "./billingTenderService";
import type { PaymentSettingsConfig } from "../settings/companySettingsService";

describe("Billing Tender & Held Bills (POS-005, POS-006, Split Payments)", () => {
  beforeEach(() => {
    billingTenderService.clearHeldBills();
  });

  describe("Split Tender Payments & Live Totals", () => {
    it("handles multi-mode split tender (Cash + UPI) matching grand total to the exact paisa", () => {
      const grandTotal = 1224.50;
      const payments: PaymentTenderLine[] = [
        { mode: "Cash", amount: 500.00 },
        { mode: "UPI", amount: 724.50, reference_no: "UPI_TXN_99182" },
      ];

      const res = billingTenderService.calculateTenderBalance(grandTotal, payments);
      expect(res.totalPaid).toBe(1224.50);
      expect(res.balanceDue).toBe(0);
      expect(res.balanceRemaining).toBe(0);
      expect(res.changeDue).toBe(0);
      expect(res.isFullyPaid).toBe(true);
      expect(res.hasNonCashOverpayment).toBe(false);
      expect(res.statusBadge.type).toBe("fully_paid");
    });

    it("calculates cash change strictly from Cash tender lines", () => {
      const grandTotal = 850.00;
      const payments: PaymentTenderLine[] = [
        { mode: "Cash", amount: 1000.00 },
      ];

      const res = billingTenderService.calculateTenderBalance(grandTotal, payments);
      expect(res.totalTendered).toBe(1000.00);
      expect(res.totalPaid).toBe(850.00);
      expect(res.changeDue).toBe(150.00);
      expect(res.isFullyPaid).toBe(true);
      expect(res.hasNonCashOverpayment).toBe(false);
      expect(res.statusBadge.text).toContain("Change due ₹150.00");
    });

    it("allows cash overpayment with split payment (Cash change returned while UPI is exact)", () => {
      const grandTotal = 1200.00;
      // Customer pays 500 UPI and hands 1000 cash (total tendered = 1500)
      const payments: PaymentTenderLine[] = [
        { mode: "UPI", amount: 500.00, reference_no: "UTR987654321012" },
        { mode: "Cash", amount: 1000.00 },
      ];

      const res = billingTenderService.calculateTenderBalance(grandTotal, payments);
      expect(res.totalTendered).toBe(1500.00);
      expect(res.totalPaid).toBe(1200.00);
      expect(res.changeDue).toBe(300.00);
      expect(res.isFullyPaid).toBe(true);
      expect(res.hasNonCashOverpayment).toBe(false);
    });

    it("blocks non-cash overpayment where UPI or Card exceeds invoice total", () => {
      const grandTotal = 500.00;
      const payments: PaymentTenderLine[] = [
        { mode: "UPI", amount: 600.00, reference_no: "UTR123456789012" },
      ];

      const res = billingTenderService.calculateTenderBalance(grandTotal, payments);
      expect(res.hasNonCashOverpayment).toBe(true);
      expect(res.isFullyPaid).toBe(false);
      expect(res.statusBadge.type).toBe("error");
    });

    it("identifies remaining balance for customer credit ledger", () => {
      const grandTotal = 1000;
      const payments: PaymentTenderLine[] = [{ mode: "Cash", amount: 400 }];

      const res = billingTenderService.calculateTenderBalance(grandTotal, payments);
      expect(res.totalPaid).toBe(400);
      expect(res.balanceDue).toBe(600);
      expect(res.balanceRemaining).toBe(600);
      expect(res.isFullyPaid).toBe(false);
    });

    it("calculates exact remainder for a line", () => {
      const grandTotal = 1500.75;
      const payments: PaymentTenderLine[] = [
        { mode: "Cash", amount: 500.25 },
        { mode: "UPI", amount: 0 },
      ];

      const remainder = billingTenderService.calculateRemainderForLine(grandTotal, payments, 1);
      expect(remainder).toBe(1000.50);
    });

    it("splits evenly across modes allocating any odd paisa to the first line", () => {
      const grandTotal = 100.05;
      const split = billingTenderService.splitEvenly(grandTotal, ["Cash", "UPI"]);

      expect(split.length).toBe(2);
      expect(split[0].mode).toBe("Cash");
      expect(split[0].amount).toBe(50.03);
      expect(split[1].mode).toBe("UPI");
      expect(split[1].amount).toBe(50.02);

      // Verify exact sum matches to the paisa
      const sum = Math.round((split[0].amount + split[1].amount) * 100) / 100;
      expect(sum).toBe(100.05);
    });
  });

  describe("Payment Lines Validation (Exact Paisa, Credit Rules, References)", () => {
    const mockSettings: PaymentSettingsConfig = {
      enableDynamicUpiQr: true,
      enableQuickDenominations: true,
      creditPolicy: "block",
      modes: [
        {
          id: "cash",
          name: "Cash",
          enabled: true,
          referenceRequirement: "off",
          referenceLabel: "N/A",
          duplicateCheck: "off",
        },
        {
          id: "upi",
          name: "UPI",
          enabled: true,
          referenceRequirement: "required",
          referenceLabel: "UPI Transaction ID / UTR",
          referencePlaceholder: "12-digit UTR",
          referenceRegex: "^[0-9A-Za-z]{6,35}$",
          referenceMinLength: 6,
          referenceMaxLength: 35,
          duplicateCheck: "warn",
        },
        {
          id: "credit",
          name: "Credit",
          enabled: true,
          referenceRequirement: "off",
          referenceLabel: "N/A",
          duplicateCheck: "off",
        },
      ],
    };

    it("fails validation when payment lines sum does not match grand total (1 paisa mismatch)", async () => {
      const grandTotal = 100.00;
      const payments: PaymentTenderLine[] = [
        { mode: "Cash", amount: 50.00 },
        { mode: "Cash", amount: 49.99 }, // 1 paisa short
      ];

      const res = await billingTenderService.validatePaymentLines(grandTotal, payments, null, mockSettings);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("₹0.01 remaining");
    });

    it("fails validation when a required reference is missing", async () => {
      const grandTotal = 500.00;
      const payments: PaymentTenderLine[] = [
        { mode: "UPI", amount: 500.00, reference_no: "" }, // UPI requires reference in mockSettings
      ];

      const res = await billingTenderService.validatePaymentLines(grandTotal, payments, null, mockSettings);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("is required for UPI");
      expect(res.focusIndex).toBe(0);
    });

    it("fails validation when reference regex format is violated", async () => {
      const grandTotal = 500.00;
      const payments: PaymentTenderLine[] = [
        { mode: "UPI", amount: 500.00, reference_no: "AB" }, // Less than 6 chars min length
      ];

      const res = await billingTenderService.validatePaymentLines(grandTotal, payments, null, mockSettings);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("UPI Transaction ID / UTR must be at least 6 characters");
    });

    it("passes validation with valid reference format", async () => {
      const grandTotal = 500.00;
      const payments: PaymentTenderLine[] = [
        { mode: "UPI", amount: 500.00, reference_no: "UTR987654321012" },
      ];

      const res = await billingTenderService.validatePaymentLines(grandTotal, payments, null, mockSettings);
      expect(res.valid).toBe(true);
    });

    it("blocks credit (Udhari) tender for walk-in customer", async () => {
      const grandTotal = 750.00;
      const payments: PaymentTenderLine[] = [
        { mode: "Cash", amount: 250.00 },
        { mode: "Credit", amount: 500.00 },
      ];

      // No named customer
      const res = await billingTenderService.validatePaymentLines(grandTotal, payments, null, mockSettings);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Credit (Udhari) sale is not allowed for Walk-in Customers");
    });

    it("allows credit tender for named customer within credit limit", async () => {
      const grandTotal = 750.00;
      const payments: PaymentTenderLine[] = [
        { mode: "Cash", amount: 250.00 },
        { mode: "Credit", amount: 500.00 },
      ];

      const customer = {
        id: "cust_123",
        name: "Rahul Sharma",
        credit_limit: 2000.00,
        current_balance: 300.00,
      };

      const res = await billingTenderService.validatePaymentLines(grandTotal, payments, customer, mockSettings);
      expect(res.valid).toBe(true);
    });

    it("blocks credit tender when customer credit limit is exceeded and store policy is 'block'", async () => {
      const grandTotal = 750.00;
      const payments: PaymentTenderLine[] = [
        { mode: "Credit", amount: 750.00 },
      ];

      const customer = {
        id: "cust_123",
        name: "Rahul Sharma",
        credit_limit: 1000.00,
        current_balance: 500.00, // 500 + 750 = 1250 > 1000
      };

      const res = await billingTenderService.validatePaymentLines(grandTotal, payments, customer, mockSettings);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Credit limit exceeded");
    });

    it("permits credit tender with warning when store policy is 'warn'", async () => {
      const grandTotal = 750.00;
      const payments: PaymentTenderLine[] = [
        { mode: "Credit", amount: 750.00 },
      ];

      const customer = {
        id: "cust_123",
        name: "Rahul Sharma",
        credit_limit: 1000.00,
        current_balance: 500.00,
      };

      const warnSettings: PaymentSettingsConfig = {
        ...mockSettings,
        creditPolicy: "warn",
      };

      const res = await billingTenderService.validatePaymentLines(grandTotal, payments, customer, warnSettings);
      expect(res.valid).toBe(true);
      expect(res.warning).toContain("Credit limit exceeded");
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

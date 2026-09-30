import { describe, it, expect } from "vitest";
import {
  calculateLineTotals,
  calculateInvoiceTotals,
  computeAutoRoundOff,
  splitNetByGstMode,
  calculateLineGross,
  type BillingLineInput,
} from "./billingCalculations";

describe("Billing & Indian GST Calculation Engine (POS-002, POS-003, POS-004, NFR-COMP-01)", () => {
  describe("splitNetByGstMode", () => {
    it("computes inclusive GST accurately (Retail mode)", () => {
      // Net ₹105.00 with 5% GST -> Taxable ₹100.00, Tax ₹5.00
      const res = splitNetByGstMode(105, 5, true);
      expect(res.taxable).toBe(100);
      expect(res.tax).toBe(5);
      expect(res.total).toBe(105);
    });

    it("computes exclusive GST accurately (Wholesale mode)", () => {
      // Net ₹100.00 with 5% GST -> Taxable ₹100.00, Tax ₹5.00, Total ₹105.00
      const res = splitNetByGstMode(100, 5, false);
      expect(res.taxable).toBe(100);
      expect(res.tax).toBe(5);
      expect(res.total).toBe(105);
    });
  });

  describe("calculateLineGross & Loose Quantity", () => {
    it("calculates loose tablet rate accurately based on pack conversion", () => {
      // Strip of 10 tablets @ ₹30. Selling 4 loose tablets = (4/10) * 30 = ₹12.00
      const line: BillingLineInput = {
        qty: 0,
        loose_qty: 4,
        units_per_pack: 10,
        unit_price: 30,
        gst_percent: 12,
      };

      const gross = calculateLineGross(line);
      expect(gross).toBe(12.0);
    });

    it("calculates combined full pack + loose tablet gross", () => {
      // 2 full packs + 5 loose tablets from 10-pack @ ₹50/pack = (2 * 50) + (5/10 * 50) = 100 + 25 = ₹125.00
      const line: BillingLineInput = {
        qty: 2,
        loose_qty: 5,
        units_per_pack: 10,
        unit_price: 50,
        gst_percent: 5,
      };

      const gross = calculateLineGross(line);
      expect(gross).toBe(125.0);
    });
  });

  describe("Rate Basis Overrides", () => {
    it("treats MRP as strictly GST-inclusive even in exclusive store mode", () => {
      const line: BillingLineInput = {
        qty: 1,
        unit_price: 112,
        mrp: 112,
        gst_percent: 12,
        rate_basis: "mrp",
      };

      // In exclusive store mode, MRP must remain inclusive
      const res = calculateLineTotals(line, "exclusive");
      expect(res.taxable_amount).toBe(100);
      expect(res.total_tax).toBe(12);
      expect(res.total_amount).toBe(112);
    });

    it("treats PTR as strictly GST-exclusive even in inclusive store mode", () => {
      const line: BillingLineInput = {
        qty: 1,
        unit_price: 100,
        ptr: 100,
        gst_percent: 18,
        rate_basis: "ptr",
      };

      // In inclusive store mode, PTR must remain exclusive
      const res = calculateLineTotals(line, "inclusive");
      expect(res.taxable_amount).toBe(100);
      expect(res.total_tax).toBe(18);
      expect(res.total_amount).toBe(118);
    });
  });

  describe("Indian Statutory Auto Round-Off", () => {
    it("rounds down to nearest whole rupee when fraction < 0.50", () => {
      const ro = computeAutoRoundOff(142.4);
      expect(ro.grandTotal).toBe(142);
      expect(ro.roundOff).toBe(-0.4);
    });

    it("rounds up to nearest whole rupee when fraction >= 0.50", () => {
      const ro = computeAutoRoundOff(142.5);
      expect(ro.grandTotal).toBe(143);
      expect(ro.roundOff).toBe(0.5);
    });
  });

  describe("Invoice Totals & Multi-Rate Aggregation", () => {
    it("aggregates multiple items across 5%, 12%, and 18% GST brackets with auto round-off", () => {
      const lines: BillingLineInput[] = [
        {
          qty: 1,
          unit_price: 105, // 5% inclusive -> Taxable 100, Tax 5
          gst_percent: 5,
        },
        {
          qty: 1,
          unit_price: 112, // 12% inclusive -> Taxable 100, Tax 12
          gst_percent: 12,
        },
        {
          qty: 1,
          unit_price: 118, // 18% inclusive -> Taxable 100, Tax 18
          gst_percent: 18,
        },
      ];

      const totals = calculateInvoiceTotals(lines, { type: "amount", value: 0 }, "inclusive", false, true);

      expect(totals.taxable_subtotal).toBe(300);
      expect(totals.total_tax).toBe(35);
      expect(totals.cgst_total).toBe(17.5);
      expect(totals.sgst_total).toBe(17.5);
      expect(totals.net_before_round).toBe(335);
      expect(totals.round_off).toBe(0);
      expect(totals.grand_total).toBe(335);
    });

    it("scales tax proportionally when an overall bill discount is applied", () => {
      const lines: BillingLineInput[] = [
        {
          qty: 1,
          unit_price: 118, // Taxable 100, Tax 18
          gst_percent: 18,
        },
      ];

      // ₹10 discount applied to bill
      const totals = calculateInvoiceTotals(lines, { type: "amount", value: 10 }, "inclusive", false, false);

      expect(totals.taxable_subtotal).toBe(100);
      expect(totals.bill_discount_amount).toBe(10);
      // Net taxable is 90. Tax scaled by 90/100 -> 18 * 0.9 = 16.2
      expect(totals.total_tax).toBe(16.2);
      expect(totals.grand_total).toBe(106.2);
    });
  });
});

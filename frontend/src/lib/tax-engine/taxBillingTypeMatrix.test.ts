import { describe, it, expect } from "vitest";
import { calculateDocumentTaxes, type TaxEngineDocumentInput } from "./taxEngine";
import { calculateLineTotals, calculateInvoiceTotals } from "../billing/billingCalculations";
import { posCartService } from "../billing/posCartService";

describe("Phase 3: Tax Engine & Billing Types Matrix Verification", () => {
  describe("1. Regular GST - Intrastate & Interstate with Mixed Rates & Round-off", () => {
    it("computes intrastate tax-inclusive lines with mixed rates and Section 170 round-off", () => {
      const input: TaxEngineDocumentInput = {
        store_state: "32",
        place_of_supply: "32",
        default_tax_mode: "inclusive",
        gst_type: "regular",
        lines: [
          {
            line_id: "L1",
            product_name: "Item 5%",
            qty: 2,
            unit_price: 105, // 210 gross inclusive 5%
            gst_percent: 5,
            cess_percent: 0,
          },
          {
            line_id: "L2",
            product_name: "Item 12%",
            qty: 1,
            unit_price: 224, // 224 gross inclusive 12%
            gst_percent: 12,
            cess_percent: 0,
          },
          {
            line_id: "L3",
            product_name: "Item 18% with line disc",
            qty: 3,
            unit_price: 118, // 354 gross, minus 10% disc = 318.60 -> 319 net
            discount_percent: 10,
            gst_percent: 18,
            cess_percent: 0,
          },
          {
            line_id: "L4",
            product_name: "Item 28% with Cess 12%",
            qty: 1,
            unit_price: 140, // inclusive 40% total
            gst_percent: 28,
            cess_percent: 12,
          },
        ],
        bill_discount: { type: "amount", value: 15 },
        auto_round_off: true,
      };

      const result = calculateDocumentTaxes(input);

      expect(result.document_title).toBe("Tax Invoice");
      expect(result.is_composition).toBe(false);
      expect(result.is_inter_state).toBe(false);

      // Verify that every line has equal CGST and SGST and 0 IGST
      for (const line of result.lines) {
        expect(line.cgst_amount).toBeGreaterThanOrEqual(0);
        expect(line.sgst_amount).toBeGreaterThanOrEqual(0);
        expect(Math.abs(line.cgst_amount - line.sgst_amount)).toBeLessThanOrEqual(0.02);
        expect(line.igst_amount).toBe(0);
        expect(line.total_tax).toBeCloseTo(line.cgst_amount + line.sgst_amount + line.cess_amount, 2);
        expect(line.total_amount).toBeCloseTo(line.taxable_amount + line.total_tax, 2);
      }

      // Check Cess is tracked on L4
      const l4 = result.lines.find((l) => l.line_id === "L4");
      expect(l4?.cess_amount).toBeGreaterThan(0);
      expect(result.cess_total).toBeGreaterThan(0);

      // Invariant: sum of lines equals subtotal to the paisa
      const sumLineTaxable = Math.round(result.lines.reduce((s, l) => s + l.taxable_amount, 0) * 100) / 100;
      const sumLineTax = Math.round(result.lines.reduce((s, l) => s + l.total_tax, 0) * 100) / 100;
      expect(sumLineTaxable).toBe(result.taxable_subtotal);
      expect(sumLineTax).toBe(result.total_tax);

      // Round-off ties out to exact rupee
      expect(result.grand_total).toBe(Math.round(result.net_before_round));
      expect(Math.round((result.net_before_round + result.round_off) * 100) / 100).toBe(result.grand_total);
    });

    it("computes interstate tax-exclusive lines with IGST only", () => {
      const input: TaxEngineDocumentInput = {
        store_state: "32",
        customer_gstin: "27AABCU9603R1ZM", // Maharashtra
        default_tax_mode: "exclusive",
        gst_type: "regular",
        lines: [
          {
            line_id: "L1",
            qty: 10,
            unit_price: 100,
            gst_percent: 18,
          },
        ],
        auto_round_off: true,
      };

      const result = calculateDocumentTaxes(input);

      expect(result.is_inter_state).toBe(true);
      expect(result.cgst_total).toBe(0);
      expect(result.sgst_total).toBe(0);
      expect(result.igst_total).toBe(180);
      expect(result.total_tax).toBe(180);
      expect(result.taxable_subtotal).toBe(1000);
      expect(result.grand_total).toBe(1180);
      expect(result.document_title).toBe("Tax Invoice");
    });
  });

  describe("2. Composition Scheme & Unregistered (Bill of Supply)", () => {
    it("forces tax lines to 0 and issues Bill of Supply under composition scheme", () => {
      const input: TaxEngineDocumentInput = {
        store_state: "32",
        place_of_supply: "32",
        gst_type: "composition",
        lines: [
          {
            line_id: "L1",
            product_name: "Goods A",
            qty: 5,
            unit_price: 200,
            gst_percent: 18, // Even if product catalog has 18%, composition charges 0%
            cess_percent: 12,
          },
          {
            line_id: "L2",
            product_name: "Goods B",
            qty: 2,
            unit_price: 500,
            discount_percent: 10,
            gst_percent: 28,
          },
        ],
        bill_discount: { type: "amount", value: 50 },
        auto_round_off: true,
      };

      const result = calculateDocumentTaxes(input);

      expect(result.document_title).toBe("Bill of Supply");
      expect(result.is_composition).toBe(true);
      expect(result.total_tax).toBe(0);
      expect(result.cgst_total).toBe(0);
      expect(result.sgst_total).toBe(0);
      expect(result.igst_total).toBe(0);
      expect(result.cess_total).toBe(0);

      for (const line of result.lines) {
        expect(line.gst_rate).toBe(0);
        expect(line.cgst_amount).toBe(0);
        expect(line.sgst_amount).toBe(0);
        expect(line.igst_amount).toBe(0);
        expect(line.cess_amount).toBe(0);
        expect(line.total_tax).toBe(0);
        expect(line.total_amount).toBe(line.taxable_amount);
      }

      // 5 * 200 = 1000
      // 2 * 500 - 100 = 900
      // Total gross - line disc = 1900
      // Bill discount = 50 -> 1850 net
      expect(result.grand_total).toBe(1850);
    });

    it("handles unregistered / no_tax store issuing Bill of Supply", () => {
      const input: TaxEngineDocumentInput = {
        store_state: "32",
        gst_type: "no_tax",
        lines: [
          {
            line_id: "L1",
            qty: 1,
            unit_price: 350,
            gst_percent: 12,
          },
        ],
      };

      const result = calculateDocumentTaxes(input);
      expect(result.document_title).toBe("Bill of Supply");
      expect(result.total_tax).toBe(0);
      expect(result.grand_total).toBe(350);
    });
  });

  describe("3. POS Cart Service Tax Settings & Per-Bill Override", () => {
    it("respects store settings defaults and toggles via per-bill override", () => {
      posCartService.clearCart();

      // Configure store as regular GST
      posCartService.setStoreTaxSettings({
        taxMode: "inclusive",
        storeState: "32",
        gstType: "regular",
        allowTaxOverride: true,
      });

      const initialActive = posCartService.getActiveTaxMode();
      expect(initialActive.documentTitle).toBe("Tax Invoice");
      expect(initialActive.isComposition).toBe(false);
      expect(initialActive.isOverridden).toBe(false);

      // Override active bill to composition
      posCartService.setTaxOverride({
        gstType: "composition",
      });

      const overriddenActive = posCartService.getActiveTaxMode();
      expect(overriddenActive.documentTitle).toBe("Bill of Supply");
      expect(overriddenActive.isComposition).toBe(true);
      expect(overriddenActive.isOverridden).toBe(true);

      // Clearing cart resets override back to store setting
      posCartService.clearCart();
      const resetActive = posCartService.getActiveTaxMode();
      expect(resetActive.documentTitle).toBe("Tax Invoice");
      expect(resetActive.isComposition).toBe(false);
      expect(resetActive.isOverridden).toBe(false);
    });
  });

  describe("4. Place of Supply Rules Invariant", () => {
    it("correctly handles interstate transition when customer GSTIN or POS changes", () => {
      const sameStateTotals = calculateInvoiceTotals(
        [{ qty: 1, unit_price: 100, gst_percent: 18 }],
        { type: "amount", value: 0 },
        { storeState: "32", placeOfSupply: "32-Kerala", gstType: "regular", companyTaxMode: "exclusive" }
      );
      expect(sameStateTotals.cgst_total).toBe(9);
      expect(sameStateTotals.sgst_total).toBe(9);
      expect(sameStateTotals.igst_total).toBe(0);

      const interStateTotals = calculateInvoiceTotals(
        [{ qty: 1, unit_price: 100, gst_percent: 18 }],
        { type: "amount", value: 0 },
        { storeState: "32", placeOfSupply: "29-Karnataka", gstType: "regular", companyTaxMode: "exclusive" }
      );
      expect(interStateTotals.cgst_total).toBe(0);
      expect(interStateTotals.sgst_total).toBe(0);
      expect(interStateTotals.igst_total).toBe(18);
    });
  });
});

import { describe, it, expect } from "vitest";
import { calculateDocumentTaxes, type TaxEngineDocumentInput } from "./taxEngine";
import testVectors from "../../../../specs/gst_tax_test_vectors.json";

describe("Authoritative TaxEngine Statutory GST Test Vectors", () => {
  for (const tc of testVectors.test_cases) {
    it(`should match statutory vector: [${tc.id}] ${tc.name}`, () => {
      const input: TaxEngineDocumentInput = {
        store_state: tc.store_state,
        customer_gstin: tc.customer_gstin,
        place_of_supply: tc.place_of_supply,
        default_tax_mode: tc.tax_mode as any,
        lines: tc.lines.map((l: any) => ({
          line_id: l.line_id,
          product_name: l.product_name,
          hsn_code: l.hsn_code,
          qty: l.qty,
          loose_qty: l.loose_qty,
          units_per_pack: l.units_per_pack,
          unit_price: l.unit_price,
          rate_basis: l.rate_basis,
          discount_percent: l.discount_percent,
          discount_amount: l.discount_amount,
          gst_percent: l.gst_percent,
          cess_percent: l.cess_percent,
        })),
        bill_discount: tc.bill_discount as any,
        auto_round_off: tc.auto_round_off,
      };

      const result = calculateDocumentTaxes(input);

      // Verify line items
      expect(result.lines.length).toBe(tc.expected_lines.length);
      for (let i = 0; i < tc.expected_lines.length; i++) {
        const exp = tc.expected_lines[i];
        const act = result.lines[i];

        expect(act.line_id).toBe(exp.line_id);
        expect(act.gross_amount).toBeCloseTo(exp.gross_amount, 2);
        expect(act.line_discount).toBeCloseTo(exp.line_discount, 2);
        expect(act.allocated_bill_discount).toBeCloseTo(exp.allocated_bill_discount, 2);
        expect(act.taxable_amount).toBeCloseTo(exp.taxable_amount, 2);
        expect(act.cgst_rate).toBeCloseTo(exp.cgst_rate, 2);
        expect(act.cgst_amount).toBeCloseTo(exp.cgst_amount, 2);
        expect(act.sgst_rate).toBeCloseTo(exp.sgst_rate, 2);
        expect(act.sgst_amount).toBeCloseTo(exp.sgst_amount, 2);
        expect(act.igst_rate).toBeCloseTo(exp.igst_rate, 2);
        expect(act.igst_amount).toBeCloseTo(exp.igst_amount, 2);
        expect(act.cess_amount).toBeCloseTo(exp.cess_amount, 2);
        expect(act.total_tax).toBeCloseTo(exp.total_tax, 2);
        expect(act.total_amount).toBeCloseTo(exp.total_amount, 2);
      }

      // Verify invoice totals
      const expTot = tc.expected_totals;
      expect(result.gross_subtotal).toBeCloseTo(expTot.gross_subtotal, 2);
      expect(result.line_discount_total).toBeCloseTo(expTot.line_discount_total, 2);
      expect(result.bill_discount_total).toBeCloseTo(expTot.bill_discount_total, 2);
      expect(result.taxable_subtotal).toBeCloseTo(expTot.taxable_subtotal, 2);
      expect(result.cgst_total).toBeCloseTo(expTot.cgst_total, 2);
      expect(result.sgst_total).toBeCloseTo(expTot.sgst_total, 2);
      expect(result.igst_total).toBeCloseTo(expTot.igst_total, 2);
      expect(result.cess_total).toBeCloseTo(expTot.cess_total, 2);
      expect(result.total_tax).toBeCloseTo(expTot.total_tax, 2);
      expect(result.net_before_round).toBeCloseTo(expTot.net_before_round, 2);
      expect(result.round_off).toBeCloseTo(expTot.round_off, 2);
      expect(result.grand_total).toBeCloseTo(expTot.grand_total, 2);

      // Verify mathematical invariant: sum of line items == document totals
      const sumLineTaxable = Math.round(result.lines.reduce((s, l) => s + l.taxable_amount, 0) * 100) / 100;
      const sumLineCgst = Math.round(result.lines.reduce((s, l) => s + l.cgst_amount, 0) * 100) / 100;
      const sumLineSgst = Math.round(result.lines.reduce((s, l) => s + l.sgst_amount, 0) * 100) / 100;
      const sumLineIgst = Math.round(result.lines.reduce((s, l) => s + l.igst_amount, 0) * 100) / 100;
      const sumLineCess = Math.round(result.lines.reduce((s, l) => s + l.cess_amount, 0) * 100) / 100;
      const sumLineTotals = Math.round(result.lines.reduce((s, l) => s + l.total_amount, 0) * 100) / 100;

      expect(sumLineTaxable).toBe(result.taxable_subtotal);
      expect(sumLineCgst).toBe(result.cgst_total);
      expect(sumLineSgst).toBe(result.sgst_total);
      expect(sumLineIgst).toBe(result.igst_total);
      expect(sumLineCess).toBe(result.cess_total);
      expect(Math.round((sumLineTotals + result.round_off) * 100) / 100).toBe(result.grand_total);
    });
  }
});

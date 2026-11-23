import { describe, it, expect } from "vitest";
import { calculateDocumentTaxes, type TaxEngineDocumentInput, type TaxEngineLineInput } from "./taxEngine";
import testVectors from "../../../../specs/gst_tax_test_vectors.json";

const CHARGE_TOTAL_KEYS = [
  "charge_taxable_total",
  "charge_tax_total",
  "charge_total",
  "separate_charge_taxable_total",
  "separate_charge_tax_total",
  "separate_charge_total",
  "landed_cost_addition",
  "expense_charge_total",
  "creditable_input_tax_total",
  "non_creditable_tax_total",
  "reconciliation_identity_delta",
] as const;

const CHARGE_MONEY_KEYS = [
  "taxable_amount",
  "cgst_amount",
  "sgst_amount",
  "igst_amount",
  "cess_amount",
  "total_tax",
  "total_amount",
  "creditable_tax",
  "non_creditable_tax",
  "expense_posting",
] as const;

const CHARGE_FLAG_KEYS = ["spread_basis_used", "spread_fallback_reason", "in_payable", "is_rcm"] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

describe("Authoritative TaxEngine Statutory GST Test Vectors", () => {
  for (const tc of testVectors.test_cases as any[]) {
    it(`should match statutory vector: [${tc.id}] ${tc.name}`, () => {
      const input: TaxEngineDocumentInput = {
        store_state: tc.store_state,
        customer_gstin: tc.customer_gstin,
        place_of_supply: tc.place_of_supply,
        default_tax_mode: tc.tax_mode as any,
        // Pass each vector line through untouched, as the PHP harness does: an enumerated
        // copy silently drops whatever key a future vector adds (free_qty once did).
        lines: tc.lines.map((l: any) => ({ ...l })) as TaxEngineLineInput[],
        bill_discount: tc.bill_discount as any,
        charges: (tc.charges ?? []) as any[],
        // CR-C-11: the payable policy is a document-level input, so a vector states it.
        separately_paid_in_payable: tc.separately_paid_in_payable ?? false,
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

        for (const key of ["charge_allocation", "landed_amount", "landed_unit_cost"]) {
          if (exp[key] !== undefined) {
            expect((act as any)[key], `${key} in line ${i}`).toBeCloseTo(exp[key], 2);
          }
        }

        // PUR-002: the effective unit cost carries the charge allocation too.
        if (exp.landed_unit_cost !== undefined) {
          expect(act.effective_unit_cost, `effective_unit_cost in line ${i}`).toBeCloseTo(act.landed_unit_cost!, 2);
        }
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

      for (const key of CHARGE_TOTAL_KEYS) {
        if (expTot[key] !== undefined) {
          expect((result as any)[key], key).toBeCloseTo(expTot[key], 2);
        }
      }

      // Verify charge rows and their paisa allocations
      const expectedCharges = tc.expected_charges ?? [];
      expect(result.charges.length).toBe(expectedCharges.length);
      for (let i = 0; i < expectedCharges.length; i++) {
        const exp = expectedCharges[i];
        const act = result.charges[i] as any;

        expect(act.charge_id).toBe(exp.charge_id);
        for (const key of CHARGE_MONEY_KEYS) {
          if (exp[key] !== undefined) {
            expect(act[key], `${key} in charge ${i}`).toBeCloseTo(exp[key], 2);
          }
        }
        for (const key of CHARGE_FLAG_KEYS) {
          if (exp[key] !== undefined) {
            expect(act[key], `${key} in charge ${i}`).toBe(exp[key]);
          }
        }
        if (exp.lines_without_weight !== undefined) {
          expect(act.lines_without_weight).toEqual(exp.lines_without_weight);
        }

        expect(act.allocations.length).toBe(exp.allocations.length);
        for (let j = 0; j < exp.allocations.length; j++) {
          expect(act.allocations[j].line_id).toBe(exp.allocations[j].line_id);
          expect(act.allocations[j].allocated_amount).toBeCloseTo(exp.allocations[j].allocated_amount, 2);
          if (exp.allocations[j].is_remainder_paisa !== undefined) {
            expect(act.allocations[j].is_remainder_paisa).toBe(exp.allocations[j].is_remainder_paisa);
          }
        }

        if (act.treatment === "add_to_cost") {
          const sumAlloc = act.allocations.reduce((s: number, a: any) => s + a.allocated_amount, 0);
          expect(round2(sumAlloc)).toBe(round2(act.taxable_amount + act.non_creditable_tax));
        }
      }

      if (result.charges.length > 0) {
        const sumLineAlloc = round2(result.lines.reduce((s, l) => s + ((l as any).charge_allocation || 0), 0));
        expect(sumLineAlloc).toBe(result.landed_cost_addition);
        expect(result.reconciliation_identity_delta).toBeCloseTo(0, 2);
      }

      // Invariant: lines + payable charges + round-off == document totals
      const sumLineTaxable = round2(result.lines.reduce((s, l) => s + l.taxable_amount, 0));
      const sumLineCgst = round2(result.lines.reduce((s, l) => s + l.cgst_amount, 0));
      const sumLineSgst = round2(result.lines.reduce((s, l) => s + l.sgst_amount, 0));
      const sumLineIgst = round2(result.lines.reduce((s, l) => s + l.igst_amount, 0));
      const sumLineCess = round2(result.lines.reduce((s, l) => s + l.cess_amount, 0));
      const sumLineTotals = round2(result.lines.reduce((s, l) => s + l.total_amount, 0));

      const payable = result.charges.filter((c) => c.in_payable);
      const sumChargeCgst = round2(payable.reduce((s, c) => s + c.cgst_amount, 0));
      const sumChargeSgst = round2(payable.reduce((s, c) => s + c.sgst_amount, 0));
      const sumChargeIgst = round2(payable.reduce((s, c) => s + c.igst_amount, 0));
      const sumChargeCess = round2(payable.reduce((s, c) => s + c.cess_amount, 0));
      const sumChargeTotals = round2(payable.reduce((s, c) => s + c.total_amount, 0));

      expect(sumLineTaxable).toBe(result.taxable_subtotal);
      expect(round2(sumLineCgst + sumChargeCgst)).toBe(result.cgst_total);
      expect(round2(sumLineSgst + sumChargeSgst)).toBe(result.sgst_total);
      expect(round2(sumLineIgst + sumChargeIgst)).toBe(result.igst_total);
      expect(round2(sumLineCess + sumChargeCess)).toBe(result.cess_total);
      expect(round2(sumLineTotals + sumChargeTotals + result.round_off)).toBe(result.grand_total);

      const sumHsnTaxable = round2(result.hsn_summary.reduce((s, h) => s + h.taxable_value, 0));
      expect(sumHsnTaxable).toBe(round2(sumLineTaxable + result.charge_taxable_total));
    });
  }
});

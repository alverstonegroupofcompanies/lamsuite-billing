import { describe, expect, it } from "vitest";
import {
  expenseRegister,
  expenseRegisterTotals,
  type ExpenseRegisterBill,
  type ManualExpenseRecord,
} from "./expenseRegister";
import type { PurchaseChargeRecord } from "./purchaseChargeRegister";

/**
 * CR-C / REP-008 on the till. The register's promise is that one rupee of expense appears exactly
 * once — so these tests read the same bill the posting path wrote (`chargePosting.ts`), with the
 * `EXP-PC-…` twin present in `expenses`, and check the twin never joins its own charge.
 */

const charge = (over: Partial<PurchaseChargeRecord>): PurchaseChargeRecord => ({
  id: "c1",
  purchase_id: "p1",
  seq: 1,
  head_code: "PACKING",
  head_name: "Packing",
  note: null,
  treatment: "expense",
  spread_method: "value",
  spread_basis_used: "value",
  itc_eligibility: "eligible",
  is_rcm: 0,
  paid_separately: 0,
  paid_to_label: null,
  sac_code: "990599",
  amount: 100,
  gst_percent: 18,
  taxable_amount: 100,
  cgst_amount: 9,
  sgst_amount: 9,
  igst_amount: 0,
  cess_amount: 0,
  total_amount: 118,
  allocated_amount: 0,
  source: "manual",
  reversed_amount: 0,
  created_at: Date.parse("2026-11-15T06:00:00.000Z"),
  ...over,
});

const bill = (over: Partial<ExpenseRegisterBill>): ExpenseRegisterBill => ({
  id: "p1",
  purchase_number: "PB-1",
  supplier_name: "Alverstone Drug House",
  supplier_invoice_no: "ADH-26-27-0001",
  purchase_date: "2026-11-15",
  status: "received",
  ...over,
});

const manual = (over: Partial<ManualExpenseRecord>): ManualExpenseRecord => ({
  id: "exp_1",
  expense_number: "EXP-00001",
  expense_head: "Shop Rent",
  amount: 350,
  payment_mode: "Cash",
  expense_date: "2026-11-10",
  created_at: Date.parse("2026-11-10T06:00:00.000Z"),
  ...over,
});

describe("expenseRegister", () => {
  it("posts an expense-treated charge at its ex-tax amount and keeps its tax as input", () => {
    const result = expenseRegister([bill({})], [charge({})], [], {
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    });

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row).toMatchObject({
      source: "purchase_charge",
      date: "2026-11-15",
      head: "Packing",
      purchase_number: "ADH-26-27-0001",
      taxable_amount: 100,
      tax_amount: 18,
      creditable_tax: 18,
      non_creditable_tax: 0,
      // PUR-012's decision: the register takes the ex-tax rupee; the GST is tracked as input tax.
      amount: 100,
      payment_mode: "On Account",
      in_payable: true,
    });
    expect(result.reconciliation.balanced).toBe(true);
  });

  it("moves a blocked head's whole tax into the posting, all-or-nothing like the engines", () => {
    const [row] = expenseRegister(
      [bill({})],
      [charge({ id: "c2", itc_eligibility: "blocked" })],
      [],
      {}
    ).rows;

    expect(row).toMatchObject({
      creditable: false,
      creditable_tax: 0,
      non_creditable_tax: 18,
      amount: 118,
    });
  });

  it("lists a separately-paid charge as expense but keeps it out of the payable", () => {
    const result = expenseRegister(
      [bill({})],
      [
        charge({
          id: "c3",
          head_code: "OTHER",
          head_name: "Other",
          taxable_amount: 500,
          amount: 500,
          cgst_amount: 45,
          sgst_amount: 45,
          total_amount: 590,
          itc_eligibility: "ineligible",
          paid_separately: 1,
          paid_to_label: "Ganga Courier",
        }),
      ],
      [],
      {}
    );

    const row = result.rows[0];
    expect(row).toMatchObject({
      taxable_amount: 500,
      tax_amount: 90,
      non_creditable_tax: 90,
      amount: 590,
      paid_separately: true,
      in_payable: false,
      paid_to_label: "Ganga Courier",
    });
    // The twin the till wrote carries the real payment mode, so the register reads through it.
    const withTwin = expenseRegister(
      [bill({})],
      [charge({ id: "c3", paid_separately: 1 })],
      [manual({ id: "exp_pc", expense_number: "EXP-PC-p1-1", purchase_charge_id: "c3", payment_mode: "UPI" })],
      {}
    );
    expect(withTwin.rows[0].payment_mode).toBe("UPI");
    expect(withTwin.rows[0].expense_number).toBe("EXP-PC-p1-1");
  });

  it("never counts a charge's own expense twin twice", () => {
    const twin = manual({
      id: "exp_pc",
      expense_number: "EXP-PC-p1-1",
      expense_head: "Packing",
      amount: 100,
      payment_mode: "On Account",
      purchase_charge_id: "c1",
    });

    const result = expenseRegister([bill({})], [charge({})], [twin], {});
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].source).toBe("purchase_charge");
    expect(result.totals.postings).toBe(100);
  });

  it("keeps manual entries beside the charges and foots both", () => {
    const result = expenseRegister(
      [bill({})],
      [charge({})],
      [manual({}), manual({ id: "exp_2", expense_number: "EXP-00002", expense_head: "Electricity", amount: 500 })],
      {}
    );

    expect(result.rows.map((row) => row.head)).toEqual(["Electricity", "Shop Rent", "Packing"]);
    expect(result.totals).toMatchObject({
      rows: 3,
      postings: 950,
      manual_postings: 850,
      charge_postings: 100,
      taxable: 950,
      tax: 18,
      creditable_tax: 18,
    });
  });

  it("leaves a cancelled bill's charges out of the register", () => {
    const result = expenseRegister(
      [bill({ status: "cancelled" })],
      [charge({})],
      [manual({})],
      {}
    );

    expect(result.rows.map((row) => row.source)).toEqual(["manual"]);
  });

  it("filters by head and by source", () => {
    const charges = [
      charge({}),
      charge({ id: "c4", head_code: "FREIGHT", head_name: "Freight", taxable_amount: 200, amount: 200 }),
    ];

    expect(expenseRegister([bill({})], charges, [], { head: "pack" }).rows).toHaveLength(1);
    expect(expenseRegister([bill({})], charges, [], { head: "FREIGHT" }).rows).toHaveLength(1);
    expect(
      expenseRegister([bill({})], charges, [manual({})], { source: "purchase_charge" }).rows
    ).toHaveLength(2);
    expect(
      expenseRegister([bill({})], charges, [manual({})], { source: "manual" }).rows
    ).toHaveLength(1);
  });

  it("applies the period to the bill date for charges and the voucher date for expenses", () => {
    const result = expenseRegister(
      [bill({})],
      [charge({})],
      [manual({})],
      { startDate: "2026-11-11", endDate: "2026-11-30" }
    );

    expect(result.rows.map((row) => row.source)).toEqual(["purchase_charge"]);
  });

  it("foots a narrowed search view with the same math as the register", () => {
    const result = expenseRegister([bill({})], [charge({})], [manual({})], {});
    const narrowed = result.rows.filter((row) => row.source === "manual");

    expect(expenseRegisterTotals(narrowed)).toMatchObject({ rows: 1, postings: 350, tax: 0 });
  });

  it("reads the payable answer stored with the charge, not today's policy (PUR-016)", () => {
    // Money the clerk handed the courier himself, billed into the supplier's payable by the
    // store's switch: who was paid is a different fact from what is owed, so only the column moves.
    const inside = expenseRegister(
      [bill({})],
      [charge({ id: "c5", paid_separately: 1, in_payable: 1, paid_to_label: "Ganga Courier" })],
      [],
      {}
    );

    expect(inside.rows[0]).toMatchObject({
      paid_separately: true,
      in_payable: true,
      payment_mode: "Paid Separately",
    });
    expect(inside.totals.separately_paid_postings).toBe(100);
    expect(inside.reconciliation.delta).toBe(0);

    // A row written before the flag existed carries no answer, so the register derives the one the
    // migration backfilled for it.
    expect(
      expenseRegister([bill({})], [charge({ id: "c6", paid_separately: 1 })], [], {}).rows[0].in_payable
    ).toBe(false);
    // The stored answer wins both ways, including a supplier-borne line billed outside the payable.
    expect(
      expenseRegister([bill({})], [charge({ id: "c7", in_payable: 0 })], [], {}).rows[0].in_payable
    ).toBe(false);

    expect(inside.totals.postings).toBe(
      expenseRegister([bill({})], [charge({ id: "c6", paid_separately: 1 })], [], {}).totals.postings
    );
  });
});

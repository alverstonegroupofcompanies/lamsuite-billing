import { describe, expect, it } from "vitest";
import {
  chargeHeadsLabel,
  chargeRowsFor,
  indexChargeRegister,
  purchaseChargeSummary,
  storedInPayable,
  type PurchaseChargeRecord,
} from "./purchaseChargeRegister";

/**
 * CR-C / REP-007 on the till. The register is a *reading* of the bill, so these tests pin the
 * reading against the numbers the shared engine already posted — the ₹11,554 worked example, a
 * head paid outside the bill, and a pre-CR-C bill that owns nothing but a freight scalar.
 */

const charge = (over: Partial<PurchaseChargeRecord>): PurchaseChargeRecord => ({
  id: "c1",
  purchase_id: "p1",
  seq: 1,
  head_code: "FREIGHT",
  head_name: "Freight",
  note: null,
  treatment: "add_to_cost",
  spread_method: "value",
  spread_basis_used: "value",
  itc_eligibility: "eligible",
  is_rcm: 0,
  paid_separately: 0,
  paid_to_label: null,
  sac_code: "996731",
  amount: 200,
  gst_percent: 18,
  taxable_amount: 200,
  cgst_amount: 18,
  sgst_amount: 18,
  igst_amount: 0,
  cess_amount: 0,
  total_amount: 236,
  allocated_amount: 200,
  source: "manual",
  reversed_amount: 0,
  ...over,
});

/** Goods 10,000@12 + freight 200@18 (add to cost) + packing 100@18 (expensed). */
const workedExample = {
  id: "p1",
  subtotal: 10000,
  tax_total: 1254,
  grand_total: 11554,
  round_off: 0,
  freight_charges: 0,
};

describe("purchaseChargeSummary", () => {
  it("takes the charge half out of the header instead of adding it to the goods", () => {
    const summary = purchaseChargeSummary(
      workedExample,
      [
        charge({ seq: 1 }),
        charge({
          id: "c2",
          seq: 2,
          head_code: "PACKING",
          head_name: "Packing",
          sac_code: null,
          treatment: "expense",
          amount: 100,
          taxable_amount: 100,
          cgst_amount: 9,
          sgst_amount: 9,
          total_amount: 118,
          allocated_amount: 0,
        }),
      ],
      200
    );

    expect(summary.goods_taxable).toBe(10000);
    // PUR-001: the header tax is goods + supplier-borne charge tax, so the register shows them apart.
    expect(summary.goods_tax).toBe(1200);
    expect(summary.charge_taxable).toBe(300);
    expect(summary.charge_tax).toBe(54);
    expect(summary.charge_total).toBe(354);
    // The reconciliation the plan asks for: goods + the tax the header posted + what the
    // supplier-borne charges cost = the payable. `charge_total` is already taxable + tax.
    expect(summary.goods_taxable + summary.goods_tax + summary.charge_total).toBe(11554);
    expect(summary.payable).toBe(11554);
    expect(summary.landed_value).toBe(10200);
    expect(summary.by_head.map((row) => row.head_code)).toEqual(["FREIGHT", "PACKING"]);
    expect(chargeHeadsLabel(summary.by_head)).toBe(
      "FREIGHT 200.00@18% in bill; PACKING 100.00@18% in bill"
    );
  });

  it("keeps money paid outside the bill out of the payable and the charge totals", () => {
    const summary = purchaseChargeSummary(
      { ...workedExample, tax_total: 1200, grand_total: 11200 },
      [
        charge({
          head_code: "OTHER",
          head_name: "Other",
          sac_code: null,
          treatment: "expense",
          paid_separately: 1,
          paid_to_label: "Ganga Courier",
          amount: 500,
          taxable_amount: 500,
          cgst_amount: 45,
          sgst_amount: 45,
          total_amount: 590,
        }),
      ],
      0
    );

    // PUR-013: the courier money never entered the payable, so it sits in its own block.
    expect(summary.charge_taxable).toBe(0);
    expect(summary.charge_total).toBe(0);
    expect(summary.separately_paid).toEqual({ taxable: 500, tax: 90, total: 590 });
    expect(summary.payable).toBe(11200);
    expect(summary.by_head[0].in_payable).toBe(false);
    expect(summary.by_head[0].payment).toBe("Paid Separately");
    expect(chargeHeadsLabel(summary.by_head)).toBe("OTHER 500.00@18% paid separately");
  });

  it("subtracts what a return already took back from the landed value", () => {
    const summary = purchaseChargeSummary(workedExample, [charge({ reversed_amount: 100 })], 200);

    // PUR-015: a half-reversed freight has only half its rupee still in cost.
    expect(summary.landed_value).toBe(10100);
    expect(summary.by_head[0].reversed).toBe(100);
  });
});

describe("chargeRowsFor", () => {
  it("shows a pre-CR-C freight scalar as one Freight head (PUR-017)", () => {
    const rows = chargeRowsFor({ id: "p9", subtotal: 1000, tax_total: 120, grand_total: 1620, freight_charges: 500 }, []);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      head_code: "FREIGHT",
      head_name: "Freight",
      taxable: 500,
      tax: 0,
      total: 500,
      source: "legacy_freight",
      in_payable: true,
    });

    // The same rupee is never counted twice: a bill that owns real rows ignores the scalar.
    expect(chargeRowsFor({ id: "p9", freight_charges: 500, subtotal: 1000 }, [charge({})])).toHaveLength(1);
    expect(chargeRowsFor({ id: "p9", freight_charges: 0, subtotal: 1000 }, [])).toHaveLength(0);
  });

  it("orders heads by seq regardless of the order rows were read in", () => {
    const rows = chargeRowsFor(workedExample, [charge({ id: "c2", seq: 2 }), charge({ id: "c1", seq: 1 })]);
    expect(rows.map((row) => row.seq)).toEqual([1, 2]);
  });
});

describe("indexChargeRegister", () => {
  it("places every bill's charges from three reads, not three per bill", () => {
    const bills = [workedExample, { id: "p2", subtotal: 500, tax_total: 60, grand_total: 560, freight_charges: 50 }];
    const index = indexChargeRegister(
      bills,
      [charge({ purchase_id: "p1" })],
      [
        { purchase_id: "p1", charge_allocation: 200 },
        { purchase_id: "p1", charge_allocation: 0.004 },
      ]
    );

    expect(index.byBill.get("p1")?.charge_total).toBe(236);
    expect(index.byBill.get("p1")?.landed_value).toBe(10200);
    expect(index.byBill.get("p2")?.by_head[0].source).toBe("legacy_freight");
    expect(index.rows).toHaveLength(2);
    expect(index.rows[1].bill.id).toBe("p2");
  });
});

describe("CR-C-11 stored payable membership (PUR-013, PUR-016)", () => {
  it("reads the answer stored with the charge instead of the answer a policy gives today", () => {
    // The same courier receipt, keyed while the store billed separately-paid money into the
    // payable: 200 + 36 sits beside the goods, so the header that was printed still foots.
    const summary = purchaseChargeSummary(
      { ...workedExample, tax_total: 1236, grand_total: 11436 },
      [charge({ paid_separately: 1, in_payable: 1, paid_to_label: "Ganga Courier" })],
      200
    );

    expect(summary.charge_taxable).toBe(200);
    expect(summary.charge_tax).toBe(36);
    expect(summary.charge_total).toBe(236);
    expect(summary.separately_paid).toEqual({ taxable: 0, tax: 0, total: 0 });
    expect(summary.goods_tax).toBe(1200);
    expect(summary.goods_taxable + summary.goods_tax + summary.charge_total).toBe(11436);

    // Who was paid is still the courier: the payment column never follows the payable.
    expect(summary.by_head[0]).toMatchObject({
      paid_separately: true,
      in_payable: true,
      payment: "Paid Separately",
    });
    // The CSV text the server prints for the same bill.
    expect(chargeHeadsLabel(summary.by_head)).toBe("FREIGHT 200.00@18% in bill");

    // Cost is untouched by the decision — the freight still spread onto the goods.
    expect(summary.landed_value).toBe(10200);
  });

  it("splits a bill that carries both a supplier-borne and a separately-paid head", () => {
    const summary = purchaseChargeSummary(
      { ...workedExample, tax_total: 1236, grand_total: 11436 },
      [
        charge({}),
        charge({
          id: "c2",
          seq: 2,
          head_code: "OTHER",
          head_name: "Other",
          sac_code: null,
          treatment: "expense",
          paid_separately: 1,
          in_payable: 0,
          amount: 50,
          taxable_amount: 50,
          cgst_amount: 4.5,
          sgst_amount: 4.5,
          total_amount: 59,
          allocated_amount: 0,
        }),
      ],
      200
    );

    expect(summary.charge_total).toBe(236);
    expect(summary.separately_paid).toEqual({ taxable: 50, tax: 9, total: 59 });
    expect(chargeHeadsLabel(summary.by_head)).toBe(
      "FREIGHT 200.00@18% in bill; OTHER 50.00@18% paid separately"
    );
  });

  it("derives the pre-flag answer for a row that stores none", () => {
    expect(storedInPayable({ paid_separately: 1 })).toBe(false);
    expect(storedInPayable({ paid_separately: 0 })).toBe(true);
    expect(storedInPayable({ paid_separately: 1, in_payable: null })).toBe(false);
    // A stored answer wins over the fallback in both directions.
    expect(storedInPayable({ paid_separately: 1, in_payable: 1 })).toBe(true);
    expect(storedInPayable({ paid_separately: 0, in_payable: 0 })).toBe(false);
    expect(storedInPayable({ paid_separately: 0, in_payable: "1" })).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  chargeItcAudit,
  chargeItcSplit,
  documentItcBuckets,
  rcmReviewRows,
  type ItcChargeBill,
} from "./chargeItc";
import type { PurchaseChargeRecord } from "./purchaseChargeRegister";

/**
 * CR-C / REP-009 on the till. These assert the same paisas the server's working papers assert
 * (`backend/tests/Feature/GstWorkingPapersTest.php`), because a report that disagrees offline is a
 * report nobody can file from.
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
  place_of_supply: "32",
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

/** Goods 1,000@12, so the header already carries the supplier-borne charge GST (PUR-001). */
const bill = (over: Partial<ItcChargeBill>): ItcChargeBill => ({
  id: "p1",
  subtotal: 1000,
  tax_total: 156,
  cgst_total: 78,
  sgst_total: 78,
  igst_total: 0,
  cess_total: 0,
  is_rcm: 0,
  itc_eligibility: "eligible",
  supplier_name: "Alverstone Drug House",
  supplier_gstin: "32ZYXWV9876A1Z2",
  supplier_invoice_no: "ADH-26-1",
  purchase_date: "2026-11-06",
  ...over,
});

describe("chargeItcSplit", () => {
  it("prices creditability by eligibility for the books and refuses RCM for the return", () => {
    const rcm = chargeItcSplit(charge({ is_rcm: 1 }));
    expect(rcm).toMatchObject({ taxable: 200, tax: 36, creditable: true, claimable: false });

    const blocked = chargeItcSplit(charge({ itc_eligibility: "blocked" }));
    expect(blocked).toMatchObject({ creditable: false, claimable: false });
  });
});

describe("documentItcBuckets", () => {
  it("counts an eligible in-bill charge's tax once, because the header already carried it", () => {
    const buckets = documentItcBuckets(bill({}), [charge({})]);

    expect(buckets.eligible).toMatchObject({ taxable: 1200, cgst: 78, sgst: 78, tax: 156 });
    expect(buckets.ineligible.taxable).toBe(0);
    expect(buckets.rcm.tax).toBe(0);
  });

  it("adds only the separately-paid tax the header never carried", () => {
    // The server's 174 / 54 vector, read from a till header instead of item lines.
    const buckets = documentItcBuckets(bill({}), [
      charge({}),
      charge({
        id: "c2",
        head_code: "OTHER",
        head_name: "Other",
        taxable_amount: 100,
        cgst_amount: 9,
        sgst_amount: 9,
        total_amount: 118,
        paid_separately: 1,
      }),
    ]);

    expect(buckets.eligible).toMatchObject({ taxable: 1300, tax: 174 });
  });

  it("takes a blocked head's tax back out of ordinary input tax", () => {
    const buckets = documentItcBuckets(bill({}), [charge({ itc_eligibility: "blocked" })]);

    expect(buckets.eligible).toMatchObject({ taxable: 1000, tax: 120 });
    expect(buckets.ineligible).toMatchObject({ taxable: 200, tax: 36 });
    expect(buckets.ineligible_itc).toBe(36);
  });

  it("moves a reverse-charge head out of input tax and into the review bucket", () => {
    const buckets = documentItcBuckets(bill({}), [charge({ is_rcm: 1 })]);

    // 156 is what the header claimed; 36 of it is tax the store pays itself.
    expect(buckets.eligible).toMatchObject({ taxable: 1000, tax: 120 });
    expect(buckets.rcm).toMatchObject({ taxable: 200, tax: 36 });
  });

  it("keeps a whole-document ineligible bill's charges in the same bucket as its goods", () => {
    const buckets = documentItcBuckets(bill({ itc_eligibility: "ineligible" }), [
      charge({}),
      charge({ id: "c2", paid_separately: 1 }),
    ]);

    // The separately-paid rupee was never billed by this supplier, so it stays out of the taxable.
    expect(buckets.ineligible).toMatchObject({ taxable: 1200, tax: 156 });
    expect(buckets.eligible.tax).toBe(0);
    expect(buckets.ineligible_itc).toBe(156);
  });

  it("nets a debit note's own charges back out", () => {
    const buckets = documentItcBuckets(bill({}), [charge({})], -1);

    expect(buckets.eligible).toMatchObject({ taxable: -1200, tax: -156 });
  });
});

describe("chargeItcAudit", () => {
  it("foot creditable, non-creditable and reverse-charge tax to every charge rupee", () => {
    const bills = [bill({})];
    const charges = [
      charge({}),
      charge({ id: "c2", head_code: "INSURANCE", head_name: "Insurance", taxable_amount: 100, cgst_amount: 9, sgst_amount: 9, total_amount: 118, itc_eligibility: "blocked" }),
      charge({ id: "c3", head_code: "OTHER", head_name: "Other", taxable_amount: 100, cgst_amount: 9, sgst_amount: 9, total_amount: 118, paid_separately: 1 }),
      charge({ id: "c4", seq: 2, is_rcm: 1 }),
    ];

    const audit = chargeItcAudit(bills, charges);

    expect(audit).toMatchObject({
      total_taxable: 600,
      total_tax: 108,
      creditable_tax: 54,
      non_creditable_tax: 18,
      rcm_tax: 36,
      reconciles: true,
    });
    expect(audit.by_head).toHaveLength(4);
    expect(audit.by_head.map((head) => head.head_code)).toEqual([
      "FREIGHT",
      "FREIGHT",
      "INSURANCE",
      "OTHER",
    ]);

    const byKey = new Map(
      audit.by_head.map((head) => [
        `${head.head_code}|${head.itc_eligibility}|${head.is_rcm ? "rcm" : "normal"}|${head.paid_separately ? "sep" : "bill"}`,
        head,
      ])
    );
    expect(byKey.get("FREIGHT|eligible|normal|bill")?.creditable_tax).toBe(36);
    expect(byKey.get("FREIGHT|eligible|rcm|bill")?.creditable_tax).toBe(0);
    expect(byKey.get("INSURANCE|blocked|normal|bill")?.creditable_tax).toBe(0);
    expect(byKey.get("OTHER|eligible|normal|sep")?.paid_separately).toBe(true);
  });

  it("ignores charges that do not belong to the bills being reported", () => {
    const audit = chargeItcAudit([bill({ id: "p9" })], [charge({ purchase_id: "p1" })]);

    expect(audit.total_tax).toBe(0);
    expect(audit.by_head).toHaveLength(0);
    expect(audit.reconciles).toBe(true);
  });
});

describe("rcmReviewRows", () => {
  it("lists a reverse-charge head with its bill, taxable and self-paid tax", () => {
    const rows = rcmReviewRows([bill({})], [charge({ is_rcm: 1 }), charge({ id: "c2" })]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      invoice_number: "ADH-26-1",
      invoice_date: "2026-11-06",
      supplier_name: "Alverstone Drug House",
      head_name: "Freight",
      sac_code: "996731",
      taxable_amount: 200,
      self_paid_tax: 36,
      paid_separately: false,
    });
  });
});

import { round2 } from "../billing/billingCalculations";
import type { PurchaseChargeRecord } from "./purchaseChargeRegister";

/**
 * CR-C Task 4.13 / REP-009 — how a supplier bill's charges land in the GST input-tax papers.
 *
 * Mirrors `backend/app/Services/Gst/GstWorkingPaperService.php::itcSummary()`. Two views, on
 * purpose:
 *  - the **money view** prices creditability by `itc_eligibility === 'eligible'` alone, because a
 *    reverse-charge charge's GST is still rupees the books have to place;
 *  - the **statutory view** (`claimable`, and `by_head.creditable_tax`) also refuses `is_rcm`,
 *    because a return's ordinary input tax may not carry tax the store paid itself.
 *
 * The till always reads a bill from its header, and PUR-001 already mixed the supplier-borne
 * charge GST into `tax_total`, so a non-creditable or reverse-charge head has to be taken *back out*
 * of the creditable slab — while a separately-paid head's tax never entered the header and has to
 * be added.
 */

export interface ItcMoney {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  tax: number;
}

export interface ItcChargeBill {
  id: string;
  subtotal?: number | null;
  tax_total?: number | null;
  cgst_total?: number | null;
  sgst_total?: number | null;
  igst_total?: number | null;
  cess_total?: number | null;
  is_rcm?: number | boolean | null;
  itc_eligibility?: string | null;
  supplier_name?: string | null;
  supplier_gstin?: string | null;
  supplier_invoice_no?: string | null;
  purchase_date?: string | null;
  place_of_supply?: string | null;
}

export interface ChargeItcSplit extends ItcMoney {
  creditable: boolean;
  claimable: boolean;
  is_rcm: boolean;
  paid_separately: boolean;
}

export interface DocumentItcBuckets {
  eligible: ItcMoney;
  ineligible: ItcMoney;
  rcm: ItcMoney;
  /** The charge tax the paper refuses to credit — GSTR-3B Table 4(D)'s `ineligible_itc`. */
  ineligible_itc: number;
}

export interface ChargeHeadAudit {
  head_code: string;
  head_name: string;
  sac_code: string | null;
  itc_eligibility: string;
  is_rcm: boolean;
  paid_separately: boolean;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  tax: number;
  creditable_tax: number;
  rows: number;
}

export interface ChargeItcAudit {
  total_taxable: number;
  total_tax: number;
  creditable_tax: number;
  non_creditable_tax: number;
  rcm_tax: number;
  reconciles: boolean;
  by_head: ChargeHeadAudit[];
}

export interface RcmReviewRow {
  purchase_id: string;
  invoice_number: string;
  invoice_date: string;
  supplier_name: string;
  supplier_gstin: string | null;
  head_code: string;
  head_name: string;
  sac_code: string | null;
  place_of_supply: string | null;
  taxable_amount: number;
  self_paid_tax: number;
  paid_separately: boolean;
  note: string | null;
}

const num = (value: unknown): number => Number(value) || 0;
const flag = (value: unknown): boolean => value === 1 || value === true || value === "1";

export const emptyItcMoney = (): ItcMoney => ({
  taxable: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  cess: 0,
  tax: 0,
});

function addMoney(target: ItcMoney, source: ItcMoney, sign = 1): ItcMoney {
  return {
    taxable: round2(target.taxable + sign * source.taxable),
    cgst: round2(target.cgst + sign * source.cgst),
    sgst: round2(target.sgst + sign * source.sgst),
    igst: round2(target.igst + sign * source.igst),
    cess: round2(target.cess + sign * source.cess),
    tax: round2(target.tax + sign * source.tax),
  };
}

/** Adds one document's bucket into a report's running total, paisa by paisa. */
export function addIntoItcMoney(target: ItcMoney, source: ItcMoney): ItcMoney {
  Object.assign(target, addMoney(target, source));
  return target;
}

/** One charge, priced: `creditable` for the books, `claimable` for the return. */
export function chargeItcSplit(charge: PurchaseChargeRecord): ChargeItcSplit {
  const cgst = round2(num(charge.cgst_amount));
  const sgst = round2(num(charge.sgst_amount));
  const igst = round2(num(charge.igst_amount));
  const cess = round2(num(charge.cess_amount));
  const isRcm = flag(charge.is_rcm);
  const eligible = String(charge.itc_eligibility ?? "eligible") === "eligible";

  return {
    taxable: round2(num(charge.taxable_amount)),
    cgst,
    sgst,
    igst,
    cess,
    tax: round2(cgst + sgst + igst + cess),
    creditable: eligible,
    claimable: eligible && !isRcm,
    is_rcm: isRcm,
    paid_separately: flag(charge.paid_separately),
  };
}

/** The whole document as the header states it: goods taxable plus the GST already inside it. */
function headerMoney(bill: ItcChargeBill): ItcMoney {
  const cgst = round2(num(bill.cgst_total));
  const sgst = round2(num(bill.sgst_total));
  const igst = round2(num(bill.igst_total));
  const cess = round2(num(bill.cess_total));

  return {
    taxable: round2(num(bill.subtotal)),
    cgst,
    sgst,
    igst,
    cess,
    tax: round2(num(bill.tax_total) || cgst + sgst + igst + cess),
  };
}

/**
 * Goods and charges sorted into the three input-tax buckets for one inward document.
 * `sign` is -1 for a debit note, so a return nets its own bill out of the paper.
 */
export function documentItcBuckets(
  bill: ItcChargeBill,
  charges: PurchaseChargeRecord[],
  sign = 1
): DocumentItcBuckets {
  const buckets: DocumentItcBuckets = {
    eligible: emptyItcMoney(),
    ineligible: emptyItcMoney(),
    rcm: emptyItcMoney(),
    ineligible_itc: 0,
  };
  const header = headerMoney(bill);
  const owned = (charges || []).filter((charge) => String(charge.purchase_id) === String(bill.id));

  // A document that is reverse-charge or ineligible as a whole carries its charge GST in the same
  // header columns, so its charges belong to that bucket and not to the creditable one.
  if (flag(bill.is_rcm) || String(bill.itc_eligibility ?? "eligible") !== "eligible") {
    const chargeTaxable = owned
      .filter((charge) => !flag(charge.paid_separately))
      .reduce((total, charge) => round2(total + num(charge.taxable_amount)), 0);

    if (flag(bill.is_rcm)) {
      buckets.rcm = addMoney(buckets.rcm, { ...header, taxable: round2(header.taxable + chargeTaxable) }, sign);
    } else {
      buckets.ineligible = addMoney(
        buckets.ineligible,
        { ...header, taxable: round2(header.taxable + chargeTaxable) },
        sign
      );
      buckets.ineligible_itc = round2(buckets.ineligible_itc + sign * header.tax);
    }

    return buckets;
  }

  buckets.eligible = addMoney(buckets.eligible, header, sign);

  for (const charge of owned) {
    const split = chargeItcSplit(charge);
    const taxOnly: ItcMoney = {
      taxable: 0,
      cgst: split.cgst,
      sgst: split.sgst,
      igst: split.igst,
      cess: split.cess,
      tax: split.tax,
    };
    const full: ItcMoney = {
      taxable: split.taxable,
      cgst: split.cgst,
      sgst: split.sgst,
      igst: split.igst,
      cess: split.cess,
      tax: split.tax,
    };
    // Money a third party was paid is not an inward supply from this supplier, so it has no
    // taxable value in the supplier-invoice columns even though its GST is still input tax.
    const billed = split.paid_separately ? { ...full, taxable: 0 } : full;

    if (split.is_rcm) {
      buckets.rcm = addMoney(buckets.rcm, billed, sign);
      // The header called this tax creditable (PUR-001); a reverse-charge rupee is one the store
      // pays itself, so only the tax leaves the creditable slab — the goods stay where they are.
      if (!split.paid_separately) buckets.eligible = addMoney(buckets.eligible, taxOnly, -sign);
      continue;
    }

    if (!split.creditable) {
      buckets.ineligible = addMoney(buckets.ineligible, billed, sign);
      buckets.ineligible_itc = round2(buckets.ineligible_itc + sign * split.tax);
      if (!split.paid_separately) buckets.eligible = addMoney(buckets.eligible, taxOnly, -sign);
      continue;
    }

    // Creditable: the in-bill tax is already in the header, the separately-paid tax is not.
    buckets.eligible = addMoney(
      buckets.eligible,
      split.paid_separately ? full : { ...full, cgst: 0, sgst: 0, igst: 0, cess: 0, tax: 0 },
      sign
    );
  }

  return buckets;
}

function headKey(charge: PurchaseChargeRecord): string {
  return [
    String(charge.head_code ?? ""),
    String(charge.itc_eligibility ?? "eligible"),
    flag(charge.is_rcm) ? "rcm" : "normal",
    flag(charge.paid_separately) ? "sep" : "bill",
  ].join("|");
}

/**
 * The audit block the working papers return as `itc.charges`: every charge rupee of taxable and
 * tax, split creditable / non-creditable / reverse-charge, and footed.
 */
export function chargeItcAudit(
  bills: ItcChargeBill[],
  charges: PurchaseChargeRecord[],
  signOf: (bill: ItcChargeBill) => number = () => 1
): ChargeItcAudit {
  const billsById = new Map(bills.map((bill) => [String(bill.id), bill]));
  const byHead = new Map<string, ChargeHeadAudit>();

  let taxable = 0;
  let tax = 0;
  let creditable = 0;
  let blocked = 0;
  let rcm = 0;

  for (const charge of charges || []) {
    const bill = billsById.get(String(charge.purchase_id));
    if (!bill) continue;

    const sign = signOf(bill);
    const split = chargeItcSplit(charge);
    // A document that is reverse-charge or ineligible as a whole puts every one of its charges in
    // that one bucket; they never become creditable input tax.
    const wholeDocument =
      flag(bill.is_rcm) || String(bill.itc_eligibility ?? "eligible") !== "eligible";

    taxable = round2(taxable + sign * split.taxable);
    tax = round2(tax + sign * split.tax);

    if (wholeDocument) {
      if (split.is_rcm) rcm = round2(rcm + sign * split.tax);
      else blocked = round2(blocked + sign * split.tax);
    } else if (split.is_rcm) {
      rcm = round2(rcm + sign * split.tax);
    } else if (!split.creditable) {
      blocked = round2(blocked + sign * split.tax);
    } else {
      creditable = round2(creditable + sign * split.tax);
    }

    const key = headKey(charge);
    const row = byHead.get(key) || {
      head_code: String(charge.head_code ?? ""),
      head_name: String(charge.head_name ?? ""),
      sac_code: charge.sac_code ?? null,
      itc_eligibility: String(charge.itc_eligibility ?? "eligible"),
      is_rcm: split.is_rcm,
      paid_separately: split.paid_separately,
      taxable: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      cess: 0,
      tax: 0,
      creditable_tax: 0,
      rows: 0,
    };

    byHead.set(key, {
      ...row,
      taxable: round2(row.taxable + sign * split.taxable),
      cgst: round2(row.cgst + sign * split.cgst),
      sgst: round2(row.sgst + sign * split.sgst),
      igst: round2(row.igst + sign * split.igst),
      cess: round2(row.cess + sign * split.cess),
      tax: round2(row.tax + sign * split.tax),
      // The statutory view, so an RCM head shows no creditable tax even when its books do.
      creditable_tax: round2(row.creditable_tax + (split.claimable ? sign * split.tax : 0)),
      rows: row.rows + 1,
    });
  }

  const sorted = Array.from(byHead.values()).sort(
    (a, b) =>
      a.head_code.localeCompare(b.head_code) || a.itc_eligibility.localeCompare(b.itc_eligibility)
  );

  return {
    total_taxable: round2(taxable),
    total_tax: round2(tax),
    creditable_tax: round2(creditable),
    non_creditable_tax: round2(blocked),
    rcm_tax: round2(rcm),
    reconciles: Math.abs(creditable + blocked + rcm - tax) < 0.005,
    by_head: sorted,
  };
}

/** REP-009: the review section, so a reverse-charge line never hides inside ordinary input tax. */
export function rcmReviewRows(
  bills: ItcChargeBill[],
  charges: PurchaseChargeRecord[],
  invoiceNumber: (bill: ItcChargeBill) => string = (bill) => String(bill.supplier_invoice_no ?? "")
): RcmReviewRow[] {
  const billsById = new Map(bills.map((bill) => [String(bill.id), bill]));

  return (charges || [])
    .filter((charge) => flag(charge.is_rcm) && billsById.has(String(charge.purchase_id)))
    .map((charge) => {
      const bill = billsById.get(String(charge.purchase_id))!;
      const split = chargeItcSplit(charge);

      return {
        purchase_id: bill.id,
        invoice_number: invoiceNumber(bill),
        invoice_date: String(bill.purchase_date ?? "").slice(0, 10),
        supplier_name: String(bill.supplier_name ?? ""),
        supplier_gstin: bill.supplier_gstin ?? null,
        head_code: String(charge.head_code ?? ""),
        head_name: String(charge.head_name ?? ""),
        sac_code: charge.sac_code ?? null,
        place_of_supply: charge.place_of_supply ?? bill.place_of_supply ?? null,
        taxable_amount: split.taxable,
        self_paid_tax: split.tax,
        paid_separately: split.paid_separately,
        note: charge.note ?? null,
      };
    });
}

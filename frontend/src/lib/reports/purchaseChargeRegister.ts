import { round2 } from "../billing/billingCalculations";

/**
 * CR-C / REP-007 — the till's reading side of a supplier bill's charges.
 *
 * This mirrors `backend/app/Services/Reports/PurchaseRegisterService.php` field for field: a bill
 * header deliberately mixes the two halves (`subtotal` is goods alone while `tax_total` already
 * carries the charge GST the supplier charged, PUR-001), so any report that wants them apart has
 * to take the charge rows back out of the header instead of adding them to it. Keeping the shape
 * identical is what lets the same register print the same paisa offline and on the server.
 *
 * A bill keyed before CR-C owns no charge rows and only a `freight_charges` scalar. It is shown
 * as the single Freight line the posting path also uses (PUR-017), so its payable stays
 * explainable — but it is never re-taxable and never restates a total.
 */

export interface PurchaseChargeRecord {
  id: string;
  purchase_id: string;
  /** The id the bill synced on (SYNC-002): an edit that re-posts a row must reuse it. */
  external_id?: string | null;
  seq: number;
  head_code: string;
  head_name: string;
  note?: string | null;
  treatment: string;
  spread_method: string;
  spread_basis_used?: string | null;
  itc_eligibility: string;
  is_rcm?: number | boolean;
  paid_separately?: number | boolean;
  in_payable?: number | boolean;
  paid_to_label?: string | null;
  sac_code?: string | null;
  place_of_supply?: string | null;
  amount: number;
  gst_percent: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  total_amount: number;
  allocated_amount: number;
  source?: string;
  reversed_amount?: number;
  created_at?: number;
}

export interface ChargeRegisterRow {
  seq: number;
  head_code: string;
  head_name: string;
  sac_code: string | null;
  treatment: string;
  spread_method: string;
  spread_basis_used: string | null;
  itc_eligibility: string;
  is_rcm: boolean;
  paid_separately: boolean;
  paid_to_label: string | null;
  taxable: number;
  gst_percent: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  tax: number;
  allocated: number;
  reversed: number;
  source: string;
  note: string | null;
  in_payable: boolean;
  payment: string;
  total: number;
}

export interface ChargeAwareBill {
  id: string;
  subtotal?: number | null;
  tax_total?: number | null;
  grand_total?: number | null;
  round_off?: number | null;
  freight_charges?: number | null;
  place_of_supply?: string | null;
}

export interface PurchaseChargeSummary {
  goods_taxable: number;
  goods_tax: number;
  charge_taxable: number;
  charge_tax: number;
  charge_total: number;
  separately_paid: { taxable: number; tax: number; total: number };
  by_head: ChargeRegisterRow[];
  charge_count: number;
  landed_value: number;
  payable: number;
  round_off: number;
}

const num = (value: unknown): number => Number(value) || 0;
const flag = (value: unknown): boolean => value === 1 || value === true || value === "1";

/**
 * CR-C-11 / PUR-016: whether a charge was inside the supplier's payable is stored with the line,
 * because a store's policy for separately-paid charges is allowed to change after a bill printed.
 * A row written before the flag existed carries no answer, and was priced under the rule the
 * migration backfills — so derive that same answer rather than defaulting it.
 */
export function storedInPayable(charge: {
  paid_separately?: unknown;
  in_payable?: unknown;
}): boolean {
  if (charge.in_payable === undefined || charge.in_payable === null) return !flag(charge.paid_separately);

  return flag(charge.in_payable);
}

/** The rupee the books carried before CR-C, in the same shape as a posted head. */
function legacyFreightRow(bill: ChargeAwareBill): ChargeRegisterRow[] {
  const freight = round2(num(bill.freight_charges));
  if (Math.abs(freight) < 0.005) return [];

  return [
    derived({
      seq: 1,
      head_code: "FREIGHT",
      head_name: "Freight",
      sac_code: null,
      treatment: "add_to_cost",
      spread_method: "value",
      spread_basis_used: "value",
      itc_eligibility: "eligible",
      is_rcm: false,
      paid_separately: false,
      paid_to_label: null,
      taxable: freight,
      gst_percent: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      cess: 0,
      tax: 0,
      allocated: 0,
      reversed: 0,
      source: "legacy_freight",
      note: "Legacy freight carried over from a pre-charges bill",
    }),
  ];
}

function derived(
  row: Omit<ChargeRegisterRow, "in_payable" | "payment" | "total"> & { in_payable?: boolean }
): ChargeRegisterRow {
  const paidSeparately = row.paid_separately;
  return {
    ...row,
    in_payable: row.in_payable ?? !paidSeparately,
    payment: paidSeparately ? "Paid Separately" : "On Account",
    total: round2(row.taxable + row.tax),
  };
}

/** One row per charge head: the posted rows when the bill owns them, else its legacy freight. */
export function chargeRowsFor(
  bill: ChargeAwareBill,
  charges: PurchaseChargeRecord[]
): ChargeRegisterRow[] {
  if (!(charges || []).length) return legacyFreightRow(bill);

  return (charges || [])
    .slice()
    .sort((a, b) => num(a.seq) - num(b.seq))
    .flatMap((charge) => {
      const cgst = round2(num(charge.cgst_amount));
      const sgst = round2(num(charge.sgst_amount));
      const igst = round2(num(charge.igst_amount));
      const cess = round2(num(charge.cess_amount));

      return derived({
        seq: num(charge.seq),
        head_code: String(charge.head_code ?? ""),
        head_name: String(charge.head_name ?? ""),
        sac_code: charge.sac_code ?? null,
        treatment: String(charge.treatment ?? "add_to_cost"),
        spread_method: String(charge.spread_method ?? "value"),
        spread_basis_used: charge.spread_basis_used ?? null,
        itc_eligibility: String(charge.itc_eligibility ?? "eligible"),
        is_rcm: flag(charge.is_rcm),
        paid_separately: flag(charge.paid_separately),
        in_payable: storedInPayable(charge),
        paid_to_label: charge.paid_to_label ?? null,
        taxable: round2(num(charge.taxable_amount)),
        gst_percent: round2(num(charge.gst_percent)),
        cgst,
        sgst,
        igst,
        cess,
        tax: round2(cgst + sgst + igst + cess),
        allocated: round2(num(charge.allocated_amount)),
        reversed: round2(num(charge.reversed_amount)),
        source: String(charge.source ?? "manual"),
        note: charge.note ?? null,
      });
    });
}

/**
 * Goods and charges apart, with the payable the header actually posted.
 * `allocatedOnGoods` is the bill's own Σ `purchase_items.charge_allocation`.
 */
export function purchaseChargeSummary(
  bill: ChargeAwareBill,
  charges: PurchaseChargeRecord[],
  allocatedOnGoods = 0
): PurchaseChargeSummary {
  const byHead = chargeRowsFor(bill, charges);

  let chargeTaxable = 0;
  let chargeTax = 0;
  let separateTaxable = 0;
  let separateTax = 0;
  let landedSpread = 0;

  for (const row of byHead) {
    if (row.in_payable) {
      chargeTaxable += row.taxable;
      chargeTax += row.tax;
    } else {
      separateTaxable += row.taxable;
      separateTax += row.tax;
    }
    if (row.treatment === "add_to_cost") landedSpread += row.reversed;
  }

  const goodsTaxable = round2(num(bill.subtotal));
  const headerTax = round2(num(bill.tax_total));

  return {
    goods_taxable: goodsTaxable,
    goods_tax: round2(headerTax - chargeTax),
    charge_taxable: round2(chargeTaxable),
    charge_tax: round2(chargeTax),
    charge_total: round2(chargeTaxable + chargeTax),
    separately_paid: {
      taxable: round2(separateTaxable),
      tax: round2(separateTax),
      total: round2(separateTaxable + separateTax),
    },
    by_head: byHead,
    charge_count: byHead.length,
    landed_value: round2(goodsTaxable + round2(allocatedOnGoods) - landedSpread),
    payable: round2(num(bill.grand_total)),
    round_off: round2(num(bill.round_off)),
  };
}

/** `; `-separated head labels, the same text the server's purchases CSV prints. */
export function chargeHeadsLabel(rows: ChargeRegisterRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.head_code} ${row.taxable.toFixed(2)}@${trimRate(row.gst_percent)}% ` +
        `${row.in_payable ? "in bill" : "paid separately"}${row.is_rcm ? " RCM" : ""}`
    )
    .join("; ");
}

function trimRate(rate: number): string {
  return String(rate).replace(/\.?0+$/, "");
}

export interface ChargeRegisterIndex {
  /** Per-bill summary keyed by `purchase_documents.id`. */
  byBill: Map<string, PurchaseChargeSummary>;
  /** Every charge row, flattened, for registers that list heads rather than bills. */
  rows: Array<ChargeRegisterRow & { bill: ChargeAwareBill }>;
}

/**
 * Group charges and item allocations onto bills once, so a register with 5,000 bills does 3 reads
 * instead of 5,000. Bills with no charges of their own still get their legacy freight placed.
 */
export function indexChargeRegister(
  bills: ChargeAwareBill[],
  charges: PurchaseChargeRecord[],
  items: Array<{ purchase_id: string; charge_allocation?: number | null }>
): ChargeRegisterIndex {
  const chargesByBill = new Map<string, PurchaseChargeRecord[]>();
  for (const charge of charges || []) {
    const list = chargesByBill.get(charge.purchase_id) || [];
    list.push(charge);
    chargesByBill.set(charge.purchase_id, list);
  }

  const allocatedByBill = new Map<string, number>();
  for (const item of items || []) {
    if (!item || !item.purchase_id) continue;
    allocatedByBill.set(
      item.purchase_id,
      round2((allocatedByBill.get(item.purchase_id) || 0) + num(item.charge_allocation))
    );
  }

  const byBill = new Map<string, PurchaseChargeSummary>();
  const rows: ChargeRegisterIndex["rows"] = [];

  for (const bill of bills || []) {
    if (!bill || !bill.id) continue;
    const summary = purchaseChargeSummary(
      bill,
      chargesByBill.get(bill.id) || [],
      allocatedByBill.get(bill.id) || 0
    );
    byBill.set(bill.id, summary);
    for (const row of summary.by_head) rows.push({ ...row, bill });
  }

  return { byBill, rows };
}

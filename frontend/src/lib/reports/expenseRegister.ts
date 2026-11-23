import { round2 } from "../billing/billingCalculations";
import type { PurchaseChargeRecord } from "./purchaseChargeRegister";
import { storedInPayable } from "./purchaseChargeRegister";

/**
 * CR-C Task 4.13 / REP-008 — the till's Expense Register.
 *
 * This register did not exist before CR-C: an expense-treated bill charge only appeared if its
 * twin row in `expenses` happened to survive an edit, and nothing read the two together. So the
 * register reads the *bill* side (`purchase_charges` with treatment `expense`) for charge rows and
 * `expenses` for everything else, and skips the twins — which is why one rupee never shows twice.
 *
 * Field names and arithmetic mirror `backend/app/Services/Reports/ExpenseRegisterService.php` so
 * the same period foots to the same paisa offline and on the server.
 */

export interface ExpenseRegisterBill {
  id: string;
  purchase_number?: string;
  supplier_name?: string;
  supplier_invoice_no?: string;
  purchase_date?: string;
  status?: string;
}

export interface ManualExpenseRecord {
  id: string;
  expense_number?: string;
  expense_head: string;
  amount: number;
  payment_mode?: string;
  reference_no?: string | null;
  notes?: string | null;
  expense_date: string;
  created_at?: number;
  purchase_id?: string | null;
  purchase_charge_id?: string | null;
  gst_percent?: number | null;
  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;
  itc_eligibility?: string | null;
  paid_separately?: number | boolean | null;
}

export interface ExpenseRegisterRow {
  date: string;
  source: "purchase_charge" | "manual";
  origin: string;
  purchase_id: string | null;
  purchase_number: string;
  supplier_name: string;
  seq: number;
  head: string;
  head_code: string;
  sac_code: string | null;
  note: string | null;
  taxable_amount: number;
  gst_percent: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  tax_amount: number;
  itc_eligibility: string;
  creditable: boolean;
  creditable_tax: number;
  non_creditable_tax: number;
  amount: number;
  is_rcm: boolean;
  paid_separately: boolean;
  in_payable: boolean;
  paid_to_label: string | null;
  payment_mode: string;
  reference_no: string;
  expense_id: string | null;
  expense_number: string;
  purchase_charge_id: string | null;
  reversed_amount: number;
}

export interface ExpenseRegisterFilter {
  startDate?: string;
  endDate?: string;
  head?: string;
  source?: "all" | "manual" | "purchase_charge";
}

export interface ExpenseRegisterResult {
  rows: ExpenseRegisterRow[];
  totals: ExpenseRegisterTotals;
  reconciliation: ExpenseRegisterReconciliation;
}

export interface ExpenseRegisterTotals {
  rows: number;
  postings: number;
  taxable: number;
  tax: number;
  creditable_tax: number;
  non_creditable_tax: number;
  manual_postings: number;
  charge_postings: number;
  separately_paid_postings: number;
  rcm_postings: number;
}

export interface ExpenseRegisterReconciliation {
  identity: string;
  charge_postings: number;
  charge_taxable_plus_non_creditable_tax: number;
  delta: number;
  balanced: boolean;
}

const num = (value: unknown): number => Number(value) || 0;
const flag = (value: unknown): boolean => value === 1 || value === true || value === "1";

const msToDate = (ms: unknown): string => {
  const date = new Date(Number(ms));
  if (isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
};

export const SOURCE_CHARGE = "purchase_charge";
export const SOURCE_MANUAL = "manual";

function chargeRow(
  charge: PurchaseChargeRecord,
  bill: ExpenseRegisterBill | undefined,
  twin?: ManualExpenseRecord
): ExpenseRegisterRow {
  const cgst = round2(num(charge.cgst_amount));
  const sgst = round2(num(charge.sgst_amount));
  const igst = round2(num(charge.igst_amount));
  const cess = round2(num(charge.cess_amount));
  const tax = round2(cgst + sgst + igst + cess);
  const creditable = String(charge.itc_eligibility ?? "eligible") === "eligible";
  const creditableTax = creditable ? tax : 0;
  const nonCreditableTax = round2(tax - creditableTax);

  return {
    date: String(bill?.purchase_date || "").slice(0, 10) || msToDate(charge.created_at),
    source: SOURCE_CHARGE,
    origin: String(charge.source ?? "manual"),
    purchase_id: charge.purchase_id ?? null,
    purchase_number: String(bill?.supplier_invoice_no ?? ""),
    supplier_name: String(bill?.supplier_name ?? ""),
    seq: num(charge.seq),
    head: String(charge.head_name ?? ""),
    head_code: String(charge.head_code ?? ""),
    sac_code: charge.sac_code ?? null,
    note: charge.note ?? null,
    taxable_amount: round2(num(charge.taxable_amount)),
    gst_percent: round2(num(charge.gst_percent)),
    cgst_amount: cgst,
    sgst_amount: sgst,
    igst_amount: igst,
    cess_amount: cess,
    tax_amount: tax,
    itc_eligibility: String(charge.itc_eligibility ?? "eligible"),
    creditable,
    creditable_tax: round2(creditableTax),
    non_creditable_tax: nonCreditableTax,
    // PUR-012: the posting is the ex-tax charge plus the tax that can never be claimed back.
    amount: round2(num(charge.taxable_amount) + nonCreditableTax),
    is_rcm: flag(charge.is_rcm),
    paid_separately: flag(charge.paid_separately),
    in_payable: storedInPayable(charge),
    paid_to_label: charge.paid_to_label ?? null,
    // PUR-012's twin carries the real payment mode once the clerk records it; before that the
    // charge itself says whether the money left with the bill or separately.
    payment_mode: String(
      twin?.payment_mode ?? (flag(charge.paid_separately) ? "Paid Separately" : "On Account")
    ),
    reference_no: String(twin?.reference_no ?? bill?.supplier_invoice_no ?? ""),
    expense_id: twin?.id ?? null,
    expense_number: String(twin?.expense_number ?? ""),
    purchase_charge_id: charge.id,
    reversed_amount: round2(num(charge.reversed_amount)),
  };
}

function manualRow(expense: ManualExpenseRecord): ExpenseRegisterRow {
  const cgst = round2(num(expense.cgst_amount));
  const sgst = round2(num(expense.sgst_amount));
  const igst = round2(num(expense.igst_amount));
  const eligibility = String(expense.itc_eligibility ?? "eligible");
  const creditable = eligibility === "eligible";
  const tax = round2(cgst + sgst + igst);

  return {
    date: String(expense.expense_date || "").slice(0, 10),
    source: SOURCE_MANUAL,
    origin: "manual",
    purchase_id: expense.purchase_id ?? null,
    purchase_number: "",
    supplier_name: "",
    seq: 0,
    head: String(expense.expense_head ?? ""),
    head_code: "",
    sac_code: null,
    note: expense.notes ?? null,
    taxable_amount: round2(num(expense.amount)),
    gst_percent: round2(num(expense.gst_percent)),
    cgst_amount: cgst,
    sgst_amount: sgst,
    igst_amount: igst,
    cess_amount: 0,
    tax_amount: tax,
    itc_eligibility: eligibility,
    creditable,
    // A keyed expense is a single rupee paid; the register does not split its tax into ITC.
    creditable_tax: 0,
    non_creditable_tax: 0,
    amount: round2(num(expense.amount)),
    is_rcm: false,
    paid_separately: flag(expense.paid_separately),
    in_payable: false,
    paid_to_label: null,
    payment_mode: String(expense.payment_mode ?? "Cash"),
    reference_no: String(expense.reference_no ?? ""),
    expense_id: expense.id,
    expense_number: String(expense.expense_number ?? ""),
    purchase_charge_id: null,
    reversed_amount: 0,
  };
}

const inPeriod = (date: string, filter: ExpenseRegisterFilter): boolean => {
  const day = String(date || "").slice(0, 10);
  if (!day) return false;
  if (filter.startDate && day < filter.startDate) return false;
  if (filter.endDate && day > filter.endDate) return false;
  return true;
};

const matchesHead = (row: ExpenseRegisterRow, head: string): boolean =>
  head === "" ||
  row.head.toLowerCase().includes(head) ||
  row.head_code.toLowerCase().includes(head);

export function expenseRegister(
  bills: ExpenseRegisterBill[],
  charges: PurchaseChargeRecord[],
  expenses: ManualExpenseRecord[],
  filter: ExpenseRegisterFilter = {}
): ExpenseRegisterResult {
  const source = filter.source || "all";
  const head = String(filter.head || "").trim().toLowerCase();
  const billsById = new Map(bills.map((bill) => [bill.id, bill]));
  // PUR-012 wrote one `expenses` row per expense-treated charge; the register reads the charge
  // side, so the twins are indexed onto it rather than listed beside it.
  const twinsByCharge = new Map(
    (expenses || []).filter((e) => e.purchase_charge_id).map((e) => [String(e.purchase_charge_id), e])
  );

  const rows: ExpenseRegisterRow[] = [];

  if (source !== SOURCE_MANUAL) {
    for (const charge of charges || []) {
      if (String(charge.treatment) !== "expense") continue;
      const bill = billsById.get(charge.purchase_id);
      // A cancelled bill reverses its own postings, so its charges are not expenses this period.
      if (bill && String(bill.status).toLowerCase() === "cancelled") continue;
      const row = chargeRow(charge, bill, twinsByCharge.get(String(charge.id)));
      if (!inPeriod(row.date, filter) || !matchesHead(row, head)) continue;
      rows.push(row);
    }
  }

  if (source !== SOURCE_CHARGE) {
    for (const expense of expenses || []) {
      // The charge's own register row already carries this rupee; the twin is skipped (PUR-012).
      if (expense.purchase_charge_id) continue;
      const row = manualRow(expense);
      if (!inPeriod(row.date, filter) || !matchesHead(row, head)) continue;
      rows.push(row);
    }
  }

  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.purchase_number.localeCompare(b.purchase_number) ||
      a.seq - b.seq ||
      a.head.localeCompare(b.head)
  );

  return { rows, totals: expenseRegisterTotals(rows), reconciliation: reconcile(rows) };
}

/** Footing for a set of rows — the register itself and a narrowed search view use the same math. */
export function expenseRegisterTotals(rows: ExpenseRegisterRow[]): ExpenseRegisterTotals {
  const sum = (pick: (row: ExpenseRegisterRow) => number, where?: (row: ExpenseRegisterRow) => boolean) =>
    round2(rows.reduce((total, row) => total + (where && !where(row) ? 0 : pick(row)), 0));

  const isCharge = (row: ExpenseRegisterRow) => row.source === SOURCE_CHARGE;

  return {
    rows: rows.length,
    postings: sum((row) => row.amount),
    taxable: sum((row) => row.taxable_amount),
    tax: sum((row) => row.tax_amount),
    creditable_tax: sum((row) => row.creditable_tax),
    non_creditable_tax: sum((row) => row.non_creditable_tax),
    manual_postings: sum((row) => row.amount, (row) => !isCharge(row)),
    charge_postings: sum((row) => row.amount, isCharge),
    separately_paid_postings: sum((row) => row.amount, (row) => row.paid_separately),
    rcm_postings: sum((row) => row.amount, (row) => row.is_rcm),
  };
}

function reconcile(rows: ExpenseRegisterRow[]): ExpenseRegisterReconciliation {
  const charges = rows.filter((row) => row.source === SOURCE_CHARGE);
  const postings = round2(charges.reduce((total, row) => total + row.amount, 0));
  const buildUp = round2(
    charges.reduce((total, row) => total + row.taxable_amount + row.non_creditable_tax, 0)
  );

  return {
    identity: "Σ expense-register charge postings = Σ charge taxable + non-creditable charge tax",
    charge_postings: postings,
    charge_taxable_plus_non_creditable_tax: buildUp,
    delta: round2(postings - buildUp),
    balanced: Math.abs(postings - buildUp) < 0.005,
  };
}

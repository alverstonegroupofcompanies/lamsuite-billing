import type { ChargeHeadMaster } from "../masters/chargeHeadsStore";
import type {
  ChargeItcEligibility,
  ChargeSpreadMethod,
  ChargeTreatment,
} from "../tax-engine/taxEngine";
import type { PurchaseChargeInput } from "./chargePosting";

/**
 * CR-C Task 4.8 / PUR-007 — the state behind the Alt+F charges grid.
 *
 * The grid is operated without a mouse, so the cells are either typed (amount, note) or cycled
 * (head, treatment, spread, ITC, the two flags): a cycle cell has no wrong spelling and no dialog.
 * This class owns that selection, the edit lifecycle and undo, exactly like the stock-adjustment
 * grid, and nothing else — it prices no rupee. `toInputs()` hands the operator's rows to
 * `resolveCharges`, which is the only place a head's presets are applied to a posted bill.
 */

export type ChargeColumn =
  | "head_code"
  | "amount"
  | "gst_percent"
  | "treatment"
  | "spread_method"
  | "itc_eligibility"
  | "is_rcm"
  | "paid_separately"
  | "paid_to_label"
  | "note";

export type ChargeColumnKind = "text" | "number" | "cycle";

export interface ChargeColumnDef {
  key: ChargeColumn;
  label: string;
  kind: ChargeColumnKind;
  hint: string;
}

export const GST_SLABS = [0, 5, 12, 18, 28];

const TREATMENTS: ChargeTreatment[] = ["add_to_cost", "expense"];
const SPREADS: ChargeSpreadMethod[] = ["value", "quantity", "weight"];
const ITC_FLAGS: ChargeItcEligibility[] = ["eligible", "ineligible", "blocked", "partial"];

export const CHARGE_COLUMNS: ChargeColumnDef[] = [
  { key: "head_code", label: "Head", kind: "cycle", hint: "Space" },
  { key: "amount", label: "Amount", kind: "number", hint: "type" },
  { key: "gst_percent", label: "GST %", kind: "cycle", hint: "Space / type" },
  { key: "treatment", label: "Treatment", kind: "cycle", hint: "Space" },
  { key: "spread_method", label: "Spread by", kind: "cycle", hint: "Space" },
  { key: "itc_eligibility", label: "ITC", kind: "cycle", hint: "Space" },
  { key: "is_rcm", label: "RCM", kind: "cycle", hint: "Space" },
  { key: "paid_separately", label: "Paid separately", kind: "cycle", hint: "Space" },
  { key: "paid_to_label", label: "Paid to", kind: "text", hint: "type" },
  { key: "note", label: "Note", kind: "text", hint: "type" },
];

export const TREATMENT_LABELS: Record<ChargeTreatment, string> = {
  add_to_cost: "Add to cost",
  expense: "Expense",
};

export const SPREAD_LABELS: Record<ChargeSpreadMethod, string> = {
  value: "Value",
  quantity: "Quantity",
  weight: "Weight",
};

export const ITC_LABELS: Record<ChargeItcEligibility, string> = {
  eligible: "Eligible",
  ineligible: "Ineligible",
  blocked: "Blocked 17(5)",
  partial: "Partial",
};

export const yesNo = (flag: boolean): string => (flag ? "Yes" : "No");

/** The cell text the grid shows, so a screen never re-derives these labels. */
export function chargeCellText(row: ChargeDraftRow, column: ChargeColumn): string {
  switch (column) {
    case "head_code":
      return row.head_code || "—";
    case "amount":
      return row.amount === null ? "" : String(row.amount);
    case "gst_percent":
      return String(row.gst_percent);
    case "treatment":
      return TREATMENT_LABELS[row.treatment];
    case "spread_method":
      return SPREAD_LABELS[row.spread_method];
    case "itc_eligibility":
      return ITC_LABELS[row.itc_eligibility];
    case "is_rcm":
      return yesNo(row.is_rcm);
    case "paid_separately":
      return yesNo(row.paid_separately);
    case "paid_to_label":
      return row.paid_to_label;
    case "note":
      return row.note;
  }
}

export interface ChargeDraftRow {
  /** Doubles as the sync key: an edit keeps the id the bill was posted with (SYNC-002). */
  external_id: string;
  head_code: string;
  amount: number | null;
  gst_percent: number;
  treatment: ChargeTreatment;
  spread_method: ChargeSpreadMethod;
  itc_eligibility: ChargeItcEligibility;
  is_rcm: boolean;
  paid_separately: boolean;
  paid_to_label: string;
  note: string;
  /**
   * Cells the operator set by hand. Switching head re-prices the rest of the row from the new
   * head's presets, and an override the operator typed must survive that — otherwise one Space
   * on the head silently changes what the charge does to stock or to ITC.
   */
  touched: ChargeColumn[];
  source: "manual" | "legacy_freight";
}

const newId = (): string => `chg_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;

/** A fresh row, preset from the head so the grid is usable with keystrokes alone. */
export function blankChargeRow(head?: ChargeHeadMaster | null, externalId = newId()): ChargeDraftRow {
  return {
    external_id: externalId,
    head_code: head?.code || "",
    amount: null,
    gst_percent: 0,
    treatment: head?.default_treatment || "add_to_cost",
    spread_method: head?.default_spread_method || "value",
    itc_eligibility: head?.default_itc_eligibility || "eligible",
    is_rcm: false,
    paid_separately: false,
    paid_to_label: "",
    note: "",
    touched: [],
    source: "manual",
  };
}

/**
 * PUR-017: a bill keyed before CR-C carried one freight scalar. Opening it for edit shows that
 * money as the same 0% Freight row the posting path would derive, so the operator edits charges
 * rather than a field the totals no longer read.
 */
export function legacyFreightRow(freightCharges: number): ChargeDraftRow | null {
  const amount = Math.round((Number(freightCharges) || 0) * 100) / 100;
  if (Math.abs(amount) < 0.005) return null;

  return {
    ...blankChargeRow(null, `legacy-freight`),
    head_code: "FREIGHT",
    amount,
    treatment: "add_to_cost",
    spread_method: "value",
    note: "Carried over from this bill's Freight field",
    touched: ["head_code", "amount", "treatment", "spread_method"],
    source: "legacy_freight",
  };
}

/** A posted charge row read back into the grid, keeping the id it syncs on. */
export function chargeRowToDraft(charge: {
  external_id?: string | null;
  head_code: string;
  amount: number;
  gst_percent?: number | null;
  treatment?: string | null;
  spread_method?: string | null;
  itc_eligibility?: string | null;
  is_rcm?: number | boolean | null;
  paid_separately?: number | boolean | null;
  paid_to_label?: string | null;
  note?: string | null;
  source?: string | null;
}): ChargeDraftRow {
  const on = (value: unknown) => value === 1 || value === true || value === "1";

  return {
    external_id: String(charge.external_id || newId()),
    head_code: String(charge.head_code || ""),
    amount: Math.round((Number(charge.amount) || 0) * 100) / 100,
    gst_percent: Number(charge.gst_percent) || 0,
    treatment: (TREATMENTS.includes(charge.treatment as ChargeTreatment)
      ? charge.treatment
      : "add_to_cost") as ChargeTreatment,
    spread_method: (SPREADS.includes(charge.spread_method as ChargeSpreadMethod)
      ? charge.spread_method
      : "value") as ChargeSpreadMethod,
    itc_eligibility: (ITC_FLAGS.includes(charge.itc_eligibility as ChargeItcEligibility)
      ? charge.itc_eligibility
      : "eligible") as ChargeItcEligibility,
    is_rcm: on(charge.is_rcm),
    paid_separately: on(charge.paid_separately),
    paid_to_label: String(charge.paid_to_label || ""),
    note: String(charge.note || ""),
    touched: [
      "head_code",
      "amount",
      "gst_percent",
      "treatment",
      "spread_method",
      "itc_eligibility",
      "is_rcm",
      "paid_separately",
    ],
    source: charge.source === "legacy_freight" ? "legacy_freight" : "manual",
  };
}

/**
 * Draft rows in the shape `resolveCharges` and the tax engine take. A row with no head or no
 * rupee is dropped, so a half-keyed line never reaches the bill as a zero-rupee charge.
 */
export function draftsToInputs(
  rows: ChargeDraftRow[],
  placeOfSupply?: string | null
): PurchaseChargeInput[] {
  return rows
    .filter((row) => row.head_code && Math.abs(Number(row.amount) || 0) >= 0.005)
    .map((row) => ({
      external_id: row.external_id,
      head_code: row.head_code,
      amount: Number(row.amount) || 0,
      gst_percent: row.gst_percent,
      treatment: row.treatment,
      spread_method: row.spread_method,
      itc_eligibility: row.itc_eligibility,
      is_rcm: row.is_rcm,
      paid_separately: row.paid_separately,
      paid_to_label: row.paid_separately ? row.paid_to_label || null : null,
      note: row.note || null,
      place_of_supply: placeOfSupply ?? null,
      source: row.source,
    }));
}

export type ChargeKeyAction =
  | "move_up"
  | "move_down"
  | "move_left"
  | "move_right"
  | "cycle_forward"
  | "cycle_back"
  | "start_edit"
  | "commit_edit"
  | "cancel_edit"
  | "add_row"
  | "delete_row"
  | "undo_delete"
  | "apply"
  | "close"
  | "noop";

export interface ChargeKeyResult {
  handled: boolean;
  action?: ChargeKeyAction;
}

export interface ChargeKeyOptions {
  ctrlOrCmd?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export interface ChargeEngineOptions {
  heads: ChargeHeadMaster[];
  rows?: ChargeDraftRow[];
  placeOfSupply?: string | null;
}

export class PurchaseChargesKeyboardEngine {
  rows: ChargeDraftRow[];
  heads: ChargeHeadMaster[];
  placeOfSupply: string | null;
  activeRowIndex: number | null = null;
  activeColumn: ChargeColumn;
  editing = false;
  private editBackup: ChargeDraftRow | null = null;
  private undoBuffer: { row: ChargeDraftRow; index: number } | null = null;

  constructor(options: ChargeEngineOptions) {
    this.heads = options.heads || [];
    this.placeOfSupply = options.placeOfSupply ?? null;
    this.rows = (options.rows || []).map((row) => ({ ...row, touched: [...row.touched] }));
    this.activeColumn = CHARGE_COLUMNS[0].key;
    if (this.rows.length) this.activeRowIndex = 0;
  }

  get columns(): ChargeColumnDef[] {
    return CHARGE_COLUMNS;
  }

  /** The heads this store may charge against, in master order (rule R12). */
  get usableHeads(): ChargeHeadMaster[] {
    return this.heads.filter((head) => head.is_active);
  }

  get activeRow(): ChargeDraftRow | null {
    return this.activeRowIndex === null ? null : this.rows[this.activeRowIndex] || null;
  }

  columnDef(column: ChargeColumn = this.activeColumn): ChargeColumnDef {
    return CHARGE_COLUMNS.find((c) => c.key === column) || CHARGE_COLUMNS[0];
  }

  findHead(code: string): ChargeHeadMaster | null {
    const wanted = String(code || "").trim().toUpperCase();
    if (!wanted) return null;

    return (
      this.heads.find((head) => head.code.toUpperCase() === wanted) ||
      this.heads.find((head) => head.name.toUpperCase() === wanted) ||
      null
    );
  }

  /** Progressive search: the heads whose code or name starts with what has been typed. */
  searchHeads(query: string): ChargeHeadMaster[] {
    const q = String(query || "").trim().toUpperCase();
    if (!q) return this.usableHeads;

    return this.usableHeads.filter(
      (head) => head.code.toUpperCase().startsWith(q) || head.name.toUpperCase().includes(q)
    );
  }

  private setActive(index: number | null, column?: ChargeColumn): void {
    this.activeRowIndex = index;
    if (column) this.activeColumn = column;
  }

  addRow(): number {
    const head = this.activeRow
      ? this.findHead(this.activeRow.head_code)
      : this.usableHeads[0] || null;
    const row = blankChargeRow(head);

    if (this.activeRowIndex === null) {
      this.rows.push(row);
      this.setActive(this.rows.length - 1, "amount");
    } else {
      const insertAt = this.activeRowIndex + 1;
      this.rows.splice(insertAt, 0, row);
      this.setActive(insertAt, "amount");
    }

    return this.activeRowIndex as number;
  }

  deleteActiveRow(): boolean {
    if (this.activeRowIndex === null) return false;
    const index = this.activeRowIndex;
    this.undoBuffer = { row: { ...this.rows[index] }, index };
    this.rows.splice(index, 1);
    this.editing = false;
    this.editBackup = null;
    this.setActive(this.rows.length ? Math.min(index, this.rows.length - 1) : null);
    return true;
  }

  undoDelete(): boolean {
    if (!this.undoBuffer) return false;
    const { row, index } = this.undoBuffer;
    this.rows.splice(Math.min(index, this.rows.length), 0, row);
    this.undoBuffer = null;
    this.setActive(Math.min(index, this.rows.length - 1));
    return true;
  }

  startEdit(): boolean {
    if (this.activeRowIndex === null || this.columnDef().kind === "cycle") return false;
    this.editBackup = { ...this.rows[this.activeRowIndex] };
    this.editing = true;
    return true;
  }

  commitEdit(): boolean {
    if (!this.editing) return false;
    this.editing = false;
    this.editBackup = null;
    return true;
  }

  cancelEdit(): boolean {
    if (!this.editing) return false;
    if (this.editBackup && this.activeRowIndex !== null) {
      this.rows[this.activeRowIndex] = { ...this.editBackup };
    }
    this.editing = false;
    this.editBackup = null;
    return true;
  }

  /** Writes the active cell and marks it as the operator's own value. */
  setCellValue(value: string | number | null): void {
    const row = this.activeRow;
    if (!row) return;
    const column = this.activeColumn;

    if (column === "amount" || column === "gst_percent") {
      const numeric = value === null || value === "" ? null : Number(value);
      if (numeric === null || !Number.isFinite(numeric)) {
        (row as unknown as Record<string, unknown>)[column] = column === "amount" ? null : 0;
      } else {
        (row as unknown as Record<string, unknown>)[column] =
          column === "amount" ? Math.round(numeric * 100) / 100 : numeric;
      }
    } else if (column === "head_code") {
      const head = this.findHead(String(value || ""));
      // An unknown code is refused here and again by resolveCharges: a bill must never be
      // posted against a head this store does not have.
      if (head) this.applyHead(row, head);
    } else if (column === "is_rcm" || column === "paid_separately") {
      row[column] = value === 1 || value === "1" || value === "true";
    } else {
      row[column as "paid_to_label" | "note"] = String(value ?? "");
    }

    this.touch(column);
  }

  /** Where a typed head code went, so the grid can say why a keystroke did nothing. */
  private applyHead(row: ChargeDraftRow, head: ChargeHeadMaster): void {
    row.head_code = head.code;
    if (!row.touched.includes("treatment")) row.treatment = head.default_treatment;
    if (!row.touched.includes("spread_method")) row.spread_method = head.default_spread_method;
    if (!row.touched.includes("itc_eligibility")) {
      row.itc_eligibility = head.default_itc_eligibility;
    }
    row.source = "manual";
  }

  private touch(column: ChargeColumn): void {
    const row = this.activeRow;
    if (!row) return;
    if (column === "paid_separately" && row.paid_separately && !row.paid_to_label) {
      this.activeColumn = "paid_to_label";
    }
    if (!row.touched.includes(column)) row.touched.push(column);
  }

  /** Space advances a cycle cell; the head cell walks this store's own heads. */
  cycle(direction: 1 | -1 = 1): boolean {
    const row = this.activeRow;
    if (!row) return false;
    const column = this.activeColumn;

    if (column === "head_code") {
      const heads = this.usableHeads;
      if (!heads.length) return false;
      const at = heads.findIndex((head) => head.code === row.head_code);
      const next = heads[(at + direction + heads.length) % heads.length];
      this.applyHead(row, next);
      this.touch("head_code");
      return true;
    }

    if (column === "gst_percent") {
      const at = GST_SLABS.indexOf(row.gst_percent);
      row.gst_percent = at === -1 ? GST_SLABS[0] : GST_SLABS[(at + direction + GST_SLABS.length) % GST_SLABS.length];
      this.touch(column);
      return true;
    }

    if (column === "treatment" || column === "spread_method" || column === "itc_eligibility") {
      const options: readonly string[] =
        column === "treatment" ? TREATMENTS : column === "spread_method" ? SPREADS : ITC_FLAGS;
      const at = options.indexOf(String(row[column]));
      const next = options[(at + direction + options.length) % options.length];
      (row as unknown as Record<string, string>)[column] = next;
      this.touch(column);
      return true;
    }

    if (column === "is_rcm" || column === "paid_separately") {
      row[column] = !row[column];
      this.touch(column);
      return true;
    }

    return false;
  }

  handleKeyDown(key: string, options: ChargeKeyOptions = {}): ChargeKeyResult {
    const ctrl = Boolean(options.ctrlOrCmd);
    const normalised = key.length === 1 ? key.toLowerCase() : key;

    if (this.editing) {
      if (normalised === "Enter") return { handled: true, action: this.commitEdit() ? "commit_edit" : "noop" };
      if (normalised === "Escape") return { handled: true, action: this.cancelEdit() ? "cancel_edit" : "noop" };
      return { handled: false };
    }

    if (ctrl && normalised === "Enter") return { handled: true, action: "apply" };
    if (ctrl && normalised === "z") {
      return this.undoDelete() ? { handled: true, action: "undo_delete" } : { handled: false };
    }

    if (normalised === "Insert") {
      this.addRow();
      return { handled: true, action: "add_row" };
    }

    if (this.activeRowIndex === null) {
      if (normalised === "ArrowUp" && this.rows.length) {
        this.setActive(this.rows.length - 1);
        return { handled: true, action: "move_up" };
      }
      if (normalised === "Escape") return { handled: true, action: "close" };
      return { handled: false };
    }

    if (normalised === "ArrowUp") {
      if (this.activeRowIndex > 0) {
        this.activeRowIndex -= 1;
        return { handled: true, action: "move_up" };
      }
      return { handled: true, action: "noop" };
    }

    if (normalised === "ArrowDown") {
      if (this.activeRowIndex < this.rows.length - 1) {
        this.activeRowIndex += 1;
        return { handled: true, action: "move_down" };
      }
      return { handled: true, action: "noop" };
    }

    if (normalised === "ArrowLeft" || normalised === "ArrowRight") {
      const forward = normalised === "ArrowRight";
      const columns = this.columns.map((c) => c.key);
      const at = columns.indexOf(this.activeColumn);
      const next = forward ? at + 1 : at - 1;
      if (next >= 0 && next < columns.length) {
        this.activeColumn = columns[next];
        return { handled: true, action: forward ? "move_right" : "move_left" };
      }
      return { handled: true, action: "noop" };
    }

    // Space and Enter both advance a cycle cell; Enter only opens a typed one.
    if (normalised === " ") {
      const back = Boolean(options.shift);
      return {
        handled: true,
        action: this.cycle(back ? -1 : 1) ? (back ? "cycle_back" : "cycle_forward") : "noop",
      };
    }

    if (normalised === "Enter") {
      if (this.columnDef().kind === "cycle") {
        return { handled: true, action: this.cycle(1) ? "cycle_forward" : "noop" };
      }
      return { handled: true, action: this.startEdit() ? "start_edit" : "noop" };
    }

    if (normalised === "Delete" || normalised === "Backspace") {
      return { handled: true, action: this.deleteActiveRow() ? "delete_row" : "noop" };
    }

    if (normalised === "Escape") return { handled: true, action: "close" };

    return { handled: false };
  }

  /** Amounts are required; an empty row is dropped, never posted as zero. */
  get filledRows(): ChargeDraftRow[] {
    return this.rows.filter((row) => row.head_code && Math.abs(Number(row.amount) || 0) >= 0.005);
  }

  toInputs(): PurchaseChargeInput[] {
    return draftsToInputs(this.rows, this.placeOfSupply);
  }

  /**
   * What the grid can tell without the master or the engine: an unknown or inactive head, a credit
   * on a head that only takes positives, a separately-paid charge with no payee. `resolveCharges`
   * still refuses the post — this is what stops the operator reaching F12 with a broken row.
   */
  errors(): string[] {
    const problems: string[] = [];

    for (const row of this.rows) {
      if (!row.head_code) {
        if (Math.abs(Number(row.amount) || 0) >= 0.005) {
          problems.push("A charge row needs a head (Space on Head).");
        }
        continue;
      }

      const head = this.findHead(row.head_code);
      const label = head ? head.name : row.head_code;

      if (!head) {
        problems.push(`Charge head "${row.head_code}" does not exist in this store (rule R12).`);
      } else if (!head.is_active) {
        problems.push(`Charge head "${head.name}" is not active in this store.`);
      }

      if (Math.abs(Number(row.amount) || 0) < 0.005) {
        problems.push(`"${label}" needs an amount.`);
        continue;
      }

      const amount = Number(row.amount) || 0;
      if (amount < 0 && head?.allowed_sign === "positive") {
        problems.push(`A negative amount is not allowed on the charge head "${label}".`);
      }
      if (amount > 0 && head?.allowed_sign === "negative") {
        problems.push(`Only a credit (negative) amount is allowed on "${label}".`);
      }
      if (row.paid_separately && !row.paid_to_label.trim()) {
        problems.push(`"${label}" is paid separately — say who it was paid to.`);
      }
      if (!Number.isFinite(row.gst_percent) || row.gst_percent < 0 || row.gst_percent > 100) {
        problems.push(`"${label}" has a GST rate the engine cannot price.`);
      }
    }

    return problems;
  }
}

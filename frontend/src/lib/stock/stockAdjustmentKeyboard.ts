import type { StockAdjustmentLineInput, StockAdjustmentMode } from "./stockAdjustmentService";

export type StockAdjustmentColumn =
  | "product_name"
  | "batch_no"
  | "system_qty"
  | "counted_qty"
  | "adjustment_qty"
  | "reason"
  | "unit_cost"
  | "notes";

export interface StockAdjustmentColumnDef {
  key: StockAdjustmentColumn;
  label: string;
  editable: boolean;
}

export type StockAdjustmentRow = StockAdjustmentLineInput;

export type StockAdjustmentKeyAction =
  | "move_up"
  | "move_down"
  | "move_left"
  | "move_right"
  | "focus_last_line"
  | "return_to_entry_row"
  | "start_edit"
  | "commit_edit"
  | "cancel_edit"
  | "delete_line"
  | "undo_delete"
  | "add_line"
  | "toggle_mode"
  | "post"
  | "import_csv"
  | "noop";

export interface StockAdjustmentKeyResult {
  handled: boolean;
  action?: StockAdjustmentKeyAction;
}

export interface StockAdjustmentKeyOptions {
  ctrlOrCmd?: boolean;
  shift?: boolean;
}

const ADJUSTMENT_COLUMNS: StockAdjustmentColumnDef[] = [
  { key: "product_name", label: "Product", editable: true },
  { key: "batch_no", label: "Batch", editable: true },
  { key: "system_qty", label: "System", editable: false },
  { key: "adjustment_qty", label: "Adjustment", editable: true },
  { key: "reason", label: "Reason", editable: true },
  { key: "unit_cost", label: "Unit Cost", editable: true },
  { key: "notes", label: "Notes", editable: true },
];

const PHYSICAL_COUNT_COLUMNS: StockAdjustmentColumnDef[] = [
  { key: "product_name", label: "Product", editable: true },
  { key: "batch_no", label: "Batch", editable: true },
  { key: "system_qty", label: "System", editable: false },
  { key: "counted_qty", label: "Counted", editable: true },
  { key: "reason", label: "Reason", editable: true },
  { key: "notes", label: "Notes", editable: true },
];

export function stockAdjustmentColumns(mode: StockAdjustmentMode): StockAdjustmentColumnDef[] {
  return mode === "physical_count" ? [...PHYSICAL_COUNT_COLUMNS] : [...ADJUSTMENT_COLUMNS];
}

/**
 * Pure state machine for the stock-adjustment document grid. The modal keeps
 * React rendering concerns here-free; this class owns selection, edit
 * lifecycle, undo and the keyboard contract asserted by tests and QA.
 */
export class StockAdjustmentKeyboardEngine {
  rows: StockAdjustmentRow[];
  mode: StockAdjustmentMode;
  activeRowIndex: number | null = null;
  activeColumn: StockAdjustmentColumn;
  editing = false;
  private editBackup: StockAdjustmentRow | null = null;
  private undoBuffer: { row: StockAdjustmentRow; index: number } | null = null;

  constructor(options: { rows?: StockAdjustmentRow[]; mode?: StockAdjustmentMode } = {}) {
    this.rows = (options.rows || []).map((row) => ({ ...row }));
    this.mode = options.mode || "adjustment";
    this.activeColumn = this.navigableColumns[0]?.key || "product_name";
  }

  get columns(): StockAdjustmentColumnDef[] {
    return stockAdjustmentColumns(this.mode);
  }

  get navigableColumns(): StockAdjustmentColumnDef[] {
    return this.columns.filter((column) => column.editable);
  }

  isEditable(column: StockAdjustmentColumn = this.activeColumn): boolean {
    return this.columns.find((c) => c.key === column)?.editable === true;
  }

  effectiveAdjustmentQty(row: StockAdjustmentRow): number {
    if (this.mode === "physical_count") {
      const counted = Number(row.counted_qty ?? NaN);
      if (Number.isNaN(counted)) return 0;
      return Number((counted - Number(row.system_qty || 0)).toFixed(3));
    }
    return Number(row.adjustment_qty || 0);
  }

  setMode(mode: StockAdjustmentMode): void {
    if (mode === this.mode) return;
    this.cancelEdit();
    this.mode = mode;
    if (!this.navigableColumns.some((c) => c.key === this.activeColumn)) {
      this.activeColumn = mode === "physical_count" ? "counted_qty" : "adjustment_qty";
    }
  }

  toggleMode(): StockAdjustmentMode {
    this.setMode(this.mode === "adjustment" ? "physical_count" : "adjustment");
    return this.mode;
  }

  replaceRows(rows: StockAdjustmentRow[]): void {
    this.rows = rows.map((row) => ({ ...row }));
    this.activeRowIndex = this.rows.length > 0 ? 0 : null;
    this.activeColumn = this.navigableColumns[0].key;
    this.editing = false;
    this.editBackup = null;
    this.undoBuffer = null;
  }

  addRow(row: Partial<StockAdjustmentRow> = {}): number {
    const base: StockAdjustmentRow = {
      product_id: "",
      batch_id: "",
      reason: this.mode === "physical_count" ? "Physical Count" : "Other",
      ...row,
    };
    if (this.activeRowIndex === null) {
      this.rows.push(base);
      this.activeRowIndex = this.rows.length - 1;
    } else {
      const insertAt = this.activeRowIndex + 1;
      this.rows.splice(insertAt, 0, base);
      this.activeRowIndex = insertAt;
    }
    this.activeColumn = this.navigableColumns[0].key;
    return this.activeRowIndex;
  }

  deleteActiveRow(): boolean {
    if (this.activeRowIndex === null) return false;
    const index = this.activeRowIndex;
    this.undoBuffer = { row: { ...this.rows[index] }, index };
    this.rows.splice(index, 1);
    if (this.rows.length === 0) {
      this.activeRowIndex = null;
    } else {
      this.activeRowIndex = Math.min(index, this.rows.length - 1);
    }
    this.editing = false;
    this.editBackup = null;
    return true;
  }

  undoDelete(): boolean {
    if (!this.undoBuffer) return false;
    const { row, index } = this.undoBuffer;
    this.rows.splice(index, 0, row);
    this.activeRowIndex = index;
    this.activeColumn = this.navigableColumns[0].key;
    this.undoBuffer = null;
    return true;
  }

  setCellValue(value: string | number | null): void {
    if (this.activeRowIndex === null) return;
    const row = this.rows[this.activeRowIndex];
    if (!row) return;
    const column = this.activeColumn;

    if (column === "counted_qty" || column === "system_qty" || column === "adjustment_qty" || column === "unit_cost") {
      const numeric = value === null || value === "" ? (column === "counted_qty" ? null : 0) : Number(value);
      (row as unknown as Record<string, unknown>)[column] = Number.isNaN(numeric as number) ? null : numeric;
    } else {
      (row as unknown as Record<string, unknown>)[column] = value === null ? "" : String(value);
    }
  }

  startEdit(): boolean {
    if (this.activeRowIndex === null || !this.isEditable()) return false;
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

  handleKeyDown(key: string, options: StockAdjustmentKeyOptions = {}): StockAdjustmentKeyResult {
    const ctrl = Boolean(options.ctrlOrCmd);
    const normalised = key.length === 1 ? key.toLowerCase() : key;

    if (this.editing) {
      if (normalised === "Enter") {
        this.commitEdit();
        return { handled: true, action: "commit_edit" };
      }
      if (normalised === "Escape") {
        this.cancelEdit();
        return { handled: true, action: "cancel_edit" };
      }
      return { handled: false };
    }

    if (ctrl && normalised === "m") {
      this.toggleMode();
      return { handled: true, action: "toggle_mode" };
    }
    if (ctrl && normalised === "Enter") {
      return { handled: true, action: "post" };
    }
    if (ctrl && normalised === "i") {
      return { handled: true, action: "import_csv" };
    }
    if (ctrl && normalised === "z") {
      return this.undoDelete()
        ? { handled: true, action: "undo_delete" }
        : { handled: false };
    }

    if (normalised === "Insert") {
      this.addRow();
      return { handled: true, action: "add_line" };
    }

    // Entry row: no row selected yet.
    if (this.activeRowIndex === null) {
      if (normalised === "ArrowUp" && this.rows.length > 0) {
        this.activeRowIndex = this.rows.length - 1;
        this.activeColumn = this.navigableColumns[0].key;
        return { handled: true, action: "focus_last_line" };
      }
      if (normalised === "ArrowDown") {
        return { handled: true, action: "noop" };
      }
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
      this.activeRowIndex = null;
      return { handled: true, action: "return_to_entry_row" };
    }

    if (normalised === "ArrowLeft" || normalised === "ArrowRight") {
      const columns = this.navigableColumns;
      const current = columns.findIndex((c) => c.key === this.activeColumn);
      const next = normalised === "ArrowLeft" ? current - 1 : current + 1;
      if (next >= 0 && next < columns.length) {
        this.activeColumn = columns[next].key;
        return { handled: true, action: normalised === "ArrowLeft" ? "move_left" : "move_right" };
      }
      return { handled: true, action: "noop" };
    }

    if (normalised === "Enter") {
      return this.startEdit()
        ? { handled: true, action: "start_edit" }
        : { handled: true, action: "noop" };
    }

    if (normalised === "Delete" || normalised === "Backspace") {
      return this.deleteActiveRow()
        ? { handled: true, action: "delete_line" }
        : { handled: true, action: "noop" };
    }

    if (normalised === "Escape") {
      this.activeRowIndex = null;
      return { handled: true, action: "return_to_entry_row" };
    }

    return { handled: false };
  }
}

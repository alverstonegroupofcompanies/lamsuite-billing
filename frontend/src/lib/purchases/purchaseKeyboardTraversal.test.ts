import { describe, it, expect, beforeEach } from "vitest";
import type { PurchaseLineItemInput } from "./purchaseService";

/**
 * State machine simulating the keyboard navigation engine of PurchaseEntryForm
 */
class PurchaseKeyboardTraversalEngine {
  lines: PurchaseLineItemInput[] = [];
  selectedRowIndex: number | null = null;
  selectedCellCol: string = "qty";
  focusContext: "header" | "entry_row" | "grid" | "cell_edit" = "entry_row";
  isEditingCell: boolean = false;
  cellEditBackup: PurchaseLineItemInput | null = null;
  undoDeleteBuffer: { line: PurchaseLineItemInput; index: number } | null = null;
  entryInputFocused: boolean = true;

  readonly visibleNavigableCols = [
    "product_name",
    "batch_no",
    "expiry_date",
    "qty",
    "free_qty",
    "mrp",
    "purchase_rate",
    "discount",
    "gst",
    "selling_rate",
  ];

  addLine(line: PurchaseLineItemInput) {
    this.lines.push(line);
    // After adding from entry row, focus remains in entry row ready for next item
    this.focusContext = "entry_row";
    this.selectedRowIndex = null;
    this.entryInputFocused = true;
  }

  handleKeyDown(key: string, ctrlOrCmd = false): { handled: boolean; action?: string } {
    // 1. In entry row
    if (this.focusContext === "entry_row") {
      if (key === "ArrowUp" && this.lines.length > 0) {
        // Up from entry row moves into last committed line
        this.selectedRowIndex = this.lines.length - 1;
        this.selectedCellCol = "qty";
        this.focusContext = "grid";
        this.entryInputFocused = false;
        return { handled: true, action: "focus_last_line" };
      }
      if (ctrlOrCmd && key.toLowerCase() === "z" && this.undoDeleteBuffer) {
        this.undoLineDelete();
        return { handled: true, action: "undo_delete" };
      }
      return { handled: false };
    }

    // 2. In grid traversal (row / cell navigation)
    if (this.focusContext === "grid" && !this.isEditingCell) {
      if (key === "ArrowUp") {
        if (this.selectedRowIndex !== null && this.selectedRowIndex > 0) {
          this.selectedRowIndex--;
          return { handled: true, action: "move_up" };
        }
        return { handled: true, action: "stay_top" };
      }

      if (key === "ArrowDown") {
        if (this.selectedRowIndex !== null) {
          if (this.selectedRowIndex >= this.lines.length - 1) {
            // Down from last line returns to entry row
            this.selectedRowIndex = null;
            this.focusContext = "entry_row";
            this.entryInputFocused = true;
            return { handled: true, action: "return_to_entry_row" };
          } else {
            this.selectedRowIndex++;
            return { handled: true, action: "move_down" };
          }
        }
      }

      if (key === "ArrowLeft") {
        const curIdx = this.visibleNavigableCols.indexOf(this.selectedCellCol);
        if (curIdx > 0) {
          this.selectedCellCol = this.visibleNavigableCols[curIdx - 1];
          return { handled: true, action: "move_cell_left" };
        }
        return { handled: true, action: "stay_first_cell" };
      }

      if (key === "ArrowRight") {
        const curIdx = this.visibleNavigableCols.indexOf(this.selectedCellCol);
        if (curIdx >= 0 && curIdx < this.visibleNavigableCols.length - 1) {
          this.selectedCellCol = this.visibleNavigableCols[curIdx + 1];
          return { handled: true, action: "move_cell_right" };
        }
        return { handled: true, action: "stay_last_cell" };
      }

      if (key === "Enter") {
        if (this.selectedRowIndex !== null && this.lines[this.selectedRowIndex]) {
          // Enter edits the selected cell
          this.cellEditBackup = { ...this.lines[this.selectedRowIndex] };
          this.isEditingCell = true;
          this.focusContext = "cell_edit";
          return { handled: true, action: "start_cell_edit" };
        }
      }

      if (key === "Delete" || key === "Backspace") {
        if (this.selectedRowIndex !== null) {
          const idx = this.selectedRowIndex;
          this.removeCommittedLine(idx);
          if (this.lines.length === 0) {
            this.selectedRowIndex = null;
            this.focusContext = "entry_row";
            this.entryInputFocused = true;
          } else {
            this.selectedRowIndex = Math.min(idx, this.lines.length - 1);
          }
          return { handled: true, action: "delete_line" };
        }
      }

      if (key === "Escape") {
        // Esc returns to entry row
        this.selectedRowIndex = null;
        this.focusContext = "entry_row";
        this.entryInputFocused = true;
        return { handled: true, action: "escape_to_entry_row" };
      }

      if (ctrlOrCmd && key.toLowerCase() === "z" && this.undoDeleteBuffer) {
        this.undoLineDelete();
        return { handled: true, action: "undo_delete" };
      }
    }

    // 3. In cell edit mode
    if (this.focusContext === "cell_edit" && this.isEditingCell) {
      if (key === "Enter") {
        // Enter saves and commits the cell edit
        this.isEditingCell = false;
        this.focusContext = "grid";
        this.cellEditBackup = null;
        return { handled: true, action: "save_cell_edit" };
      }

      if (key === "Escape") {
        // Esc cancels and reverts cell edit
        if (this.cellEditBackup && this.selectedRowIndex !== null) {
          this.lines[this.selectedRowIndex] = { ...this.cellEditBackup };
        }
        this.isEditingCell = false;
        this.focusContext = "grid";
        this.cellEditBackup = null;
        return { handled: true, action: "cancel_cell_edit" };
      }
    }

    return { handled: false };
  }

  removeCommittedLine(index: number) {
    const target = this.lines[index];
    if (!target) return;
    this.undoDeleteBuffer = { line: target, index };
    this.lines = this.lines.filter((_, i) => i !== index);
  }

  undoLineDelete() {
    if (!this.undoDeleteBuffer) return;
    const { line, index } = this.undoDeleteBuffer;
    this.lines.splice(index, 0, line);
    this.selectedRowIndex = index;
    this.selectedCellCol = "qty";
    this.focusContext = "grid";
    this.undoDeleteBuffer = null;
  }
}

describe("Purchase Inward Keyboard Traversal & Editing (Item 6)", () => {
  let engine: PurchaseKeyboardTraversalEngine;

  beforeEach(() => {
    engine = new PurchaseKeyboardTraversalEngine();
    // Add 3 committed lines
    engine.addLine({
      product_id: "p1",
      product_name: "Amoxicillin 500mg",
      batch_no: "AMX-01",
      expiry_date: "2027-12-31",
      pack_qty: 10,
      purchase_rate: 85,
      mrp: 120,
      gst_percent: 12,
    });
    engine.addLine({
      product_id: "p2",
      product_name: "Dolo 650mg",
      batch_no: "DOL-99",
      expiry_date: "2028-06-30",
      pack_qty: 25,
      purchase_rate: 24,
      mrp: 35,
      gst_percent: 12,
    });
    engine.addLine({
      product_id: "p3",
      product_name: "Azithromycin 500mg",
      batch_no: "AZI-44",
      expiry_date: "2027-10-31",
      pack_qty: 15,
      purchase_rate: 90,
      mrp: 140,
      gst_percent: 12,
    });
  });

  it("1. Up from the entry row moves focus into the last committed line", () => {
    expect(engine.focusContext).toBe("entry_row");
    expect(engine.selectedRowIndex).toBeNull();

    const res = engine.handleKeyDown("ArrowUp");
    expect(res.action).toBe("focus_last_line");
    expect(engine.focusContext).toBe("grid");
    expect(engine.selectedRowIndex).toBe(2); // Last line index
    expect(engine.selectedCellCol).toBe("qty");
  });

  it("2. ArrowUp / ArrowDown moves between committed lines", () => {
    engine.handleKeyDown("ArrowUp"); // Moves to index 2
    expect(engine.selectedRowIndex).toBe(2);

    engine.handleKeyDown("ArrowUp"); // Moves to index 1
    expect(engine.selectedRowIndex).toBe(1);

    engine.handleKeyDown("ArrowUp"); // Moves to index 0
    expect(engine.selectedRowIndex).toBe(0);

    engine.handleKeyDown("ArrowDown"); // Moves to index 1
    expect(engine.selectedRowIndex).toBe(1);
  });

  it("3. Down from the last line returns focus to the entry row", () => {
    engine.handleKeyDown("ArrowUp"); // Moves to index 2
    expect(engine.selectedRowIndex).toBe(2);

    const res = engine.handleKeyDown("ArrowDown");
    expect(res.action).toBe("return_to_entry_row");
    expect(engine.focusContext).toBe("entry_row");
    expect(engine.selectedRowIndex).toBeNull();
    expect(engine.entryInputFocused).toBe(true);
  });

  it("4. ArrowLeft / ArrowRight moves between visible editable cells", () => {
    engine.handleKeyDown("ArrowUp"); // at index 2, col "qty"
    expect(engine.selectedCellCol).toBe("qty");

    engine.handleKeyDown("ArrowRight");
    expect(engine.selectedCellCol).toBe("free_qty");

    engine.handleKeyDown("ArrowRight");
    expect(engine.selectedCellCol).toBe("mrp");

    engine.handleKeyDown("ArrowRight");
    expect(engine.selectedCellCol).toBe("purchase_rate");

    engine.handleKeyDown("ArrowLeft");
    expect(engine.selectedCellCol).toBe("mrp");

    engine.handleKeyDown("ArrowLeft");
    expect(engine.selectedCellCol).toBe("free_qty");
  });

  it("5. Enter edits cell, and Esc cancels edit restoring original value", () => {
    engine.handleKeyDown("ArrowUp"); // row 2, col "qty"
    expect(engine.lines[2].pack_qty).toBe(15);

    // Press Enter to edit
    const enterRes = engine.handleKeyDown("Enter");
    expect(enterRes.action).toBe("start_cell_edit");
    expect(engine.focusContext).toBe("cell_edit");
    expect(engine.isEditingCell).toBe(true);

    // Simulate user typing a modified value
    engine.lines[2].pack_qty = 99;
    expect(engine.lines[2].pack_qty).toBe(99);

    // User presses Esc to cancel
    const escRes = engine.handleKeyDown("Escape");
    expect(escRes.action).toBe("cancel_cell_edit");
    expect(engine.focusContext).toBe("grid");
    expect(engine.isEditingCell).toBe(false);
    expect(engine.lines[2].pack_qty).toBe(15); // Reverted!
  });

  it("6. Enter saves the edited cell value", () => {
    engine.handleKeyDown("ArrowUp"); // row 2
    engine.handleKeyDown("Enter"); // start edit
    expect(engine.isEditingCell).toBe(true);

    // Modify quantity
    engine.lines[2].pack_qty = 40;

    // Press Enter to commit
    const saveRes = engine.handleKeyDown("Enter");
    expect(saveRes.action).toBe("save_cell_edit");
    expect(engine.focusContext).toBe("grid");
    expect(engine.isEditingCell).toBe(false);
    expect(engine.lines[2].pack_qty).toBe(40); // Preserved!
  });

  it("7. Delete removes committed line with Undo (Ctrl+Z)", () => {
    engine.handleKeyDown("ArrowUp"); // row 2 (Azithromycin)
    expect(engine.lines.length).toBe(3);

    // Press Delete
    const delRes = engine.handleKeyDown("Delete");
    expect(delRes.action).toBe("delete_line");
    expect(engine.lines.length).toBe(2);
    expect(engine.lines.map((l) => l.product_name)).not.toContain("Azithromycin 500mg");

    // Press Ctrl+Z to undo
    const undoRes = engine.handleKeyDown("z", true);
    expect(undoRes.action).toBe("undo_delete");
    expect(engine.lines.length).toBe(3);
    expect(engine.lines[2].product_name).toBe("Azithromycin 500mg");
    expect(engine.selectedRowIndex).toBe(2);
  });
});

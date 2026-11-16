import { describe, expect, it } from "vitest";
import {
  StockAdjustmentKeyboardEngine,
  stockAdjustmentColumns,
  type StockAdjustmentRow,
} from "./stockAdjustmentKeyboard";

const row = (overrides: Partial<StockAdjustmentRow> = {}): StockAdjustmentRow => ({
  product_id: "p1",
  product_name: "Paracetamol 500mg",
  batch_id: "b1",
  batch_no: "B-01",
  system_qty: 100,
  adjustment_qty: 0,
  reason: "Damaged",
  unit_cost: 10,
  ...overrides,
});

const lines = (): StockAdjustmentRow[] => [
  row(),
  row({ product_id: "p2", product_name: "Dolo 650mg", batch_id: "b2", batch_no: "D-02", system_qty: 40 }),
  row({ product_id: "p3", product_name: "Azithral 500mg", batch_id: "b3", batch_no: "A-03", system_qty: 25 }),
];

describe("Stock adjustment keyboard engine (item 27)", () => {
  it("publishes the adjustment and physical-count column sets", () => {
    expect(stockAdjustmentColumns("adjustment").map((c) => c.key)).toEqual([
      "product_name",
      "batch_no",
      "system_qty",
      "adjustment_qty",
      "reason",
      "unit_cost",
      "notes",
    ]);
    expect(stockAdjustmentColumns("physical_count").map((c) => c.key)).toEqual([
      "product_name",
      "batch_no",
      "system_qty",
      "counted_qty",
      "reason",
      "notes",
    ]);
  });

  it("Up from the entry row focuses the last line", () => {
    const engine = new StockAdjustmentKeyboardEngine({ rows: lines() });
    expect(engine.activeRowIndex).toBeNull();

    const result = engine.handleKeyDown("ArrowUp");
    expect(result.action).toBe("focus_last_line");
    expect(engine.activeRowIndex).toBe(2);
    expect(engine.activeColumn).toBe("product_name");
  });

  it("moves between rows and returns to the entry row from the last line", () => {
    const engine = new StockAdjustmentKeyboardEngine({ rows: lines() });
    engine.handleKeyDown("ArrowUp");
    expect(engine.activeRowIndex).toBe(2);

    engine.handleKeyDown("ArrowUp");
    expect(engine.activeRowIndex).toBe(1);

    engine.handleKeyDown("ArrowDown");
    expect(engine.activeRowIndex).toBe(2);

    const result = engine.handleKeyDown("ArrowDown");
    expect(result.action).toBe("return_to_entry_row");
    expect(engine.activeRowIndex).toBeNull();
  });

  it("skips read-only system stock while traversing editable cells", () => {
    const engine = new StockAdjustmentKeyboardEngine({ rows: lines() });
    engine.handleKeyDown("ArrowUp");
    expect(engine.activeColumn).toBe("product_name");

    const visited: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      engine.handleKeyDown("ArrowRight");
      visited.push(engine.activeColumn);
    }
    expect(visited).toEqual(["batch_no", "adjustment_qty", "reason", "unit_cost", "notes"]);
    expect(visited).not.toContain("system_qty");

    engine.handleKeyDown("ArrowRight");
    expect(engine.activeColumn).toBe("notes");
    engine.handleKeyDown("ArrowLeft");
    expect(engine.activeColumn).toBe("unit_cost");
  });

  it("Enter edits the cell and Escape reverts the draft", () => {
    const engine = new StockAdjustmentKeyboardEngine({ rows: lines() });
    engine.handleKeyDown("ArrowUp");
    engine.handleKeyDown("ArrowUp"); // row 1 (Dolo)
    engine.handleKeyDown("ArrowRight");
    engine.handleKeyDown("ArrowRight"); // adjustment_qty
    expect(engine.activeColumn).toBe("adjustment_qty");

    expect(engine.handleKeyDown("Enter").action).toBe("start_edit");
    expect(engine.editing).toBe(true);

    engine.setCellValue(-12);
    expect(engine.rows[1].adjustment_qty).toBe(-12);

    expect(engine.handleKeyDown("Escape").action).toBe("cancel_edit");
    expect(engine.editing).toBe(false);
    expect(engine.rows[1].adjustment_qty).toBe(0);
  });

  it("Enter commits the edited value", () => {
    const engine = new StockAdjustmentKeyboardEngine({ rows: lines() });
    engine.handleKeyDown("ArrowUp");
    engine.handleKeyDown("ArrowRight");
    engine.handleKeyDown("ArrowRight");

    engine.handleKeyDown("Enter");
    engine.setCellValue(7);
    expect(engine.handleKeyDown("Enter").action).toBe("commit_edit");
    expect(engine.editing).toBe(false);
    expect(engine.rows[2].adjustment_qty).toBe(7);
  });

  it("does not start editing a read-only cell", () => {
    const engine = new StockAdjustmentKeyboardEngine({ rows: lines() });
    engine.handleKeyDown("ArrowUp");
    engine.activeColumn = "system_qty";
    const result = engine.handleKeyDown("Enter");
    expect(result.action).toBe("noop");
    expect(engine.editing).toBe(false);
  });

  it("Delete removes the selected line and Ctrl+Z restores it", () => {
    const engine = new StockAdjustmentKeyboardEngine({ rows: lines() });
    engine.handleKeyDown("ArrowUp");
    expect(engine.rows).toHaveLength(3);

    expect(engine.handleKeyDown("Delete").action).toBe("delete_line");
    expect(engine.rows).toHaveLength(2);
    expect(engine.rows.map((r) => r.product_name)).not.toContain("Azithral 500mg");

    expect(engine.handleKeyDown("z", { ctrlOrCmd: true }).action).toBe("undo_delete");
    expect(engine.rows).toHaveLength(3);
    expect(engine.rows[2].product_name).toBe("Azithral 500mg");
    expect(engine.activeRowIndex).toBe(2);
  });

  it("Insert adds a line after the active row and focuses its first cell", () => {
    const engine = new StockAdjustmentKeyboardEngine({ rows: lines() });
    engine.handleKeyDown("ArrowUp");
    engine.handleKeyDown("ArrowUp");
    expect(engine.activeRowIndex).toBe(1);

    expect(engine.handleKeyDown("Insert").action).toBe("add_line");
    expect(engine.rows).toHaveLength(4);
    expect(engine.activeRowIndex).toBe(2);
    expect(engine.activeColumn).toBe("product_name");
    expect(engine.rows[2].reason).toBe("Other");
  });

  it("Ctrl+M toggles to physical count and recomputes the delta from the counted qty", () => {
    const engine = new StockAdjustmentKeyboardEngine({ rows: lines() });
    expect(engine.handleKeyDown("m", { ctrlOrCmd: true }).action).toBe("toggle_mode");
    expect(engine.mode).toBe("physical_count");
    expect(engine.navigableColumns.map((c) => c.key)).toEqual([
      "product_name",
      "batch_no",
      "counted_qty",
      "reason",
      "notes",
    ]);

    engine.handleKeyDown("ArrowUp");
    engine.handleKeyDown("ArrowRight");
    engine.handleKeyDown("ArrowRight");
    expect(engine.activeColumn).toBe("counted_qty");

    engine.handleKeyDown("Enter");
    engine.setCellValue(95);
    engine.handleKeyDown("Enter");

    const line = engine.rows[2];
    expect(line.system_qty).toBe(25);
    expect(line.counted_qty).toBe(95);
    expect(engine.effectiveAdjustmentQty(line)).toBe(70);
  });

  it("Ctrl+Enter posts and Ctrl+I opens the CSV importer", () => {
    const engine = new StockAdjustmentKeyboardEngine({ rows: lines() });
    expect(engine.handleKeyDown("Enter", { ctrlOrCmd: true }).action).toBe("post");
    expect(engine.handleKeyDown("i", { ctrlOrCmd: true }).action).toBe("import_csv");
  });

  it("keeps selection on a valid column when switching back from physical count", () => {
    const engine = new StockAdjustmentKeyboardEngine({ rows: lines(), mode: "physical_count" });
    engine.handleKeyDown("ArrowUp");
    engine.activeColumn = "counted_qty";

    engine.toggleMode();
    expect(engine.mode).toBe("adjustment");
    expect(engine.navigableColumns.some((c) => c.key === engine.activeColumn)).toBe(true);
    expect(engine.activeColumn).toBe("adjustment_qty");
  });
});

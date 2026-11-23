import { describe, expect, it } from "vitest";
import { DEFAULT_CHARGE_HEADS, type ChargeHeadMaster } from "../masters/chargeHeadsStore";
import {
  CHARGE_COLUMNS,
  PurchaseChargesKeyboardEngine,
  chargeRowToDraft,
  legacyFreightRow,
  type ChargeColumn,
  type ChargeDraftRow,
} from "./chargesGrid";

/**
 * Task 4.8 (PUR-007) — the grid behind Alt+F, driven the way the operator drives it: arrows move
 * the caret, Space cycles a choice, typing fills a number, and every state change is one
 * `handleKeyDown` away. The modal only paints this, so this is where "fully keyboard-driven" is
 * actually proven.
 */

const HEADS: ChargeHeadMaster[] = DEFAULT_CHARGE_HEADS.map((head, index) => ({
  ...head,
  id: `chg_head_${index + 1}`,
  type: "charge_head",
}));

const engine = (rows: ChargeDraftRow[] = []) =>
  new PurchaseChargesKeyboardEngine({ heads: HEADS, rows });

const press = (grid: PurchaseChargesKeyboardEngine, key: string, options = {}) =>
  grid.handleKeyDown(key, options);

/** Walking the row with the arrow keys — the only way the tests move the caret. */
const goto = (grid: PurchaseChargesKeyboardEngine, column: ChargeColumn) => {
  const keys = CHARGE_COLUMNS.map((c) => c.key);
  let at = keys.indexOf(grid.activeColumn);
  const target = keys.indexOf(column);
  while (at !== target) {
    press(grid, at < target ? "ArrowRight" : "ArrowLeft");
    at = keys.indexOf(grid.activeColumn);
  }
  expect(grid.activeColumn).toBe(column);
};

describe("Alt+F charges grid (PUR-007)", () => {
  it("builds a whole bill's charges from keystrokes alone", () => {
    const grid = engine();

    // An empty grid still gives the operator somewhere to start: Insert makes the first row and
    // lands the caret on the amount, because the head is already chosen.
    expect(press(grid, "Insert")).toEqual({ handled: true, action: "add_row" });
    expect(grid.rows).toHaveLength(1);
    expect(grid.activeColumn).toBe("amount");
    expect(grid.activeRow?.head_code).toBe("FREIGHT");

    grid.setCellValue("200");
    expect(grid.activeRow?.amount).toBe(200);

    // A GST slab is a cycle, not free text: Space walks 0 → 5 → 12 → 18.
    goto(grid, "gst_percent");
    for (let step = 0; step < 3; step++) press(grid, " ");
    expect(grid.activeRow?.gst_percent).toBe(18);

    // Treatment is the cell that decides what the money does after it is posted.
    goto(grid, "treatment");
    expect(press(grid, " ")).toEqual({ handled: true, action: "cycle_forward" });
    expect(grid.activeRow?.treatment).toBe("expense");

    // Shift+Space goes back, so a mistimed cycle is undone without leaving the keyboard.
    expect(press(grid, " ", { shift: true })).toEqual({ handled: true, action: "cycle_back" });
    expect(grid.activeRow?.treatment).toBe("add_to_cost");

    goto(grid, "is_rcm");
    press(grid, " ");
    expect(grid.activeRow?.is_rcm).toBe(true);

    // A second row, then back up to the first: arrows own the rows, Space owns the choices.
    press(grid, "Insert");
    expect(grid.rows).toHaveLength(2);
    grid.setCellValue("50");
    press(grid, "ArrowUp");
    expect(grid.activeRowIndex).toBe(0);

    expect(grid.errors()).toEqual([]);
    const inputs = grid.toInputs();
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      head_code: "FREIGHT",
      amount: 200,
      gst_percent: 18,
      treatment: "add_to_cost",
      is_rcm: true,
    });
    expect(inputs[0].external_id).toBe(grid.rows[0].external_id);
  });

  it("re-prices an untouched row from its head, and never an overridden cell", () => {
    const grid = engine();
    press(grid, "Insert");

    // LOADING presets quantity spread, so cycling the head carries its presets onto a fresh row.
    goto(grid, "head_code");
    press(grid, " ");
    press(grid, " ");
    expect(grid.activeRow?.head_code).toBe("LOADING");
    expect(grid.activeRow?.spread_method).toBe("quantity");

    // The operator chose weight by hand, so the next head must not take that choice away.
    goto(grid, "spread_method");
    press(grid, " ");
    expect(grid.activeRow?.spread_method).toBe("weight");

    goto(grid, "head_code");
    press(grid, " ");
    expect(grid.activeRow?.head_code).toBe("INSURANCE");
    expect(grid.activeRow?.spread_method).toBe("weight");
    expect(grid.activeRow?.treatment).toBe("add_to_cost");

    // OTHER was never touched here, so its own default treatment does apply.
    press(grid, " ");
    expect(grid.activeRow?.head_code).toBe("OTHER");
    expect(grid.activeRow?.treatment).toBe("expense");
  });

  it("refuses a row the engine could not post, before the operator reaches F12", () => {
    // An unknown head is the R12 failure: this store has no such charge.
    const ghost = legacyFreightRow(250)!;
    ghost.head_code = "GHOST";
    expect(engine([ghost]).errors().join(" ")).toContain("does not exist in this store");

    // FREIGHT is positive-only, so a credit on it is refused before the tax engine sees it.
    const signed = engine();
    press(signed, "Insert");
    signed.setCellValue("-200");
    expect(signed.errors().join(" ")).toContain("negative amount is not allowed");

    // OTHER takes both signs, and the same keystroke on it is accepted.
    const credit = engine();
    press(credit, "Insert");
    goto(credit, "head_code");
    for (let step = 0; step < 4; step++) press(credit, " ");
    expect(credit.activeRow?.head_code).toBe("OTHER");
    goto(credit, "amount");
    credit.setCellValue("-200");
    expect(credit.errors()).toEqual([]);

    // PUR-013: money settled on someone else's invoice must say who it was settled with.
    const separate = engine();
    press(separate, "Insert");
    separate.setCellValue("300");
    goto(separate, "paid_separately");
    press(separate, " ");
    expect(separate.activeColumn).toBe("paid_to_label"); // the caret follows the question
    expect(separate.errors().join(" ")).toContain("who it was paid to");
    separate.setCellValue("Transporter - KPS");
    expect(separate.errors()).toEqual([]);
    expect(separate.toInputs()[0]).toMatchObject({
      paid_separately: true,
      paid_to_label: "Transporter - KPS",
    });

    // An empty row is dropped, never posted as zero rupees.
    const blank = engine();
    press(blank, "Insert");
    expect(blank.toInputs()).toEqual([]);
  });

  it("edits, deletes and undoes rows without the mouse", () => {
    const grid = engine([
      chargeRowToDraft({ external_id: "chg-a", head_code: "FREIGHT", amount: 200, gst_percent: 18 }),
      chargeRowToDraft({ external_id: "chg-b", head_code: "PACKING", amount: 100, gst_percent: 18 }),
    ]);

    // A typed cell opens an editor that Enter commits and Escape rolls back (PUR-007).
    goto(grid, "amount");
    expect(press(grid, "Enter")).toEqual({ handled: true, action: "start_edit" });
    grid.setCellValue("250");
    expect(press(grid, "Escape")).toEqual({ handled: true, action: "cancel_edit" });
    expect(grid.activeRow?.amount).toBe(200);

    press(grid, "Enter");
    grid.setCellValue("250");
    expect(press(grid, "Enter")).toEqual({ handled: true, action: "commit_edit" });
    expect(grid.activeRow?.amount).toBe(250);
    expect(grid.editing).toBe(false);

    expect(press(grid, "Delete")).toEqual({ handled: true, action: "delete_row" });
    expect(grid.rows.map((r) => r.external_id)).toEqual(["chg-b"]);
    expect(press(grid, "z", { ctrlOrCmd: true })).toEqual({ handled: true, action: "undo_delete" });
    expect(grid.rows.map((r) => r.external_id)).toEqual(["chg-a", "chg-b"]);
    expect(grid.activeRowIndex).toBe(0);

    expect(press(grid, "Escape")).toEqual({ handled: true, action: "close" });
    expect(press(grid, "Enter", { ctrlOrCmd: true })).toEqual({ handled: true, action: "apply" });
  });

  it("carries a pre-CR-C bill's freight into the grid as a 0% Freight row", () => {
    const row = legacyFreightRow(1200.5)!;
    expect(row).toMatchObject({
      head_code: "FREIGHT",
      amount: 1200.5,
      gst_percent: 0,
      treatment: "add_to_cost",
      source: "legacy_freight",
    });
    expect(legacyFreightRow(0)).toBeNull();

    const grid = engine([row]);
    expect(grid.errors()).toEqual([]);
    expect(grid.toInputs()[0]).toMatchObject({ external_id: "legacy-freight", amount: 1200.5 });

    // Reading a posted row back keeps its head, its flags and the id it syncs on (SYNC-002).
    expect(
      chargeRowToDraft({
        external_id: "chg-freight",
        head_code: "FREIGHT",
        amount: 200,
        gst_percent: 18,
        treatment: "add_to_cost",
        spread_method: "value",
        itc_eligibility: "blocked",
        is_rcm: 1,
        paid_separately: 0,
        paid_to_label: null,
        note: "carrier bill 88",
      })
    ).toMatchObject({
      external_id: "chg-freight",
      head_code: "FREIGHT",
      amount: 200,
      gst_percent: 18,
      itc_eligibility: "blocked",
      is_rcm: true,
      paid_separately: false,
      note: "carrier bill 88",
    });
  });
});

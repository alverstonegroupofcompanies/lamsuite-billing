import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PurchaseChargesModal } from "./PurchaseChargesModal";
import { DEFAULT_CHARGE_HEADS, type ChargeHeadMaster } from "../../lib/masters/chargeHeadsStore";
import type { ChargeDraftRow } from "../../lib/purchases/chargesGrid";
import { calculateDocumentTaxes, type TaxEngineDocumentTotals } from "../../lib/tax-engine/taxEngine";

/**
 * Task 4.8 / PUR-007 proof at the screen edge: the Alt+F grid is operated with keystrokes only.
 * Nothing here fires a click, so a row reaching `onApply` means an operator at a counter with no
 * mouse could have keyed it exactly the same way.
 */

const HEADS: ChargeHeadMaster[] = DEFAULT_CHARGE_HEADS.map((head, index) => ({
  ...head,
  id: `chg_head_${index + 1}`,
  type: "charge_head",
}));

const draft = (over: Partial<ChargeDraftRow> = {}): ChargeDraftRow => ({
  external_id: "chg-existing",
  head_code: "FREIGHT",
  amount: 200,
  gst_percent: 0,
  treatment: "add_to_cost",
  spread_method: "value",
  itc_eligibility: "eligible",
  is_rcm: false,
  paid_separately: false,
  paid_to_label: "",
  note: "",
  touched: ["head_code", "amount"],
  source: "manual",
  ...over,
});

function setup(rows: ChargeDraftRow[] = []) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <PurchaseChargesModal
      isOpen
      heads={HEADS}
      rows={rows}
      placeOfSupply="27"
      totals={null}
      onApply={onApply}
      onClose={onClose}
    />
  );
  return { onApply, onClose };
}

/** Where the grid's caret sits, as the cell it owns. */
const activeCell = () => document.activeElement?.getAttribute("data-cell");

function press(key: string, init: Record<string, unknown> = {}) {
  const target = document.activeElement;
  if (!target) throw new Error("The grid lost focus");
  fireEvent.keyDown(target, { key, ...init });
}

async function cellText(column: string): Promise<string> {
  await waitFor(() => expect(document.querySelector(`[data-cell="0-${column}"]`)).not.toBeNull());
  return document.querySelector(`[data-cell="0-${column}"]`)?.textContent || "";
}

/** The only way these tests move the caret is the arrow key the operator presses. */
const COLUMNS_TO_WALK = 12;

async function goto(column: string) {
  for (let guard = 0; guard < COLUMNS_TO_WALK && activeCell() !== `0-${column}`; guard++) {
    press("ArrowRight");
    await waitFor(() => expect(activeCell()).not.toBeNull());
  }
  expect(activeCell()).toBe(`0-${column}`);
}

describe("PurchaseChargesModal keyboard-only entry (PUR-007)", () => {
  it("keys a freight charge in and applies it without a pointer", async () => {
    const { onApply } = setup();

    // An empty grid seeds its first row from this store's own first head and lands the caret on
    // the amount, because that is the one cell the operator has to key.
    await waitFor(() => expect(activeCell()).toBe("0-amount"));
    expect(await cellText("head_code")).toBe("FREIGHT");

    press("Enter");
    await waitFor(() => expect(document.querySelector('[data-cell-edit="0-amount"]')).not.toBeNull());
    const editor = document.querySelector<HTMLInputElement>('[data-cell-edit="0-amount"]')!;
    fireEvent.change(editor, { target: { value: "200" } });
    press("Enter");
    await waitFor(() => expect(document.querySelector('[data-cell-edit="0-amount"]')).toBeNull());
    expect(await cellText("amount")).toBe("200");

    // GST is a slab walk, not free text: 0 → 5 → 12 → 18.
    await goto("gst_percent");
    for (let step = 0; step < 3; step++) press(" ");
    expect(await cellText("gst_percent")).toBe("18");

    // Treatment and spread came off the Freight head's own presets.
    expect(await cellText("treatment")).toBe("Add to cost");
    expect(await cellText("spread_method")).toBe("Value");

    press("Enter", { ctrlKey: true });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0][0]).toMatchObject({
      head_code: "FREIGHT",
      amount: 200,
      gst_percent: 18,
      treatment: "add_to_cost",
      spread_method: "value",
    });
  });

  it("closes on Escape instead of swallowing the bill behind it", async () => {
    const { onClose } = setup([draft()]);

    await waitFor(() => expect(activeCell()).toBe("0-head_code"));
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refuses a separately-paid charge until it says who it was paid to", async () => {
    const { onApply } = setup([draft()]);

    await waitFor(() => expect(activeCell()).toBe("0-head_code"));
    await goto("paid_separately");
    press(" ");

    // Cycling Paid separately to Yes moves the caret to the payee, because the row needs one.
    await waitFor(() => expect(activeCell()).toBe("0-paid_to_label"));
    press("Enter", { ctrlKey: true });
    expect(onApply).not.toHaveBeenCalled();
    expect(await screen.findByText(/who it was paid to/)).toBeInTheDocument();

    press("Enter");
    await waitFor(() => expect(document.querySelector('[data-cell-edit="0-paid_to_label"]')).not.toBeNull());
    const editor = document.querySelector<HTMLInputElement>('[data-cell-edit="0-paid_to_label"]')!;
    fireEvent.change(editor, { target: { value: "Transport Co" } });
    press("Enter");

    press("Enter", { ctrlKey: true });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0][0]).toMatchObject({
      paid_separately: true,
      paid_to_label: "Transport Co",
    });
  });
});

/**
 * CR-C-11 / PUR-016: the grid prices nothing itself, so the footer is the operator's only chance to
 * see which side of the supplier's payable a separately-paid receipt landed on. These read the
 * totals the parent's engine call produces, not numbers typed into the test.
 */
describe("PurchaseChargesModal payable footer (PUR-013, PUR-016)", () => {
  const freight = {
    charge_id: "C1",
    head_code: "FREIGHT",
    head_name: "Freight",
    amount: 200,
    gst_percent: 18,
    treatment: "add_to_cost",
    spread_method: "value",
    itc_eligibility: "eligible",
    paid_separately: true,
    paid_to_label: "Ganga Courier",
  } as const;

  const priced = (overrides: Record<string, unknown> = {}): TaxEngineDocumentTotals =>
    calculateDocumentTaxes({
      store_state: "32",
      place_of_supply: "32",
      default_tax_mode: "exclusive",
      auto_round_off: false,
      bill_discount: { type: "amount", value: 0 },
      lines: [
        {
          line_id: "L1",
          product_name: "Paracetamol 650mg",
          hsn_code: "30049090",
          qty: 100,
          loose_qty: 0,
          units_per_pack: 1,
          unit_price: 100,
          rate_basis: "ptr",
          discount_percent: 0,
          discount_amount: 0,
          gst_percent: 12,
          cess_percent: 0,
        },
      ],
      charges: [{ ...freight }],
      ...overrides,
    } as any);

  const renderWith = (totals: TaxEngineDocumentTotals) =>
    render(
      <PurchaseChargesModal
        isOpen
        heads={HEADS}
        rows={[draft({ paid_separately: true, paid_to_label: "Ganga Courier" })]}
        placeOfSupply="32"
        totals={totals}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

  const summary = () =>
    (document.querySelector("[data-charge-summary]")?.textContent || "").replace(/\s+/g, " ");

  it("keeps money paid to a courier out of the payable it shows", () => {
    renderWith(priced());

    expect(summary()).toContain("Charges ₹0.00");
    expect(summary()).toContain("+ ₹236.00 paid separately outside the bill");
    expect(summary()).toContain("Payable ₹11200.00");
  });

  it("says so when the store's switch bills that same money into the payable", () => {
    renderWith(priced({ separately_paid_in_payable: true }));

    expect(summary()).toContain("Charges ₹236.00");
    expect(summary()).toContain("incl. ₹236.00 paid separately");
    expect(summary()).not.toContain("outside the bill");
    expect(summary()).toContain("Payable ₹11436.00");

    // The rupee still reached stock, whichever side of the payable the policy put it on.
    expect(summary()).toContain("In stock cost ₹200.00");
  });

  it("shows no payable qualifier for a charge the supplier paid", () => {
    renderWith(priced({ charges: [{ ...freight, paid_separately: false }] }));

    expect(summary()).toContain("Charges ₹236.00");
    expect(summary()).not.toContain("paid separately");
  });
});

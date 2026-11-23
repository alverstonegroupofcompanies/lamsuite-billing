import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PurchaseEntryForm } from "./PurchaseEntryForm";
import {
  purchaseService,
  type PurchaseDocumentRecord,
  type PurchaseItemRecord,
  type PurchaseLineItemInput,
} from "../../lib/purchases/purchaseService";
import type { PurchaseChargeRecord } from "../../lib/reports/purchaseChargeRegister";
import { purchaseDraftService } from "../../lib/purchases/purchaseDraftService";

/**
 * CR-C Task 4.8 / PUR-007 & PUR-017 on the bill itself.
 *
 * The grid's own keystrokes are proven in `PurchaseChargesModal.test.tsx`; this file owns the seam:
 * Alt+F on a live purchase bill raises the grid, what is keyed there prices the totals bar, the
 * vendor-total check and the F12 summary through the one engine pass, and the posted document
 * carries `charges[]` in place of the freight scalar. Every step is a key an operator at a counter
 * would press and no pointer event is fired, so a regression that only shows up in the keyboard
 * path — a chord lost to the bill behind the grid, a bar that disagrees with the grid's footer —
 * fails here rather than at a till.
 */

// The supplier master is not part of this seam; the bill needs one supplier and nothing more.
vi.mock("../../lib/purchases/supplierLedgerService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/purchases/supplierLedgerService")>();
  return {
    ...real,
    supplierLedgerService: {
      ...real.supplierLedgerService,
      getAllSuppliers: async () => [
        { id: "sup_walk", name: "Walkthrough Distributors", is_active: true },
      ],
    },
  };
});

const PACKS: PurchaseLineItemInput = {
  product_id: "prod_1",
  product_name: "Paracetamol 650mg",
  hsn_code: "30049090",
  batch_no: "BATCH-01",
  expiry_date: "2030-12-31",
  pack_qty: 10,
  loose_qty: 0,
  units_per_pack: 1,
  purchase_rate: 100,
  selling_rate: 200,
  discount_type: "percent",
  discount_percent: 0,
  discount_amount: 0,
  gst_percent: 12,
};

const SYRUP: PurchaseLineItemInput = {
  ...PACKS,
  product_id: "prod_2",
  product_name: "Cough Syrup 100ml",
  batch_no: "BATCH-02",
  pack_qty: 4,
  purchase_rate: 50,
  selling_rate: 100,
  gst_percent: 5,
};

const LINES = [PACKS, SYRUP];

// (10 × ₹100 at 12%) + (4 × ₹50 at 5%) = ₹1,330.00 with no charges. Two lines, so no single line
// total can be mistaken for the payable. Every figure asserted below is measured off this.
const GOODS_TOTAL = 1330;

const rupee = (value: number) => `₹ ${value.toFixed(2)}`;

const postedCharge = (over: Partial<PurchaseChargeRecord> = {}): PurchaseChargeRecord => ({
  id: "chg_row_1",
  purchase_id: "pb_walk",
  seq: 1,
  head_code: "PACKING",
  head_name: "Packing",
  note: "Cartons",
  treatment: "add_to_cost",
  spread_method: "value",
  itc_eligibility: "eligible",
  is_rcm: 0,
  paid_separately: 0,
  in_payable: 1,
  amount: 50,
  gst_percent: 12,
  taxable_amount: 50,
  cgst_amount: 3,
  sgst_amount: 3,
  igst_amount: 0,
  cess_amount: 0,
  total_amount: 56,
  allocated_amount: 50,
  source: "manual",
  ...over,
});

const documentRecord = (over: Partial<PurchaseDocumentRecord> = {}): PurchaseDocumentRecord =>
  ({
    id: "pb_walk",
    purchase_number: "PB-0001",
    module_key: "purchase",
    supplier_id: "sup_walk",
    supplier_name: "Walkthrough Distributors",
    supplier_invoice_no: "INV-1",
    purchase_date: "2026-11-20",
    place_of_supply: "32-Kerala",
    is_interstate: 0,
    is_rcm: 0,
    itc_eligibility: "eligible",
    subtotal: GOODS_TOTAL,
    discount_total: 0,
    tax_total: 120,
    cgst_total: 60,
    sgst_total: 60,
    igst_total: 0,
    round_off: 0,
    grand_total: GOODS_TOTAL,
    paid_amount: 0,
    payment_status: "unpaid",
    status: "received",
    sync_state: "pending",
    external_id: "pb_walk",
    created_at: 0,
    updated_at: 0,
    ...over,
  }) as PurchaseDocumentRecord;

const itemRecords = (): PurchaseItemRecord[] =>
  LINES.map((line, index) =>
    ({
      id: `pbi_${index + 1}`,
      purchase_id: "pb_walk",
      ...line,
      total_units: line.pack_qty * (line.units_per_pack || 1),
    }) as unknown as PurchaseItemRecord
  );

/** Where the grid's caret sits, as the cell it owns — the same probe the grid's own tests use. */
const activeCell = () => document.activeElement?.getAttribute("data-cell");

function press(key: string, init: Record<string, unknown> = {}) {
  const target = document.activeElement ?? document.body;
  fireEvent.keyDown(target, { key, ...init });
}

async function cellText(column: string, row = 0): Promise<string> {
  await waitFor(() =>
    expect(document.querySelector(`[data-cell="${row}-${column}"]`)).not.toBeNull()
  );
  return document.querySelector(`[data-cell="${row}-${column}"]`)?.textContent || "";
}

const gridOpen = () => document.querySelector('[data-cell="0-head_code"]') !== null;

/** Alt+F, exactly as an operator at the counter presses it. */
async function altF() {
  press("f", { altKey: true });
  await waitFor(() => expect(gridOpen()).toBe(true));
}

async function altFClosed() {
  press("f", { altKey: true });
  await waitFor(() => expect(gridOpen()).toBe(false));
}

/** The amount the grid seeds its first row with, keyed rather than applied programmatically. */
async function keyAmount(value: string) {
  press("Enter");
  await waitFor(() => expect(document.querySelector('[data-cell-edit="0-amount"]')).not.toBeNull());
  fireEvent.change(document.querySelector<HTMLInputElement>('[data-cell-edit="0-amount"]')!, {
    target: { value },
  });
  press("Enter");
  await waitFor(() => expect(document.querySelector('[data-cell-edit="0-amount"]')).toBeNull());
}

const applyGrid = () => press("Enter", { ctrlKey: true });

async function closeGrid() {
  await waitFor(() => expect(gridOpen()).toBe(false));
}

function setup(props: Partial<ComponentProps<typeof PurchaseEntryForm>> = {}) {
  render(
    <PurchaseEntryForm
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      initialPoData={{
        po_id: "",
        supplier_id: "sup_walk",
        supplier_name: "Walkthrough Distributors",
        lines: LINES,
      }}
      {...props}
    />
  );
}

async function payable(text: string) {
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
}

async function goodsOnlyBill() {
  await payable(rupee(GOODS_TOTAL));
}

describe("Purchase screen charges grid (PUR-007)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("raises the grid on Alt+F and Escape returns to the bill", async () => {
    setup();
    await goodsOnlyBill();

    expect(gridOpen()).toBe(false);

    await altF();
    expect(await screen.findByRole("dialog", { name: "Supplier bill charges" })).toBeInTheDocument();

    press("Escape");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Supplier bill charges" })
      ).not.toBeInTheDocument()
    );

    // Escape dismissed the grid, not the bill behind it.
    expect(screen.getByText(rupee(GOODS_TOTAL))).toBeInTheDocument();
  });

  it("closes on the same Alt+F chord that opened it", async () => {
    setup();
    await goodsOnlyBill();

    await altF();
    await altFClosed();
    expect(
      screen.queryByRole("dialog", { name: "Supplier bill charges" })
    ).not.toBeInTheDocument();
  });

  it("prices a freight charge keyed in the grid through the engine into the totals bar", async () => {
    setup();
    await goodsOnlyBill();

    await altF();
    // The grid seeds its first row from this store's own first head, so no head keystroke is
    // needed for the commonest charge on a pharma bill.
    expect(await cellText("head_code")).toBe("FREIGHT");
    await keyAmount("200");
    applyGrid();
    await closeGrid();

    await payable(rupee(GOODS_TOTAL + 200));
    expect(document.querySelector('[data-charge-total="true"]')?.textContent).toContain("200.00");
  });

  it("keeps the bill's draft and post chords alive while the grid owns Enter and the arrows", async () => {
    const saveDraft = vi
      .spyOn(purchaseDraftService, "saveDraft")
      .mockResolvedValue(undefined as never);

    setup();
    await goodsOnlyBill();

    await altF();
    await keyAmount("200");

    // The caret still belongs to the grid: the arrows walk its columns, not the bill's cells.
    press("ArrowRight");
    expect(activeCell()).toBe("0-gst_percent");

    // PUR-007 names F8 among the chords that must keep working over the open grid.
    press("F8");
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(gridOpen()).toBe(true);

    applyGrid();
    await closeGrid();
    await payable(rupee(GOODS_TOTAL + 200));
  });

  it("shows the charge block in the F12 summary and posts charges[] in place of the freight scalar", async () => {
    const record = vi
      .spyOn(purchaseService, "recordInwardPurchaseBill")
      .mockResolvedValue({ success: true, purchaseId: "pb_new", purchaseNumber: "PB-9" });

    setup();
    await goodsOnlyBill();

    await altF();
    await keyAmount("200");
    applyGrid();
    await closeGrid();

    // Alt+B then type: the bill number the post path insists on, reached by chord alone.
    press("b", { altKey: true });
    await waitFor(() => expect(document.activeElement?.tagName).toBe("INPUT"));
    fireEvent.change(document.activeElement as HTMLInputElement, { target: { value: "INV-77" } });

    press("F12");
    expect(await screen.findByText(/Post Purchase Inward Bill/)).toBeInTheDocument();
    const block = document.querySelector("[data-charge-summary-block]");
    expect(block?.textContent).toContain("Freight");
    expect(block?.textContent).toContain("200.00");

    press("Enter");

    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const doc = record.mock.calls[0][0];
    expect(doc.charges).toHaveLength(1);
    expect(doc.charges![0]).toMatchObject({
      head_code: "FREIGHT",
      amount: 200,
      gst_percent: 0,
      treatment: "add_to_cost",
      spread_method: "value",
    });
    // The scalar is gone from the live path: the money rides on the charge row, never twice.
    expect(doc.freight_charges ?? 0).toBe(0);
  });

  it("checks the vendor invoice total against the charge-inclusive payable", async () => {
    setup();
    await goodsOnlyBill();

    await altF();
    await keyAmount("200");
    applyGrid();
    await closeGrid();

    press("i", { altKey: true });
    await waitFor(() => expect(document.activeElement?.id).toBe("supplier-invoice-total-input"));
    fireEvent.change(document.activeElement as HTMLInputElement, { target: { value: String(GOODS_TOTAL + 200) } });

    // ₹1,320.00 is the payable with the charge in it, so the check reads Match, not Short.
    expect(await screen.findByText("✓ Match")).toBeInTheDocument();
  });
});

describe("Purchase screen charge recall (PUR-017)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a pre-CR-C bill with its freight as a 0% Freight row, priced once", async () => {
    vi.spyOn(purchaseService, "getPurchaseBillById").mockResolvedValue({
      document: documentRecord({ freight_charges: 500 }),
      items: itemRecords(),
      charges: [],
    });

    setup({ editPurchaseId: "pb_walk", initialPoData: null });

    // The carried-over freight is already in the payable — opening a bill restates nothing.
    await payable(rupee(GOODS_TOTAL + 500));

    await altF();
    expect(await cellText("head_code")).toBe("FREIGHT");
    expect(await cellText("amount")).toBe("500");
    expect(await cellText("gst_percent")).toBe("0");
    expect(await cellText("note")).toContain("Freight field");

    applyGrid();
    await closeGrid();
    await payable(rupee(GOODS_TOTAL + 500));
  });

  it("recalls a bill's own posted charge rows into the grid", async () => {
    vi.spyOn(purchaseService, "getPurchaseBillById").mockResolvedValue({
      document: documentRecord(),
      items: itemRecords(),
      charges: [postedCharge()],
    });

    setup({ editPurchaseId: "pb_walk", initialPoData: null });

    // The bill's own row is priced the moment it opens, before the grid is ever raised — and the
    // grid reads its rows once per opening, so this is the state it will be keyed from.
    await payable(rupee(GOODS_TOTAL + 56));

    await altF();
    expect(await cellText("head_code")).toBe("PACKING");
    expect(await cellText("amount")).toBe("50");
    expect(await cellText("gst_percent")).toBe("12");
    expect(await cellText("treatment")).toBe("Add to cost");

    applyGrid();
    await closeGrid();
    // ₹50 at 12% = ₹56.00, priced by the engine alongside the goods.
    await payable(rupee(GOODS_TOTAL + 56));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PurchaseEntryForm } from "./PurchaseEntryForm";
import { purchaseService, type PurchaseLineItemInput } from "../../lib/purchases/purchaseService";
import { productsStore, type ProductBatch, type ProductItem } from "../../lib/masters/productsStore";
import { sqliteStorage } from "../../lib/db/sqliteStorage";

/**
 * G3-PURCHASE-UI (QA round 3).
 *
 * PUR-03: the entry row at the foot of the grid is a line being typed, not a line on the bill. The
 * totals bar, the supplier-total check and the post must all agree on that, so what the operator
 * checks against the paper invoice is exactly what posts.
 *
 * PUR-02: picking an existing batch in the entry row must carry its batch number (and the rest of
 * the batch's details) into the line, so Enter on Sell commits it.
 */

vi.mock("../../lib/purchases/supplierLedgerService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/purchases/supplierLedgerService")>();
  return {
    ...real,
    supplierLedgerService: {
      ...real.supplierLedgerService,
      getAllSuppliers: async () => [{ id: "sup_qa", name: "QA Pharma", is_active: true }],
    },
  };
});

const COMMITTED: PurchaseLineItemInput[] = [
  {
    product_id: "prod_a",
    product_name: "Committed Tablet A",
    hsn_code: "30049090",
    batch_no: "TA-1",
    expiry_date: "2030-12-31",
    pack_qty: 10,
    loose_qty: 0,
    units_per_pack: 1,
    purchase_rate: 100,
    selling_rate: 150,
    discount_type: "percent",
    discount_percent: 0,
    discount_amount: 0,
    gst_percent: 12,
  },
  {
    product_id: "prod_b",
    product_name: "Committed Syrup B",
    hsn_code: "30049090",
    batch_no: "SB-1",
    expiry_date: "2030-12-31",
    pack_qty: 4,
    loose_qty: 0,
    units_per_pack: 1,
    purchase_rate: 50,
    selling_rate: 80,
    discount_type: "percent",
    discount_percent: 0,
    discount_amount: 0,
    gst_percent: 5,
  },
];

// (10 × ₹100 at 12%) + (4 × ₹50 at 5%) = ₹1,330.00 — the two committed lines and nothing else.
const COMMITTED_TOTAL = 1330;

const COUGH_SYRUP: ProductItem = {
  id: "prod_cs",
  name: "QA Cough Syrup 100ml",
  barcode: "8909000000099",
  hsn_sac_code: "30049011",
  mrp: 120,
  sel_rate: 115,
  ptr: 60,
  gst_percent: 12,
  units_per_pack: 1,
  current_stock: 40,
  is_active: true,
} as ProductItem;

const CS_A1: ProductBatch = {
  id: "batch_cs_a1",
  product_id: "prod_cs",
  batch_no: "CS-A1",
  expiry_date: "2027-06-30",
  stock_qty: 40,
  mrp: 120,
  purchase_rate: 60,
  selling_rate: 115,
} as ProductBatch;

const rupee = (value: number) => `₹ ${value.toFixed(2)}`;

function press(key: string, init: Record<string, unknown> = {}, target?: Element | null) {
  fireEvent.keyDown(target ?? document.activeElement ?? document.body, { key, ...init });
}

function mockCatalogue() {
  vi.spyOn(productsStore, "findProductByBarcode").mockImplementation(async (q: string) =>
    q === COUGH_SYRUP.barcode ? COUGH_SYRUP : null
  );
  vi.spyOn(productsStore, "searchProducts").mockImplementation(async (q: string) =>
    COUGH_SYRUP.name.toLowerCase().includes(q.toLowerCase()) ? [COUGH_SYRUP] : []
  );
  vi.spyOn(productsStore, "getAllProducts").mockResolvedValue([COUGH_SYRUP]);
  const realFindAll = sqliteStorage.findAll.bind(sqliteStorage);
  vi.spyOn(sqliteStorage, "findAll").mockImplementation((async (table: string) =>
    table === "product_batches" ? [CS_A1] : realFindAll(table)) as typeof sqliteStorage.findAll);
  vi.spyOn(purchaseService, "getLastPurchaseForItem").mockResolvedValue(null as never);
}

function setup(lines: PurchaseLineItemInput[] = COMMITTED) {
  render(
    <PurchaseEntryForm
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      initialPoData={{ po_id: "", supplier_id: "sup_qa", supplier_name: "QA Pharma", lines }}
    />
  );
}

const productInput = () =>
  screen.getByPlaceholderText(/type product name/i) as HTMLInputElement;

/** Scan the cough syrup into the entry row, as a barcode gun at the counter would. */
async function scanIntoEntryRow(rowIndex = COMMITTED.length) {
  const input = productInput();
  input.focus();
  fireEvent.change(input, { target: { value: COUGH_SYRUP.barcode } });
  press("Enter", {}, input);
  await waitFor(() => expect(document.getElementById(`purchase-batch-${rowIndex}`)).not.toBeNull());
}

async function keyBillNumber(value: string) {
  press("b", { altKey: true });
  await waitFor(() => expect(document.activeElement?.tagName).toBe("INPUT"));
  fireEvent.change(document.activeElement as HTMLInputElement, { target: { value } });
}

describe("Purchase entry row is not on the bill until committed (PUR-03)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCatalogue();
  });

  it("totals and the supplier-total check exclude a line still in the entry row", async () => {
    setup();
    await waitFor(() => expect(screen.getByText(rupee(COMMITTED_TOTAL))).toBeInTheDocument());

    await scanIntoEntryRow();

    // The entry row holds a ₹60 + 12% line; the payable must not move until it is committed.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText(rupee(COMMITTED_TOTAL))).toBeInTheDocument();
    expect(screen.queryByText(rupee(COMMITTED_TOTAL + 67.2))).not.toBeInTheDocument();

    press("i", { altKey: true });
    await waitFor(() => expect(document.activeElement?.id).toBe("supplier-invoice-total-input"));
    fireEvent.change(document.activeElement as HTMLInputElement, { target: { value: String(COMMITTED_TOTAL) } });
    expect(await screen.findByText("✓ Match")).toBeInTheDocument();
  });

  it("F12 is refused while the entry row holds a product, and the posted grand equals the displayed one", async () => {
    const record = vi
      .spyOn(purchaseService, "recordInwardPurchaseBill")
      .mockResolvedValue({ success: true, purchaseId: "pb_new", purchaseNumber: "PB-9" });

    setup();
    await waitFor(() => expect(screen.getByText(rupee(COMMITTED_TOTAL))).toBeInTheDocument());
    await keyBillNumber("QA-PB-001");
    await scanIntoEntryRow();

    press("F12", {}, document.body);
    expect(await screen.findByText(/Press Enter to add the line in the entry row, or Esc to clear it/)).toBeInTheDocument();
    expect(screen.queryByText(/Post Purchase Inward Bill/)).not.toBeInTheDocument();

    // Esc clears the entry row; now F12 opens the summary and the posted bill is the screen's bill.
    // (Once the row holds a product the search input is gone, so the key goes to the page.)
    press("Escape", {}, document.body);
    await waitFor(() => expect(document.getElementById("purchase-batch-2")).toBeNull());

    press("F12", {}, document.body);
    expect(await screen.findByText(/Post Purchase Inward Bill/)).toBeInTheDocument();
    press("Enter");

    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const doc = record.mock.calls[0][0];
    expect(doc.lines).toHaveLength(2);
    const posted = purchaseService.calculateDocumentTotals(doc.lines, false, {
      round_off: doc.round_off,
      charges: [],
    });
    expect(posted.grandTotal).toBeCloseTo(COMMITTED_TOTAL, 2);
  });
});

describe("Picking an existing batch in the entry row (PUR-02)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCatalogue();
  });

  it("commits the line against the picked batch with its batch_no", async () => {
    setup([]);
    await scanIntoEntryRow(0);

    // Batch cell: typing opens the picker with the search seeded; Enter takes the existing batch.
    const trigger = document.getElementById("purchase-batch-0")!;
    trigger.focus();
    press("C", {}, trigger);
    const search = (await screen.findByPlaceholderText(/Search product name or batch number/)) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "CS-A1" } });
    await screen.findByText(/CS-A1/);
    press("Enter", {}, search);

    // The picker shows the batch; the line itself must now carry it.
    await screen.findByText(/40 on hand/);

    const sell = screen.getByPlaceholderText("Sell") as HTMLInputElement;
    sell.focus();
    press("Enter", {}, sell);

    expect(screen.queryByText("Please specify batch number")).not.toBeInTheDocument();
    // Committed: the line is now a grid row showing its batch number, and the entry row is empty.
    await waitFor(() => expect(document.querySelector('[placeholder="Sell"]')).toBeNull());
    expect(screen.getByText("CS-A1")).toBeInTheDocument();
  });
});

describe("Purchase line margin (PUR-04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCatalogue();
  });

  it("shows the pack margin from the same unit and tax basis as the bill", async () => {
    setup([
      {
        product_id: "prod_paracet",
        product_name: "QA Paracet 500 Strip",
        hsn_code: "30049099",
        batch_no: "PA-NEW",
        expiry_date: "2028-01-31",
        pack_qty: 100,
        loose_qty: 0,
        units_per_pack: 15,
        purchase_rate: 60,
        selling_rate: 90,
        discount_type: "percent",
        discount_percent: 0,
        discount_amount: 0,
        gst_percent: 12,
      },
    ]);

    // ₹90 incl 12% is ₹80.36 ex-tax against a ₹60 cost: 25.3%, not the 95.6% that
    // compared a per-tablet cost with a per-strip price.
    expect(await screen.findByText("25.3%")).toBeInTheDocument();
    expect(screen.queryByText("95.6%")).not.toBeInTheDocument();
  });
});

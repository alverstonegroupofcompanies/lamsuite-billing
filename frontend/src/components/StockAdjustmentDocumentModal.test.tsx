import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StockAdjustmentDocumentModal } from "./StockAdjustmentDocumentModal";
import { StockAdjustmentPolicyError } from "../lib/stock/stockAdjustmentService";

const mocks = vi.hoisted(() => ({
  policy: vi.fn(),
  post: vi.fn(),
  parseCsv: vi.fn(),
}));

vi.mock("../lib/masters/productsStore", () => ({
  formatExpiryDisplay: (value: string | null | undefined) => value || "—",
}));

vi.mock("../lib/stock/stockAdjustmentService", () => {
  class MockStockAdjustmentPolicyError extends Error {
    errors: string[];
    lineErrors: Record<number, string[]>;

    constructor(
      message: string,
      errors: string[] = [message],
      lineErrors: Record<number, string[]> = {}
    ) {
      super(message);
      this.name = "StockAdjustmentPolicyError";
      this.errors = errors;
      this.lineErrors = lineErrors;
    }
  }

  return {
    STOCK_ADJUSTMENT_REASONS: [
      "Damaged",
      "Expired",
      "Breakage",
      "Theft",
      "Found Stock",
      "Physical Count",
      "Other",
    ],
    StockAdjustmentPolicyError: MockStockAdjustmentPolicyError,
    getStockAdjustmentPolicy: mocks.policy,
    postStockAdjustment: mocks.post,
    parseStockAdjustmentCsv: mocks.parseCsv,
  };
});

const batches = [
  {
    id: "b1",
    product_id: "p1",
    batch_no: "PAR-01",
    expiry_date: "2027-12-31",
    stock_qty: 100,
    purchase_rate: 24,
  },
  {
    id: "b2",
    product_id: "p2",
    batch_no: "AMX-01",
    expiry_date: "2028-06-30",
    stock_qty: 40,
    purchase_rate: 85,
  },
  {
    id: "b3",
    product_id: "p2",
    batch_no: "AMX-02",
    expiry_date: "2027-01-31",
    stock_qty: 5,
    purchase_rate: 80,
  },
];

const products = {
  p1: { id: "p1", name: "Paracetamol 500mg", mrp: 35 },
  p2: { id: "p2", name: "Amoxicillin 500mg", mrp: 120 },
};

const postedResult = {
  success: true,
  document_id: "adj_1",
  status: "posted" as const,
  requires_approval: false,
  lines_posted: 1,
  total_qty: 10,
  total_value: 240,
};

function renderModal() {
  const onClose = vi.fn();
  const onPosted = vi.fn();
  const utils = render(
    <StockAdjustmentDocumentModal
      isOpen
      batches={batches as any}
      products={products as any}
      onClose={onClose}
      onPosted={onPosted}
    />
  );
  return { onClose, onPosted, ...utils };
}

const entryCell = () => document.querySelector<HTMLElement>('[data-cell-entry="true"]');

function press(key: string, init: Record<string, unknown> = {}) {
  const target = entryCell();
  if (!target) throw new Error("Entry row is not rendered");
  fireEvent.keyDown(target, { key, ...init });
}

const activeCell = () => document.activeElement?.getAttribute("data-cell");

// The modal manager focuses its first control on a macrotask after opening;
// let that run so it cannot steal focus from the grid mid-assertion.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function focusLastLine() {
  press("ArrowUp");
  await waitFor(() => expect(activeCell()).toBe("0-product_name"));
}

/** Opens the combobox the grid mounts in a cell and returns its search field. */
async function openSearch(column: string) {
  const shell = document.querySelector<HTMLElement>(`[data-cell-edit="0-${column}"]`);
  if (!shell) throw new Error(`The ${column} cell is not in edit mode`);
  fireEvent.click(shell.querySelector('[role="combobox"]')!);
  return screen.findByPlaceholderText(/Search product name or batch number/i);
}

async function pickOption(column: string, term: string, contains: string) {
  const search = await openSearch(column);
  fireEvent.change(search, { target: { value: term } });
  const options = await screen.findAllByRole("option");
  const pick = options.find((option) => option.textContent?.includes(contains));
  if (!pick) throw new Error(`No option listing "${contains}"`);
  fireEvent.click(pick);
  return options;
}

describe("StockAdjustmentDocumentModal keyboard grid", () => {
  beforeEach(() => {
    mocks.policy.mockReset();
    mocks.post.mockReset();
    mocks.parseCsv.mockReset();
    mocks.policy.mockReturnValue({
      allow_negative_stock: false,
      require_notes: false,
      max_qty_per_line: null,
      max_value_per_document: null,
      approval_threshold_qty: null,
      approval_threshold_value: null,
      max_documents_per_day: null,
      locked_before_date: null,
      allowed_roles: [],
      approver_roles: [],
    });
    mocks.post.mockResolvedValue(postedResult);
  });

  it("navigates rows and skips the read-only system column with the arrow keys", async () => {
    renderModal();
    await settle();

    await focusLastLine();

    press("ArrowRight");
    await waitFor(() => expect(activeCell()).toBe("0-batch_no"));

    press("ArrowRight");
    await waitFor(() => expect(activeCell()).toBe("0-adjustment_qty"));
  });

  it("starts and commits an in-cell edit with Enter alone", async () => {
    renderModal();
    await settle();
    await focusLastLine();
    press("ArrowRight");
    press("ArrowRight");
    await waitFor(() => expect(activeCell()).toBe("0-adjustment_qty"));

    press("Enter");
    const editor = await waitFor(() =>
      document.querySelector<HTMLInputElement>('[data-cell-edit="0-adjustment_qty"]')
    );
    fireEvent.change(editor!, { target: { value: "-10" } });
    fireEvent.keyDown(editor!, { key: "Enter" });

    await waitFor(() =>
      expect(document.querySelector('[data-cell-edit="0-adjustment_qty"]')).toBeNull()
    );
    expect(document.querySelector('[data-cell="0-adjustment_qty"]')).toHaveTextContent("-10");
  });

  it("uses Escape to cancel only the edit, then Escape again to close", async () => {
    const { onClose } = renderModal();
    await settle();
    await focusLastLine();
    press("Enter");
    const editor = await waitFor(() =>
      document.querySelector<HTMLElement>('[data-cell-edit="0-product_name"]')
    );

    fireEvent.keyDown(editor!, { key: "Escape" });
    await waitFor(() =>
      expect(document.querySelector('[data-cell-edit="0-product_name"]')).toBeNull()
    );
    expect(onClose).not.toHaveBeenCalled();

    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("deletes a line with Delete and restores it with Ctrl+Z", async () => {
    renderModal();
    await settle();
    await focusLastLine();

    press("Delete");
    await waitFor(() =>
      expect(screen.getByText(/to add the first line/i)).toBeInTheDocument()
    );

    press("z", { ctrlKey: true });
    await waitFor(() =>
      expect(document.querySelector('[data-cell="0-product_name"]')).not.toBeNull()
    );
  });

  it("toggles adjustment and physical-count columns with Ctrl+M", async () => {
    renderModal();
    await settle();

    expect(screen.getByRole("columnheader", { name: "Adjustment" })).toBeInTheDocument();
    press("m", { ctrlKey: true });

    await waitFor(() =>
      expect(screen.getByRole("columnheader", { name: "Counted" })).toBeInTheDocument()
    );
    expect(screen.queryByRole("columnheader", { name: "Adjustment" })).toBeNull();
    expect(screen.getByRole("button", { name: /physical count/i })).toBeInTheDocument();
  });

  it("imports CSV through Ctrl+I and applies the valid rows", async () => {
    renderModal();
    await settle();

    press("i", { ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /import csv/i })).toBeInTheDocument()
    );

    mocks.parseCsv.mockReturnValue({
      validLines: [
        {
          product_id: "p1",
          product_name: "Paracetamol 500mg",
          batch_id: "b1",
          batch_no: "PAR-01",
          system_qty: 100,
          adjustment_qty: -4,
          reason: "Damaged",
          unit_cost: 24,
        },
      ],
      invalidRows: [],
      summary: { totalRows: 1, validCount: 1, invalidCount: 0 },
    });
    fireEvent.change(screen.getByPlaceholderText(/barcode,batch,counted/i), {
      target: { value: "8901001,PAR-01,-4,Damaged,Broken strip" },
    });

    fireEvent.click(await screen.findByRole("button", { name: /apply 1 valid line/i }));

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /import csv/i })).toBeNull()
    );
    expect(document.querySelector('[data-cell="0-product_name"]')).toHaveTextContent(
      "Paracetamol 500mg"
    );
  });

  it("posts the document with Ctrl+Enter after selecting a product by keyboard", async () => {
    const { onPosted } = renderModal();
    await settle();
    await focusLastLine();

    press("Enter");
    await pickOption("product_name", "para", "Paracetamol");

    press("Enter", { ctrlKey: true });

    await waitFor(() => expect(onPosted).toHaveBeenCalledWith(postedResult));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    const payload = mocks.post.mock.calls[0][0];
    expect(payload.mode).toBe("adjustment");
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0]).toMatchObject({
      product_id: "p1",
      batch_id: "b1",
      batch_no: "PAR-01",
      system_qty: 100,
    });
  });

  /**
   * The catalog pickers used to be native <select>s over every stocked line, so a
   * four-figure shelf left the pharmacist scrolling for the batch. They now use the
   * searchable combobox the purchase and transfer screens already use.
   */
  it("narrows the product picker by name, batch or barcode instead of scrolling a list", async () => {
    renderModal();
    await settle();
    await focusLastLine();

    press("Enter");
    expect(document.querySelector("select")).toBeNull();

    const search = await openSearch("product_name");
    fireEvent.change(search, { target: { value: "amox" } });

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("AMX-02")])
    );

    fireEvent.click(options.find((option) => option.textContent?.includes("AMX-02"))!);

    await waitFor(() =>
      expect(document.querySelector('[data-cell="0-product_name"]')).toHaveTextContent(
        "Amoxicillin 500mg"
      )
    );
    expect(document.querySelector('[data-cell="0-batch_no"]')).toHaveTextContent("AMX-02");
    expect(document.querySelector('[data-cell="0-system_qty"]')).toHaveTextContent("5");
  });

  it("offers only the chosen product's batches, earliest expiry first, in the batch cell", async () => {
    renderModal();
    await settle();
    await focusLastLine();

    press("Enter");
    await pickOption("product_name", "amox", "AMX-01");

    // Choosing a batch parks the cursor on Adjustment; step back to the batch cell.
    press("ArrowLeft");
    await waitFor(() => expect(activeCell()).toBe("0-batch_no"));
    press("Enter");
    const options = await pickOption("batch_no", "", "AMX-02");

    expect(options.every((option) => option.textContent?.includes("Amoxicillin"))).toBe(true);
    expect(options[0].textContent).toContain("AMX-02");
  });

  it("renders policy rejections with line-level errors instead of posting", async () => {
    const { onPosted } = renderModal();
    mocks.post.mockRejectedValue(
      new StockAdjustmentPolicyError("Blocked by policy", ["Negative stock is blocked."], {
        1: ["Line 1 exceeds the maximum 5 units."],
      })
    );
    await settle();
    await focusLastLine();

    press("Enter", { ctrlKey: true });

    await waitFor(() =>
      expect(screen.getByText("Negative stock is blocked.")).toBeInTheDocument()
    );
    expect(screen.getByText("Line 1 exceeds the maximum 5 units.")).toBeInTheDocument();
    expect(onPosted).not.toHaveBeenCalled();
  });
});

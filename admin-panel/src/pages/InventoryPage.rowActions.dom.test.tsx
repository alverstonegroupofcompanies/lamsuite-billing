import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryPage } from "./InventoryPage";

/**
 * MV-02 — the inventory lists the operator acts on: the batch list, the stock ledger, the near-expiry
 * alert list, the branch transfers and the pending adjustment documents. Each row now carries an action
 * that either reads the record behind it (batch movement, transfer lines, adjustment lines) or hands it
 * to the screen where it can be changed.
 *
 * The Stock Ledger tab used to fetch its rows and render nothing at all, so this also pins the table
 * itself down: no rows on screen means no row actions to test.
 */

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: false,
    role: "super_admin",
    stores: [{ id: 7, name: "Test Store 2", code: "STORE-07", store_type: "pharmacy" }],
    activeStore: { id: 7, name: "Test Store 2", code: "STORE-07", store_type: "pharmacy" },
  }),
}));

const MOVEMENT = {
  transaction_date: "2026-11-19",
  reference_number: "QA-PO-0091",
  product_name: "QA Paracetamol 500mg",
  batch_no: "QA-B1",
  voucher_type: "Purchase Inward",
  in_qty: 100,
  out_qty: 0,
  party_name: "QA Distributors",
};

const NEAR_EXPIRY = [
  {
    id: 400,
    store_id: 7,
    store_name: "Test Store 2",
    product_id: 11,
    product_name: "QA Cough Syrup 100ml",
    batch_no: "QA-S9",
    expiry_date: "2026-12-10",
    stock_qty: 18,
    mrp: 145,
    selling_rate: 138,
    is_expired: false,
    days_remaining: 13,
  },
];

const ADJUSTMENT_DOC = {
  id: 9,
  document_id: "ADJ-2026-11-0004",
  mode: "physical_count",
  status: "pending_approval",
  lines_count: 2,
  total_qty: -6,
  total_value: 870,
  requires_approval: true,
  created_at: "2026-11-21 14:05:00",
  creator: { name: "Anshad" },
};

// Live shape from /admin/inventory/batches: quantities arrive as decimal strings and the product is
// nested, unlike the near-expiry query, which flattens it to product_name.
const BATCH = {
  id: 1854,
  store_id: 7,
  product_id: 1799,
  batch_no: "L1532433B",
  expiry_date: "2026-09-01",
  stock_qty: "366.00",
  mrp: "452.00",
  purchase_rate: "0.00",
  selling_rate: "452.00",
  product: { id: 1799, name: "MC NOX - 40mg", barcode: null, hsn_sac_code: "30049099" },
  store: { id: 7, name: "Test Stiore 2", code: "STORE-07", allow_negative_stock: false },
};

// Live shape from /admin/stock/transfers: lines ride on the list row and received_qty is null until
// the destination branch posts goods receipt.
const TRANSFER = {
  id: 1,
  from_store_id: 1,
  to_store_id: 7,
  transfer_number: "TRF-2026-001",
  status: "dispatched",
  notes: "Urgent branch stock replenishment request",
  created_at: "2026-10-10T11:14:00.000000Z",
  received_at: null,
  from_store: { id: 1, name: "Retail Store" },
  to_store: { id: 7, name: "Test Stiore 2" },
  creator: { id: 1, name: "Muhammad Anshad" },
  items: [
    {
      id: 1,
      product_id: 1,
      batch_no: "DL9812",
      qty: "10.00",
      received_qty: null,
      short_qty: null,
      shortage_reason: null,
      product: { id: 1, name: "Dolo 650mg Tablet" },
    },
  ],
};

const ADJUSTMENT_DETAIL = {
  ...ADJUSTMENT_DOC,
  document_date: "2026-11-21",
  blocking_rule: "value_over_threshold",
  reason: "Monthly physical count",
  approver: null,
  lines: [
    {
      id: 1,
      product_name: "QA Cough Syrup 100ml",
      batch_no: "QA-S9",
      system_qty: 24,
      counted_qty: 18,
      adjustment_qty: -6,
      reason: "Damaged unit write-off",
    },
  ],
};

const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.spyOn(global, "fetch").mockImplementation((async (input: any) => {
    const url = typeof input === "string" ? input : String(input?.url);
    calls.push(url);

    const body = url.includes("/admin/inventory/ledger")
      ? { data: [MOVEMENT], current_page: 1, last_page: 1, total: 1 }
      : url.includes("/admin/inventory/near-expiry")
      ? NEAR_EXPIRY
      : url.includes("/admin/inventory/batches")
      ? { success: true, data: [BATCH], current_page: 1, last_page: 1, total: 1 }
      : url.includes("/admin/stock/transfers")
      ? { success: true, data: [TRANSFER], current_page: 1, last_page: 1, total: 1 }
      : url.includes("/admin/stock-adjustments/policy")
      ? {
          success: true,
          policy: {
            allow_negative_stock: false,
            allowed_roles: ["manager"],
            allowed_reasons: ["Damaged"],
            require_notes: false,
            approver_roles: ["store_owner"],
            max_qty_per_line: null,
            max_value_per_document: 5000,
            max_documents_per_day: null,
            max_units_per_day: null,
            approval_threshold_value: 1000,
            approval_threshold_qty: null,
            locked_before_date: null,
            allowed_time_window: null,
          },
        }
      : url.includes("/admin/stock-adjustments/9")
      ? ADJUSTMENT_DETAIL
      : url.includes("/admin/stock-adjustments")
      ? { data: [ADJUSTMENT_DOC], current_page: 1, last_page: 1, total: 1 }
      : { success: true, data: [], current_page: 1, last_page: 1, total: 0 };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
});

async function openTab(label: string) {
  render(<InventoryPage />);
  await userEvent.click(await screen.findByRole("button", { name: label }));
}

describe("Inventory row actions", () => {
  it("lists stock movements and opens the one under the cursor", async () => {
    await openTab("Stock Ledger");
    const row = (await screen.findByText("QA-PO-0091")).closest("tr") as HTMLTableRowElement;
    await userEvent.click(within(row).getByTitle("View this movement"));

    const modal = await screen.findByTestId("record-inspector");
    expect(within(modal).getByText("QA Distributors")).toBeInTheDocument();
    expect(within(modal).getByText(/Units in/)).toBeInTheDocument();
  });

  it("hands a ledger batch to the batch list where the quantity is actionable", async () => {
    await openTab("Stock Ledger");
    const row = (await screen.findByText("QA-PO-0091")).closest("tr") as HTMLTableRowElement;
    await userEvent.click(within(row).getByTitle("Find this batch in the batch list"));

    // The batch list owns the search box, so the hand-off is the query the list refetches with.
    await waitFor(() =>
      expect(calls.some((u) => u.includes("/admin/inventory/batches") && u.includes("search=QA-B1"))).toBe(true)
    );
  });

  it("reads a near-expiry batch and the movement that left it there", async () => {
    await openTab("Near-Expiry & Expired");
    const row = (await screen.findByText("QA Cough Syrup 100ml")).closest("tr") as HTMLTableRowElement;
    await userEvent.click(within(row).getByTitle("View batch & product movement"));

    const modal = await screen.findByTestId("record-inspector");
    await waitFor(() =>
      expect(calls.some((u) => u.includes("/admin/inventory/ledger?product_id=11"))).toBe(true)
    );
    expect(within(modal).getByText("13 days")).toBeInTheDocument();
    expect(within(modal).getByText("QA-PO-0091")).toBeInTheDocument();
  });

  it("shows the lines of a pending adjustment before approving it", async () => {
    await openTab("Adjustments & Policy");
    const row = (await screen.findByText("ADJ-2026-11-0004")).closest("tr") as HTMLTableRowElement;
    await userEvent.click(within(row).getByTitle("View adjustment lines"));

    const modal = await screen.findByTestId("record-inspector");
    await waitFor(() => expect(calls.some((u) => u.includes("/admin/stock-adjustments/9"))).toBe(true));
    expect(within(modal).getByText("Damaged unit write-off")).toBeInTheDocument();
    expect(within(modal).getByText(/moved no stock yet/)).toBeInTheDocument();
  });

  it("reads a batch straight off the batch list, product nested or flattened", async () => {
    await openTab("Batch Inventory");
    const row = (await screen.findByText("L1532433B")).closest("tr") as HTMLTableRowElement;
    expect(within(row).getByTitle("Reconcile this batch against physical stock")).toBeInTheDocument();

    await userEvent.click(within(row).getByTitle("View batch & product movement"));
    const modal = await screen.findByTestId("record-inspector");
    await waitFor(() =>
      expect(calls.some((u) => u.includes("/admin/inventory/ledger?product_id=1799"))).toBe(true)
    );
    // The batch list nests the product under product.name; only the alert query has days_remaining.
    expect(within(modal).getAllByText("MC NOX - 40mg").length).toBeGreaterThan(0);
    expect(within(modal).queryByText("Days remaining")).toBeNull();
    expect(within(modal).queryByText(/undefined/)).toBeNull();
    expect(within(modal).getByText("QA-PO-0091")).toBeInTheDocument();
  });

  it("reconciles from the batch row with the quantity the list shows", async () => {
    await openTab("Batch Inventory");
    const row = (await screen.findByText("L1532433B")).closest("tr") as HTMLTableRowElement;
    await userEvent.click(within(row).getByTitle("Reconcile this batch against physical stock"));

    const heading = await screen.findByText(/Physical Stock Reconciliation: L1532433B/);
    const modal = heading.closest("div.fixed") as HTMLElement;
    const qtyInput = within(modal).getByRole("spinbutton") as HTMLInputElement;
    expect(qtyInput.value).toBe("366");
  });

  it("unrolls the batch lines of a branch transfer", async () => {
    await openTab("Inter-Store Transfers");
    const row = (await screen.findByText("TRF-2026-001")).closest("tr") as HTMLTableRowElement;
    await userEvent.click(within(row).getByTitle("View transfer lines"));

    const modal = await screen.findByTestId("record-inspector");
    expect(within(modal).getByText("Dolo 650mg Tablet")).toBeInTheDocument();
    expect(within(modal).getByText("Retail Store → Test Stiore 2")).toBeInTheDocument();
    // Nothing has been received yet, so the received and short columns must not read as zeroes.
    expect(within(modal).getByText("Urgent branch stock replenishment request")).toBeInTheDocument();
    expect(within(modal).queryByText(/goods receipt/i)).toBeInTheDocument();
  });
});

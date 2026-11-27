import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransactionsPage } from "./TransactionsPage";

/**
 * MV-01 — every list on Transactions & Ledgers ends in an Actions column, and the View action reads
 * the document the row cannot show: the lines of a credit note, the bill a charge was paid against,
 * the cart a hold parked.
 *
 * The credit note case is the one that used to be a dead end — the row proved a return existed and
 * nothing proved what was returned, which is what a customer query actually asks.
 */

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: false,
    role: "super_admin",
    user: { name: "Anshad", email: "admin@lamstone.in" },
    stores: [],
    activeStore: { id: 7, name: "Test Store 2", code: "STORE-07", store_type: "pharmacy" },
  }),
}));

const CREDIT_NOTE = {
  id: 77,
  invoice_number: "VRT-CR-0007",
  invoice_date: "2026-11-20",
  customer_name: "QA Walk-in Customer",
  tax_total: 90,
  grand_total: 990,
  payment_mode: "Cash",
  status: "issued",
  module_key: "credit_note",
};

const CREDIT_NOTE_DETAIL = {
  ...CREDIT_NOTE,
  round_off: 0,
  credit_note_of: "VRT-000123",
  items: [
    {
      id: 901,
      product_name: "QA Paracetamol 500mg",
      batch_no: "QA-B1",
      qty: 2,
      unit_price: 450,
      gst_percent: 12,
      tax_total: 90,
      total_amount: 990,
    },
  ],
};

const PURCHASE = {
  id: 88,
  invoice_number: "PUR-1001",
  supplier_invoice_no: "SUP-9001",
  invoice_date: "2026-11-18",
  supplier_name: "QA Distributors",
  supplier_id: 44,
  subtotal: 5000,
  tax_total: 600,
  grand_total: 5600,
  paid_amount: 5600,
  status: "paid",
  store: { name: "Test Store 2" },
};

// Live shape from /admin/held-bills: the till's own buffer token as id, held_at in milliseconds,
// and cart_payload as an object whose lines sit under .items.
const HELD_BILL = {
  id: "hold_1795586400000_5024",
  customer_name: "QA Bill Book",
  held_by_counter_name: "Counter 1",
  held_by_user_name: "anshad",
  items_count: 2,
  grand_total: 1450,
  status: "held",
  held_at: 1795586400000,
};

const HELD_BILL_DETAIL = {
  ...HELD_BILL,
  cart_payload: {
    customer: "QA Bill Book",
    items: [
      { id: 1, name: "QA Vitamin C 500mg", batch_no: "QA-V1", qty: 1, rate: 250, total: 250 },
      { id: 2, name: "QA Paracetamol 500mg", batch_no: "QA-B1", qty: 2, rate: 600, total: 1200 },
    ],
  },
};

const TABS = [
  "Sales Invoices",
  "Sales Returns & Credit Notes",
  "Quotations & Estimates",
  "Inward Purchases",
  "Purchase Returns",
  "Purchase Orders",
  "Bill Charges",
  "Held Bills",
  "Shifts & Cash Close",
  "Stock Transfers",
  "Expenses",
  "Customer Receipts",
  "Supplier Payments",
];

const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.spyOn(global, "fetch").mockImplementation((async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : String(input?.url);
    calls.push(url);

    const body = url.includes("/admin/returns")
      ? { data: [CREDIT_NOTE] }
      : url.includes("/admin/invoices/77")
      ? CREDIT_NOTE_DETAIL
      : url.includes("/admin/purchases/88")
      ? { ...PURCHASE, items: [{ id: 1, product_name: "QA Paracetamol 500mg", batch_no: "QA-B1", qty: 10, purchase_rate: 500, total_amount: 5600 }] }
      : url.includes("/admin/purchases")
      ? { data: [PURCHASE] }
      : url.includes("/admin/held-bills/hold_")
      ? HELD_BILL_DETAIL
      : url.includes("/admin/held-bills")
      ? { data: [HELD_BILL] }
      : url.includes("/admin/parties")
      ? { data: [{ id: 44, name: "QA Distributors", current_balance: 0 }] }
      : { success: true, data: [], current_page: 1, last_page: 1, total: 0, approvals: [] };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
});

async function openTab(label: string) {
  render(<TransactionsPage />);
  await userEvent.click(await screen.findByRole("button", { name: label }));
}

describe("Transactions row actions", () => {
  it("ends every list on the page with an Actions column", async () => {
    render(<TransactionsPage />);
    for (const label of TABS) {
      const tab = await screen.findByRole("button", { name: label });
      await userEvent.click(tab);
      await waitFor(async () => {
        expect(await screen.findAllByText("Actions")).not.toHaveLength(0);
      }, { timeout: 4000 });
    }
  });

  it("reads a credit note's lines back from the server instead of offering a cancel", async () => {
    await openTab("Sales Returns & Credit Notes");
    const row = (await screen.findByText("VRT-CR-0007")).closest("tr") as HTMLTableRowElement;
    await userEvent.click(within(row).getByTitle("View credit note"));

    const modal = await screen.findByTestId("record-inspector");
    await waitFor(() => expect(calls.some((u) => u.includes("/admin/invoices/77"))).toBe(true));
    expect(within(modal).getByText("QA Paracetamol 500mg")).toBeInTheDocument();
    expect(within(modal).getByText("QA-B1")).toBeInTheDocument();
    // The note explains why this row has no Cancel, because cancelling double-moves the stock.
    expect(within(modal).getByText(/cancelling would move the stock a second time/)).toBeInTheDocument();
    expect(within(row).queryByTitle(/cancel/i)).toBeNull();
  });

  it("pays the supplier the purchase row was billed under", async () => {
    await openTab("Inward Purchases");
    const row = (await screen.findByText("SUP-9001")).closest("tr") as HTMLTableRowElement;
    await userEvent.click(within(row).getByTitle("Record a payment to this supplier"));

    const heading = await screen.findByText("Record Supplier Payment Disbursement");
    const modal = heading.closest("div.fixed") as HTMLElement;
    const supplierLabel = within(modal).getByText("Select Supplier *");
    const supplierSelect = supplierLabel.parentElement!.querySelector("select") as HTMLSelectElement;
    expect(supplierSelect.value).toBe("44");
    expect(supplierSelect.options[supplierSelect.selectedIndex].text).toContain("QA Distributors");
    expect(calls.some((u) => u.includes("/admin/parties"))).toBe(true);
  });

  it("unparks a held cart's lines and reads its hold time as a time", async () => {
    await openTab("Held Bills");
    const row = (await screen.findByText("QA Bill Book")).closest("tr") as HTMLTableRowElement;
    await userEvent.click(within(row).getByTitle("View held cart"));

    const modal = await screen.findByTestId("record-inspector");
    await waitFor(() => expect(calls.some((u) => u.includes("/admin/held-bills/hold_"))).toBe(true));
    // cart_payload nests its lines under .items, so a flat read of the payload shows an empty cart.
    expect(within(modal).getByText("QA Vitamin C 500mg")).toBeInTheDocument();
    expect(within(modal).getByText("QA Paracetamol 500mg")).toBeInTheDocument();
    expect(within(modal).getAllByText(/1,200\.00/).length).toBeGreaterThan(0);
    // held_at arrives in milliseconds; a seconds read of it would print a 5-digit year, not a date.
    expect(within(modal).queryByText(/Invalid Date/)).toBeNull();
    expect(within(modal).getByText(/^Held \d{2}-\d{2}-2026 \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
    expect(within(modal).getByText(/moved no stock|parked/i)).toBeInTheDocument();
  });
});

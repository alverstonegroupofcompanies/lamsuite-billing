import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SalesReturnPage } from "./SalesReturnPage";
import { invoiceManagementService, type InvoiceRecord } from "../lib/billing/invoiceManagementService";
import { salesReturnService } from "../lib/billing/salesReturnService";
import { partiesStore } from "../lib/masters/partiesStore";
import { shortcutDispatcher } from "../lib/keyboard/shortcutDispatcher";

/**
 * KB-03(a)(b): the returns screen must be keyboard-only.
 *
 * F7 is printed on the "New Return" button, so it must open the return, not re-navigate the
 * page. And once the invoice search finds bills, the arrow keys and Enter must pick one the way
 * every other counter list does - a cashier returning an item never reaches for the mouse.
 */

const invoice = (id: string, number: string, customer: string): InvoiceRecord =>
  ({
    id,
    invoice_number: number,
    invoice_date: "2026-11-20",
    customer_name: customer,
    customer_phone: "9876543210",
    grand_total: 450,
    status: "issued",
  }) as unknown as InvoiceRecord;

const INVOICES = [invoice("inv_1", "C01-INV-0001", "Ravi Kumar"), invoice("inv_2", "C01-INV-0002", "Ravi Kumar")];

function press(key: string, init: Record<string, unknown> = {}) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
}

const invoiceSearch = () =>
  screen.getByLabelText(/Or Search Any Bill/i) as HTMLInputElement;

const resultOptions = () => document.querySelectorAll('[role="listbox"] [role="option"]');

let navSalesReturns: ReturnType<typeof vi.fn>;
let unregisterGlobal: () => void;
let uninstall: () => void;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/returns/sales"]}>
      <SalesReturnPage />
    </MemoryRouter>
  );
}

async function openForm() {
  renderPage();
  fireEvent.click(await screen.findByText("New Return (F7)"));
  await waitFor(() => expect(screen.getByText("New Sales Return / Credit Note")).toBeInTheDocument());
}

async function searchInvoices(query = "Ravi") {
  fireEvent.change(invoiceSearch(), { target: { value: query } });
  await waitFor(() => expect(resultOptions()).toHaveLength(INVOICES.length));
}

describe("Returns screen is keyboard-first (KB-03)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(salesReturnService, "getSalesReturns").mockResolvedValue([]);
    vi.spyOn(salesReturnService, "getReturnedQtyMapForInvoice").mockResolvedValue(new Map());
    vi.spyOn(partiesStore, "searchCustomers").mockResolvedValue([]);
    vi.spyOn(invoiceManagementService, "listInvoices").mockResolvedValue(INVOICES);
    vi.spyOn(invoiceManagementService, "getInvoiceWithDetails").mockImplementation(async (id: string) => ({
      invoice: INVOICES.find((inv) => inv.id === id) || null,
      items: [
        {
          product_id: "prod_1",
          product_name: "Paracetamol 650mg",
          hsn_code: "30049090",
          batch_no: "BATCH-01",
          expiry_date: "2030-12-31",
          qty: 1,
          loose_qty: 0,
          units_per_pack: 1,
          unit_price: 100,
          discount_percent: 0,
          gst_percent: 12,
        },
      ],
    }) as never);

    navSalesReturns = vi.fn(() => true);
    uninstall = shortcutDispatcher.install();
    unregisterGlobal = shortcutDispatcher.register({
      id: "test-global-shell",
      scope: "global",
      handlers: { navSalesReturns },
    });
  });

  afterEach(() => {
    unregisterGlobal();
    uninstall();
  });

  it("opens the New Return form on F7 instead of re-navigating the page", async () => {
    renderPage();
    await screen.findByText("New Return (F7)");

    press("F7");

    expect(await screen.findByText("New Sales Return / Credit Note")).toBeInTheDocument();
    expect(navSalesReturns).not.toHaveBeenCalled();
  });

  it("keeps the caret in the invoice search when F7 is pressed again inside the return", async () => {
    renderPage();
    await screen.findByText("New Return (F7)");

    press("F7");
    await screen.findByText("New Sales Return / Credit Note");
    press("F7");

    await waitFor(() => expect(document.activeElement).toBe(invoiceSearch()));
    expect(navSalesReturns).not.toHaveBeenCalled();
    expect(screen.getByText("New Sales Return / Credit Note")).toBeInTheDocument();
  });

  it("walks the invoice results with the arrows and selects with Enter", async () => {
    await openForm();
    await searchInvoices();

    fireEvent.keyDown(invoiceSearch(), { key: "ArrowDown" });
    fireEvent.keyDown(invoiceSearch(), { key: "Enter" });

    await waitFor(() =>
      expect(invoiceManagementService.getInvoiceWithDetails).toHaveBeenCalledWith("inv_2")
    );
    expect(await screen.findByText("Select items to return:")).toBeInTheDocument();
  });

  it("lets Escape dismiss the results without closing the return form", async () => {
    await openForm();
    await searchInvoices();

    fireEvent.keyDown(invoiceSearch(), { key: "Escape" });

    await waitFor(() => expect(resultOptions()).toHaveLength(0));
    expect(screen.getByText("New Sales Return / Credit Note")).toBeInTheDocument();
  });
});

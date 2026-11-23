import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomerReceiptModal } from "./CustomerReceiptModal";

/**
 * PAY-05: the panel's receipt used to post only the rupees, so the invoice it paid
 * stayed "unpaid" forever. The picker's choices must reach the API — and, when the
 * operator names nothing, the request must carry no allocations key so the server
 * allocates oldest-first itself.
 */

const OPEN_INVOICE = {
  document_type: "invoice",
  document_id: 7,
  document_number: "INV-7001",
  document_date: "2026-10-04",
  grand_total: 500,
  paid_amount: 200,
  outstanding: 300,
};

const postedBodies: any[] = [];

function installReceiptApi() {
  vi.spyOn(global, "fetch").mockImplementation((async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : String(input?.url);
    const method = String(init?.method || "GET").toUpperCase();

    if (/\/admin\/parties/.test(url)) {
      return new Response(
        JSON.stringify({ data: [{ id: 12, name: "Anand Traders", current_balance: 700 }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (/\/admin\/outstanding-documents/.test(url)) {
      return new Response(JSON.stringify({ data: [OPEN_INVOICE] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (method === "POST" && /\/admin\/payments\/customer/.test(url)) {
      postedBodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ success: true, id: 91, allocated_amount: 250, unallocated_amount: 0 }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    }
    throw new TypeError(`Unmocked request in test: ${method} ${url}`);
  }) as typeof fetch);
}

// The customer select is the first of the modal's two selects; the labels are
// not wired to ids, so it is addressed by order.
async function chooseCustomer(): Promise<void> {
  await userEvent.selectOptions(screen.getAllByRole("combobox")[0], "12");
}

async function tickInvoiceSeven(): Promise<void> {
  const row = await screen.findByTestId("allocation-row-invoice:7");
  await userEvent.click(within(row).getByRole("checkbox"));
}

async function openReceipt(): Promise<void> {
  render(<CustomerReceiptModal storeId={3} onClose={() => {}} onSaved={() => {}} />);
  await screen.findByText(/Anand Traders/);
  await chooseCustomer();
}

beforeEach(() => {
  postedBodies.length = 0;
});

describe("CustomerReceiptModal", () => {
  it("posts the bills the operator named", async () => {
    installReceiptApi();
    await openReceipt();

    await userEvent.type(screen.getByPlaceholderText("0.00"), "250");
    await tickInvoiceSeven();
    await userEvent.click(screen.getByRole("button", { name: /record receipt/i }));

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0].allocations).toEqual([{ invoice_id: 7, amount: 250 }]);
  });

  it("sends no allocations key when the operator names no bill", async () => {
    installReceiptApi();
    await openReceipt();

    await userEvent.type(screen.getByPlaceholderText("0.00"), "250");
    await userEvent.click(screen.getByRole("button", { name: /record receipt/i }));

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0]).not.toHaveProperty("allocations");
    expect(postedBodies[0].amount).toBe(250);
  });

  it("says what the receipt actually settled", async () => {
    installReceiptApi();
    const onSaved = vi.fn();
    render(<CustomerReceiptModal storeId={3} onClose={() => {}} onSaved={onSaved} />);
    await screen.findByText(/Anand Traders/);
    await chooseCustomer();
    await userEvent.type(screen.getByPlaceholderText("0.00"), "250");
    await tickInvoiceSeven();
    await userEvent.click(screen.getByRole("button", { name: /record receipt/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0][0]).toContain("₹250.00 settled");
  });
});

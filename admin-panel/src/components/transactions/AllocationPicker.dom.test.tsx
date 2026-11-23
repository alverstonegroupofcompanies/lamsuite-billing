import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationPicker } from "./AllocationPicker";
import type { PaymentAllocationInput } from "../../types";

/**
 * PAY-05: a receipt used to move only the party's balance, so the invoice it paid
 * kept reading "unpaid". The picker is how the operator names the bills; naming
 * none must send no allocations key at all, which is the server's cue to fall
 * back to oldest-open-first.
 */

const INV_OLD: any = {
  document_type: "invoice",
  document_id: 7,
  document_number: "INV-7001",
  document_date: "2026-10-04",
  grand_total: 500,
  paid_amount: 200,
  outstanding: 300,
};
const INV_NEW: any = {
  document_type: "invoice",
  document_id: 9,
  document_number: "INV-7002",
  document_date: "2026-10-11",
  grand_total: 400,
  paid_amount: 0,
  outstanding: 400,
};
const PURCHASE: any = {
  document_type: "purchase",
  document_id: 5,
  document_number: "PUR-220",
  document_date: "2026-10-02",
  grand_total: 5000,
  paid_amount: 1500,
  outstanding: 3500,
};

const requestedUrls: string[] = [];

function installDocumentsApi(rows: any[]) {
  vi.spyOn(global, "fetch").mockImplementation((async (input: any) => {
    const url = typeof input === "string" ? input : String(input?.url);
    if (/\/admin\/outstanding-documents/.test(url)) {
      requestedUrls.push(url);
      return new Response(JSON.stringify({ data: rows }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new TypeError(`Unmocked request in test: ${url}`);
  }) as typeof fetch);
}

function lastEmit(onChange: ReturnType<typeof vi.fn>): PaymentAllocationInput[] | undefined {
  const calls = onChange.mock.calls.map((c) => c[0]);
  return calls[calls.length - 1];
}

beforeEach(() => {
  requestedUrls.length = 0;
});

describe("AllocationPicker", () => {
  it("asks the server for this party's open bills and shows them oldest first", async () => {
    installDocumentsApi([INV_OLD, INV_NEW]);
    const onChange = vi.fn();
    render(
      <AllocationPicker storeId={3} partyType="customer" partyId="12" amount="250" onAllocationsChange={onChange} />
    );

    await screen.findByTestId("allocation-picker");
    expect(requestedUrls[0]).toContain("store_id=3");
    expect(requestedUrls[0]).toContain("party_type=customer");
    expect(requestedUrls[0]).toContain("party_id=12");
    expect(screen.getByTestId("allocation-row-invoice:7")).toHaveTextContent("INV-7001");
    expect(screen.getByTestId("allocation-row-invoice:9")).toHaveTextContent("INV-7002");
    expect(screen.getByTestId("allocation-row-invoice:7")).toHaveTextContent("₹300.00");
  });

  it("sends no allocations at all when the operator names no bill — the FIFO fallback", async () => {
    installDocumentsApi([INV_OLD, INV_NEW]);
    const onChange = vi.fn();
    render(
      <AllocationPicker storeId={3} partyType="customer" partyId="12" amount="250" onAllocationsChange={onChange} />
    );

    await screen.findByTestId("allocation-picker");
    expect(lastEmit(onChange)).toBeUndefined();
    expect(screen.getByText(/clears the oldest open bills by itself/i)).toBeInTheDocument();
  });

  it("never allocates more than the receipt, even across two bills", async () => {
    installDocumentsApi([INV_OLD, INV_NEW]);
    const onChange = vi.fn();
    render(
      <AllocationPicker storeId={3} partyType="customer" partyId="12" amount="250" onAllocationsChange={onChange} />
    );

    await screen.findByTestId("allocation-picker");
    const first = screen.getByTestId("allocation-row-invoice:7");
    await userEvent.click(within(first).getByRole("checkbox"));
    await waitFor(() => expect(lastEmit(onChange)).toEqual([{ invoice_id: 7, amount: 250 }]));

    const second = screen.getByTestId("allocation-row-invoice:9");
    await userEvent.click(within(second).getByRole("checkbox"));
    await waitFor(() => expect(lastEmit(onChange)).toEqual([{ invoice_id: 7, amount: 250 }]));
    expect(within(second).getByRole("spinbutton")).toHaveValue(0);
  });

  it("clamps a typed amount to the bill's own open balance", async () => {
    installDocumentsApi([INV_OLD]);
    const onChange = vi.fn();
    render(
      <AllocationPicker storeId={3} partyType="customer" partyId="12" amount="500" onAllocationsChange={onChange} />
    );

    await screen.findByTestId("allocation-picker");
    const row = screen.getByTestId("allocation-row-invoice:7");
    await userEvent.click(within(row).getByRole("checkbox"));
    const input = within(row).getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "999");
    await userEvent.tab();

    await waitFor(() => expect(lastEmit(onChange)).toEqual([{ invoice_id: 7, amount: 300 }]));
    expect(input).toHaveValue(300);
    expect(within(row).getByText(/open ₹300\.00/)).toBeInTheDocument();
    expect(within(row).getByText("₹300.00")).toBeInTheDocument();
  });

  it("fills oldest first across the party's bills", async () => {
    installDocumentsApi([INV_OLD, INV_NEW]);
    const onChange = vi.fn();
    render(
      <AllocationPicker storeId={3} partyType="customer" partyId="12" amount="500" onAllocationsChange={onChange} />
    );

    await screen.findByTestId("allocation-picker");
    await userEvent.click(screen.getByRole("button", { name: /fill oldest first/i }));

    await waitFor(() =>
      expect(lastEmit(onChange)).toEqual([
        { invoice_id: 7, amount: 300 },
        { invoice_id: 9, amount: 200 },
      ])
    );
  });

  it("names purchase bills with purchase_id for a supplier payment", async () => {
    installDocumentsApi([PURCHASE]);
    const onChange = vi.fn();
    render(
      <AllocationPicker storeId={3} partyType="supplier" partyId="8" amount="2000" onAllocationsChange={onChange} />
    );

    await screen.findByTestId("allocation-picker");
    expect(requestedUrls[0]).toContain("party_type=supplier");
    await userEvent.click(within(screen.getByTestId("allocation-row-purchase:5")).getByRole("checkbox"));
    await waitFor(() => expect(lastEmit(onChange)).toEqual([{ purchase_id: 5, amount: 2000 }]));
  });

  it("drops the named bills when the party changes", async () => {
    installDocumentsApi([INV_OLD]);
    const onChange = vi.fn();
    const { rerender } = render(
      <AllocationPicker storeId={3} partyType="customer" partyId="12" amount="250" onAllocationsChange={onChange} />
    );

    await screen.findByTestId("allocation-picker");
    await userEvent.click(within(screen.getByTestId("allocation-row-invoice:7")).getByRole("checkbox"));
    await waitFor(() => expect(lastEmit(onChange)).toEqual([{ invoice_id: 7, amount: 250 }]));

    installDocumentsApi([INV_NEW]);
    rerender(
      <AllocationPicker storeId={3} partyType="customer" partyId="13" amount="250" onAllocationsChange={onChange} />
    );
    await screen.findByTestId("allocation-row-invoice:9");
    expect(lastEmit(onChange)).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DayClosePage } from "./DayClosePage";

/**
 * DCL-04 — a closed day in the history list is a record, so it gets the row actions of one: read the
 * close as it was posted, and load that date into the panel to reconcile or re-open it.
 */

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: false,
    user: { id: 1, name: "Anshad", email: "admin@lamstone.in", role: "super_admin", store_id: 7 },
    stores: [{ id: 7, name: "Test Store 2", code: "STORE-07", store_type: "pharmacy" }],
    activeStore: { id: 7, name: "Test Store 2", code: "STORE-07", store_type: "pharmacy" },
  }),
}));

const HISTORY_ROW = {
  id: 5,
  close_date: "2026-11-20",
  status: "reconciled",
  gross_sales: 48200,
  cash_collected: 12000,
  digital_collected: 30000,
  refunds: 900,
  expected_cash: 12500,
  counted_cash: 12480,
  cash_variance: -20,
  bills_count: 61,
  locked_at: "2026-11-20 21:40:00",
};

const EMPTY_TENDER = { collected: 0, refunded: 0, net: 0, pending: 0, receipts: 0 };

const SUMMARY = {
  store_id: 7,
  store_name: "Test Store 2",
  close_date: "2026-11-26",
  sales: { gross_total: 0, tax_total: 0, discount_total: 0, bills_count: 0 },
  returns: { count: 0, total: 0 },
  tenders: { cash: EMPTY_TENDER, upi: EMPTY_TENDER, card: EMPTY_TENDER, credit: EMPTY_TENDER },
  cash: { opening_float: 0, cash_sales: 0, cash_refunds: 0, cash_expenses: 0, cash_drops: 0, expected: 0 },
  totals: { cash_collected: 0, digital_collected: 0, credit_sales: 0, refunds: 0, pending_clearance: 0 },
  counters: [],
  shifts: [],
  saved: null,
};

const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.spyOn(global, "fetch").mockImplementation((async (input: any) => {
    const url = typeof input === "string" ? input : String(input?.url);
    calls.push(url);
    const body = url.includes("/admin/day-close/history")
      ? { success: true, history: [HISTORY_ROW] }
      : { success: true, day_close: SUMMARY };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
});

describe("Day close history row actions", () => {
  it("reads a closed day straight from the history row", async () => {
    render(<DayClosePage />);
    const row = (await screen.findByText("2026-11-20")).closest("tr") as HTMLTableRowElement;
    await userEvent.click(within(row).getByTitle("View this day close"));

    const modal = await screen.findByTestId("record-inspector");
    expect(within(modal).getByText("Variance")).toBeInTheDocument();
    expect(within(modal).getByText(/20\.00/)).toBeInTheDocument();
    expect(within(modal).getByText(/61/)).toBeInTheDocument();
  });

  it("loads a history row into the panel without opening another record", async () => {
    render(<DayClosePage />);
    const row = (await screen.findByText("2026-11-20")).closest("tr") as HTMLTableRowElement;
    await userEvent.click(within(row).getByTitle("Load this date into the day close panel"));

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput.value).toBe("2026-11-20");
    expect(screen.queryByTestId("record-inspector")).toBeNull();
    await waitFor(() =>
      expect(calls.some((u) => u.includes("/admin/day-close") && u.includes("date=2026-11-20"))).toBe(true)
    );
  });
});

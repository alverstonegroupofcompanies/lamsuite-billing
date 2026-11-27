import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PurchaseChargesPanel } from "./PurchaseChargesPanel";

/**
 * MV-CHG-01 — a charge row is only half a story. The panel shows what was charged; the row action
 * reads the supplier bill it was spread against, which is the only place the goods value that
 * carried the charge can be checked.
 */

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: false,
    stores: [],
    activeStore: { id: 7, name: "Test Store 2", code: "STORE-07", store_type: "pharmacy" },
  }),
}));

const FREIGHT = {
  id: 501,
  seq: 1,
  external_id: null,
  store: { id: 7, name: "Test Store 2", code: "STORE-07" },
  purchase: { id: 88, invoice_number: "PUR-1001", supplier_name: "QA Distributors", invoice_date: "2026-11-18" },
  head_code: "FREIGHT",
  head_name: "Freight",
  note: "Carrier invoice 4471",
  sac_code: "996731",
  treatment: "add_to_cost",
  spread_method: "value",
  spread_basis_used: "goods_value",
  itc_eligibility: "eligible",
  is_rcm: false,
  paid_separately: false,
  paid_to_label: null,
  in_payable: true,
  amount: 1200,
  gst_percent: 5,
  taxable_amount: 1200,
  cgst_amount: 30,
  sgst_amount: 30,
  igst_amount: 0,
  cess_amount: 0,
  total_tax: 60,
  total_amount: 1260,
  allocated_amount: 1260,
  reversed_amount: 0,
  source: "admin",
};

const CASH_DISCOUNT = {
  ...FREIGHT,
  id: 502,
  seq: 2,
  head_code: "CASH_DISC",
  head_name: "Cash Discount",
  note: null,
  amount: -400,
  taxable_amount: -400,
  cgst_amount: 0,
  sgst_amount: 0,
  total_tax: 0,
  total_amount: -400,
  in_payable: true,
  allocated_amount: 0,
};

const UNSYNCED = { ...FREIGHT, id: 503, purchase: null, head_name: "Loading", head_code: "LOADING" };

const BILL_DETAIL = {
  id: 88,
  invoice_number: "PUR-1001",
  supplier_name: "QA Distributors",
  supplier_gstin: "32AAACQ1234A1Z5",
  invoice_date: "2026-11-18",
  status: "paid",
  subtotal: 20000,
  tax_total: 2400,
  grand_total: 23260,
  paid_amount: 23260,
  charges: [FREIGHT, CASH_DISCOUNT],
};

const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.spyOn(global, "fetch").mockImplementation((async (input: any) => {
    const url = typeof input === "string" ? input : String(input?.url);
    calls.push(url);
    const body = url.includes("/admin/purchases/88")
      ? BILL_DETAIL
      : {
          success: true,
          data: [FREIGHT, CASH_DISCOUNT, UNSYNCED],
          meta: { total: 3, per_page: 25, current_page: 1, last_page: 1 },
          summary: { row_count: 3, charge_amount_total: 2160, in_payable_total: 2160, outside_payable_total: 0 },
        };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
});

describe("Purchase charges row actions", () => {
  it("opens the supplier bill a charge line was spread against", async () => {
    render(<PurchaseChargesPanel />);
    const row = (await screen.findByText("Freight")).closest("tr") as HTMLTableRowElement;
    await userEvent.click(within(row).getByTitle("View the supplier bill this charge sits on"));

    const modal = await screen.findByTestId("record-inspector");
    await waitFor(() => expect(calls.some((u) => u.includes("/admin/purchases/88"))).toBe(true));
    expect(within(modal).getAllByText("PUR-1001").length).toBeGreaterThan(0);
    expect(within(modal).getByText("32AAACQ1234A1Z5")).toBeInTheDocument();
    // The bill's own charge lines come back from the detail endpoint, including the negative one.
    expect(within(modal).getAllByText("Cash Discount").length).toBeGreaterThan(0);
    expect(within(modal).getByText("Goods value (taxable)")).toBeInTheDocument();
  });

  it("marks a charge whose bill has not reached the server as unopenable", async () => {
    render(<PurchaseChargesPanel />);
    const row = (await screen.findByText("Loading")).closest("tr") as HTMLTableRowElement;
    const action = within(row).getByTitle("This charge line has no supplier bill on the server yet") as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(calls.some((u) => u.includes("/admin/purchases/"))).toBe(false);
  });
});

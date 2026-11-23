import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PurchaseChargesPanel } from "./PurchaseChargesPanel";

/**
 * CR-C Task 4.14 — the charges register in the admin panel.
 *
 * The screen answers the accountant's question, not the store manager's: what was keyed as freight,
 * packing or courier across the bills, and is that money inside the supplier's payable or outside
 * it. Both answers are read off the stored row, because the row is what the printed bill promised
 * (PUR-016) — so the panel must render the membership it is handed and never infer it from a switch.
 */

const auth = vi.hoisted(() => ({ isAllStores: false }));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ hasPermission: () => true, isAllStores: auth.isAllStores, activeStore: null, role: "super_admin" }),
}));

const FREIGHT = {
  id: 11,
  seq: 1,
  store: { id: 1, name: "North Store", code: "NST" },
  purchase: { id: 5, invoice_number: "PUR-501", supplier_name: "Distributors NST", invoice_date: "2026-11-15" },
  head_code: "FREIGHT",
  head_name: "Freight",
  note: "Supplier billed it on the invoice",
  treatment: "add_to_cost",
  spread_method: "value",
  itc_eligibility: "eligible",
  is_rcm: false,
  paid_separately: false,
  paid_to_label: null,
  in_payable: true,
  amount: 200,
  gst_percent: 5,
  taxable_amount: 200,
  total_tax: 10,
  total_amount: 210,
  allocated_amount: 210,
  reversed_amount: 0,
  source: "manual",
};

const COURIER = {
  id: 12,
  seq: 2,
  store: { id: 2, name: "South Store", code: "SST" },
  purchase: { id: 6, invoice_number: "PUR-502", supplier_name: "Distributors SST", invoice_date: "2026-11-16" },
  head_code: "OTHER",
  head_name: "Courier",
  note: null,
  treatment: "expense",
  spread_method: "quantity",
  itc_eligibility: "blocked",
  is_rcm: true,
  paid_separately: true,
  paid_to_label: "Courier Co",
  in_payable: false,
  amount: -50,
  gst_percent: 18,
  taxable_amount: 20,
  total_tax: 3.6,
  total_amount: 23.6,
  allocated_amount: 0,
  reversed_amount: 0,
  source: "till_sync",
};

function listOf(...rows: any[]) {
  return {
    success: true,
    data: rows,
    meta: { total: rows.length, per_page: 25, current_page: 1, last_page: 1 },
    summary: {
      row_count: rows.length,
      charge_amount_total: rows.reduce((s, r) => s + Math.abs(r.amount), 0),
      in_payable_total: rows.filter((r) => r.in_payable).reduce((s, r) => s + r.total_amount, 0),
      outside_payable_total: rows.filter((r) => !r.in_payable).reduce((s, r) => s + r.total_amount, 0),
    },
  };
}

const requestedUrls: string[] = [];

function installChargesApi(body: () => any = () => listOf(FREIGHT, COURIER)) {
  vi.spyOn(global, "fetch").mockImplementation((async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : String(input?.url);
    if (/\/admin\/purchase-charges/.test(url)) {
      requestedUrls.push(url);
      return new Response(JSON.stringify(body()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new TypeError(`Unmocked request in test: ${url}`);
  }) as typeof fetch);
}

beforeEach(() => {
  requestedUrls.length = 0;
  auth.isAllStores = false;
});

describe("PurchaseChargesPanel", () => {
  it("names each charge line, the bill it belongs to and where its money sits", async () => {
    installChargesApi();
    render(<PurchaseChargesPanel />);

    const freight = await screen.findByTestId("charge-row-11");
    expect(within(freight).getByText("Freight")).toBeInTheDocument();
    expect(within(freight).getByText("PUR-501")).toBeInTheDocument();
    expect(within(freight).getByText("Distributors NST")).toBeInTheDocument();
    // The rupees are the stored answer: what was keyed, the GST the line carried, and the total.
    expect(within(freight).getByText("₹200.00")).toBeInTheDocument();
    expect(within(freight).getByText("₹10.00")).toBeInTheDocument();
    expect(within(freight).getByText("₹210.00")).toBeInTheDocument();
    expect(within(freight).getByText("In payable")).toBeInTheDocument();

    const courier = screen.getByTestId("charge-row-12");
    expect(within(courier).getByText("Outside payable")).toBeInTheDocument();
    // A separately-paid line is only useful if the screen says who was actually handed the money.
    expect(within(courier).getByText("Courier Co")).toBeInTheDocument();
    // and a negative charge is a legal line, so it must print as negative rather than vanish
    expect(within(courier).getByText("-₹50.00")).toBeInTheDocument();
  });

  it("only names the store when the scope is every store", async () => {
    installChargesApi();
    const { rerender } = render(<PurchaseChargesPanel />);
    await screen.findByTestId("charge-row-11");
    expect(screen.queryByText("North Store")).not.toBeInTheDocument();

    auth.isAllStores = true;
    rerender(<PurchaseChargesPanel />);
    await screen.findByText("South Store");
    expect(screen.getByText("North Store")).toBeInTheDocument();
  });

  it("foots the whole filtered answer, not the page on screen", async () => {
    installChargesApi();
    render(<PurchaseChargesPanel />);

    const summary = await screen.findByTestId("charges-summary");
    // 2 rows, ₹250 keyed, ₹210 rides in the payable, ₹23.60 was paid to somebody else.
    expect(within(summary).getByText(/2 charge lines/)).toBeInTheDocument();
    expect(within(summary).getByText("₹250.00")).toBeInTheDocument();
    expect(within(summary).getByText("₹210.00")).toBeInTheDocument();
    expect(within(summary).getByText("₹23.60")).toBeInTheDocument();
  });

  it("re-reads the register with whichever filter the accountant picks", async () => {
    installChargesApi();
    render(<PurchaseChargesPanel />);
    await screen.findByTestId("charge-row-11");

    await userEvent.selectOptions(screen.getByLabelText("Treatment"), "expense");
    await userEvent.selectOptions(screen.getByLabelText("In payable"), "no");
    // A date field is set whole: typing it one keystroke at a time is a jsdom habit, not what an
    // accountant's browser does with <input type="date">.
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-30" } });

    await waitFor(() => {
      const last = new URL(requestedUrls[requestedUrls.length - 1]);
      expect(last.searchParams.get("treatment")).toBe("expense");
      expect(last.searchParams.get("in_payable")).toBe("no");
      expect(last.searchParams.get("from")).toBe("2026-11-01");
      expect(last.searchParams.get("to")).toBe("2026-11-30");
    });
  });

  it("exports the filtered rows to the last paisa as a file", async () => {
    const csv: string[] = [];
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        blob.text().then((text) => csv.push(text));
        return "blob:charges";
      },
      revokeObjectURL: () => {},
    }));
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      (this as any).__download?.();
    };

    installChargesApi(() => listOf(FREIGHT));
    render(<PurchaseChargesPanel />);
    await screen.findByTestId("charge-row-11");

    await userEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => {
      expect(new URL(requestedUrls[requestedUrls.length - 1]).searchParams.get("export")).toBe("true");
    });
    await waitFor(() => expect(csv.length).toBe(1));

    const text = csv[0];
    expect(text).toContain("head_name");
    expect(text).toContain("Freight");
    expect(text).toContain("PUR-501");
    expect(text).toContain("210");
  });
});

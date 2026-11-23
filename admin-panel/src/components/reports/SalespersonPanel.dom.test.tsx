import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SalespersonPanel } from "./SalespersonPanel";

/**
 * GAP-01 / SPR-015 — who sold what.
 *
 * The register is read inside one store, keeps a renamed person's bills under
 * the name printed on them, and adds up to the store's own sales window: the
 * bills nobody was named on are shown as their own figure instead of vanishing.
 */

const auth = vi.hoisted(() => ({
  activeStore: { id: 1, name: "North Store", code: "NST" },
  isAllStores: false,
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: auth.isAllStores,
    activeStore: auth.activeStore,
  }),
}));

const row = (over: Record<string, any>) => ({
  salesperson_id: 1,
  name: "Rina Thomas",
  code: "SP-01",
  store_id: 1,
  store_name: "North Store",
  archived: false,
  bills: 0,
  returns: 0,
  gross_sales: 0,
  returns_value: 0,
  net_sales: 0,
  discounts: 0,
  net_taxable_value: 0,
  average_bill: 0,
  items: [],
  ...over,
});

const calls: Array<{ method: string; url: string }> = [];

function installApi(payload: Record<string, any>) {
  vi.spyOn(global, "fetch").mockImplementation((async (input: any, init: any = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const url = typeof input === "string" ? input : String(input?.url);
    calls.push({ method, url });

    if (method === "GET") {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch);
}

const REGISTER = {
  date_range: { start_date: "2026-11-01", end_date: "2026-11-30" },
  salespeople: [
    row({
      salesperson_id: 11,
      name: "Rina Thomas",
      code: "SP-01",
      bills: 3,
      returns: 1,
      gross_sales: 1500.5,
      returns_value: 100.25,
      net_sales: 1400.25,
      discounts: 49.75,
      net_taxable_value: 1350.5,
      average_bill: 500.17,
      items: [
        { product_id: 7, product_name: "Paracetamol 500mg", qty: 10, net_value: 950.5 },
        { product_id: 8, product_name: "Vitamin C 1000mg", qty: 2, net_value: 400 },
      ],
    }),
    row({
      salesperson_id: 12,
      name: "Abdul Samad",
      code: "SP-02",
      archived: true,
      bills: 1,
      gross_sales: 200,
      net_sales: 200,
      net_taxable_value: 200,
      average_bill: 200,
    }),
    row({ salesperson_id: 13, name: "Sona Mathew", code: "SP-03" }),
    row({ salesperson_id: 14, name: "Nisha Varghese", code: "SP-04" }),
  ],
  unattributed: row({ salesperson_id: null, name: "Unattributed", bills: 7, gross_sales: 700, net_sales: 700 }),
  totals: row({ name: "All salespeople", bills: 11, returns: 1, gross_sales: 2400.5, net_sales: 2300.25 }),
};

function lineOf(personName: string): HTMLElement {
  const cell = screen.getByText(personName);
  const tr = cell.closest("tr");
  if (!tr) throw new Error(`${personName} is not in a table row`);
  return tr as HTMLElement;
}

async function openPanel() {
  render(<SalespersonPanel startDate="2026-11-01" endDate="2026-11-30" />);
  await waitFor(() => expect(screen.getByText("Rina Thomas")).toBeInTheDocument());
}

beforeEach(() => {
  calls.length = 0;
  auth.isAllStores = false;
});

describe("salesperson register", () => {
  it("asks the server for the window it was given", async () => {
    installApi(REGISTER);
    await openPanel();

    const url = calls.find((c) => /\/admin\/reports\/salesperson/.test(c.url))?.url || "";
    expect(url).toContain("start_date=2026-11-01");
    expect(url).toContain("end_date=2026-11-30");
  });

  it("shows each person's bills, net sales and average bill", async () => {
    installApi(REGISTER);
    await openPanel();

    const rina = lineOf("Rina Thomas");
    expect(rina).toHaveTextContent("SP-01");
    expect(rina).toHaveTextContent(/1,?400\.25/);
    expect(rina).toHaveTextContent(/500\.17/);

    // An archived person still reads as a person, and a person with no bills
    // in the window reads as zeroes rather than silence.
    expect(lineOf("Abdul Samad")).toHaveTextContent("Archived");
    expect(lineOf("Sona Mathew")).toHaveTextContent("0");
    expect(lineOf("Nisha Varghese")).toBeInTheDocument();
  });

  it("shows what each person sold", async () => {
    installApi(REGISTER);
    await openPanel();

    expect(screen.getByText("Paracetamol 500mg")).toBeInTheDocument();
    expect(screen.getByText("Vitamin C 1000mg")).toBeInTheDocument();
    expect(screen.getByText(/10 units/)).toBeInTheDocument();
  });

  it("keeps the bills nobody was named on and totals the window", async () => {
    installApi(REGISTER);
    await openPanel();

    expect(lineOf("Unattributed")).toHaveTextContent(/700/);
    expect(lineOf("All salespeople")).toHaveTextContent(/2,?300\.25/);
  });

  it("names the store when the owner is reading every store at once", async () => {
    auth.isAllStores = true;
    installApi({
      ...REGISTER,
      salespeople: [row({ salesperson_id: 21, name: "Rina Thomas", store_id: 2, store_name: "South Store" })],
      unattributed: row({ salesperson_id: null, name: "Unattributed" }),
    });
    await openPanel();

    expect(screen.getByRole("columnheader", { name: /store/i })).toBeInTheDocument();
    expect(lineOf("Rina Thomas")).toHaveTextContent("South Store");
  });

  it("says so when the store has nobody on the master yet", async () => {
    installApi({ ...REGISTER, salespeople: [] });
    render(<SalespersonPanel startDate="2026-11-01" endDate="2026-11-30" />);

    await waitFor(() => expect(screen.getByText(/no salespeople on the master/i)).toBeInTheDocument());
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsPage } from "./ReportsPage";

/**
 * GAP-02 / PHR-007 — what the owner reads after the gate.
 *
 * The panel used to answer "pharmacy report" with a list of prescribing
 * doctors. The register an inspector asks for is the other question: which
 * scheduled packs left the counter, in what batch and quantity, and which
 * pharmacist put their name on each one. A pack that left unsupervised stays
 * in the book, flagged, because dropping it is how a store stops seeing its
 * own gaps.
 */

const auth = vi.hoisted(() => ({
  isAllStores: false,
  activeStore: null as any,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: auth.isAllStores,
    stores: [
      { id: 1, name: "LamStone Medicos", code: "LMS", store_type: "pharmacy" },
      { id: 2, name: "Fresh Mart", code: "FRM", store_type: "kirana_general" },
    ],
    activeStore: auth.activeStore,
    setActiveStore: vi.fn(),
  }),
}));

const CHEMIST = { id: 1, name: "LamStone Medicos", code: "LMS", store_type: "pharmacy" };
const GROCERY = { id: 2, name: "Fresh Mart", code: "FRM", store_type: "kirana_general" };

const confirmed = {
  store_id: 1,
  store_name: "LamStone Medicos",
  invoice_id: 5,
  invoice_number: "C01-INV-0005",
  invoice_date: "2026-11-10",
  counter_code: "C01",
  is_return: false,
  product_id: 3,
  product_name: "Alprazolam 0.25 Strip",
  batch_no: "BCH-ALP",
  schedule_code: "H1",
  qty: 2,
  unit_price: 100,
  total_amount: 200,
  pharmacist_id: 11,
  pharmacist_name: "Dr. Firoza Ali",
  pharmacist_reg_no: "KPK-2019-45512",
  pharmacist_confirmed_at: "2026-11-10 14:02:11",
};

const unsupervised = {
  ...confirmed,
  invoice_id: 6,
  invoice_number: "C02-INV-0006",
  counter_code: "C02",
  pharmacist_id: null,
  pharmacist_name: null,
  pharmacist_reg_no: null,
  pharmacist_confirmed_at: null,
};

const returned = {
  ...confirmed,
  store_id: 2,
  store_name: "Fresh Mart",
  invoice_id: 7,
  invoice_number: "C01-CN-0007",
  is_return: true,
  qty: -1,
  total_amount: -100,
};

function stubPharmacy(restricted: any) {
  vi.spyOn(global, "fetch").mockImplementation((async (input: any) => {
    const url = typeof input === "string" ? input : String(input?.url);
    const body = url.includes("/admin/reports/pharmacy")
      ? {
          doctor_sales: [
            { doctor_name: "Dr. Mehta", doctor_reg_no: "MCI-88213", rx_count: 3, total_value: 1450 },
          ],
          restricted_drug_register: restricted,
        }
      : {};

    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
    } as Response;
  }) as any);
}

async function openPharmacyTab() {
  render(<ReportsPage />);
  await userEvent.click(
    await screen.findByRole("button", { name: /Rx & Schedule H1 Register/i })
  );
  await waitFor(() => expect(screen.getByText(/Prescription Sales by Registered Doctors/i)).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.isAllStores = false;
  auth.activeStore = CHEMIST;
});

describe("restricted drug register on the panel", () => {
  it("names the pharmacist and the registration beside every scheduled pack", async () => {
    stubPharmacy({ rows: [confirmed], totals: { lines: 1, quantity: 2, value: 200, unconfirmed: 0 } });
    await openPharmacyTab();

    const table = await screen.findByRole("table", { name: /restricted drug register/i });
    const row = within(table).getByRole("row", { name: /Alprazolam 0\.25 Strip/i });

    expect(within(row).getByText("C01-INV-0005")).toBeInTheDocument();
    expect(within(row).getByText("BCH-ALP")).toBeInTheDocument();
    expect(within(row).getByText("H1")).toBeInTheDocument();
    expect(within(row).getByText("Dr. Firoza Ali")).toBeInTheDocument();
    expect(within(row).getByText("KPK-2019-45512")).toBeInTheDocument();
  });

  it("keeps an unsupervised pack in the book and flags it", async () => {
    stubPharmacy({ rows: [confirmed, unsupervised], totals: { lines: 2, quantity: 4, value: 400, unconfirmed: 1 } });
    await openPharmacyTab();

    const table = await screen.findByRole("table", { name: /restricted drug register/i });
    const gap = within(table).getByRole("row", { name: /C02-INV-0006/i });

    expect(within(gap).getByText(/no pharmacist/i)).toBeInTheDocument();
    expect(within(table).getAllByText("Dr. Firoza Ali")).toHaveLength(1);
    expect(screen.getByText(/1 without a pharmacist/i)).toBeInTheDocument();
  });

  it("reads a return as its own entry so the register adds up backwards", async () => {
    stubPharmacy({
      rows: [confirmed, returned],
      totals: { lines: 2, quantity: 1, value: 100, unconfirmed: 0 },
    });
    await openPharmacyTab();

    const table = await screen.findByRole("table", { name: /restricted drug register/i });
    const credit = within(table).getByRole("row", { name: /C01-CN-0007/i });

    expect(within(credit).getByText("-1")).toBeInTheDocument();
    expect(within(credit).getByText(/Return/i)).toBeInTheDocument();
  });

  it("names the branch when the owner is reading every store at once", async () => {
    auth.isAllStores = true;
    stubPharmacy({ rows: [confirmed, returned], totals: { lines: 2, quantity: 1, value: 100, unconfirmed: 0 } });
    await openPharmacyTab();

    const table = await screen.findByRole("table", { name: /restricted drug register/i });

    expect(within(table).getByRole("columnheader", { name: /store/i })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /C01-CN-0007/i })).toHaveTextContent(/Fresh Mart/i);
  });

  it("says plainly when the window holds no scheduled packs", async () => {
    stubPharmacy({ rows: [], totals: { lines: 0, quantity: 0, value: 0, unconfirmed: 0 } });
    await openPharmacyTab();

    expect(await screen.findByText(/no scheduled packs were dispensed/i)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /restricted drug register/i })).not.toBeInTheDocument();
    // The doctor list is still the other half of the same report.
    expect(screen.getByText("Dr. Mehta")).toBeInTheDocument();
  });

  it("keeps the whole pharmacy report off a store that sells no medicines", async () => {
    auth.activeStore = GROCERY;
    stubPharmacy({ rows: [], totals: { lines: 0, quantity: 0, value: 0, unconfirmed: 0 } });

    render(<ReportsPage />);

    expect(screen.queryByRole("button", { name: /Rx & Schedule H1 Register/i })).not.toBeInTheDocument();
  });
});

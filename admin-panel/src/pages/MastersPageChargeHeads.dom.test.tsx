import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MastersPage } from "./MastersPage";

/**
 * CR-C Task 4.14 — the charge heads master.
 *
 * A head is what prefills the POS charges grid, so its defaults are the store's answer to "what
 * kind of money is this": treatment, spread, ITC eligibility and the signs it accepts. Heads are
 * store-scoped (R12), the seeded set is restorable, and a head that posted charges already carries
 * cannot be deleted until those charges are moved — the lifecycle units got in v2.1.1.
 */

const auth = vi.hoisted(() => ({ storeId: 1 }));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: false,
    role: "super_admin",
    activeStore: { id: auth.storeId, name: "North Store", code: "NST", store_type: "pharmacy" },
  }),
}));

const FREIGHT = {
  id: 21,
  store_id: 1,
  type: "charge_head",
  name: "Freight",
  code: "FREIGHT",
  description: null,
  is_active: true,
  config: {
    sac_code: "996731",
    default_treatment: "add_to_cost",
    default_spread_method: "value",
    default_itc_eligibility: "eligible",
    allowed_sign: "positive",
    seeded: true,
  },
};

const CASH_DISCOUNT = {
  id: 22,
  store_id: 1,
  type: "charge_head",
  name: "Cash Discount",
  code: "CASH_DISC",
  description: "Supplier's own early-payment discount",
  is_active: true,
  config: {
    sac_code: null,
    default_treatment: "add_to_cost",
    default_spread_method: "value",
    default_itc_eligibility: "eligible",
    allowed_sign: "negative",
    seeded: false,
  },
};

const heads = { data: [FREIGHT, CASH_DISCOUNT], current_page: 1, last_page: 1, total: 2 };

const calls: Array<{ method: string; url: string; body: any }> = [];

function installApi(handlers: Array<[string, RegExp, { status?: number; body: any }]>) {
  vi.spyOn(global, "fetch").mockImplementation((async (input: any, init: any = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const url = typeof input === "string" ? input : String(input?.url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    for (const [m, pattern, reply] of handlers) {
      if (m !== method || !pattern.test(url)) continue;
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: [], current_page: 1, last_page: 1, total: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
}

async function openChargeHeadsTab() {
  render(<MastersPage />);
  await userEvent.click(await screen.findByRole("button", { name: /Charge Heads/i }));
  await screen.findByText("Cash Discount");
}

beforeEach(() => {
  calls.length = 0;
  auth.storeId = 1;
});

describe("MastersPage charge heads", () => {
  it("reads the store's own heads with the defaults each one carries", async () => {
    installApi([["GET", /lookups\?.*type=charge_head/, { body: heads }]]);
    await openChargeHeadsTab();

    const freight = screen.getByText("Freight").closest("tr") as HTMLTableRowElement;
    // Not a raw JSON dump: an owner has to read what the head will do to a keyed line.
    expect(within(freight).getByText(/add_to_cost/)).toBeInTheDocument();
    expect(within(freight).getByText(/positive/)).toBeInTheDocument();
    expect(within(freight).getByText("996731")).toBeInTheDocument();

    const discount = screen.getByText("Cash Discount").closest("tr") as HTMLTableRowElement;
    expect(within(discount).getByText(/negative/)).toBeInTheDocument();
  });

  it("creates a head with its defaults, in this store, as a charge_head", async () => {
    installApi([
      ["GET", /lookups\?.*type=charge_head/, { body: heads }],
      ["POST", /\/admin\/lookups$/, { body: { success: true, data: FREIGHT } }],
    ]);
    await openChargeHeadsTab();

    await userEvent.click(screen.getByRole("button", { name: /Add Charge Head/i }));
    await userEvent.type(screen.getByLabelText(/Name \/ Label/i), "Courier");
    await userEvent.type(screen.getByLabelText(/Code \/ Short Name/i), "courier");
    await userEvent.selectOptions(screen.getByLabelText(/Default treatment/i), "expense");
    await userEvent.selectOptions(screen.getByLabelText(/Allowed sign/i), "both");

    await userEvent.click(screen.getByRole("button", { name: /Save Record/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && /\/admin\/lookups$/.test(c.url));
      expect(post).toBeTruthy();
    });
    const post = calls.find((c) => c.method === "POST" && /\/admin\/lookups$/.test(c.url))!;
    expect(post.body).toMatchObject({
      type: "charge_head",
      store_id: 1,
      name: "Courier",
      code: "COURIER",
      config: { default_treatment: "expense", allowed_sign: "both" },
    });
  });

  it("restores the store's default head set and says what it did", async () => {
    installApi([
      ["GET", /lookups\?.*type=charge_head/, { body: heads }],
      [
        "POST",
        /reset-charge-heads/,
        { body: { success: true, seeded: ["Packing"], removed: ["Old Head"], kept: ["Courier"] } },
      ],
    ]);
    await openChargeHeadsTab();

    await userEvent.click(screen.getByRole("button", { name: /Reset to Defaults/i }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && /reset-charge-heads/.test(c.url))).toBe(true);
    });
    await waitFor(() => expect(screen.getByText(/1 default head\(s\) restored/)).toBeInTheDocument());
    expect(screen.getByText(/1 unreferenced custom head\(s\) removed/)).toBeInTheDocument();
    expect(screen.getByText(/1 referenced custom head\(s\) kept/)).toBeInTheDocument();
  });

  it("refuses to delete a head that posted charges until they are reassigned", async () => {
    installApi([
      ["GET", /lookups\?.*type=charge_head/, { body: heads }],
      [
        "DELETE",
        /\/admin\/lookups\/22$/,
        {
          status: 409,
          body: {
            message: 'Charge head "Cash Discount" is used by 3 bill(s) in this store.',
            reassignment_required: true,
            // The real shape: the bills that stand in the way, with how much charge each carries.
            referencing_bills: [
              { purchase_id: 11, invoice_number: "PUR-101", amount: 200 },
              { purchase_id: 12, invoice_number: "PUR-102", amount: 150 },
              { purchase_id: 13, invoice_number: "PUR-103", amount: 50 },
            ],
            candidate_heads: [{ id: 21, name: "Freight", code: "FREIGHT" }],
          },
        },
      ],
      [
        "DELETE",
        /\/admin\/lookups\/22\?reassign_to=21/,
        { body: { success: true, message: "Charge head deleted and 3 charge line(s) reassigned." } },
      ],
    ]);
    await openChargeHeadsTab();

    const discountRow = screen.getByText("Cash Discount").closest("tr") as HTMLTableRowElement;
    await userEvent.click(within(discountRow).getByTitle(/Delete Record/i));

    // Every row carries a same-named trash button, so confirm inside the dialog that opened.
    const ask = await screen.findByText(/^Are you sure you want to delete "Cash Discount"/);
    const dialog = ask.closest("form") as HTMLElement;
    await userEvent.click(within(dialog).getByRole("button", { name: /Delete Record/i }));

    // The store is told which bills stand in the way, and given a head to move them to.
    const modal = await screen.findByTestId("charge-head-reassign");
    expect(within(modal).getByText("PUR-102")).toBeInTheDocument();
    await userEvent.selectOptions(within(modal).getByLabelText(/Replacement head/i), "21");
    await userEvent.click(within(modal).getByRole("button", { name: /Reassign & Delete Head/i }));

    await waitFor(() => {
      expect(
        calls.some((c) => c.method === "DELETE" && /\/admin\/lookups\/22\?reassign_to=21/.test(c.url))
      ).toBe(true);
    });
  });
});

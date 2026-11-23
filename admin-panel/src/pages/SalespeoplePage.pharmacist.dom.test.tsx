import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SalespeoplePage } from "./SalespeoplePage";

/**
 * GAP-02 / PHR-002, PHR-011 — the pharmacist half of a staff record.
 *
 * A registration is what lets a person confirm a restricted-drug bill, so the
 * panel records the number the council issued and the window it is worth. A
 * store that sells no medicines must not see any of this: no tick-box, no
 * fields, no registration on the cards.
 */

const auth = vi.hoisted(() => ({
  isAllStores: false,
  stores: [] as any[],
  activeStore: null as any,
  setActiveStore: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: auth.isAllStores,
    stores: auth.stores,
    activeStore: auth.activeStore,
    setActiveStore: auth.setActiveStore,
  }),
}));

const CHEMIST = { id: 1, name: "LamStone Medicos", code: "LMS", store_type: "pharmacy" };
const GROCERY = { id: 2, name: "Fresh Mart", code: "FRM", store_type: "kirana_general" };

const current = () => ({
  id: 11,
  store_id: 1,
  name: "Dr. Firoza Ali",
  code: "SP-01",
  phone: null,
  counter_ids: null,
  is_active: true,
  archived_at: null,
  version: 2,
  has_pin: true,
  is_pharmacist: true,
  reg_no: "KPK-2019-45512",
  reg_valid_from: "2019-06-01",
  reg_valid_until: "2029-05-31",
});

const lapsed = () => ({
  id: 12,
  store_id: 1,
  name: "Shibu Varghese",
  code: "SP-02",
  phone: null,
  counter_ids: null,
  is_active: true,
  archived_at: null,
  version: 1,
  has_pin: true,
  is_pharmacist: true,
  reg_no: "KPK-2013-11887",
  reg_valid_from: "2013-01-01",
  reg_valid_until: "2023-12-31",
});

function installApi(people: any[], extra: Array<[string, RegExp, any]> = []) {
  const calls: Array<{ method: string; url: string; body: any }> = [];

  const handlers: Array<[string, RegExp, (body: any, url: string) => { status?: number; body: any }]> = [
    ...extra,
    ["GET", /\/admin\/salespeople(\?.*)?$/, () => ({ body: { success: true, salespeople: people.map((p) => ({ ...p })) } })],
    ["GET", /\/admin\/counters$/, () => ({ body: { success: true, counters: [] } })],
    [
      "POST",
      /\/admin\/salespeople$/,
      (body: any) => ({
        status: 201,
        body: { success: true, salesperson: { id: 99, store_id: body.store_id ?? 1, version: 1, archived_at: null, ...body } },
      }),
    ],
  ];

  vi.spyOn(global, "fetch").mockImplementation((async (input: any, init: any = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const url = typeof input === "string" ? input : String(input?.url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    for (const [m, pattern, reply] of handlers) {
      if (m !== method || !pattern.test(url)) continue;
      const resolved = reply(body, url);
      const status = resolved.status ?? 200;
      return {
        ok: status < 400,
        status,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => resolved.body,
      } as Response;
    }

    throw new Error(`Unstubbed request: ${method} ${url}`);
  }) as any);

  return { calls };
}

async function renderPage() {
  render(<SalespeoplePage />);
  await waitFor(() => expect(screen.getByText("Dr. Firoza Ali")).toBeInTheDocument());
}

async function openAddDialog() {
  await userEvent.click(screen.getByRole("button", { name: /add salesperson/i }));
  return screen.findByRole("dialog", { name: /add salesperson/i });
}

// A window that is open today, so the record the dialog posts is a live one.
const VALID_FROM = "2023-01-01";
const VALID_UNTIL = "2029-12-31";

beforeEach(() => {
  auth.isAllStores = false;
  auth.stores = [CHEMIST, GROCERY];
  auth.activeStore = CHEMIST;
  auth.setActiveStore.mockReset();
});

describe("pharmacist registration on the staff master", () => {
  it("records the registration number and its window for a pharmacy", async () => {
    const { calls } = installApi([current(), lapsed()]);
    await renderPage();

    const dialog = await openAddDialog();
    await userEvent.type(within(dialog).getByLabelText(/^name$/i), "Meera Nair");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /registered pharmacist/i }));

    await userEvent.type(within(dialog).getByLabelText(/registration number/i), "KPK-2022-30211");
    fireEvent.change(within(dialog).getByLabelText(/^valid from$/i), { target: { value: VALID_FROM } });
    fireEvent.change(within(dialog).getByLabelText(/^valid until$/i), { target: { value: VALID_UNTIL } });
    await userEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.body?.is_pharmacist === true &&
            c.body?.reg_no === "KPK-2022-30211"
        )
      ).toBe(true)
    );
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({
      reg_valid_from: VALID_FROM,
      reg_valid_until: VALID_UNTIL,
    });
  });

  it("shows the registration on the card and names one that has lapsed", async () => {
    installApi([current(), lapsed()]);
    await renderPage();

    const firoza = screen.getByRole("group", { name: "Dr. Firoza Ali" });
    expect(within(firoza).getByText("KPK-2019-45512")).toBeInTheDocument();
    expect(within(firoza).queryByText(/expired/i)).not.toBeInTheDocument();

    const shibu = screen.getByRole("group", { name: "Shibu Varghese" });
    expect(within(shibu).getByText("KPK-2013-11887")).toBeInTheDocument();
    expect(within(shibu).getByText(/expired 2023-12-31/i)).toBeInTheDocument();
  });

  it("prefills the registration when the owner opens the record", async () => {
    installApi([current(), lapsed()]);
    await renderPage();

    await userEvent.click(
      within(screen.getByRole("group", { name: "Dr. Firoza Ali" })).getByRole("button", { name: /edit/i })
    );
    const dialog = await screen.findByRole("dialog", { name: /dr\. firoza ali/i });

    expect(within(dialog).getByRole("checkbox", { name: /registered pharmacist/i })).toBeChecked();
    expect(within(dialog).getByLabelText(/registration number/i)).toHaveValue("KPK-2019-45512");
    expect(within(dialog).getByLabelText(/^valid until$/i)).toHaveValue("2029-05-31");
  });

  it("keeps the refusal the server gives on the registration field", async () => {
    installApi([current(), lapsed()], [
      [
        "POST",
        /\/admin\/salespeople$/,
        () => ({
          status: 422,
          body: {
            message: "A pharmacist must carry the registration number the council issued them.",
            errors: { reg_no: ["Record the registration number, or leave the pharmacist flag off."] },
          },
        }),
      ],
    ]);
    await renderPage();

    const dialog = await openAddDialog();
    await userEvent.type(within(dialog).getByLabelText(/^name$/i), "No Number");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /registered pharmacist/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(within(dialog).getByText(/record the registration number/i)).toBeInTheDocument()
    );
    expect(screen.getByRole("dialog", { name: /add salesperson/i })).toBeInTheDocument();
  });

  it("shows nothing about pharmacists in a store that sells no drugs", async () => {
    auth.activeStore = GROCERY;
    installApi([{ ...current(), store_id: 2, is_pharmacist: false, reg_no: null }]);
    await renderPage();

    const dialog = await openAddDialog();
    expect(within(dialog).queryByRole("checkbox", { name: /registered pharmacist/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/registration number/i)).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Dr. Firoza Ali" })).queryByText("KPK-2019-45512")).not.toBeInTheDocument();
  });
});

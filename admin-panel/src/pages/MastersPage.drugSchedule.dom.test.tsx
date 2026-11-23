import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MastersPage } from "./MastersPage";

/**
 * GAP-02 / PHR-001, PHR-003 — the drug-schedule master and the product that carries it.
 *
 * The schedule list is what the server reads to decide whether a bill needs a
 * pharmacist, so the panel must let an owner write its two marks — needs a
 * pharmacist, needs prescription details — on a schedule belonging to one named
 * pharmacy, and must let them put that schedule on a product. A store that sells
 * no medicines sees none of it: no tab, no field, no stamp.
 */

const CHEMIST = { id: 1, name: "LamStone Medicos", code: "LMS", store_type: "pharmacy" };
const GROCERY = { id: 2, name: "Fresh Mart", code: "FRM", store_type: "kirana_general" };

const auth = vi.hoisted(() => ({
  isAllStores: false,
  activeStore: null as any,
  stores: [] as any[],
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: auth.isAllStores,
    role: "super_admin",
    activeStore: auth.activeStore,
    stores: auth.stores,
    setActiveStore: vi.fn(),
  }),
}));

const SCHEDULE_H1 = {
  id: 7,
  store_id: 1,
  type: "drug_schedule",
  code: "H1",
  name: "Schedule H1",
  description: "Injectables and habit-forming drugs",
  config: { restricted: true, prescription_required: true },
  is_active: true,
};
const SCHEDULE_C = {
  id: 9,
  store_id: 1,
  type: "drug_schedule",
  code: "C",
  name: "Schedule C",
  description: "Drugs of abuse",
  config: { restricted: false, prescription_required: false },
  is_active: true,
};

const ALPRAZOLAM = {
  id: 41,
  store_id: 1,
  name: "Xanax 0.25mg Strip of 15",
  hsn_sac_code: "30049099",
  mrp: 120,
  sel_rate: 100,
  gst_percent: 5,
  units_per_pack: 1,
  reorder_level: 5,
  current_stock: 40,
  is_active: true,
  version: 1,
  drug_schedule_id: 7,
  schedule_code: "H1",
};

const RICE = {
  id: 61,
  store_id: 2,
  name: "Sona Masoori Rice 5kg",
  hsn_sac_code: "10063020",
  mrp: 480,
  sel_rate: 450,
  gst_percent: 0,
  units_per_pack: 1,
  reorder_level: 5,
  current_stock: 12,
  is_active: true,
  version: 1,
  drug_schedule_id: null,
  schedule_code: null,
};

/**
 * A small fake of the endpoints this slice touches, including the stamping
 * AdminMasterController::stampSchedule does: the schedule a product names
 * decides the schedule_code that comes back on the row.
 */
function installApi(
  opts: {
    schedules?: any[];
    products?: any[];
    productRefusal?: { status: number; body: any };
  } = {}
) {
  const schedules = opts.schedules ?? [SCHEDULE_H1, SCHEDULE_C];
  const products: any[] = opts.products ?? [{ ...ALPRAZOLAM }];
  const calls: Array<{ method: string; url: string; body: any }> = [];

  const json = (status: number, body: any) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const page = (rows: any[]) => ({ data: rows, current_page: 1, last_page: 1, total: rows.length });
  const stampOf = (scheduleId: any) => {
    const schedule = schedules.find((s) => String(s.id) === String(scheduleId));
    return schedule ? String(schedule.code || schedule.name).toUpperCase() : null;
  };

  vi.spyOn(global, "fetch").mockImplementation((async (input: any, init: any = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const url = typeof input === "string" ? input : String(input?.url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    if (/\/admin\/lookups/.test(url)) {
      if (method === "POST") {
        schedules.push({ ...body, id: 700 + schedules.length });
        return json(201, { data: {} });
      }
      const type = decodeURIComponent(url.match(/type=([^&]*)/)?.[1] ?? "");
      if (type !== "drug_schedule") return json(200, page([]));
      return json(200, page(schedules.filter((s) => String(s.store_id) === String(auth.activeStore?.id))));
    }

    if (/\/admin\/products\/\d+$/.test(url) && method === "PUT") {
      const row = products.find((p) => String(p.id) === url.match(/\/(\d+)$/)?.[1]);
      Object.assign(row, body, { schedule_code: stampOf(body.drug_schedule_id) });
      return json(200, page([row]));
    }

    if (/\/admin\/products$/.test(url) && method === "POST") {
      if (opts.productRefusal) return json(opts.productRefusal.status, opts.productRefusal.body);
      products.push({
        id: 900 + products.length,
        version: 1,
        current_stock: 0,
        reorder_level: 0,
        ...body,
        schedule_code: stampOf(body.drug_schedule_id),
      });
      return json(201, { data: {} });
    }

    if (/\/admin\/products/.test(url)) {
      return json(200, page(products.filter((p) => String(p.store_id) === String(auth.activeStore?.id))));
    }

    return json(200, page([]));
  }) as typeof fetch);

  return { calls, products, schedules };
}

async function openSchedulesTab() {
  render(<MastersPage />);
  await userEvent.click(await screen.findByRole("button", { name: /drug schedules/i }));
  return screen.findByRole("button", { name: /^add drug schedule$/i });
}

async function openProductDialog() {
  await userEvent.click(await screen.findByRole("button", { name: /^add product$/i }));
  return screen.findByRole("dialog", { name: /create catalog product sku/i });
}

beforeEach(() => {
  auth.isAllStores = false;
  auth.activeStore = CHEMIST;
  auth.stores = [CHEMIST, GROCERY];
});

describe("drug schedule master (PHR-001)", () => {
  it("shows a pharmacy's schedules with their marks in words, not as stored JSON", async () => {
    installApi();
    await openSchedulesTab();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Schedule H1")).toBeInTheDocument();
    expect(within(table).getByText(/^needs a pharmacist$/i)).toBeInTheDocument();
    expect(within(table).getByText(/prescription details/i)).toBeInTheDocument();
    // Schedule C carries neither mark, and no row falls through to raw config.
    expect(within(table).getByText(/no pharmacist needed/i)).toBeInTheDocument();
    expect(within(table).queryByText(/\{"/)).not.toBeInTheDocument();
  });

  it("creates a restricted schedule for the pharmacy the dialog names", async () => {
    const { calls } = installApi({ schedules: [] });
    await openSchedulesTab();

    await userEvent.click(await screen.findByRole("button", { name: /^add drug schedule$/i }));
    const dialog = await screen.findByRole("dialog", { name: /create drug schedule/i });

    // The list belongs to one store, so the dialog says which one it writes.
    expect(within(dialog).getByText(/LamStone Medicos/i)).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText(/name \/ label/i), "Schedule H1");
    await userEvent.type(within(dialog).getByLabelText(/schedule code/i), "h1");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /needs a pharmacist/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: /save record/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && /\/admin\/lookups/.test(c.url))).toBe(true)
    );
    const post = calls.find((c) => c.method === "POST" && /\/admin\/lookups/.test(c.url))!;
    expect(post.body).toMatchObject({
      type: "drug_schedule",
      store_id: 1,
      name: "Schedule H1",
      code: "H1",
    });
    expect(post.body.config).toMatchObject({ restricted: true, prescription_required: false });
  });

  it("marks a product with a schedule from its own store and stamps the code on the list", async () => {
    const { calls } = installApi({ products: [] });
    render(<MastersPage />);

    const dialog = await openProductDialog();
    await userEvent.type(within(dialog).getByLabelText(/product \/ brand item name/i), "Xanax 0.25mg Strip of 15");
    await userEvent.selectOptions(within(dialog).getByLabelText(/drug schedule/i), "7");
    await userEvent.click(within(dialog).getByRole("button", { name: /save product/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && /\/admin\/products/.test(c.url));
      expect(post?.body.drug_schedule_id).toBe(7);
    });
    await screen.findByText("H1");
  });

  it("keeps the server's refusal about a retired schedule on screen", async () => {
    installApi({
      products: [],
      productRefusal: {
        status: 422,
        body: {
          message: 'Drug schedule "Schedule H1" is retired, so no new product may carry it.',
          errors: { drug_schedule_id: ["This schedule is switched off in the list."] },
        },
      },
    });
    render(<MastersPage />);

    const dialog = await openProductDialog();
    await userEvent.type(within(dialog).getByLabelText(/product \/ brand item name/i), "Xanax 0.25mg");
    await userEvent.selectOptions(within(dialog).getByLabelText(/drug schedule/i), "7");
    await userEvent.click(within(dialog).getByRole("button", { name: /save product/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/no new product may carry it/i)
    );
    expect(within(dialog).getByLabelText(/drug schedule/i)).toHaveValue("7");
  });

  it("releases a product from its schedule when the owner picks none", async () => {
    const { calls, products } = installApi();
    render(<MastersPage />);

    const row = await screen.findByRole("row", { name: /xanax/i });
    await userEvent.click(within(row).getByRole("button", { name: /edit product/i }));

    const dialog = await screen.findByRole("dialog", { name: /edit product/i });
    expect(within(dialog).getByLabelText(/drug schedule/i)).toHaveValue("7");

    await userEvent.selectOptions(within(dialog).getByLabelText(/drug schedule/i), "");
    await userEvent.click(within(dialog).getByRole("button", { name: /save product/i }));

    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT" && /\/admin\/products\//.test(c.url));
      expect(put?.body.drug_schedule_id).toBeNull();
    });
    await waitFor(() => expect(products.find((p) => p.id === 41).schedule_code).toBeNull());
  });

  it("names the rule a deleted schedule takes off the shelf", async () => {
    installApi();
    await openSchedulesTab();

    const row = await screen.findByRole("row", { name: /schedule h1/i });
    await userEvent.click(within(row).getByRole("button", { name: /delete record/i }));

    expect(
      await screen.findByText(/need no pharmacist on their next bill/i)
    ).toBeInTheDocument();
  });

  it("offers no schedule surface in a store that sells no medicines", async () => {
    auth.activeStore = GROCERY;
    installApi({ products: [RICE] });
    render(<MastersPage />);

    await screen.findByRole("button", { name: /^add product$/i });
    expect(screen.queryByRole("button", { name: /drug schedules/i })).not.toBeInTheDocument();

    const dialog = await openProductDialog();
    expect(within(dialog).queryByLabelText(/drug schedule/i)).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    const table = await screen.findByRole("table");
    expect(within(table).queryByText("H1")).not.toBeInTheDocument();
  });

  it("waits for one pharmacy before showing the schedule list at all", async () => {
    auth.isAllStores = true;
    auth.activeStore = null;
    installApi();
    render(<MastersPage />);

    await screen.findByRole("button", { name: /^add product$/i });
    expect(screen.queryByRole("button", { name: /drug schedules/i })).not.toBeInTheDocument();
  });
});

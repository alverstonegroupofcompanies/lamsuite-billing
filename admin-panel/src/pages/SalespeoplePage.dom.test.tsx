import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SalespeoplePage } from "./SalespeoplePage";

/**
 * GAP-01 / SPR-001..005 — the salesperson master lives in the panel.
 *
 * A person belongs to exactly one store, their code never repeats inside it,
 * the counters they may sell at are a restriction the till obeys, someone who
 * has sold something is archived rather than deleted, and a PIN never comes
 * back out of the server. Every one of those rules is driven here through the
 * endpoints the page actually calls.
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

const RETAIL = { id: 1, name: "Retail Store", code: "STORE-01" };
const KOCHI = { id: 2, name: "LamStone Medicos (Kochi)", code: "STORE-02" };

const COUNTERS = [
  { id: 3, store_id: 1, counter_code: "C01", counter_name: "Front Counter", status: "active" },
  { id: 4, store_id: 1, counter_code: "C02", counter_name: "Dock Counter", status: "active" },
];

const rina = () => ({
  id: 11,
  store_id: 1,
  name: "Rina Thomas",
  code: "SP-01",
  phone: "9847000011",
  counter_ids: [3],
  is_active: true,
  archived_at: null,
  version: 3,
  has_pin: true,
});

const abdul = () => ({
  id: 12,
  store_id: 1,
  name: "Abdul Samad",
  code: "SP-02",
  phone: null,
  counter_ids: null,
  is_active: true,
  archived_at: null,
  version: 1,
  has_pin: false,
});

type Reply = { status?: number; body: any };
type Handler = (body: any, url: string) => Reply;
type Stub = [string, RegExp, Handler | Reply];

function installApi(conflicts: Stub[] = []) {
  const people: any[] = [rina(), abdul()];
  const calls: Array<{ method: string; url: string; body: any }> = [];

  const handlers: Stub[] = [
    ...conflicts,
    [
      "GET",
      /\/admin\/salespeople(\?.*)?$/,
      (_b: any, url: string) => {
        const includeArchived = /include_archived=(1|true)/.test(url);
        const raw = url.match(/[?&]q=([^&]*)/)?.[1];
        const q = raw ? decodeURIComponent(raw).toLowerCase() : "";
        const rows = people
          .filter((p) => (includeArchived ? true : !p.archived_at))
          .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
          .map((p) => ({ ...p }));
        return { body: { success: true, salespeople: rows } };
      },
    ],
    [
      "POST",
      /\/admin\/salespeople$/,
      (body: any) => {
        const code = String(body.code || "").toUpperCase();
        if (people.some((p) => String(p.code).toUpperCase() === code)) {
          return {
            status: 422,
            body: {
              message: "That salesperson code is already used in this store.",
              errors: { code: [`The code ${code} already belongs to someone else in this store.`] },
            },
          };
        }
        const created = {
          id: 99,
          store_id: Number(body.store_id || 1),
          name: body.name,
          code: code || "SP-03",
          phone: body.phone || null,
          counter_ids: body.counter_ids ?? null,
          is_active: body.is_active ?? true,
          archived_at: null,
          version: 1,
          has_pin: Boolean(body.pin),
        };
        people.push(created);
        return { status: 201, body: { success: true, salesperson: created } };
      },
    ],
    [
      "PUT",
      /\/admin\/salespeople\/\d+$/,
      (body: any, url: string) => {
        const id = Number(url.match(/\/admin\/salespeople\/(\d+)/)?.[1]);
        const row = people.find((p) => p.id === id);
        if (body.version !== undefined && Number(body.version) !== row.version) {
          return {
            status: 409,
            body: {
              success: false,
              code: "salesperson_version_conflict",
              message: "This salesperson was changed by someone else. Reload to see the current record.",
              current_version: row.version,
            },
          };
        }
        if (body.pin === "") {
          row.has_pin = false;
        } else if (body.pin) {
          row.has_pin = true;
        }
        const { pin: _pin, ...rest } = body;
        Object.assign(row, rest);
        row.version += 1;
        return { body: { success: true, salesperson: { ...row } } };
      },
    ],
    [
      "DELETE",
      /\/admin\/salespeople\/\d+$/,
      (_b: any, url: string) => {
        const id = Number(url.match(/\/admin\/salespeople\/(\d+)/)?.[1]);
        const row = people.find((p) => p.id === id);
        // Rina has bills, Abdul has none — the same split the server makes.
        if (id === 11) {
          row.is_active = false;
          row.archived_at = "2026-11-22T10:00:00+05:30";
          row.version += 1;
          return {
            body: {
              success: true,
              archived: true,
              bills: 4,
              salesperson: { ...row },
              message: "Archived. 4 saved bill(s) still name this salesperson.",
            },
          };
        }
        people.splice(people.indexOf(row), 1);
        return { body: { success: true, deleted: true } };
      },
    ],
    ["GET", /\/admin\/counters$/, () => ({ body: { success: true, counters: COUNTERS } })],
  ];

  vi.spyOn(global, "fetch").mockImplementation((async (input: any, init: any = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const url = typeof input === "string" ? input : String(input?.url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    for (const [m, pattern, reply] of handlers) {
      if (m !== method || !pattern.test(url)) continue;
      const resolved = typeof reply === "function" ? reply(body, url) : reply;
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

  return { calls, people };
}

function rowOf(name: string): HTMLElement {
  return screen.getByRole("group", { name: new RegExp(`^${name}$`) });
}

async function renderPage() {
  render(<SalespeoplePage />);
  await waitFor(() => expect(screen.getByText("Rina Thomas")).toBeInTheDocument());
}

async function openAddDialog() {
  await userEvent.click(screen.getByRole("button", { name: /add salesperson/i }));
  return screen.findByRole("dialog", { name: /add salesperson/i });
}

beforeEach(() => {
  auth.isAllStores = false;
  auth.stores = [RETAIL, KOCHI];
  auth.activeStore = RETAIL;
  auth.setActiveStore.mockReset();
});

describe("salespeople master", () => {
  it("lists the store's people with their code, counters and PIN state", async () => {
    installApi();
    await renderPage();

    const rinaRow = rowOf("Rina Thomas");
    expect(within(rinaRow).getByText("SP-01")).toBeInTheDocument();
    expect(within(rinaRow).getByText("Front Counter")).toBeInTheDocument();
    expect(within(rinaRow).getByText("PIN set")).toBeInTheDocument();

    const abdulRow = rowOf("Abdul Samad");
    expect(within(abdulRow).getByText("SP-02")).toBeInTheDocument();
    expect(within(abdulRow).getByText("Every counter")).toBeInTheDocument();
    expect(within(abdulRow).queryByText("PIN set")).not.toBeInTheDocument();
  });

  it("names the store a new person will belong to and moves the panel there", async () => {
    const { calls } = installApi();
    await renderPage();

    const dialog = await openAddDialog();
    const storeSelect = within(dialog).getByLabelText(/^store$/i);

    expect(within(storeSelect).getByRole("option", { name: /retail store/i })).toBeInTheDocument();
    expect(
      within(storeSelect).getByRole("option", { name: /lamstone medicos \(kochi\)/i })
    ).toBeInTheDocument();
    expect(storeSelect).toHaveValue("1");
    expect(within(dialog).getByText(/belongs to this store/i)).toBeInTheDocument();

    await userEvent.selectOptions(storeSelect, "2");
    await userEvent.type(within(dialog).getByLabelText(/^name$/i), "Meera Nair");
    await userEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByText("Meera Nair")).toBeInTheDocument());
    // The person is born in one store, so the panel's own scope moves there
    // first — the POST then carries that store as its X-Store-Id.
    expect(auth.setActiveStore).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    const post = calls.find((c) => c.method === "POST" && /\/admin\/salespeople$/.test(c.url));
    expect(post?.body).toMatchObject({ name: "Meera Nair" });
  });

  it("shows the server's refusal on the code field and keeps the dialog open", async () => {
    installApi();
    await renderPage();

    const dialog = await openAddDialog();
    await userEvent.type(within(dialog).getByLabelText(/^name$/i), "Copycat");
    await userEvent.type(within(dialog).getByLabelText(/^code$/i), "sp-01");
    await userEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(
        within(dialog).getByText(/already belongs to someone else in this store/i)
      ).toBeInTheDocument()
    );
    expect(screen.getByRole("dialog", { name: /add salesperson/i })).toBeInTheDocument();
  });

  it("refuses a trivial PIN in the browser and never sends it", async () => {
    const { calls } = installApi();
    await renderPage();

    const dialog = await openAddDialog();
    await userEvent.type(within(dialog).getByLabelText(/^name$/i), "Deepa Raj");
    await userEvent.type(within(dialog).getByLabelText(/personal pin/i), "111111");
    await userEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(within(dialog).getByText(/repeated digits/i)).toBeInTheDocument()
    );
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("restricts a person to the counters ticked in the dialog", async () => {
    const { calls } = installApi();
    await renderPage();

    const dialog = await openAddDialog();
    await userEvent.type(within(dialog).getByLabelText(/^name$/i), "Salan K");
    expect(within(dialog).getByText(/every counter/i)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("checkbox", { name: /dock counter/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByText("Salan K")).toBeInTheDocument());
    const post = calls.find((c) => c.method === "POST" && /\/admin\/salespeople$/.test(c.url));
    expect(post?.body).toMatchObject({ counter_ids: [4] });
    expect(within(rowOf("Salan K")).getByText("Dock Counter")).toBeInTheDocument();
  });

  it("tells the owner to reload when someone else saved the person first", async () => {
    installApi([
      [
        "PUT",
        /\/admin\/salespeople\/\d+$/,
        () => ({
          status: 409,
          body: {
            success: false,
            code: "salesperson_version_conflict",
            message: "This salesperson was changed by someone else. Reload to see the current record.",
            current_version: 7,
          },
        }),
      ],
    ]);
    await renderPage();

    await userEvent.click(within(rowOf("Rina Thomas")).getByRole("button", { name: /edit/i }));
    const dialog = await screen.findByRole("dialog", { name: /rina thomas/i });

    await userEvent.type(within(dialog).getByLabelText(/^phone$/i), "123");
    await userEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(within(dialog).getByText(/was changed by someone else/i)).toBeInTheDocument()
    );
    expect(within(dialog).getByRole("button", { name: /reload this record/i })).toBeInTheDocument();
  });

  it("clears a stored PIN only when the owner asks for it", async () => {
    const { calls } = installApi();
    await renderPage();

    await userEvent.click(within(rowOf("Rina Thomas")).getByRole("button", { name: /edit/i }));
    const dialog = await screen.findByRole("dialog", { name: /rina thomas/i });

    expect(within(dialog).getByText(/pin already set/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /remove stored pin/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "PUT" && /\/admin\/salespeople\/11$/.test(c.url) && c.body?.pin === ""
        )
      ).toBe(true)
    );
    await waitFor(() =>
      expect(within(rowOf("Rina Thomas")).queryByText("PIN set")).not.toBeInTheDocument()
    );
  });

  it("archives a person who has sold instead of deleting them", async () => {
    installApi();
    await renderPage();

    await userEvent.click(within(rowOf("Rina Thomas")).getByRole("button", { name: /remove/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirm removal/i }));

    await waitFor(() =>
      expect(screen.getByText(/4 saved bill\(s\) still name this salesperson/i)).toBeInTheDocument()
    );
    await waitFor(() => expect(screen.queryByText("Rina Thomas")).not.toBeInTheDocument());

    // The history is still there — for the owner who asks for it.
    await userEvent.click(screen.getByRole("checkbox", { name: /include archived/i }));
    await waitFor(() => expect(screen.getByText("Rina Thomas")).toBeInTheDocument());
    expect(within(rowOf("Rina Thomas")).getByText("Archived")).toBeInTheDocument();
  });

  it("deletes a person who never sold anything", async () => {
    installApi();
    await renderPage();

    await userEvent.click(within(rowOf("Abdul Samad")).getByRole("button", { name: /remove/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirm removal/i }));

    await waitFor(() => expect(screen.queryByText("Abdul Samad")).not.toBeInTheDocument());
    expect(screen.queryByText(/still name this salesperson/i)).not.toBeInTheDocument();
  });

  it("searches the list without leaving the page", async () => {
    installApi();
    await renderPage();

    await userEvent.type(screen.getByLabelText(/search salespeople/i), "rina");

    await waitFor(() => expect(screen.getByText("Rina Thomas")).toBeInTheDocument());
    expect(screen.queryByText("Abdul Samad")).not.toBeInTheDocument();
  });
});

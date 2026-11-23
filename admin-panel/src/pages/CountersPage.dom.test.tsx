import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CountersPage } from "./CountersPage";
import { formatDateTime } from "../utils/formatters";

/**
 * CNT-009 — the counter master lives in the admin panel.
 *
 * Every action on a counter is an audited API call and the card changes in
 * place: the owner never has to reload the page to see what they just did, and
 * an activation code is shown exactly once.
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

const FRONT = {
  id: 3,
  store_id: 1,
  counter_code: "C01",
  counter_name: "Front Counter",
  location_name: "Main Shop",
  status: "active",
  device_uuid: "uuid-front-machine",
  current_device_id: "dev-77",
  is_remote: false,
  is_hub: false,
  is_digital_only: false,
  idle_lock_minutes: 5,
  grace_hours: 24,
  last_seen_at: "2026-11-20T09:12:00+05:30",
  last_sync_at: "2026-11-20T09:12:00+05:30",
  last_activity_at: "2026-11-20T09:14:00+05:30",
  last_bill_at: "2026-11-20T08:55:00+05:30",
  last_bill_number: "C01-INV-11002",
  last_salesperson_name: "Rina",
  last_operator_name: "Anu (owner)",
  unsynced_items_count: 7,
  offline_since: null,
  offline_periods: [
    { started_at: "2026-11-20T07:10:00+05:30", ended_at: "2026-11-20T07:22:00+05:30", minutes: 12 },
    { started_at: "2026-11-20T08:00:00+05:30", ended_at: "2026-11-20T08:05:00+05:30", minutes: 5 },
  ],
  is_online: true,
  unlock_pin_set: true,
  sequences: [],
};

const DOCK = {
  id: 4,
  store_id: 1,
  counter_code: "C02",
  counter_name: "Dock Counter",
  location_name: "Warehouse",
  status: "unclaimed",
  device_uuid: null,
  current_device_id: null,
  is_remote: true,
  is_hub: false,
  is_digital_only: false,
  idle_lock_minutes: 5,
  grace_hours: 24,
  last_seen_at: null,
  last_sync_at: null,
  last_activity_at: null,
  last_bill_at: null,
  last_salesperson_name: null,
  unsynced_items_count: 0,
  offline_since: null,
  offline_periods: [],
  is_online: false,
  sequences: [],
};

const RAW_CODE = "LAM-C02-1111222233334444-AAAA555566667777";
const QR_PAYLOAD = JSON.stringify({ v: 1, kind: "lam_suite_counter_claim", code: RAW_CODE, store_id: 1, counter_id: 4 });

type Handler = (body: any, url: string) => { status?: number; body: any };

function installApi(handlers: Array<[string, RegExp, Handler | { status?: number; body: any }]>) {
  const calls: Array<{ method: string; url: string; body: any }> = [];

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

  return calls;
}

function counterCard(name: string): HTMLElement {
  return screen.getByRole("group", { name: new RegExp(`^${name}$`) });
}

async function renderPage() {
  render(<CountersPage />);
  await waitFor(() => expect(screen.getByText("Front Counter")).toBeInTheDocument());
}

/** A store whose counters mutate as the owner acts on them, like the real API. */
function liveState() {
  const counters: any[] = [{ ...FRONT }, { ...DOCK }];
  let revokedCode = false;
  let pinResetReply: Handler | null = null;
  const rowOf = (url: string) => {
    const id = Number(url.match(/\/admin\/counters\/(\d+)/)?.[1]);
    return counters.find((c) => c.id === id);
  };

  return {
    counters,
    /** A test that needs the server to say no to a PIN replaces the default reply. */
    refusePinReset(reply: Handler) {
      pinResetReply = reply;
    },
    handlers: [
      // Every reply is a fresh read, exactly as an HTTP response is.
      ["GET", /\/admin\/counters$/, () => ({ body: { success: true, counters: counters.map((c) => ({ ...c })) } })] as const,
      [
        "POST",
        /\/admin\/counters$/,
        (body: any) => {
          const taken = counters.some(
            (c) => String(c.counter_name).toLowerCase() === String(body.counter_name).toLowerCase()
          );
          if (taken) {
            return {
              status: 422,
              body: {
                message: "That counter name is already in use in this store.",
                errors: {
                  counter_name: [`The name "${body.counter_name}" (${counters[0].counter_code}) is already live in this store.`],
                },
              },
            };
          }
          const created = { ...DOCK, ...body, id: 5, status: "unclaimed", device_uuid: null, last_seen_at: null };
          counters.push(created);
          return { status: 201, body: { success: true, counter: created } };
        },
      ] as const,
      [
        "PUT",
        /\/admin\/counters\/\d+$/,
        (body: any, url: string) => {
          const row = rowOf(url);
          Object.assign(row, body);
          return { body: { success: true, counter: row } };
        },
      ] as const,
      [
        "POST",
        /\/admin\/counters\/\d+\/lock$/,
        (_b: any, url: string) => {
          const row = rowOf(url);
          row.status = "locked";
          return { body: { success: true, counter: row } };
        },
      ] as const,
      [
        "POST",
        /\/admin\/counters\/\d+\/unlock$/,
        (_b: any, url: string) => {
          const row = rowOf(url);
          row.status = "active";
          return { body: { success: true, counter: row } };
        },
      ] as const,
      [
        "POST",
        /\/admin\/approvals\/one-time-pins$/,
        (body: any) => ({
          status: 201,
          body: {
            success: true,
            pin: "481920",
            message: "One-time approval PIN issued. It expires in 10 minute(s) and works for one save.",
            approval: { id: "7", actions: body.actions, mode: "one_time_pin", status: "pending" },
          },
        }),
      ] as const,
      [
        "POST",
        /\/admin\/counters\/\d+\/unlock-pin\/reset$/,
        (body: any, url: string) => {
          if (pinResetReply) return pinResetReply(body, url);
          const row = rowOf(url);
          row.unlock_pin_set = true;
          return { body: { success: true, counter: { ...row } } };
        },
      ] as const,
      [
        "POST",
        /\/admin\/counters\/\d+\/activation-code$/,
        () => ({
          body: {
            success: true,
            code: RAW_CODE,
            activation_key_id: 9,
            key_prefix: "LAM-C02-1111",
            expires_at: "2026-11-21T09:00:00+05:30",
            qr_payload: QR_PAYLOAD,
            message: "Show or send this code once. It cannot be retrieved again.",
          },
        }),
      ] as const,
      [
        "POST",
        /\/admin\/counters\/\d+\/reissue$/,
        () => ({
          body: {
            success: true,
            code: RAW_CODE,
            activation_key_id: 10,
            key_prefix: "LAM-C01-9999",
            expires_at: "2026-11-21T09:00:00+05:30",
            qr_payload: QR_PAYLOAD,
            revoked_device_uuid: "uuid-front-machine",
          },
        }),
      ] as const,
      [
        "GET",
        /\/admin\/counters\/\d+\/activation-codes$/,
        () => ({
          body: {
            success: true,
            codes: [
              { id: 9, label: null, key_prefix: "LAM-C02-1111", state: revokedCode ? "revoked" : "open", expires_at: "2026-11-21T09:00:00+05:30" },
            ],
          },
        }),
      ] as const,
      [
        "POST",
        /\/admin\/counters\/\d+\/activation-codes\/9\/revoke$/,
        () => {
          revokedCode = true;
          return { body: { success: true, revoked: true, key_prefix: "LAM-C02-1111" } };
        },
      ] as const,
      [
        "DELETE",
        /\/admin\/counters\/\d+$/,
        (body: any, url: string) => {
          if (body?.confirm_retire) {
            const row = rowOf(url);
            row.status = "revoked";
            row.retired_at = "2026-11-20T10:00:00+05:30";
            return { body: { success: true, retired: true, documents: 12, counter: row } };
          }
          return {
            status: 409,
            body: {
              error: "counter_has_documents",
              message: "This counter has 12 saved document(s). Retiring it keeps the history; deleting it is not allowed.",
              documents: 12,
            },
          };
        },
      ] as const,
    ] as any,
  };
}

beforeEach(() => {
  auth.isAllStores = false;
  auth.stores = [RETAIL, KOCHI];
  auth.activeStore = RETAIL;
  auth.setActiveStore.mockReset();
  localStorage.clear();
  localStorage.setItem("admin_token", "qa-admin-token");
  localStorage.setItem("admin_store_id", "1");
});

describe("Admin panel counters page (CNT-009)", () => {
  it("shows each counter with its live facts", async () => {
    const state = liveState();
    installApi(state.handlers);
    await renderPage();

    const front = counterCard("Front Counter");
    expect(within(front).getByText("C01")).toBeInTheDocument();
    expect(within(front).getByText("Active")).toBeInTheDocument();
    expect(within(front).getByText("uuid-front-machine")).toBeInTheDocument();
    expect(within(front).getByText(formatDateTime(FRONT.last_activity_at))).toBeInTheDocument();
    expect(within(front).getByText(formatDateTime(FRONT.last_bill_at))).toBeInTheDocument();
    expect(within(front).getByText("Rina")).toBeInTheDocument();
    // CNT-01: which bill, who was signed in, and how often it went dark.
    expect(within(front).getByText(/C01-INV-11002/)).toBeInTheDocument();
    expect(within(front).getByText(/signed in: anu \(owner\)/i)).toBeInTheDocument();
    expect(within(front).getByText(/2 offline periods in 24 h · 17 min/i)).toBeInTheDocument();
    expect(within(front).getByText(/unsynced.*7/i)).toBeInTheDocument();
    expect(within(front).getByText(/online now/i)).toBeInTheDocument();

    const dock = counterCard("Dock Counter");
    expect(within(dock).getByText("Unclaimed")).toBeInTheDocument();
    expect(within(dock).getByText(/no workstation yet/i)).toBeInTheDocument();
    expect(within(dock).getByText(/none yet/i)).toBeInTheDocument();
    expect(within(dock).getByText(/no bill yet/i)).toBeInTheDocument();
    expect(within(dock).getByText(/no presence yet/i)).toBeInTheDocument();
  });

  it("creates a counter through the API and shows the card without a reload", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    await renderPage();

    await userEvent.click(screen.getByRole("button", { name: /new counter/i }));
    await userEvent.type(screen.getByLabelText(/counter name/i), "Airport Kiosk");
    await userEvent.clear(screen.getByLabelText(/counter code/i));
    await userEvent.type(screen.getByLabelText(/counter code/i), "C03");
    await userEvent.type(screen.getByLabelText(/location/i), "Departures");
    await userEvent.click(screen.getByRole("checkbox", { name: /remote counter/i }));
    await userEvent.click(screen.getByRole("button", { name: /^create counter$/i }));

    await waitFor(() => expect(screen.getByText("Airport Kiosk")).toBeInTheDocument());

    const created = calls.find((c) => c.method === "POST" && /\/admin\/counters$/.test(c.url));
    expect(created?.body).toMatchObject({
      counter_name: "Airport Kiosk",
      counter_code: "C03",
      location_name: "Departures",
      is_remote: true,
    });
    // The card is there because the page re-read the counters, not because it
    // reloaded.
    expect(calls.filter((c) => c.method === "GET" && /\/admin\/counters$/.test(c.url)).length).toBeGreaterThan(1);
  });

  it("surfaces the server's refusal when a name is already live", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    await renderPage();

    await userEvent.click(screen.getByRole("button", { name: /new counter/i }));
    await userEvent.type(screen.getByLabelText(/counter name/i), "Front Counter");
    await userEvent.clear(screen.getByLabelText(/counter code/i));
    await userEvent.type(screen.getByLabelText(/counter code/i), "C09");
    await userEvent.click(screen.getByRole("button", { name: /^create counter$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("already in use in this store");
    expect(calls.filter((c) => c.method === "GET" && /\/admin\/counters$/.test(c.url))).toHaveLength(1);
  });

  it("renames a counter and shows the new name on the card", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    await renderPage();

    await userEvent.click(within(counterCard("Front Counter")).getByRole("button", { name: /edit/i }));
    const nameInput = await screen.findByLabelText(/counter name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Main Counter");
    await userEvent.click(screen.getByRole("button", { name: /^save changes$/i }));

    await waitFor(() => expect(counterCard("Main Counter")).toBeInTheDocument());
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toContain("/admin/counters/3");
    expect(put?.body).toMatchObject({ counter_name: "Main Counter" });
  });

  it("locks and unlocks a counter from its card", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    await renderPage();

    await userEvent.click(within(counterCard("Front Counter")).getByRole("button", { name: /^lock$/i }));
    await waitFor(() => expect(within(counterCard("Front Counter")).getByText("Locked")).toBeInTheDocument());

    await userEvent.click(within(counterCard("Front Counter")).getByRole("button", { name: /^unlock$/i }));
    await waitFor(() => expect(within(counterCard("Front Counter")).getByText("Active")).toBeInTheDocument());

    expect(calls.some((c) => c.method === "POST" && /\/admin\/counters\/3\/lock$/.test(c.url))).toBe(true);
    expect(calls.some((c) => c.method === "POST" && /\/admin\/counters\/3\/unlock$/.test(c.url))).toBe(true);
  });

  it("shows an issued activation code once, with its QR, and never again", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    await renderPage();

    await userEvent.click(within(counterCard("Dock Counter")).getByRole("button", { name: /generate code/i }));

    const panel = await screen.findByRole("dialog", { name: /activation code/i });
    expect(within(panel).getByText(RAW_CODE)).toBeInTheDocument();
    expect(within(panel).getByRole("img", { name: /activation qr/i })).toBeInTheDocument();
    expect(within(panel).getByText(/cannot be retrieved again/i)).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("button", { name: /done/i }));
    expect(screen.queryByText(RAW_CODE)).not.toBeInTheDocument();

    await userEvent.click(within(counterCard("Dock Counter")).getByRole("button", { name: /codes/i }));
    const list = await screen.findByRole("dialog", { name: /activation codes/i });
    expect(within(list).getByText("LAM-C02-1111")).toBeInTheDocument();
    // The history is masked: the raw code never comes back.
    expect(document.body.textContent).not.toContain(RAW_CODE);

    const issued = calls.find((c) => c.method === "POST" && /\/activation-code$/.test(c.url));
    expect(issued?.url).toContain("/admin/counters/4/activation-code");
  });

  it("re-issues a code for the counter that is already working", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    await renderPage();

    await userEvent.click(within(counterCard("Front Counter")).getByRole("button", { name: /re-issue code/i }));
    const panel = await screen.findByRole("dialog", { name: /activation code/i });
    expect(within(panel).getByText(RAW_CODE)).toBeInTheDocument();

    expect(calls.some((c) => c.method === "POST" && /\/admin\/counters\/3\/reissue$/.test(c.url))).toBe(true);
  });

  it("revokes an open code from the codes list", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    await renderPage();

    await userEvent.click(within(counterCard("Dock Counter")).getByRole("button", { name: /codes/i }));
    const list = await screen.findByRole("dialog", { name: /activation codes/i });
    await userEvent.click(within(list).getByRole("button", { name: /revoke/i }));

    await waitFor(() => expect(within(list).getByText(/revoked/i)).toBeInTheDocument());
    expect(calls.some((c) => c.method === "POST" && /\/activation-codes\/9\/revoke$/.test(c.url))).toBe(true);
  });

  it("refuses to erase a counter with documents and retires it when confirmed", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    await renderPage();

    await userEvent.click(within(counterCard("Front Counter")).getByRole("button", { name: /^delete$/i }));

    const dialog = await screen.findByRole("dialog", { name: /retire/i });
    expect(dialog).toHaveTextContent("12 saved document");

    await userEvent.click(within(dialog).getByRole("button", { name: /retire/i }));

    await waitFor(() => expect(within(counterCard("Front Counter")).getByText("Retired")).toBeInTheDocument());

    const first = calls.filter((c) => c.method === "DELETE");
    expect(first).toHaveLength(2);
    expect(first[0].body).toBeUndefined();
    expect(first[1].body).toMatchObject({ confirm_retire: true });
  });

  it("reads every store in all-store scope but changes none of them", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    auth.isAllStores = true;
    auth.activeStore = null;
    await renderPage();

    expect(counterCard("Front Counter")).toBeInTheDocument();
    expect(within(counterCard("Front Counter")).queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
    expect(within(counterCard("Dock Counter")).queryByRole("button", { name: /generate code/i })).not.toBeInTheDocument();
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("names the store a new counter will land in", async () => {
    installApi(liveState().handlers);
    await renderPage();

    await userEvent.click(screen.getByRole("button", { name: /new counter/i }));
    const dialog = await screen.findByRole("dialog", { name: /new counter/i });

    expect(within(dialog).getByRole("combobox", { name: /store/i })).toHaveValue("1");
    expect(within(dialog).getByRole("option", { name: /Retail Store/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: /Kochi/i })).toBeInTheDocument();
  });

  it("links a new counter to the store the admin picks, even from all-store scope", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    auth.isAllStores = true;
    auth.activeStore = null;
    await renderPage();

    await userEvent.click(screen.getByRole("button", { name: /new counter/i }));
    const dialog = await screen.findByRole("dialog", { name: /new counter/i });
    const storeSelect = within(dialog).getByRole("combobox", { name: /store/i });

    // Nothing is created until the admin says which store owns it.
    await userEvent.type(within(dialog).getByLabelText(/counter name/i), "Kochi Counter");
    await userEvent.type(within(dialog).getByLabelText(/counter code/i), "C90");
    expect(within(dialog).getByRole("button", { name: /create counter/i })).toBeDisabled();

    await userEvent.selectOptions(storeSelect, "2");
    await userEvent.click(within(dialog).getByRole("button", { name: /create counter/i }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && /\/admin\/counters$/.test(c.url))).toBe(true));
    expect(auth.setActiveStore).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    expect(counterCard("Kochi Counter")).toBeInTheDocument();
  });

  it("fills in the next free counter code for the store it is creating in", async () => {
    installApi(liveState().handlers);
    await renderPage();

    await userEvent.click(screen.getByRole("button", { name: /new counter/i }));
    const dialog = await screen.findByRole("dialog", { name: /new counter/i });

    // This store already holds C01 and C02, so the next one is C03.
    expect(within(dialog).getByLabelText(/counter code/i)).toHaveValue("C03");
    expect(within(dialog).getByText(/next free code/i)).toBeInTheDocument();
  });

  it("creates with the code it filled in, without the admin touching it", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    await renderPage();

    await userEvent.click(screen.getByRole("button", { name: /new counter/i }));
    const dialog = await screen.findByRole("dialog", { name: /new counter/i });
    await userEvent.type(within(dialog).getByLabelText(/counter name/i), "Airport Kiosk");
    await userEvent.click(within(dialog).getByRole("button", { name: /^create counter$/i }));

    await waitFor(() => expect(screen.getByText("Airport Kiosk")).toBeInTheDocument());
    const created = calls.find((c) => c.method === "POST" && /\/admin\/counters$/.test(c.url));
    expect(created?.body).toMatchObject({ counter_name: "Airport Kiosk", counter_code: "C03" });
  });

  it("re-numbers the auto code when the admin moves the counter to another store", async () => {
    const state = liveState();
    state.counters.push({ ...FRONT, id: 9, store_id: 2, counter_code: "C01", counter_name: "Kochi Front" });
    installApi(state.handlers);
    auth.isAllStores = true;
    auth.activeStore = null;
    await renderPage();

    await userEvent.click(screen.getByRole("button", { name: /new counter/i }));
    const dialog = await screen.findByRole("dialog", { name: /new counter/i });
    const storeSelect = within(dialog).getByRole("combobox", { name: /store/i });

    await userEvent.selectOptions(storeSelect, "1");
    expect(within(dialog).getByLabelText(/counter code/i)).toHaveValue("C03");

    await userEvent.selectOptions(storeSelect, "2");
    expect(within(dialog).getByLabelText(/counter code/i)).toHaveValue("C02");
  });

  it("keeps the code the admin typed, even after changing store", async () => {
    installApi(liveState().handlers);
    await renderPage();

    await userEvent.click(screen.getByRole("button", { name: /new counter/i }));
    const dialog = await screen.findByRole("dialog", { name: /new counter/i });
    const codeInput = within(dialog).getByLabelText(/counter code/i);

    await userEvent.clear(codeInput);
    await userEvent.type(codeInput, "KIOSK-1");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: /store/i }), "2");

    expect(codeInput).toHaveValue("KIOSK-1");
  });

  it("asks the server to number a counter for a store whose roster it cannot see", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    auth.isAllStores = true;
    auth.activeStore = null;
    await renderPage();

    await userEvent.click(screen.getByRole("button", { name: /new counter/i }));
    const dialog = await screen.findByRole("dialog", { name: /new counter/i });
    await userEvent.type(within(dialog).getByLabelText(/counter name/i), "Kochi Counter");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: /store/i }), "2");

    // Store 2 has no counters in this page's roster, so the panel guesses nothing.
    expect(within(dialog).getByLabelText(/counter code/i)).toHaveValue("");
    expect(within(dialog).getByText(/the store numbers it/i)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: /create counter/i }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && /\/admin\/counters$/.test(c.url))).toBe(true));
    const created = calls.find((c) => c.method === "POST" && /\/admin\/counters$/.test(c.url));
    expect(created?.body).toMatchObject({ counter_name: "Kochi Counter", counter_code: "" });
  });

  it("shows which counters can be unlocked and which cannot", async () => {
    installApi(liveState().handlers);
    await renderPage();

    expect(within(counterCard("Front Counter")).getByText(/unlock pin set/i)).toBeInTheDocument();
    expect(within(counterCard("Dock Counter")).getByText(/no unlock pin/i)).toBeInTheDocument();
  });

  it("sets the counter unlock PIN without leaving it on screen", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    await renderPage();

    await userEvent.click(within(counterCard("Dock Counter")).getByRole("button", { name: /set unlock pin/i }));
    const dialog = await screen.findByRole("dialog", { name: /unlock pin/i });

    // A PIN is typed blind, and the dialog says what a reset also does.
    const input = within(dialog).getByLabelText(/new unlock pin/i);
    expect(input).toHaveAttribute("type", "password");
    expect(within(dialog).getByText(/locks the counter/i)).toBeInTheDocument();

    await userEvent.type(input, "731964");
    await userEvent.click(within(dialog).getByRole("button", { name: /set unlock pin/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && /unlock-pin\/reset$/.test(c.url))).toBe(true)
    );
    const call = calls.find((c) => c.method === "POST" && /unlock-pin\/reset$/.test(c.url));
    expect(call?.url).toContain("/admin/counters/4/unlock-pin/reset");
    expect(call?.body).toEqual({ pin: "731964" });

    // It is shown once — as nothing at all — and the card now says it exists.
    expect(document.body.textContent).not.toContain("731964");
    await waitFor(() =>
      expect(within(counterCard("Dock Counter")).getByText(/unlock pin set/i)).toBeInTheDocument()
    );
    expect(screen.queryByRole("dialog", { name: /unlock pin/i })).not.toBeInTheDocument();
  });

  it("refuses a trivial PIN before the panel asks the server", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    await renderPage();

    await userEvent.click(within(counterCard("Front Counter")).getByRole("button", { name: /set unlock pin/i }));
    const dialog = await screen.findByRole("dialog", { name: /unlock pin/i });
    const input = within(dialog).getByLabelText(/new unlock pin/i);

    await userEvent.type(input, "123456");
    expect(within(dialog).getByRole("button", { name: /set unlock pin/i })).toBeDisabled();
    expect(within(dialog).getByText(/sequential/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST" && /unlock-pin\/reset$/.test(c.url))).toBe(false);

    // Six digits is the counter domain's floor — four is not enough here.
    await userEvent.clear(input);
    await userEvent.type(input, "58291");
    expect(within(dialog).getByRole("button", { name: /set unlock pin/i })).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, "582913");
    expect(within(dialog).getByRole("button", { name: /set unlock pin/i })).toBeEnabled();
  });

  it("issues a one-time approval PIN and shows it exactly once", async () => {
    const state = liveState();
    const calls = installApi(state.handlers);
    await renderPage();

    await userEvent.click(within(counterCard("Front Counter")).getByRole("button", { name: /^approval pin$/i }));
    const dialog = await screen.findByRole("dialog", { name: /issue an approval pin/i });
    expect(within(dialog).getByRole("checkbox", { name: /discount above/i })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /price change above/i })).toBeChecked();

    await userEvent.click(within(dialog).getByRole("checkbox", { name: /cancel an issued invoice/i }));
    await userEvent.type(within(dialog).getByLabelText(/reason/i), "Bulk order");
    await userEvent.click(within(dialog).getByRole("button", { name: /^issue pin$/i }));

    const pinPanel = await screen.findByRole("dialog", { name: /one-time approval pin/i });
    expect(within(pinPanel).getByText("481920")).toBeInTheDocument();
    await userEvent.click(within(pinPanel).getByRole("button", { name: /done/i }));

    // The PIN is a credential: once the panel is closed, no trace of it stays.
    expect(screen.queryByText("481920")).not.toBeInTheDocument();

    const issued = calls.find((c) => c.method === "POST" && /one-time-pins$/.test(c.url));
    expect(issued?.body).toMatchObject({
      counter_id: 3,
      actions: ["pos.discount", "pos.price_override", "invoice.cancel"],
      minutes: 10,
      reason: "Bulk order",
    });
  });

  it("keeps the approval dialog open when the server refuses to issue", async () => {
    const state = liveState();
    installApi([
      [
        "POST",
        /\/admin\/approvals\/one-time-pins$/,
        () => ({
          status: 403,
          body: { success: false, code: "ISSUER_NOT_PERMITTED", error: "Only an administrator or store owner can issue an approval PIN." },
        }),
      ] as const,
      ...state.handlers,
    ] as any);
    await renderPage();

    await userEvent.click(within(counterCard("Front Counter")).getByRole("button", { name: /^approval pin$/i }));
    const dialog = await screen.findByRole("dialog", { name: /issue an approval pin/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /^issue pin$/i }));

    await waitFor(() =>
      expect(within(dialog).getByText(/only an administrator or store owner/i)).toBeInTheDocument()
    );
    expect(screen.queryByRole("dialog", { name: /one-time approval pin/i })).not.toBeInTheDocument();
  });

  it("keeps the dialog open when the server refuses the PIN", async () => {
    const state = liveState();
    state.refusePinReset(() => ({
      status: 422,
      body: { message: "PIN must be 6 numeric digits.", errors: { pin: ["PIN must be 6 numeric digits."] } },
    }));
    installApi(state.handlers);
    await renderPage();

    await userEvent.click(within(counterCard("Dock Counter")).getByRole("button", { name: /set unlock pin/i }));
    const dialog = await screen.findByRole("dialog", { name: /unlock pin/i });
    await userEvent.type(within(dialog).getByLabelText(/new unlock pin/i), "582913");
    await userEvent.click(within(dialog).getByRole("button", { name: /set unlock pin/i }));

    await waitFor(() => expect(screen.getByText(/PIN must be 6 numeric digits/i)).toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: /unlock pin/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("582913");
    expect(within(counterCard("Dock Counter")).getByText(/no unlock pin/i)).toBeInTheDocument();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPage } from "./SettingsPage";

/**
 * GAP-01 / SPR-006..008 — the owner's switch for the salesperson on a bill.
 *
 * `required` is the shipped default, because a store that keeps no salesperson
 * column is a store that cannot say who sold. The panel must read the stored
 * word back honestly and must never save a word the server has no meaning for.
 */

const auth = vi.hoisted(() => ({
  activeStore: { id: 1, name: "North Store", code: "NST", store_type: "retail" },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: false,
    role: "super_admin",
    activeStore: auth.activeStore,
  }),
}));

const calls: Array<{ method: string; url: string; body: any }> = [];

function installApi(payload: Record<string, any>) {
  vi.spyOn(global, "fetch").mockImplementation((async (input: any, init: any = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const url = typeof input === "string" ? input : String(input?.url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    if (method === "GET") {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
}

const base = {
  store_id: "1",
  store_name: "North Store",
  tax_mode: "inclusive",
  billing: { tax_mode: "inclusive", credit_period_days: 30 },
  sequences: { invoicePrefix: "INV" },
  printing: { paperSize: "thermal_80mm" },
  workspace: { theme: "light" },
  security: {},
  inventory: {},
  wallet: {},
  whatsapp: { enabled: false },
};

async function openSettings() {
  render(<SettingsPage />);
  await screen.findByRole("button", { name: /Save System Settings/i });
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("alert", vi.fn());
});

describe("salesperson on bill", () => {
  it("reads the mode the store has stored", async () => {
    installApi({ ...base, salesperson_on_bill: "optional" });
    await openSettings();

    expect(screen.getByLabelText(/Salesperson on bill/i)).toHaveValue("optional");
  });

  it("shows required when the store has never chosen", async () => {
    installApi({ ...base });
    await openSettings();

    expect(screen.getByLabelText(/Salesperson on bill/i)).toHaveValue("required");
    expect(screen.getByText(/shipped default/i)).toBeInTheDocument();
  });

  it("saves the chosen word and leaves the rest of the billing block alone", async () => {
    installApi({ ...base, salesperson_on_bill: "required" });
    await openSettings();

    await userEvent.selectOptions(screen.getByLabelText(/Salesperson on bill/i), "off");
    await userEvent.click(screen.getByRole("button", { name: /Save System Settings/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && /\/admin\/settings$/.test(c.url));
      expect(post?.body.salesperson_on_bill).toBe("off");
    });
    const post = calls.find((c) => c.method === "POST" && /\/admin\/settings$/.test(c.url))!;
    expect(post.body.billing.tax_mode).toBe("inclusive");
    expect(post.body.billing.credit_period_days).toBe(30);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPage } from "./SettingsPage";

/**
 * CR-C Task 4.14 — the charge policy switches (CFG-003).
 *
 * These four keys are read by the server on every posted bill: negative lines may be refused, the
 * charge total may be capped against the goods value, separately paid charges may or may not join
 * the supplier payable, and returns reverse charges proportionally or as sunk. The panel is the only
 * place an owner can set them, so it must show the stored value honestly — and a blank cap must save
 * as "no cap", never as 0%, which would refuse every charge line in the store.
 */

const auth = vi.hoisted(() => ({ activeStore: { id: 1, name: "North Store", code: "NST", store_type: "pharmacy" } }));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: false,
    role: "super_admin",
    activeStore: auth.activeStore,
  }),
}));

const POLICY = {
  reverse_on_return: "sunk",
  separately_paid_in_payable: false,
  allow_negative_charges: true,
  max_percent_of_goods: 10,
};

const settings = {
  store_id: "1",
  store_name: "North Store",
  tax_mode: "inclusive",
  billing: {
    tax_mode: "inclusive",
    purchase_tax_mode: "exclusive",
    credit_period_days: 30,
    round_off_enabled: true,
    purchase_charges: POLICY,
  },
  sequences: { invoicePrefix: "INV" },
  printing: { paperSize: "thermal_80mm" },
  workspace: { theme: "light" },
  security: {},
  inventory: {},
  wallet: {},
  whatsapp: { enabled: false },
};

const calls: Array<{ method: string; url: string; body: any }> = [];

function installApi(saveReturns: any = { success: true }) {
  vi.spyOn(global, "fetch").mockImplementation((async (input: any, init: any = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const url = typeof input === "string" ? input : String(input?.url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    if (method === "GET") {
      return new Response(JSON.stringify(settings), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(saveReturns), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
}

async function openPolicy() {
  render(<SettingsPage />);
  await screen.findByText(/Supplier bill charges/i);
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("alert", vi.fn());
});

describe("SettingsPage charge policy", () => {
  it("shows the store's stored policy rather than the defaults", async () => {
    installApi();
    await openPolicy();

    expect(screen.getByLabelText(/Charge reversal on return/i)).toHaveValue("sunk");
    expect(screen.getByLabelText(/separately paid charges into the supplier payable/i)).not.toBeChecked();
    expect(screen.getByLabelText(/Allow negative charge lines/i)).toBeChecked();
    expect(screen.getByLabelText(/Maximum charges as % of goods value/i)).toHaveValue(10);
  });

  it("saves only what changed, keeping the rest of the billing block", async () => {
    installApi();
    await openPolicy();

    await userEvent.click(screen.getByLabelText(/separately paid charges into the supplier payable/i));
    await userEvent.clear(screen.getByLabelText(/Maximum charges as % of goods value/i));
    await userEvent.click(screen.getByRole("button", { name: /Save System Settings/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && /\/admin\/settings$/.test(c.url));
      expect(post).toBeTruthy();
    });
    const post = calls.find((c) => c.method === "POST" && /\/admin\/settings$/.test(c.url))!;

    expect(post.body.billing.purchase_charges).toEqual({
      reverse_on_return: "sunk",
      separately_paid_in_payable: true,
      allow_negative_charges: true,
      // A cleared cap is sent as null (no cap), not as 0 rendered in a box that limits nothing.
      max_percent_of_goods: null,
    });
    expect(post.body.billing.tax_mode).toBe("inclusive");
    expect(post.body.billing.credit_period_days).toBe(30);
  });
});

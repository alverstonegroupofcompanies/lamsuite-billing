import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPage } from "./SettingsPage";

/**
 * G8-UI (same cause as UI-01): the gateway URL input rendered `api_url || <default>`, so
 * clearing it put the default straight back and anything typed was appended to it.
 */

// A stable store object, as in the app: SettingsPage reloads whenever activeStore changes identity.
const auth = vi.hoisted(() => ({ activeStore: { id: 1, name: "North Store", code: "NST", store_type: "pharmacy" } }));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: false,
    role: "super_admin",
    activeStore: auth.activeStore,
  }),
}));

const settings = {
  store_id: "1",
  store_name: "North Store",
  tax_mode: "inclusive",
  billing: { tax_mode: "inclusive" },
  sequences: { invoicePrefix: "INV" },
  printing: { paperSize: "thermal_80mm" },
  workspace: { theme: "light" },
  security: {},
  inventory: {},
  wallet: {},
  whatsapp: { enabled: true, api_url: "https://wa-api.alverstone.in", session_id: "default" },
};

beforeEach(() => {
  vi.stubGlobal("alert", vi.fn());
  vi.spyOn(global, "fetch").mockImplementation((async () =>
    new Response(JSON.stringify(settings), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch);
});

describe("SettingsPage WhatsApp gateway URL", () => {
  it("can be cleared and replaced instead of appending to the default", async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await userEvent.click(await screen.findByRole("button", { name: /WhatsApp Gateway \(OpenWA\)/i }));
    // Switching tab reloads the settings; edit only after that reload has landed.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    const input = await screen.findByDisplayValue("https://wa-api.alverstone.in");
    await userEvent.clear(input);
    expect(input).toHaveValue("");

    await userEvent.type(input, "https://wa.example.test");
    expect(input).toHaveValue("https://wa.example.test");
  });
});

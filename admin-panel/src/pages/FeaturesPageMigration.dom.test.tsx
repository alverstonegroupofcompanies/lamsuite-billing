import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FeaturesPage } from "./FeaturesPage";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    activeStore: { id: 7, name: "Alpha Store", code: "STR007" },
    stores: [{ id: 7, name: "Alpha Store", code: "STR007" }],
    hasPermission: () => true,
  }),
}));

const calls: Array<{ method: string; url: string; body: any }> = [];

function installApi(featureFlags: Record<string, boolean>) {
  vi.spyOn(global, "fetch").mockImplementation((async (input: any, init: any = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const url = typeof input === "string" ? input : String(input?.url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    const payload = {
      store_id: 7,
      store_name: "Alpha Store",
      all_available_menus: [{ id: "pos", name: "POS Billing", description: "Billing counter" }],
      enabled_menu_items: ["pos"],
      feature_flags: featureFlags,
      version: 4,
    };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
}

/**
 * MIG-02: the switch that decides whether a branch's tills may import legacy data lives
 * on the store row, and the server answers for a branch that never saved it. The panel
 * has to show that answer rather than a blank that reads as "off".
 */
describe("Menu & Feature Control owns the Data Migration switch", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("alert", vi.fn());
  });

  it("shows the switch as the store has it", async () => {
    installApi({ allow_data_migration: true, allow_offline_billing: false });

    render(<FeaturesPage />);

    const card = await screen.findByText(/Legacy Data Migration/);
    expect(card).toBeInTheDocument();
    expect(screen.getByText(/Off stops imports/)).toBeInTheDocument();
  });

  it("saves the switch off against the store in scope", async () => {
    installApi({ allow_data_migration: true, allow_offline_billing: false });

    render(<FeaturesPage />);

    fireEvent.click(await screen.findByText(/Legacy Data Migration/));
    fireEvent.click(screen.getByRole("button", { name: /Apply Feature Config/ }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/admin/stores/7/features"))).toBe(true)
    );
    const save = calls.find((c) => c.method === "PUT")!;
    expect(save.body.feature_flags.allow_data_migration).toBe(false);
    expect(save.body.feature_flags.allow_offline_billing).toBe(false);
    expect(save.body.enabled_menu_items).toEqual(["pos"]);
  });
});

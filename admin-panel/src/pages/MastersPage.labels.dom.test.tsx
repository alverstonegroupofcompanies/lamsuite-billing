import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MastersPage } from "./MastersPage";

/**
 * UI-02 — master tabs name their create action with a real singular label.
 *
 * Truncating the plural ("Parties".slice(0, -1)) produced "Add Partie" and
 * "Add Categorie"; the button, delete confirm and lookup modal all shared it.
 */

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: false,
    role: "super_admin",
    activeStore: { id: 1, name: "North Store", code: "NST", store_type: "pharmacy" },
  }),
}));

beforeEach(() => {
  vi.spyOn(global, "fetch").mockImplementation((async () =>
    new Response(JSON.stringify({ data: [], current_page: 1, last_page: 1, total: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch);
});

describe("MastersPage — create-action labels (UI-02)", () => {
  it('labels the parties action "Add Party"', async () => {
    render(<MastersPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Parties & Ledgers/i }));

    expect(await screen.findByRole("button", { name: /^Add Party$/ })).toBeInTheDocument();
    expect(screen.queryByText(/Partie\b/)).not.toBeInTheDocument();
  });

  it("uses real singular labels for lookup tabs", async () => {
    render(<MastersPage />);

    await userEvent.click(await screen.findByRole("button", { name: /Categories \/ Groups/i }));
    expect(await screen.findByRole("button", { name: /^Add Category$/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Bank Accounts/i }));
    expect(await screen.findByRole("button", { name: /^Add Bank Account$/ })).toBeInTheDocument();
  });
});

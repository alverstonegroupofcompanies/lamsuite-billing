import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MastersPage } from "./MastersPage";

/**
 * MST-01 — the party form carries a GST state at all.
 *
 * Every party used to be saved with state_code "32" whatever the store or the
 * GSTIN said, which put Kerala place-of-supply on bills from other states.
 */

let fetchMock: ReturnType<typeof vi.fn>;

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: false,
    role: "super_admin",
    activeStore: { id: 7, name: "Belagavi Branch", code: "BLG", state_code: "29", store_type: "pharmacy" },
  }),
}));

beforeEach(() => {
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ data: [], current_page: 1, last_page: 1, total: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  vi.spyOn(global, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);
});

async function openCreateParty() {
  render(<MastersPage />);
  await userEvent.click(await screen.findByRole("button", { name: /Parties & Ledgers/i }));
  await userEvent.click(await screen.findByRole("button", { name: /^Add Party$/ }));
}

function stateField() {
  return screen.getByLabelText(/State Code/i) as HTMLSelectElement;
}

/** Most master-form labels are still plain siblings of their control. */
function controlFor(labelText: RegExp): HTMLInputElement {
  const label = screen.getByText(labelText);
  const control = label.parentElement?.querySelector("input");
  if (!control) throw new Error(`No input beside "${labelText}"`);
  return control as HTMLInputElement;
}

function postedBody(): Record<string, any> {
  const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
  return JSON.parse(String((call?.[1] as RequestInit).body));
}

describe("MastersPage — party GST state (MST-01)", () => {
  it("starts a new party on the active store's state, not Kerala", async () => {
    await openCreateParty();
    expect(stateField().value).toBe("29");
  });

  it("follows the state declared by the GSTIN and posts it", async () => {
    await openCreateParty();

    await userEvent.type(controlFor(/Full Name/i), "Sai Traders");
    await userEvent.type(screen.getByLabelText(/^GSTIN/i), "27ABCDE1234F1Z5");
    await userEvent.tab();

    expect(stateField().value).toBe("27");

    await userEvent.click(screen.getByRole("button", { name: /^Save Party$/ }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")
      ).toBe(true);
    });
    expect(postedBody().state_code).toBe("27");
  });

  it("only offers real GST state codes", async () => {
    await openCreateParty();
    const values = Array.from(stateField().options).map((o) => o.value);
    expect(values).toContain("33");
    expect(values).not.toContain("3232");
  });
});

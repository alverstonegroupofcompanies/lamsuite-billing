import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StoresPage } from "./StoresPage";

/**
 * UI-01 / SET-01 — the store form's free-text parameters stay editable, and the
 * GST state is chosen from the real state list rather than typed.
 *
 * A render-time fallback ("Asia/Kolkata", "Professional") makes a field
 * impossible to clear: backspacing restores the default, so a typed
 * replacement is appended to it. For the state code that appending was worse
 * than cosmetic — "32" + "32" produced a store whose place of supply no GST
 * return can file.
 */

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: false,
    role: "super_admin",
    stores: [],
    activeStore: null,
  }),
}));

beforeEach(() => {
  vi.spyOn(global, "fetch").mockImplementation((async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch);
});

async function openAddStore() {
  render(<StoresPage />);
  await userEvent.click(await screen.findByRole("button", { name: /Add Store Branch/i }));
}

describe("StoresPage — store parameters stay editable (UI-01)", () => {
  it("clears and replaces the timezone and license plan instead of appending", async () => {
    await openAddStore();

    const timezone = screen.getByDisplayValue("Asia/Kolkata") as HTMLInputElement;
    await userEvent.clear(timezone);
    expect(timezone.value).toBe("");
    await userEvent.type(timezone, "Asia/Dubai");
    expect(timezone.value).toBe("Asia/Dubai");

    const licensePlan = screen.getByDisplayValue("Professional Store") as HTMLInputElement;
    await userEvent.clear(licensePlan);
    expect(licensePlan.value).toBe("");
    await userEvent.type(licensePlan, "Enterprise");
    expect(licensePlan.value).toBe("Enterprise");
  });
});

describe("StoresPage — GST state cannot be mistyped (SET-01)", () => {
  it("chooses the state from the GST state list instead of a text box", async () => {
    await openAddStore();
    const field = screen.getByLabelText(/State Code/i);
    expect(field.tagName).toBe("SELECT");

    await userEvent.selectOptions(field, "29");
    expect((field as HTMLSelectElement).value).toBe("29");
    expect(Array.from((field as HTMLSelectElement).options).map((o) => o.value)).not.toContain("3232");
  });

  it("follows the state the GSTIN declares", async () => {
    await openAddStore();
    const gstin = screen.getByLabelText(/GSTIN/i) as HTMLInputElement;
    await userEvent.type(gstin, "27ABCDE1234F1Z5");
    await userEvent.tab();

    expect((screen.getByLabelText(/State Code/i) as HTMLSelectElement).value).toBe("27");
  });

  it("will not hold a store code the server would reject", async () => {
    await openAddStore();
    const code = screen.getByLabelText(/Store Code/i) as HTMLInputElement;
    await userEvent.clear(code);
    await userEvent.type(code, "STORE 04/QA-PH");
    expect(code.value).toBe("STORE04QA-PH");
  });

  it("starts empty, so typing never appends to a suggested code", async () => {
    await openAddStore();
    const code = screen.getByLabelText(/Store Code/i) as HTMLInputElement;
    expect(code.value).toBe("");
    expect(code.placeholder).toMatch(/^STORE-0\d+$/);

    await userEvent.type(code, "qa_ph-1");
    expect(code.value).toBe("QAPH-1");
  });
});

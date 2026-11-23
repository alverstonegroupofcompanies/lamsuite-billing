import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MastersPage } from "./MastersPage";

/**
 * STK-01 / PRD-01 — the admin product form must not pre-fill "B1" or a
 * fabricated expiry date, and must not send opening stock without them.
 */

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: false,
    role: "super_admin",
    activeStore: { id: 1, name: "North Store", code: "NST", store_type: "pharmacy" },
  }),
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ data: [], current_page: 1, last_page: 1, total: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  vi.spyOn(global, "fetch").mockImplementation(fetchMock as typeof fetch);
});

function fieldFor(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  const input = label.parentElement?.querySelector("input");
  if (!input) throw new Error(`No input beside "${labelText}"`);
  return input as HTMLInputElement;
}

async function openCreateProduct() {
  render(<MastersPage />);
  await userEvent.click(await screen.findByRole("button", { name: /^Add Product$/ }));
}

describe("MastersPage — opening stock (STK-01 / PRD-01)", () => {
  it("starts the opening batch blank instead of inventing B1 and an expiry", async () => {
    await openCreateProduct();

    expect(fieldFor("Batch No").value).toBe("");
    expect(fieldFor("Expiry Date").value).toBe("");
    expect(fieldFor("Stock Quantity").value).toBe("0");
  });

  it("refuses to submit opening stock without a batch number and expiry", async () => {
    await openCreateProduct();

    await userEvent.type(fieldFor("Product / Brand Item Name *"), "Ibuprofen 400mg");
    await userEvent.clear(fieldFor("Stock Quantity"));
    await userEvent.type(fieldFor("Stock Quantity"), "25");

    await userEvent.click(screen.getByRole("button", { name: /^Save Product$/ }));

    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(0);
  });

  it("sends the opening batch only when stock is positive", async () => {
    await openCreateProduct();

    await userEvent.type(fieldFor("Product / Brand Item Name *"), "Ibuprofen 400mg");
    await userEvent.type(fieldFor("Batch No"), "OPEN-9");
    await userEvent.type(fieldFor("Expiry Date"), "2028-06-30");
    await userEvent.clear(fieldFor("Stock Quantity"));
    await userEvent.type(fieldFor("Stock Quantity"), "25");

    await userEvent.click(screen.getByRole("button", { name: /^Save Product$/ }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true);
    });

    const [, init] = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.initial_batch).toEqual({ batch_no: "OPEN-9", expiry_date: "2028-06-30", stock_qty: 25 });
  });
});

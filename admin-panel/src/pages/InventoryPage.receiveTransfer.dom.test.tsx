import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryPage } from "./InventoryPage";

/**
 * STK-03 — receiving a transfer reports what actually arrived. The dialog must
 * demand a reason for a short line, and send per-line quantities instead of the
 * old one-click "credit everything".
 */

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isAllStores: false,
    stores: [],
    activeStore: { id: 2, name: "QA Cosmetics", code: "QA-CS", store_type: "retail" },
  }),
}));

const TRANSFER = {
  id: 41,
  transfer_number: "TRF-20261122-ABC123",
  status: "dispatched",
  from_store: { id: 1, name: "QA Pharmacy", code: "QA-PH" },
  to_store: { id: 2, name: "QA Cosmetics", code: "QA-CS" },
  items: [
    {
      id: 501,
      product_id: 11,
      batch_no: "QA-B1",
      qty: 30,
      product: { id: 11, name: "QA Paracetamol 500mg", barcode: "8909000000011" },
    },
  ],
};

const DEST_PRODUCTS = [{ id: 77, name: "QA Glow Face Cream 50g", barcode: "8909000000011" }];

let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();

    if (method === "POST" && url.includes("/receive")) {
      return json({ success: true, transfer: { ...TRANSFER, status: "received" }, resolutions: [] });
    }
    if (url.includes("/admin/stock/transfers")) {
      return json({ success: true, data: [TRANSFER] });
    }
    if (url.includes("/admin/products")) {
      return json({ data: DEST_PRODUCTS, current_page: 1, last_page: 1, total: DEST_PRODUCTS.length });
    }
    return json({ data: [], success: true, current_page: 1, last_page: 1, total: 0 });
  });
  vi.spyOn(global, "fetch").mockImplementation(fetchMock as typeof fetch);
});

async function openTransferReceipt() {
  render(<InventoryPage />);
  await userEvent.click(await screen.findByRole("button", { name: /Inter-Store Transfers/i }));
  await userEvent.click(await screen.findByRole("button", { name: /^Receive Stock$/ }));
  const heading = await screen.findByText(/Receive TRF-20261122-ABC123/);
  const overlay = heading.closest("div.fixed") as HTMLElement;
  const form = overlay.querySelector("form") as HTMLElement;
  if (!form) throw new Error("Receipt form not found");
  return form;
}

function receivedQtyInput(panel: HTMLElement): HTMLInputElement {
  const editable = (within(panel).getAllByDisplayValue("30") as HTMLInputElement[]).find(
    (el) => !el.hasAttribute("disabled")
  );
  if (!editable) throw new Error("Received quantity input not found");
  return editable;
}

describe("InventoryPage — transfer receipt (STK-03)", () => {
  it("blocks a short receipt until a shortage reason is recorded", async () => {
    const panel = await openTransferReceipt();

    const received = receivedQtyInput(panel);
    await userEvent.clear(received);
    await userEvent.type(received, "25");

    await userEvent.click(within(panel).getByRole("button", { name: /^Receive Stock$/ }));

    expect(await screen.findByText(/shortage reason is required/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => ((init as RequestInit | undefined)?.method || "GET") === "POST")).toBe(false);
  });

  it("sends the received quantity and reason per line", async () => {
    const panel = await openTransferReceipt();

    const received = receivedQtyInput(panel);
    await userEvent.clear(received);
    await userEvent.type(received, "25");

    const reason = within(panel).getByPlaceholderText(/crushed in transit/i);
    await userEvent.type(reason, "Five strips crushed in transit");

    await userEvent.click(within(panel).getByRole("button", { name: /^Receive Stock$/ }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => ((init as RequestInit | undefined)?.method || "GET") === "POST")).toBe(true);
    });

    const [, init] = fetchMock.mock.calls.find(
      ([, i]) => ((i as RequestInit | undefined)?.method || "GET") === "POST"
    )!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.lines).toEqual([
      { item_id: 501, received_qty: 25, shortage_reason: "Five strips crushed in transit" },
    ]);
  });
});

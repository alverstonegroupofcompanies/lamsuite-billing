import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PurchasesPage } from "./PurchasesPage";
import { sqliteStorage } from "../lib/db/sqliteStorage";
import { supplierLedgerService } from "../lib/purchases/supplierLedgerService";
import { purchaseOrderService } from "../lib/purchases/purchaseOrderService";
import { shortcutDispatcher } from "../lib/keyboard/shortcutDispatcher";

/**
 * KB-01: the button says "New Inward Bill (F2)", so F2 must open the bill.
 *
 * The shortcut was advertised on the button and in the key map, but nothing on the list
 * answered it - F2 was the global Purchases chord, which on this route is a no-op, and
 * Ctrl+Shift+N was never registered either. Both keys are keyed here, once with the global
 * shell installed exactly as Layout installs it.
 */

function press(key: string, init: Record<string, unknown> = {}) {
  fireEvent.keyDown(document.body, { key, ...init });
}

const entryRow = () => screen.queryByPlaceholderText(/Scan barcode or type product name \[F1\]/i);

let navPurchases: ReturnType<typeof vi.fn>;
let unregisterGlobal: () => void;
let uninstall: () => void;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/purchases"]}>
      <PurchasesPage />
    </MemoryRouter>
  );
}

describe("Purchases list opens an inward bill from the keyboard (KB-01)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sqliteStorage, "findAll").mockResolvedValue([]);
    vi.spyOn(supplierLedgerService, "getAllSuppliers").mockResolvedValue([]);
    vi.spyOn(supplierLedgerService, "getSupplierAgeingAnalysis").mockResolvedValue([]);
    vi.spyOn(supplierLedgerService, "getSupplierStatement").mockResolvedValue(null as never);
    vi.spyOn(purchaseOrderService, "getAllOrders").mockResolvedValue([]);

    navPurchases = vi.fn(() => true);
    uninstall = shortcutDispatcher.install();
    unregisterGlobal = shortcutDispatcher.register({
      id: "test-global-shell",
      scope: "global",
      handlers: { navPurchases },
    });
  });

  afterEach(() => {
    unregisterGlobal();
    uninstall();
  });

  it("opens the entry form on F2 and never leaves the list", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("New Inward Bill (F2)")).toBeInTheDocument());

    press("F2");

    await waitFor(() => expect(entryRow()).not.toBeNull());
    expect(navPurchases).not.toHaveBeenCalled();
  });

  it("opens the entry form on Ctrl+Shift+N as well", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("New Inward Bill (F2)")).toBeInTheDocument());

    press("n", { ctrlKey: true, shiftKey: true });

    await waitFor(() => expect(entryRow()).not.toBeNull());
    expect(navPurchases).not.toHaveBeenCalled();
  });
});

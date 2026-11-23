import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PosBillingPage } from "./PosBillingPage";
import { posCartService } from "../lib/billing/posCartService";
import { getMockDatabase, sqliteStorage } from "../lib/db/sqliteStorage";
import { salespersonStore } from "../lib/masters/salespersonStore";
import { shortcutDispatcher } from "../lib/keyboard/shortcutDispatcher";
import { resetMockHandlers } from "../lib/ipc/ipcBridge";

/**
 * GAP-01 / SPR-012 — naming who sold the bill without leaving the keyboard.
 *
 * The store default is that every bill names a person, so the field has to be
 * reachable the way everything else in the header is reachable: a chord. Alt+S
 * lands on it, the type-ahead answers from the device cache with no network,
 * and the owner switching the column off takes both the field and the chord
 * away — a key that focuses nothing must not swallow the keystroke.
 */

async function seedPeople() {
  await salespersonStore.ingest(
    [
      { id: 11, store_id: 1, name: "Rina Thomas", code: "SP-01", phone: "9847111222", is_active: true },
      { id: 12, store_id: 1, name: "Abdul Samad", code: "SP-02", phone: "9847333444", is_active: true },
    ],
    "1"
  );
}

function openPos() {
  return render(
    <MemoryRouter initialEntries={["/pos"]}>
      <PosBillingPage />
    </MemoryRouter>
  );
}

const altS = { key: "s", altKey: true, ctrlKey: false, metaKey: false, shiftKey: false };

let uninstallDispatcher: () => void;

beforeEach(async () => {
  resetMockHandlers();
  sqliteStorage.registerMockIpcHandlers();
  getMockDatabase().reset();
  await sqliteStorage.initDatabase();
  localStorage.clear();
  posCartService.clearCart();
  await seedPeople();
  // The app shell installs the listener; a screen rendered on its own has to.
  uninstallDispatcher = shortcutDispatcher.install();
});

afterEach(() => {
  uninstallDispatcher();
  cleanup();
});

describe("POS salesperson chord", () => {
  it("names the field as required, the way the store default says", async () => {
    openPos();

    const field = await screen.findByPlaceholderText(/salesperson/i);
    expect(field).toHaveAttribute("aria-required", "true");
    expect(field).toHaveAttribute("placeholder", expect.stringMatching(/\*/));
  });

  it("puts the caret in the salesperson field on Alt+S", async () => {
    openPos();

    const field = await screen.findByPlaceholderText(/salesperson/i);
    fireEvent.keyDown(window, altS);

    await waitFor(() => expect(document.activeElement).toBe(field));
    // Focusing opens the list so a cashier sees who is on the counter's list.
    expect(screen.getByRole("listbox", { name: /salespeople/i })).toBeInTheDocument();
  });

  it("types ahead offline and puts the chosen person on the bill", async () => {
    const onChoose = vi.spyOn(posCartService, "setSalesperson");
    openPos();

    const field = await screen.findByPlaceholderText(/salesperson/i);
    fireEvent.keyDown(window, altS);
    await userEvent.type(field, "rina");

    const option = await screen.findByRole("option", { name: /Rina Thomas/ });
    await userEvent.click(option);

    expect(field).toHaveValue("Rina Thomas");
    expect(onChoose).toHaveBeenCalledWith("11", "Rina Thomas");
  });

  it("keeps the column and its chord out of the bill when the owner turns it off", async () => {
    await sqliteStorage.insertRecord("store_settings", "active_config", {
      salesperson_on_bill: "off",
      store_type: "general",
    });

    openPos();
    await screen.findByLabelText("Scan barcode or type product name");

    expect(screen.queryByPlaceholderText(/salesperson/i)).toBeNull();

    const entry = document.activeElement;
    fireEvent.keyDown(window, altS);
    // Declined: the keystroke is not eaten by a field that does not exist.
    await waitFor(() => expect(document.activeElement).toBe(entry));
  });
});

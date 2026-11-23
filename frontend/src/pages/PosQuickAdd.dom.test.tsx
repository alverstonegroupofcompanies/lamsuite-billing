import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PosBillingPage } from "./PosBillingPage";
import { counterSessionService } from "../lib/auth/counterSessionService";
import { getMockDatabase, sqliteStorage } from "../lib/db/sqliteStorage";
import { resetMockHandlers } from "../lib/ipc/ipcBridge";

/**
 * PRD-02: billing used to swallow an unknown name — no dropdown, no message,
 * nothing for the cashier to press. The purchase screen already had a quick-add
 * door; billing has to offer the same one, and only to a till whose profile
 * reaches Masters.
 */
async function typeUnknownProduct(name: string) {
  render(
    <MemoryRouter initialEntries={["/pos"]}>
      <PosBillingPage />
    </MemoryRouter>
  );

  const input = await screen.findByLabelText("Scan barcode or type product name");
  fireEvent.change(input, { target: { value: name } });
  fireEvent.focus(input);
}

describe("billing search gives the cashier a way forward (PRD-02)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("offers to create the product under the name that was typed", async () => {
    await typeUnknownProduct("QA Zinc Quickadd Tab");

    const row = await screen.findByTestId("product-search-quick-add");
    expect(row.textContent).toContain("QA Zinc Quickadd Tab");
    expect(screen.queryByTestId("product-search-empty")).not.toBeInTheDocument();
  });

  it("says the product is missing when this till may not reach Masters", async () => {
    vi.spyOn(counterSessionService, "allowsModule").mockImplementation((menu: string) => menu !== "masters");

    await typeUnknownProduct("QA Zinc Locked Tab");

    const hint = await screen.findByTestId("product-search-empty");
    expect(hint.textContent).toContain("QA Zinc Locked Tab");
    expect(screen.queryByTestId("product-search-quick-add")).not.toBeInTheDocument();
  });
});

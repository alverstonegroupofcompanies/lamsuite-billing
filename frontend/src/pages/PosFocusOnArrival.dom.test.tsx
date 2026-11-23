import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PosBillingPage } from "./PosBillingPage";
import { posCartService } from "../lib/billing/posCartService";
import { getMockDatabase, sqliteStorage } from "../lib/db/sqliteStorage";
import { resetMockHandlers } from "../lib/ipc/ipcBridge";

/**
 * KB-03(c): arriving at POS from a global F1 has to land on the entry row.
 *
 * The mount effect focused the search_bar input, which the default inline_row layout never
 * mounts, so the caret stayed on nothing. The entry row owns the first keystroke in both
 * layouts, and the landing focus has to follow the layout this store chose.
 */

describe("POS focuses the entry row on arrival (KB-03)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    localStorage.clear();
    posCartService.clearCart();
  });

  it("puts the caret in the inline entry row the default layout shows", async () => {
    render(
      <MemoryRouter initialEntries={["/pos"]}>
        <PosBillingPage />
      </MemoryRouter>
    );

    const entry = await screen.findByLabelText("Scan barcode or type product name");
    await waitFor(() => expect(document.activeElement).toBe(entry));
  });
});

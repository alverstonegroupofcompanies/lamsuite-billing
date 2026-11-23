import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PosBillingPage } from "./PosBillingPage";
import { posCartService } from "../lib/billing/posCartService";
import type { ProductBatch, ProductItem } from "../lib/masters/productsStore";
import { getMockDatabase, sqliteStorage } from "../lib/db/sqliteStorage";
import { resetMockHandlers } from "../lib/ipc/ipcBridge";

/**
 * KB-03(d): Option+2 and Option+8 must pick UPI and Credit.
 *
 * macOS reports Option+2 as `™` and Option+8 as `•`, so the handler's `event.key` lookup never
 * found the digit. The digit is the button's own number, and the buttons are the only map the
 * cashier sees; the keys have to read the physical key and follow this store's enabled modes.
 */

const PRODUCT = {
  id: "prod_1",
  name: "Paracetamol 650mg",
  sel_rate: 100,
  mrp: 100,
  gst_percent: 0,
  units_per_pack: 1,
  unit_name: "pc",
} as unknown as ProductItem;

const BATCH = {
  id: "batch_1",
  product_id: "prod_1",
  batch_no: "B1",
  expiry_date: "2030-12-31",
  selling_rate: 100,
  mrp: 100,
  purchase_rate: 70,
  stock_qty: 50,
} as unknown as ProductBatch;

const tenderModes = () => Array.from(document.querySelectorAll("select")).map((s) => s.value);

async function openSettlement() {
  render(
    <MemoryRouter initialEntries={["/pos"]}>
      <PosBillingPage />
    </MemoryRouter>
  );

  await screen.findByLabelText("Scan barcode or type product name");
  posCartService.clearCart();
  posCartService.addProductToCart(PRODUCT, BATCH, 1);

  fireEvent.keyDown(document.activeElement ?? document.body, { key: "F12" });
  await screen.findByText("Bill Settlement (F12)");
  await waitFor(() => expect(tenderModes()).toContain("Cash"));
}

describe("Settlement mode keys survive macOS Option (KB-03)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    localStorage.clear();
    posCartService.clearCart();
  });

  it("picks UPI with Option+2, which reports the symbol not the digit", async () => {
    await openSettlement();

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "™",
      code: "Digit2",
      altKey: true,
    });

    await waitFor(() => expect(tenderModes()).toContain("UPI"));
  });

  it("picks Credit with Option+8", async () => {
    await openSettlement();

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "•",
      code: "Digit8",
      altKey: true,
    });

    await waitFor(() => expect(tenderModes()).toContain("Credit"));
  });
});

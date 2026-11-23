import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PosBillingPage } from "./PosBillingPage";
import { posCartService } from "../lib/billing/posCartService";
import { counterSequenceService } from "../lib/auth/counterSequenceService";
import { companySettingsService } from "../lib/settings/companySettingsService";
import type { ProductBatch, ProductItem } from "../lib/masters/productsStore";
import { getMockDatabase, sqliteStorage } from "../lib/db/sqliteStorage";
import { resetMockHandlers } from "../lib/ipc/ipcBridge";

/**
 * NUM-02: the number on the screen has to be the number in the book.
 *
 * The till previewed C01-INV-7951 and the store's book filed the bill under
 * C01-INV-8301, because the number the counter actually issued was never shown
 * after the save. The preview is a guess until the save answers; the answer is
 * what the cashier, the print-out and the next bill have to follow.
 */

const COUNTER_ID = 12;
const COUNTER_CODE = "C01";
const FY = "2026-27";

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

/** Put this till on a counter series that starts at C01-INV-1001. */
async function primeCounterSeries() {
  await counterSequenceService.saveLeasedBlock({
    counter_id: COUNTER_ID,
    counter_code: COUNTER_CODE,
    doc_type: "invoice",
    financial_year: FY,
    prefix: `${COUNTER_CODE}-INV`,
    range_start: 1001,
    range_end: 1050,
    next_number: 1001,
  });
  counterSequenceService.setActiveCounter({ counterId: COUNTER_ID, counterCode: COUNTER_CODE, financialYear: FY });
}

async function openSettlementWithOneItem() {
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

  return screen.findByText("Invoice: C01-INV-1001");
}

function mockSaveAnswer(answer: { success: boolean; invoiceId: string; invoiceNumber?: string }) {
  return vi
    .spyOn(posCartService, "finalizeInvoice")
    .mockResolvedValue(answer as Awaited<ReturnType<typeof posCartService.finalizeInvoice>>);
}

describe("POS shows the number the counter issued (NUM-02)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    localStorage.clear();
    posCartService.clearCart();
    counterSequenceService.clearActiveCounter();
    await primeCounterSeries();
  });

  it("previews the next number of this counter's series while the bill is open", async () => {
    expect(companySettingsService.previewNextInvoiceNumber()).toBe("C01-INV-1001");
    await openSettlementWithOneItem();
  });

  it("tells the cashier when the counter files the bill under a different number", async () => {
    mockSaveAnswer({ success: true, invoiceId: "inv_1", invoiceNumber: "C01-INV-1051" });
    await openSettlementWithOneItem();

    fireEvent.click(screen.getByRole("button", { name: /Save \(Ctrl\+S\)/ }));

    await screen.findByText(/The counter issued C01-INV-1051 in place of C01-INV-1001/);
    expect(await screen.findByText("C01-INV-1051")).toBeInTheDocument();
  });

  it("moves the next preview past the number the counter filed", async () => {
    mockSaveAnswer({ success: true, invoiceId: "inv_1", invoiceNumber: "C01-INV-1051" });
    await openSettlementWithOneItem();

    fireEvent.click(screen.getByRole("button", { name: /Save \(Ctrl\+S\)/ }));

    await screen.findByText("Next: C01-INV-1052");
    await waitFor(() =>
      expect(counterSequenceService.previewForActive("invoice")).toBe("C01-INV-1052")
    );
  });

  it("says nothing about renumbering when the counter keeps the previewed number", async () => {
    mockSaveAnswer({ success: true, invoiceId: "inv_1", invoiceNumber: "C01-INV-1001" });
    await openSettlementWithOneItem();

    fireEvent.click(screen.getByRole("button", { name: /Save \(Ctrl\+S\)/ }));

    await screen.findByText("Invoice C01-INV-1001 billed successfully!");
    expect(screen.queryByText(/in place of/)).not.toBeInTheDocument();
    expect(counterSequenceService.previewForActive("invoice")).toBe("C01-INV-1002");
  });
});

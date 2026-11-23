import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SalesReturnPage } from "./SalesReturnPage";

/**
 * UI-03 — the return line shows the batch expiry the way the rest of the app
 * does (MM/YY in the store calendar), not the raw UTC timestamp.
 *
 * 2027-03-30T18:30:00.000000Z is midnight IST on 31 March 2027 → 03/27.
 */

const fixtures = vi.hoisted(() => ({
  invoice: {
    id: 77,
    invoice_number: "INV-77",
    status: "issued",
    customer_name: "QA Customer",
    grand_total: 10,
    paid_amount: 10,
  },
  item: {
    product_id: "p1",
    product_name: "QA Cough Syrup",
    batch_no: "B1",
    expiry_date: "2027-03-30T18:30:00.000000Z",
    qty: 1,
    loose_qty: 0,
    unit_price: 10,
    units_per_pack: 1,
    hsn_code: "3004",
  },
}));

vi.mock("../lib/billing/invoiceManagementService", () => ({
  invoiceManagementService: {
    getInvoiceWithDetails: vi.fn(async () => ({ invoice: fixtures.invoice, items: [fixtures.item] })),
    listInvoices: vi.fn(async () => [fixtures.invoice]),
  },
}));

vi.mock("../lib/billing/salesReturnService", () => ({
  salesReturnService: {
    getSalesReturns: vi.fn(async () => []),
    getReturnedQtyMapForInvoice: vi.fn(async () => new Map<string, number>()),
  },
  returnKey: (productId: string, batchNo?: string) => `${productId}_${batchNo || ""}`,
  toBaseUnits: (qty?: number, looseQty?: number, unitsPerPack?: number) =>
    Math.max(0, Number(qty) || 0) * Math.max(1, Math.round(Number(unitsPerPack) || 1)) +
    Math.max(0, Number(looseQty) || 0),
}));

vi.mock("../lib/printing/printingEngine", () => ({
  printingEngine: {},
}));

vi.mock("../lib/masters/partiesStore", () => ({
  partiesStore: { searchCustomers: vi.fn(async () => []) },
}));

vi.mock("../lib/settings/companySettingsService", () => ({
  companySettingsService: { getStorePrintHeader: vi.fn(() => ({})) },
}));

vi.mock("../components/PrintPreviewModal", () => ({
  PrintPreviewModal: () => null,
}));

describe("SalesReturnPage batch expiry (UI-03)", () => {
  it("renders the expiry as MM/YY instead of a raw UTC timestamp", async () => {
    render(
      <MemoryRouter initialEntries={["/returns?invoiceId=77"]}>
        <SalesReturnPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("QA Cough Syrup")).toBeInTheDocument();
    expect(screen.queryByText(/2027-03-30T18:30/)).not.toBeInTheDocument();
    expect(await screen.findByText("Exp: 03/27")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PurchaseReturnPage } from "./PurchaseReturnPage";

/**
 * UI-03 (G8-UI), purchase side: the return line shows the batch expiry as MM/YY,
 * not the raw UTC timestamp a purchase line carried from the server.
 *
 * 2027-03-30T18:30:00.000000Z is midnight IST on 31 March 2027, so the line shows 03/27.
 */

const fixtures = vi.hoisted(() => ({
  purchase: {
    id: "pur_1",
    purchase_number: "PUR-1",
    supplier_name: "QA Distributors",
    status: "posted",
    lines: [],
  },
  item: {
    product_id: "p1",
    product_name: "QA Antacid",
    batch_no: "PB1",
    expiry_date: "2027-03-30T18:30:00.000000Z",
    qty: 1,
    loose_qty: 0,
    units_per_pack: 1,
    purchase_rate: 10,
    gst_percent: 12,
  },
}));

vi.mock("../lib/db/sqliteStorage", () => ({
  sqliteStorage: { findAll: vi.fn(async () => [fixtures.purchase]) },
}));

vi.mock("../lib/purchases/purchaseService", () => ({
  purchaseService: { getPurchaseBillById: vi.fn(async () => ({ items: [fixtures.item] })) },
}));

vi.mock("../lib/purchases/purchaseReturnService", () => ({
  purchaseReturnService: {
    getPurchaseReturns: vi.fn(async () => []),
    // The picker reads this till's bills plus the server's, so the page no longer queries the
    // local table itself.
    getOriginalBills: vi.fn(async () => [fixtures.purchase]),
  },
}));

vi.mock("../lib/printing/printingEngine", () => ({ printingEngine: {} }));

vi.mock("../lib/settings/companySettingsService", () => ({
  companySettingsService: { getStorePrintHeader: vi.fn(() => ({})), getSettings: vi.fn(() => ({})) },
}));

vi.mock("../components/PrintPreviewModal", () => ({ PrintPreviewModal: () => null }));

describe("PurchaseReturnPage batch expiry (UI-03)", () => {
  it("renders the expiry as MM/YY instead of a raw UTC timestamp", async () => {
    render(
      <MemoryRouter initialEntries={["/returns/purchase?purchaseId=pur_1"]}>
        <PurchaseReturnPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("QA Antacid")).toBeInTheDocument();
    expect(screen.queryByText(/2027-03-30T18:30/)).not.toBeInTheDocument();
    expect(await screen.findByText("Exp: 03/27")).toBeInTheDocument();
  });
});

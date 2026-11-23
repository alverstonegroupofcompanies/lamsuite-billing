import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PurchasePostSuccessModal } from "./PurchasePostSuccessModal";

/**
 * PUR-01 — the till must never tell the cashier a bill is posted and the supplier ledger
 * updated when the server refused it or has not seen it yet.
 */

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  purchaseNumber: "C01-PUR-0001",
  purchaseId: "pur_1",
  grandTotal: 11554,
  itemCount: 3,
  supplierName: "QA Pharma Distributors",
  onPrintLabels: vi.fn(),
  onPrintVoucher: vi.fn(),
  onPaySupplier: vi.fn(),
  onNewBill: vi.fn(),
};

describe("PurchasePostSuccessModal — server acceptance", () => {
  it("says posted only when the server accepted the bill", () => {
    render(<PurchasePostSuccessModal {...baseProps} syncState="synced" />);

    expect(screen.getByText("Purchase Bill Posted!")).toBeTruthy();
    expect(screen.getByTestId("purchase-sync-state").textContent).toContain("Posted to the server");
  });

  it("shows the server's refusal instead of the success message", () => {
    render(
      <PurchasePostSuccessModal
        {...baseProps}
        syncState="pending"
        syncMessage="A charge is taxed by the place of supply of its supplier bill, not its own."
      />
    );

    expect(screen.queryByText("Purchase Bill Posted!")).toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("server refused this bill");
    expect(alert.textContent).toContain("place of supply");
    expect(alert.textContent).not.toContain("supplier ledger updated");
  });

  it("says saved on this till while the bill is still queued", () => {
    render(<PurchasePostSuccessModal {...baseProps} syncState="pending" />);

    expect(screen.getByText("Purchase Bill Saved on This Till")).toBeTruthy();
    expect(screen.getByTestId("purchase-sync-state").textContent).toContain("when the connection is back");
  });
});

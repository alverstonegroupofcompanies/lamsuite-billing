import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SupplierQuickAddModal } from "./SupplierQuickAddModal";

/**
 * MST-01 — a quick-added supplier is supplied where the store is, not where the
 * first till in the chain happens to stand.
 */

const mocks = vi.hoisted(() => ({
  upsertSupplier: vi.fn(),
  getSettings: vi.fn(() => ({ state_code: "29" })),
}));

vi.mock("../../lib/purchases/supplierLedgerService", () => ({
  supplierLedgerService: { upsertSupplier: mocks.upsertSupplier },
}));

vi.mock("../../lib/settings/companySettingsService", () => ({
  companySettingsService: { getSettings: () => mocks.getSettings() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockReturnValue({ state_code: "29" });
  mocks.upsertSupplier.mockResolvedValue(undefined);
});

describe("SupplierQuickAddModal — place of supply", () => {
  it("defaults to the signing-in store's state", async () => {
    render(<SupplierQuickAddModal isOpen initialName="" onClose={() => {}} onSupplierCreated={() => {}} />);

    await waitFor(() => {
      expect((screen.getByLabelText(/Place of Supply/i) as HTMLSelectElement).value).toBe("29-Karnataka");
    });
  });

  it("takes the state from the GSTIN when the operator enters one", async () => {
    render(<SupplierQuickAddModal isOpen initialName="" onClose={() => {}} onSupplierCreated={() => {}} />);

    await userEvent.type(screen.getByLabelText(/Company \/ Supplier Name/i), "Deccan Distributors");
    await userEvent.type(screen.getByLabelText(/GSTIN/i), "27ABCDE1234F1Z5");

    await waitFor(() => {
      expect((screen.getByLabelText(/Place of Supply/i) as HTMLSelectElement).value).toBe("27-Maharashtra");
    });

    await userEvent.click(screen.getByRole("button", { name: /Save Supplier/i }));

    await waitFor(() => expect(mocks.upsertSupplier).toHaveBeenCalled());
    expect(mocks.upsertSupplier.mock.calls[0][0].state_code).toBe("27");
  });

  it("falls back to the store's own state with no GSTIN", async () => {
    render(<SupplierQuickAddModal isOpen initialName="" onClose={() => {}} onSupplierCreated={() => {}} />);

    await userEvent.type(screen.getByLabelText(/Company \/ Supplier Name/i), "Hubballi Wholesale");
    await userEvent.click(screen.getByRole("button", { name: /Save Supplier/i }));

    await waitFor(() => expect(mocks.upsertSupplier).toHaveBeenCalled());
    expect(mocks.upsertSupplier.mock.calls[0][0].state_code).toBe("29");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InvoiceApprovalDialog } from "./InvoiceApprovalDialog";

const mocks = vi.hoisted(() => ({
  verifyManager: vi.fn(),
  verifyOneTimePin: vi.fn(),
  saveGrant: vi.fn(),
}));

vi.mock("../lib/billing/invoiceApprovalService", () => ({
  invoiceApprovalService: {
    verifyManager: mocks.verifyManager,
    verifyOneTimePin: mocks.verifyOneTimePin,
    saveGrant: mocks.saveGrant,
  },
}));

vi.mock("../lib/auth/storeRegistryService", () => ({
  storeRegistryService: {
    getActiveStore: () => ({ id: 4, counter_code: "C01" }),
  },
}));

vi.mock("../lib/auth/staffAuthService", () => ({
  staffAuthService: {
    getCurrentSession: () => ({
      user: { full_name: "Cashier One", username: "cashier", store_id: 4 },
      counterCode: "C01",
    }),
  },
}));

const invoice = {
  id: "inv-1",
  invoice_number: "INV-1001",
} as React.ComponentProps<typeof InvoiceApprovalDialog>["invoice"];

const grant = {
  id: "7",
  token: "grant-token",
  action: "edit" as const,
  mode: "manager" as const,
  approvedByName: "Floor Manager",
  expiresAt: "2030-01-01T00:05:00+00:00",
};

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof InvoiceApprovalDialog>> = {}
) {
  const onApproved = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <InvoiceApprovalDialog
      isOpen
      action="edit"
      invoice={invoice}
      onClose={onClose}
      onApproved={onApproved}
      {...overrides}
    />
  );
  return { onApproved, onClose, ...utils };
}

function submitDialog(): void {
  const form = document.querySelector("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
}

describe("InvoiceApprovalDialog", () => {
  beforeEach(() => {
    mocks.verifyManager.mockReset();
    mocks.verifyOneTimePin.mockReset();
    mocks.saveGrant.mockReset();
  });

  it("renders empty credential fields and never pre-fills a PIN", () => {
    renderDialog();

    expect(screen.getByLabelText(/manager username or email/i)).toHaveValue("");
    expect(screen.getByLabelText(/manager password or pin/i)).toHaveValue("");
    expect(screen.getByLabelText(/reason/i)).toHaveValue("");
    expect(screen.queryByText(/admin panel → transactions → allow edit/i)).not.toBeInTheDocument();
  });

  it("requires a reason before authorising a cancellation", async () => {
    const { onApproved } = renderDialog({ action: "cancel" });

    submitDialog();

    expect(await screen.findByText(/cancellation reason is mandatory/i)).toBeInTheDocument();
    expect(mocks.verifyManager).not.toHaveBeenCalled();
    expect(mocks.verifyOneTimePin).not.toHaveBeenCalled();
    expect(onApproved).not.toHaveBeenCalled();
  });

  it("verifies manager credentials and forwards the grant", async () => {
    mocks.verifyManager.mockResolvedValue({ success: true, grant });
    const { onApproved } = renderDialog();

    fireEvent.change(screen.getByLabelText(/manager username or email/i), {
      target: { value: "manager1" },
    });
    fireEvent.change(screen.getByLabelText(/manager password or pin/i), {
      target: { value: "floor-secret" },
    });
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Wrong tender" },
    });
    submitDialog();

    await waitFor(() => expect(onApproved).toHaveBeenCalledWith(grant, "Wrong tender"));

    expect(mocks.verifyManager).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: "4",
        invoiceId: "inv-1",
        action: "edit",
        identifier: "manager1",
        secret: "floor-secret",
        reason: "Wrong tender",
        counterCode: "C01",
      })
    );
    expect(mocks.saveGrant).toHaveBeenCalledWith("inv-1", grant);
    expect(mocks.verifyOneTimePin).not.toHaveBeenCalled();
  });

  it("verifies an admin-issued one-time PIN bound to a staff user", async () => {
    mocks.verifyOneTimePin.mockResolvedValue({
      success: true,
      grant: { ...grant, token: "pin-token", mode: "one_time_pin" },
    });
    const { onApproved } = renderDialog({ action: "cancel" });

    fireEvent.click(screen.getByRole("button", { name: /one-time pin/i }));
    expect(
      screen.getByText(/admin panel → transactions → allow edit/i)
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/staff user id/i), {
      target: { value: "42" },
    });
    fireEvent.change(screen.getByLabelText(/one-time pin/i), {
      target: { value: "739146" },
    });
    fireEvent.change(screen.getByLabelText(/cancellation reason/i), {
      target: { value: "Customer returned items" },
    });
    submitDialog();

    await waitFor(() => expect(onApproved).toHaveBeenCalledTimes(1));

    expect(mocks.verifyOneTimePin).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: "4",
        invoiceId: "inv-1",
        action: "cancel",
        userId: "42",
        pin: "739146",
        reason: "Customer returned items",
      })
    );
    expect(mocks.verifyManager).not.toHaveBeenCalled();
  });

  it("shows the server error and stays open when approval fails", async () => {
    mocks.verifyManager.mockResolvedValue({ success: false, error: "Invalid manager credentials." });
    const { onApproved } = renderDialog();

    fireEvent.change(screen.getByLabelText(/manager username or email/i), {
      target: { value: "manager1" },
    });
    fireEvent.change(screen.getByLabelText(/manager password or pin/i), {
      target: { value: "wrong" },
    });
    submitDialog();

    expect(await screen.findByText(/invalid manager credentials/i)).toBeInTheDocument();
    expect(onApproved).not.toHaveBeenCalled();
    expect(mocks.saveGrant).not.toHaveBeenCalled();
  });
});

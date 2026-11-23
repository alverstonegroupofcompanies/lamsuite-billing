import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CustomerCombobox } from "./CustomerCombobox";
import type { Customer } from "../lib/masters/partiesStore";

const mocks = vi.hoisted(() => ({
  searchCustomers: vi.fn(),
  getRecentOrFrequentCustomers: vi.fn(),
  ensurePartiesPopulated: vi.fn(),
  quickCreateCustomer: vi.fn(),
}));

vi.mock("../lib/masters/partiesStore", () => ({
  partiesStore: {
    searchCustomers: mocks.searchCustomers,
    getRecentOrFrequentCustomers: mocks.getRecentOrFrequentCustomers,
    ensurePartiesPopulated: mocks.ensurePartiesPopulated,
    quickCreateCustomer: mocks.quickCreateCustomer,
  },
  isValidIndianPhone: (phone: string) => /^[6-9]\d{9}$/.test(phone.replace(/\D/g, "")),
  isValidGstin: (gstin: string) => gstin.trim().length === 15,
  normalizeIndianPhone: (phone: string) => phone.replace(/\D/g, "").slice(-10),
}));

vi.mock("../lib/settings/companySettingsService", () => ({
  companySettingsService: {
    getSettings: () => ({ state_code: "32" }),
  },
}));

const rahul: Customer = {
  id: "cust_rahul",
  name: "Rahul Sharma",
  phone: "9876543210",
  gstin: "32AAAAA0000A1Z5",
  place_of_supply: "32-Kerala",
  is_active: true,
};

function renderCombobox(onChange = vi.fn()) {
  const view = render(
    <CustomerCombobox value="" onChange={onChange} />
  );
  const input = screen.getByRole("combobox") as HTMLInputElement;
  return { ...view, input, onChange };
}

describe("CustomerCombobox — Enter selects the matching party (MST-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensurePartiesPopulated.mockResolvedValue({ count: 0, source: "test" });
    mocks.getRecentOrFrequentCustomers.mockResolvedValue([]);
  });

  it("takes the first real match on Enter even while the debounced search is still pending", async () => {
    mocks.searchCustomers.mockResolvedValue([rahul]);
    const { input, onChange } = renderCombobox();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Rah" } });
    // Enter arrives before the 60ms debounce timer has fired.
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Rahul Sharma",
          customer: rahul,
          isWalkIn: false,
        })
      );
    });
    expect(mocks.searchCustomers).toHaveBeenCalledWith("Rah", 20);
    expect(mocks.quickCreateCustomer).not.toHaveBeenCalled();
    expect(
      onChange.mock.calls.some(([selection]) => selection.isWalkIn === true)
    ).toBe(false);
  });

  it("highlights the first real match once results arrive instead of the walk-in row", async () => {
    mocks.searchCustomers.mockResolvedValue([rahul]);
    const { input } = renderCombobox();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Rah" } });

    await waitFor(() => {
      const option = screen.getByRole("option", { name: /Rahul Sharma/i });
      expect(option.getAttribute("aria-selected")).toBe("true");
    });
  });

  it("uses the typed text as a walk-in name when nothing matches", async () => {
    mocks.searchCustomers.mockResolvedValue([]);
    const { input, onChange } = renderCombobox();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Rahul" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Rahul", customer: null, isWalkIn: true })
      );
    });
    expect(mocks.quickCreateCustomer).not.toHaveBeenCalled();
  });
});

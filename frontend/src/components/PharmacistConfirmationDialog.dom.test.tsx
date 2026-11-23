import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PharmacistConfirmationDialog } from "./PharmacistConfirmationDialog";
import { PharmacistConfirmationRequiredError } from "../lib/billing/pharmacistGate";
import type { BusinessRuleErrorPayload } from "../lib/errors/businessRuleError";

const mocks = vi.hoisted(() => ({
  pharmacists: vi.fn(),
  ensurePopulated: vi.fn(),
}));

vi.mock("../lib/masters/salespersonStore", () => ({
  salespersonStore: {
    pharmacists: mocks.pharmacists,
    ensureSalespeoplePopulated: mocks.ensurePopulated,
  },
}));

const firoza = {
  id: "11",
  name: "Dr. Firoza Ali",
  code: "SP-01",
  reg_no: "KPK-2019-45512",
  is_pharmacist: true,
  registration_valid: true,
};

const naseem = {
  id: "12",
  name: "Dr. Naseem Backer",
  code: "SP-03",
  reg_no: "KPK-2021-77120",
  is_pharmacist: true,
  registration_valid: true,
};

function refusal(overrides: Record<string, unknown> = {}) {
  const payload = {
    code: "PHARMACIST_CONFIRMATION_REQUIRED",
    message: "A restricted drug is on this bill. It needs a pharmacist's confirmation.",
    rule: "PHR-004",
    line: 1,
    field: "pharmacist_id",
    fix: "Ask the pharmacist on duty to enter their PIN.",
    actions: ["pos.pharmacist_confirmation"],
    restricted_items: [
      {
        line: 1,
        product_id: 41,
        product_name: "Alprazolam 0.25 Strip",
        batch_no: "BCH-ALP",
        schedule_code: "H1",
        qty: 1,
      },
      {
        line: 2,
        product_id: 42,
        product_name: "Diazepam 5mg",
        batch_no: "BCH-DIA",
        schedule_code: "H1",
        qty: 2,
      },
    ],
    ...overrides,
  } as BusinessRuleErrorPayload;

  return new PharmacistConfirmationRequiredError(payload, "ext_bill_1");
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof PharmacistConfirmationDialog>> = {}
) {
  const onConfirmed = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <PharmacistConfirmationDialog
      open
      refusal={refusal()}
      onClose={onClose}
      onConfirmed={onConfirmed}
      {...props}
    />
  );
  return { onConfirmed, onClose, ...utils };
}

function submit(): void {
  const form = document.querySelector("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
}

describe("PharmacistConfirmationDialog", () => {
  beforeEach(() => {
    mocks.pharmacists.mockReset().mockResolvedValue([firoza, naseem]);
    mocks.ensurePopulated.mockReset().mockResolvedValue({ count: 2, source: "salespeople_eligible" });
  });

  it("names every restricted line the server refused", async () => {
    renderDialog();

    expect(await screen.findByText("Alprazolam 0.25 Strip")).toBeDefined();
    expect(screen.getByText("Diazepam 5mg")).toBeDefined();
    // The batch and how much of it, because that is what the register has to show.
    expect(screen.getAllByText(/BCH-DIA/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/H1/).length).toBeGreaterThan(0);
  });

  it("offers only the people the store registered as pharmacists", async () => {
    mocks.pharmacists.mockResolvedValue([firoza]);
    renderDialog();

    await waitFor(() => expect(mocks.pharmacists).toHaveBeenCalled());
    // The list is asked for fresh: a registration renewed an hour ago must count.
    expect(mocks.ensurePopulated).toHaveBeenCalledWith(true);

    const picker = (await screen.findByLabelText("Pharmacist")) as HTMLSelectElement;
    const names = Array.from(picker.options).map((option) => option.text);
    expect(names.some((text) => text.includes("Dr. Firoza Ali"))).toBe(true);
    expect(names.some((text) => text.includes("Dr. Naseem Backer"))).toBe(false);
  });

  it("collects the PIN as a secret and never pre-fills it", async () => {
    renderDialog();
    await screen.findByLabelText("Pharmacist");

    const pin = screen.getByLabelText("Pharmacist PIN") as HTMLInputElement;
    expect(pin.type).toBe("password");
    expect(pin.value).toBe("");
  });

  it("hands the pharmacist and the PIN over for one live retry", async () => {
    const { onConfirmed } = renderDialog();
    await screen.findByLabelText("Pharmacist");

    fireEvent.change(screen.getByLabelText("Pharmacist"), { target: { value: firoza.id } });
    fireEvent.change(screen.getByLabelText("Pharmacist PIN"), { target: { value: "582913" } });
    submit();

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(onConfirmed).toHaveBeenCalledWith({ pharmacistId: firoza.id, pin: "582913" });
  });

  it("refuses to send a bill with no PIN typed", async () => {
    const { onConfirmed } = renderDialog();
    await screen.findByLabelText("Pharmacist");

    fireEvent.change(screen.getByLabelText("Pharmacist"), { target: { value: firoza.id } });
    submit();

    await waitFor(() => expect(screen.getByText(/Enter the pharmacist/i)).toBeTruthy());
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("explains a refused confirmation in the server's own words", async () => {
    renderDialog({
      refusal: refusal({
        code: "PHARMACIST_CONFIRMATION_INVALID",
        message: "A pharmacist's confirmation was refused: Their registration expired on 2029-05-31.",
        fix: "Renew or correct the registration under Identity & Staff → Salespeople.",
      }),
    });

    expect(
      await screen.findByText(/Their registration expired on 2029-05-31/)
    ).toBeTruthy();
    expect(screen.getByText(/Renew or correct the registration/)).toBeTruthy();
  });

  it("sends nothing when the cashier closes it", async () => {
    const { onClose, onConfirmed } = renderDialog();
    await screen.findByLabelText("Pharmacist");

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});

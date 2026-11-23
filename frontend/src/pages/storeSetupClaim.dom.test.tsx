import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StoreSetupPage } from "./StoreSetupPage";
import { storeDeviceService } from "../lib/auth/storeDeviceService";

/**
 * CNT-006 / CNT-013: a fresh workstation reaches billing with a counter code
 * and nothing else. Owner logins, store keys and locally-chosen counter names
 * are gone, and every step is reachable from the keyboard.
 */

const CODE = "LAM-C01-1111222233334444-AAAA555566667777";

const PROFILE = {
  device_id: "cntr_12",
  device_uuid: "dev_uuid_claim",
  device_name: "Windows POS Terminal",
  store_id: "7",
  store_name: "LamStone Pharmacy Main",
  store_code: "STORE-07",
  counter_id: "cntr_12",
  counter_name: "Front Counter",
  counter_code: "C01",
  is_hub: false,
  license_plan: "Retail & Pharmacy Chain Pro",
  license_status: "active" as const,
  license_expires_at: "2027-12-31",
  registered_at: 1,
  is_active: true,
};

describe("Counter code setup screen (CNT-006, CNT-013)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("asks for one thing: the counter code", () => {
    render(<StoreSetupPage onSetupComplete={vi.fn()} />);

    expect(screen.getByLabelText(/activation code/i)).toBeInTheDocument();
    expect(document.querySelectorAll("input")).toHaveLength(1);
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });

  it("offers no owner login, store key or counter naming", () => {
    render(<StoreSetupPage onSetupComplete={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /owner login/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /store key/i })).toBeNull();
    expect(screen.queryByLabelText(/email|password|counter name|branch/i)).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("reaches billing with a typed code and the keyboard alone", async () => {
    const claim = vi.spyOn(storeDeviceService, "claimCounter").mockResolvedValue(PROFILE as any);
    const onSetupComplete = vi.fn();
    render(<StoreSetupPage onSetupComplete={onSetupComplete} />);

    const user = userEvent.setup();
    await user.tab();

    const field = screen.getByLabelText(/activation code/i) as HTMLInputElement;
    await user.type(field, `  ${CODE.toLowerCase()}  {Enter}`);

    expect(field.value).toBe(CODE);
    await waitFor(() => expect(onSetupComplete).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(claim).toHaveBeenCalledWith(CODE, expect.any(Function));
    expect(onSetupComplete.mock.calls[0][0].counter_name).toBe("Front Counter");
  });

  it("accepts a pasted QR payload", async () => {
    const claim = vi.spyOn(storeDeviceService, "claimCounter").mockResolvedValue(PROFILE as any);
    render(<StoreSetupPage onSetupComplete={vi.fn()} />);

    const payload = JSON.stringify({ v: 1, kind: "lam_suite_counter_claim", code: CODE });
    fireEvent.change(screen.getByLabelText(/activation code/i), { target: { value: payload } });
    fireEvent.submit(screen.getByLabelText(/activation code/i).closest("form")!);

    await waitFor(() => expect(claim).toHaveBeenCalled());
    expect(claim.mock.calls[0][0]).toContain(CODE);
  });

  it("keeps the operator on the screen with the server's reason when the code is refused", async () => {
    vi.spyOn(storeDeviceService, "claimCounter").mockRejectedValue(
      new Error("That activation code is not valid here. Ask the store owner for a current counter code.")
    );
    const onSetupComplete = vi.fn();
    render(<StoreSetupPage onSetupComplete={onSetupComplete} />);

    fireEvent.change(screen.getByLabelText(/activation code/i), { target: { value: CODE } });
    fireEvent.submit(screen.getByLabelText(/activation code/i).closest("form")!);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not valid here/));
    expect(onSetupComplete).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/activation code/i)).toBeInTheDocument();
  });

  it("lets the backend endpoint be changed without a credential", async () => {
    render(<StoreSetupPage onSetupComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /change/i }));
    const serverField = screen.getByLabelText(/backend api endpoint/i) as HTMLInputElement;
    fireEvent.change(serverField, { target: { value: "http://192.168.1.20:8000" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/192\.168\.1\.20:8000/)).toBeInTheDocument());
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });
});

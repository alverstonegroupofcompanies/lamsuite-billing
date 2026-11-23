import { describe, expect, it } from "vitest";
import { DEFAULT_PAYMENT_MODES, type PaymentModeConfig } from "../settings/companySettingsService";
import { enabledTenderModes, resolveTenderMode } from "./tenderModeKeys";

/**
 * KB-03(d): on macOS Option+2 arrives as the character `™`, not `2`, so a settlement
 * handler that only reads `event.key` never sees the digit. The mode keys also have to
 * follow this store's enabled modes, which is the list the tender buttons number.
 */

const modes = (overrides: Partial<PaymentModeConfig>[] = []): PaymentModeConfig[] =>
  DEFAULT_PAYMENT_MODES.map((mode) => {
    const over = overrides.find((o) => o.name === mode.name);
    return over ? { ...mode, ...over } : mode;
  });

describe("settlement mode keys", () => {
  it("numbers the enabled modes in the order the tender buttons show", () => {
    expect(enabledTenderModes()).toEqual([
      "Cash",
      "UPI",
      "Card",
      "Bank Transfer",
      "Cheque",
      "Wallet",
      "Gift Voucher",
      "Credit",
    ]);
  });

  it("skips a mode the owner disabled, so the button's own number is the key", () => {
    const enabled = enabledTenderModes(modes([{ name: "Card", enabled: false }]));
    expect(enabled).toEqual(["Cash", "UPI", "Bank Transfer", "Cheque", "Wallet", "Gift Voucher", "Credit"]);

    expect(resolveTenderMode({ key: "3" }, enabled)).toBe("Bank Transfer");
    expect(resolveTenderMode({ key: "7" }, enabled)).toBe("Credit");
  });

  it("reads the physical digit under Option, where macOS reports a symbol instead", () => {
    expect(resolveTenderMode({ key: "™", code: "Digit2" })).toBe("UPI");
    expect(resolveTenderMode({ key: "•", code: "Digit8" })).toBe("Credit");
    expect(resolveTenderMode({ key: "¡", code: "Digit1" })).toBe("Cash");
  });

  it("accepts the numpad and the letter aliases too", () => {
    expect(resolveTenderMode({ key: "2", code: "Numpad2" })).toBe("UPI");
    expect(resolveTenderMode({ key: "u" })).toBe("UPI");
    expect(resolveTenderMode({ key: "r" })).toBe("Credit");
    // Option+U reports `¨` but the physical key is still U.
    expect(resolveTenderMode({ key: "¨", code: "KeyU" })).toBe("UPI");
  });

  it("returns null for keys that are not tender modes", () => {
    expect(resolveTenderMode({ key: "9" })).toBeNull();
    expect(resolveTenderMode({ key: "x" })).toBeNull();
    expect(resolveTenderMode({ key: "™", code: "Digit2" }, ["Cash", "Card"])).toBe("Card");
  });
});

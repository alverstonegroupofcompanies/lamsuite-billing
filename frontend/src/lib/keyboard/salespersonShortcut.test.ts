import { describe, expect, it, vi } from "vitest";
import {
  findConflicts,
  findShortcut,
  shortcutLabel,
  type KeyEventLike,
} from "./centralKeyMap";
import { ShortcutDispatcher } from "./shortcutDispatcher";

/**
 * GAP-01 / SPR-012 — the till must be able to name who sold without the
 * cashier leaving the keyboard. The field already exists in the bill header;
 * what is missing is a chord that reaches it, advertised in the hint strip and
 * published in the key map the QA checks quote.
 *
 * Alt+S is already the supplier chord on the purchase screen and the status
 * filter on the bills register, so the POS binding must stay inside the POS
 * scope: same letter, different screen, never a same-scope conflict.
 */

const key = (overrides: Partial<KeyEventLike>): KeyEventLike & { preventDefault: () => void } => ({
  key: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  preventDefault: vi.fn(),
  ...overrides,
});

describe("salesperson shortcut", () => {
  it("binds Alt+S to the salesperson field in the POS scope", () => {
    expect(shortcutLabel("focusSalesperson", "pos")).toBe("Alt+S");
    expect(findShortcut("focusSalesperson", "pos")?.label).toMatch(/salesperson/i);
  });

  it("advertises it in the billing group so the hint strip and help list it", () => {
    const entry = findShortcut("focusSalesperson", "pos");
    expect(entry?.group).toBe("Billing");
    expect(entry?.hidden).toBeFalsy();
  });

  it("does not collide with the supplier or status-filter chords", () => {
    expect(findConflicts()).toEqual([]);
    expect(shortcutLabel("focusSupplier", "purchase")).toBe("Alt+S");
    expect(shortcutLabel("filterStatus", "bills")).toBe("Alt+S");
  });

  it("reaches the salesperson field from the POS screen only", () => {
    const dispatcher = new ShortcutDispatcher();
    const focusSalesperson = vi.fn(() => true);
    const focusSupplier = vi.fn(() => true);
    dispatcher.register({ id: "pos", scope: "pos", handlers: { focusSalesperson } });
    dispatcher.register({ id: "purchase", scope: "purchase", handlers: { focusSupplier } });

    expect(dispatcher.dispatch(key({ key: "s", altKey: true }))).toBe(true);
    expect(focusSalesperson).toHaveBeenCalledTimes(1);
    expect(focusSupplier).not.toHaveBeenCalled();

    // Ctrl+Alt+S is still switch-store, not this field.
    expect(dispatcher.dispatch(key({ key: "s", altKey: true, ctrlKey: true }))).toBe(false);
    expect(focusSalesperson).toHaveBeenCalledTimes(1);
  });

  it("hands the key back when the store has switched the column off", () => {
    const dispatcher = new ShortcutDispatcher();
    // The owner set salesperson_on_bill=off: the field is not rendered, so the
    // handler declines and nothing is focused.
    const focusSalesperson = vi.fn(() => false);
    dispatcher.register({ id: "pos", scope: "pos", handlers: { focusSalesperson } });

    expect(dispatcher.dispatch(key({ key: "s", altKey: true }))).toBe(false);
    expect(focusSalesperson).toHaveBeenCalledTimes(1);
  });
});

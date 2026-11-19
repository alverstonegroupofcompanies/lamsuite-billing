import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * Regression cover for the purchase inward form, which registers Escape for as long
 * as it is mounted: a press must not consume the registration, or the next press
 * takes the manager's DOM fallback and clicks the first "X/Cancel/Close" button in
 * the overlay — which used to wipe the selected supplier mid-bill.
 */
describe("useModalEscape", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("stays registered after a press that leaves the surface open", async () => {
    const { useModalEscape } = await import("./modalEscapeManager");
    const { modalEscapeManager } = await import("./modalEscapeManager");

    const onEscape = vi.fn();
    const { unmount } = renderHook(() => useModalEscape(true, onEscape));

    const press = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    press();
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(modalEscapeManager.hasOpenModal()).toBe(true);

    press();
    expect(onEscape).toHaveBeenCalledTimes(2);
    expect(modalEscapeManager.hasOpenModal()).toBe(true);

    unmount();
    expect(modalEscapeManager.hasOpenModal()).toBe(false);
  });

  it("unregisters when the surface closes without an Escape press", async () => {
    const { useModalEscape } = await import("./modalEscapeManager");
    const { modalEscapeManager } = await import("./modalEscapeManager");

    const onEscape = vi.fn();
    const { rerender } = renderHook(({ open }) => useModalEscape(open, onEscape), { initialProps: { open: true } });
    expect(modalEscapeManager.hasOpenModal()).toBe(true);

    rerender({ open: false });
    expect(modalEscapeManager.hasOpenModal()).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onEscape).not.toHaveBeenCalled();
  });
});

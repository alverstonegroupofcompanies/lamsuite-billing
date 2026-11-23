import { afterEach, describe, expect, it, vi } from "vitest";
import { registerNavigationGuard, requestKeyboardNavigation } from "./navigationGuard";

/**
 * KB-02: a global navigation chord pressed while a bill is being keyed must not silently
 * discard it. The guard is the one gate every global navigation handler asks before it
 * leaves the screen; the screen registers one while it holds unsaved work.
 */

const unregisters: Array<() => void> = [];

const guard = (result: boolean | (() => boolean)) => {
  const fn = vi.fn(typeof result === "function" ? result : () => result);
  unregisters.push(registerNavigationGuard(fn));
  return fn;
};

afterEach(() => {
  while (unregisters.length) unregisters.pop()!();
});

describe("keyboard navigation guard", () => {
  it("allows navigation when no screen is holding unsaved work", () => {
    expect(requestKeyboardNavigation("/stock")).toBe(true);
  });

  it("refuses navigation when a screen's guard declines, naming the target", () => {
    const dirty = guard(false);

    expect(requestKeyboardNavigation("/stock")).toBe(false);
    expect(dirty).toHaveBeenCalledWith("/stock");
  });

  it("allows navigation once the screen's guard approves", () => {
    guard(true);
    expect(requestKeyboardNavigation("/dashboard")).toBe(true);
  });

  it("asks every registered guard, and one refusal is enough", () => {
    const first = guard(true);
    const second = guard(false);
    const third = guard(true);

    expect(requestKeyboardNavigation("/bills")).toBe(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    // A refusal stops the walk: later screens cannot overrule the one holding the work.
    expect(third).not.toHaveBeenCalled();
  });

  it("stops asking a guard once its screen lets it go", () => {
    const dirty = guard(false);
    unregisters.pop()!();

    expect(requestKeyboardNavigation("/stock")).toBe(true);
    expect(dirty).not.toHaveBeenCalled();
  });
});

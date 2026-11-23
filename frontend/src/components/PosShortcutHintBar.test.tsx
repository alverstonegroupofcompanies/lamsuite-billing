import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PosShortcutHintBar } from "./PosShortcutHintBar";

/**
 * KB-03(d): the settlement hint strip printed a second, stale pay-mode map
 * (`1=Cash, 2=UPI, 3=Card, 4=Credit, 5=Split`) that disagreed with the tender buttons.
 * The buttons are the map the keys follow, so the strip must not advertise another one.
 */
describe("POS settlement hint strip", () => {
  it("advertises no pay-mode map beside the tender buttons", () => {
    render(
      <PosShortcutHintBar
        context="modal"
        onOpenShortcutsModal={vi.fn()}
      />
    );

    expect(screen.queryByText(/1\s*=\s*Cash/i)).toBeNull();
    expect(screen.queryByText(/Pick Pay Mode/i)).toBeNull();
    expect(screen.queryByText(/5\s*=\s*Split/i)).toBeNull();
    expect(screen.getByText("Close / Cancel")).toBeInTheDocument();
  });
});

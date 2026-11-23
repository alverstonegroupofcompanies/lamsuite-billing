import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentNumberBadge } from "./DocumentNumberBadge";

/**
 * SYNC-01: the number on the printed paper is the number the server saved. The
 * counter's preview of the next number is a hint, never the bill in hand — the
 * old header always showed the preview, so the till read one number ahead.
 */
describe("DocumentNumberBadge (SYNC-01)", () => {
  it("shows the saved number; the preview is only a next-number hint", () => {
    render(<DocumentNumberBadge savedNumber="C01-INV-11002" nextNumber="C01-INV-11003" />);

    expect(screen.getByText("C01-INV-11002")).toBeTruthy();
    expect(screen.getByText(/next/i).textContent).toContain("C01-INV-11003");
  });

  it("does not dress the next number up as a saved bill", () => {
    render(<DocumentNumberBadge savedNumber={null} nextNumber="C01-INV-11003" />);

    expect(screen.queryByText("C01-INV-11003")).toBeNull();
    expect(screen.getByText(/next/i).textContent).toContain("C01-INV-11003");
  });
});

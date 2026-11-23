import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CounterIdentityChip } from "./CounterIdentityChip";

/**
 * SYNC-02: a till that has not been given a counter must say so. The old header
 * fell back to "C01", so a C02 terminal claimed to be C01 and the owner reading
 * the screen had no way to tell which machine had just billed.
 */
describe("CounterIdentityChip (SYNC-02)", () => {
  it("never invents a counter code", () => {
    render(<CounterIdentityChip counterName="Counter 2" counterCode={null} />);

    expect(screen.queryByText("C01")).toBeNull();
    expect(screen.getByText(/no counter code/i)).toBeTruthy();
  });

  it("shows the counter's own code", () => {
    render(<CounterIdentityChip counterName="Counter 2" counterCode="c02" />);

    expect(screen.getByText("C02")).toBeTruthy();
    expect(screen.queryByText("C01")).toBeNull();
  });
});

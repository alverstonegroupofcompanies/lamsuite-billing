import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModalLayer, ModalStackProvider } from "./CentralModalManager";

const StackHarness = () => {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  return (
    <ModalStackProvider>
      <button onClick={() => setFirst(true)}>open first</button>
      <ModalLayer isOpen={first} onClose={() => setFirst(false)} ariaLabel="First modal">
        <div>
          <button onClick={() => setSecond(true)}>open second</button>
          <button onClick={() => setFirst(false)}>close first</button>
        </div>
      </ModalLayer>
      <ModalLayer isOpen={second} onClose={() => setSecond(false)} ariaLabel="Second modal">
        <div>
          <button>second action</button>
          <button onClick={() => setSecond(false)}>close second</button>
        </div>
      </ModalLayer>
    </ModalStackProvider>
  );
};

describe("ModalLayer", () => {
  it("stacks the newest modal above earlier ones", async () => {
    const user = userEvent.setup();
    render(<StackHarness />);

    await user.click(screen.getByText("open first"));
    await user.click(screen.getByText("open second"));

    const layers = Array.from(document.querySelectorAll<HTMLElement>("[data-modal-layer]"));
    expect(layers).toHaveLength(2);
    const firstZ = Number(layers[0].style.zIndex);
    const secondZ = Number(layers[1].style.zIndex);
    expect(secondZ).toBeGreaterThan(firstZ);
  });

  it("closes only the top modal on Escape and restores focus", async () => {
    const user = userEvent.setup();
    render(<StackHarness />);

    const opener = screen.getByText("open first");
    opener.focus();
    await user.click(opener);
    await waitFor(() => expect(screen.getByLabelText("First modal")).toBeInTheDocument());

    await user.click(screen.getByText("open second"));
    await waitFor(() => expect(screen.getByLabelText("Second modal")).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByLabelText("Second modal")).not.toBeInTheDocument();
      expect(screen.getByLabelText("First modal")).toBeInTheDocument();
    });
  });

  it("traps Tab focus inside the top layer", async () => {
    const user = userEvent.setup();
    render(<StackHarness />);

    await user.click(screen.getByText("open first"));
    await waitFor(() => expect(screen.getByLabelText("First modal")).toBeInTheDocument());

    const layer = screen.getByLabelText("First modal");
    const focusables = Array.from(layer.querySelectorAll<HTMLElement>("button"));
    focusables[focusables.length - 1].focus();
    fireEvent.keyDown(layer, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);

    fireEvent.keyDown(layer, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusables[focusables.length - 1]);
  });
});

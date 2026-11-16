import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SmartQtyInput } from "./SmartQtyInput";

function setup(overrides: Partial<React.ComponentProps<typeof SmartQtyInput>> = {}) {
  const onChange = vi.fn();
  const props: React.ComponentProps<typeof SmartQtyInput> = {
    packs: 0,
    loose: 0,
    unitsPerPack: 10,
    packName: "strip",
    looseName: "tablet",
    allowLoose: true,
    onChange,
    ...overrides,
  };
  const utils = render(<SmartQtyInput {...props} />);
  return { onChange, ...utils };
}

describe("SmartQtyInput strict quantity validation", () => {
  it("accepts pack+loose entry like 2+5", () => {
    const { onChange } = setup();
    const packInput = screen.getByTitle(/enter strip count/i);
    fireEvent.change(packInput, { target: { value: "2+5" } });

    expect(onChange).toHaveBeenCalledWith(2, 5);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rejects letters with an inline error and never emits a quantity", () => {
    const { onChange } = setup();
    const packInput = screen.getByTitle(/enter strip count/i);
    fireEvent.change(packInput, { target: { value: "abc" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/digits/i);
  });

  it("sanitises pasted junk before parsing", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByTitle(/enter strip count/i), { target: { value: "2a+5b" } });

    expect(onChange).toHaveBeenCalledWith(2, 5);
  });

  it("normalises loose overflow into packs (1+20 on a 15-pack product)", () => {
    const { onChange } = setup({ unitsPerPack: 15 });
    fireEvent.change(screen.getByTitle(/enter strip count/i), { target: { value: "1+20" } });

    expect(onChange).toHaveBeenCalledWith(2, 5);
  });

  it("allows loose-only quantities when loose sale is enabled", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByTitle(/enter strip count/i), { target: { value: "0+3" } });

    expect(onChange).toHaveBeenCalledWith(0, 3);
  });

  it("rejects loose-only entry for a sealed product", () => {
    const { onChange } = setup({ allowLoose: false, unitsPerPack: 10 });
    const input = screen.getByTitle(/enter quantity/i);
    fireEvent.change(input, { target: { value: "0+3" } });

    // The sanitizer truncates the loose part; a zero pack count is not a sale.
    expect(onChange).not.toHaveBeenCalledWith(0, 3);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("rejects a zero quantity instead of silently turning it into one", () => {
    const { onChange } = setup({ allowLoose: false, unitsPerPack: 1, packName: "pc", packs: 1 });
    const input = screen.getByTitle(/enter quantity/i);
    fireEvent.change(input, { target: { value: "0" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/greater than zero/i);
  });

  it("allows decimal quantities only for unit-based products", () => {
    const { onChange } = setup({ allowLoose: false, unitsPerPack: 1, packName: "pc" });
    fireEvent.change(screen.getByTitle(/enter quantity/i), { target: { value: "2.5" } });

    expect(onChange).toHaveBeenCalledWith(2.5, 0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("requires whole packs on pack products", () => {
    const { onChange } = setup({ unitsPerPack: 15 });
    fireEvent.change(screen.getByTitle(/enter strip count/i), { target: { value: "2.5" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/whole number/i);
  });
});

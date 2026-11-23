import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { ProductSearchDropdown } from "./ProductSearchDropdown";
import type { ProductItem } from "../../lib/masters/productsStore";

const product = (overrides: Partial<ProductItem> = {}): ProductItem =>
  ({
    id: "p1",
    name: "Paracetamol 500mg",
    barcode: "8901001",
    mrp: 20,
    sel_rate: 18,
    gst_percent: 12,
    units_per_pack: 10,
    current_stock: 100,
    is_active: true,
    ...overrides,
  }) as ProductItem;

const renderDropdown = (overrides: Partial<ComponentProps<typeof ProductSearchDropdown>> = {}) => {
  const props = {
    results: [] as ProductItem[],
    query: "Nitrazepam 10mg",
    selectedIndex: 0,
    canQuickAdd: true,
    onSelect: vi.fn(),
    onHighlight: vi.fn(),
    onQuickAdd: vi.fn(),
    ...overrides,
  };
  render(<ProductSearchDropdown {...props} />);
  return props;
};

describe("ProductSearchDropdown (PRD-02)", () => {
  it("lists matches and bills the one the cashier clicks", () => {
    const props = renderDropdown({ results: [product()] });

    expect(screen.getByText("Paracetamol 500mg")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Paracetamol 500mg"));
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  });

  it("offers to quick-add the product a search could not find", () => {
    const props = renderDropdown();

    const addRow = screen.getByTestId("product-search-quick-add");
    expect(addRow).toHaveTextContent("Nitrazepam 10mg");

    fireEvent.click(addRow);
    expect(props.onQuickAdd).toHaveBeenCalledWith("Nitrazepam 10mg");
    expect(screen.queryByTestId("product-search-empty")).not.toBeInTheDocument();
  });

  it("keeps the not-found state for a counter without masters access", () => {
    renderDropdown({ canQuickAdd: false });

    expect(screen.getByTestId("product-search-empty")).toHaveTextContent("No products match");
    expect(screen.queryByTestId("product-search-quick-add")).not.toBeInTheDocument();
  });

  it("stays quiet while the cashier has typed nothing", () => {
    renderDropdown({ query: "   " });

    expect(screen.queryByTestId("product-search-quick-add")).not.toBeInTheDocument();
    expect(screen.queryByTestId("product-search-empty")).not.toBeInTheDocument();
  });
});

import React from "react";
import { PackagePlus, SearchX } from "lucide-react";
import type { ProductItem } from "../../lib/masters/productsStore";
import { formatExpiryDisplay } from "../../lib/billing/unitConversion";

interface ProductSearchDropdownProps {
  results: ProductItem[];
  query: string;
  selectedIndex: number;
  /** PRD-02: only a counter allowed to reach Masters may create a product. */
  canQuickAdd: boolean;
  onSelect: (product: ProductItem) => void;
  onHighlight: (index: number) => void;
  onQuickAdd: (name: string) => void;
}

/**
 * The POS product search panel. It renders matches, and — instead of a blank
 * silence — names the not-found state and offers to quick-add the product the
 * cashier just typed when the counter is allowed to manage masters.
 */
export const ProductSearchDropdown: React.FC<ProductSearchDropdownProps> = ({
  results,
  query,
  selectedIndex,
  canQuickAdd,
  onSelect,
  onHighlight,
  onQuickAdd,
}) => {
  const trimmed = query.trim();

  return (
    <>
      {results.map((prod, index) => {
        const isSelected = index === selectedIndex;
        const isOutOfStock = (prod.current_stock || 0) <= 0;
        return (
          <div
            key={prod.id}
            onMouseEnter={() => onHighlight(index)}
            onClick={() => onSelect(prod)}
            className={`flex cursor-pointer items-center justify-between px-4 py-2.5 text-xs transition-colors ${
              isSelected
                ? "bg-[var(--color-accent-soft)] text-[var(--color-text)] border-l-4 border-l-[var(--color-accent)] pl-3"
                : "hover:bg-[var(--color-surface-hover)] text-[var(--color-text)]"
            }`}
          >
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className={`font-semibold ${isSelected ? "text-[var(--color-accent)] font-bold" : "text-[var(--color-text)]"}`}>
                  {prod.name}
                </p>
                {prod.generic_name && (
                  <span className="rounded-[4px] bg-[var(--color-surface-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] font-normal border border-[var(--color-border)]">
                    {prod.generic_name}
                  </span>
                )}
                {prod.units_per_pack > 1 && (
                  <span className="rounded-[4px] bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent font-medium">
                    Pack of {prod.units_per_pack} {prod.sub_unit_name || "pcs"}
                  </span>
                )}
                {isOutOfStock && (
                  <span className="rounded bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] text-[10px] font-bold px-1.5 py-0.2">
                    Out of Stock
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 font-mono">
                Barcode: <span>{prod.barcode || "—"}</span>{" "}
                {prod.hsn_sac_code ? `| HSN: ${prod.hsn_sac_code}` : ""} | GST: {prod.gst_percent}%
              </p>
            </div>
            <div className="text-right shrink-0 ml-4 font-mono">
              <p className="font-bold text-[var(--color-text)] text-sm tabular-nums">
                ₹ {(prod.sel_rate || prod.mrp).toFixed(2)}
                <span className="text-[10px] text-[var(--color-text-muted)] font-normal ml-0.5">
                  /{prod.units_per_pack > 1 ? (prod.unit_name || "Strip") : (prod.unit_name || "pc")}
                </span>
              </p>
              <p className="text-[10px] text-[var(--color-text-muted)]">
                MRP: ₹{prod.mrp.toFixed(2)}
                {(prod as any).nearest_expiry ? ` • Exp: ${formatExpiryDisplay((prod as any).nearest_expiry)}` : ""}
              </p>
              <p
                className={`text-[10px] font-medium ${
                  !isOutOfStock ? "text-[var(--color-success-text)]" : "text-[var(--color-danger-text)] font-bold"
                }`}
              >
                Stock: {prod.current_stock || 0}
              </p>
            </div>
          </div>
        );
      })}

      {trimmed !== "" && results.length === 0 && canQuickAdd && (
        <button
          type="button"
          data-testid="product-search-quick-add"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onQuickAdd(trimmed)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-xs hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] transition-colors"
        >
          <PackagePlus className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
          <span className="min-w-0">
            <span className="block font-semibold truncate">Add “{trimmed}” as a new product</span>
            <span className="block text-[10px] text-[var(--color-text-muted)]">
              Quick add it now — it can be billed before stock arrives.
            </span>
          </span>
        </button>
      )}

      {trimmed !== "" && results.length === 0 && !canQuickAdd && (
        <div
          data-testid="product-search-empty"
          className="flex items-center gap-3 px-4 py-3 text-xs text-[var(--color-text-muted)]"
        >
          <SearchX className="h-4 w-4 shrink-0" />
          <span>No products match “{trimmed}”. Ask the owner for Masters access to add it.</span>
        </div>
      )}
    </>
  );
};

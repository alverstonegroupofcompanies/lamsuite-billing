import React, { useState, useEffect, useRef, useId, useCallback, useMemo } from "react";
import ReactDOM from "react-dom";
import { Search, ChevronDown, X, Check, Package } from "lucide-react";
import {
  productsStore,
  formatExpiryDisplay,
  type ProductBatch,
  type ProductItem,
} from "../lib/masters/productsStore";
import { sqliteStorage } from "../lib/db/sqliteStorage";

export interface BatchComboboxOption {
  batch: ProductBatch;
  product?: ProductItem;
  productName: string;
  batchNo: string;
  stockQty: number;
  formattedExpiry: string;
  mrp?: number;
  sellingRate?: number;
  searchString: string;
}

export interface BatchComboboxProps {
  value: string; // selected batch id
  onChange: (batchId: string, batch?: ProductBatch, product?: ProductItem) => void;
  batches?: ProductBatch[];
  products?: ProductItem[] | Record<string, ProductItem>;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  filterInStockOnly?: boolean;
  autoFocus?: boolean;
  id?: string;
}

/** Helper component to highlight matching substrings */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="rounded-xs bg-amber-200 px-0.5 font-bold text-amber-950 dark:bg-amber-800/80 dark:text-amber-100"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

export const BatchCombobox: React.FC<BatchComboboxProps> = ({
  value,
  onChange,
  batches: externalBatches,
  products: externalProducts,
  placeholder = "Search product name or batch...",
  disabled = false,
  required = false,
  className = "",
  filterInStockOnly = false,
  autoFocus = false,
  id,
}) => {
  const componentId = useId();
  const inputId = id || componentId;
  const listboxId = `${inputId}-listbox`;

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Fallback internal data if props are not provided
  const [internalBatches, setInternalBatches] = useState<ProductBatch[]>([]);
  const [internalProducts, setInternalProducts] = useState<Record<string, ProductItem>>({});

  const triggerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Load batches if not provided externally
  useEffect(() => {
    if (externalBatches) return;
    let isMounted = true;
    sqliteStorage
      .findAll<ProductBatch>("product_batches")
      .then((b) => {
        if (isMounted) setInternalBatches(b);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [externalBatches]);

  // Load products if not provided externally
  useEffect(() => {
    if (externalProducts) return;
    let isMounted = true;
    productsStore
      .getAllProducts()
      .then((prods) => {
        if (!isMounted) return;
        const pMap: Record<string, ProductItem> = {};
        for (const p of prods) {
          pMap[p.id] = p;
        }
        setInternalProducts(pMap);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [externalProducts]);

  // Resolved product map
  const productMap = useMemo<Record<string, ProductItem>>(() => {
    if (externalProducts) {
      if (Array.isArray(externalProducts)) {
        const map: Record<string, ProductItem> = {};
        for (const p of externalProducts) {
          map[p.id] = p;
        }
        return map;
      }
      return externalProducts;
    }
    return internalProducts;
  }, [externalProducts, internalProducts]);

  // Active batches
  const batches = externalBatches || internalBatches;

  // Build mapped options
  const allOptions = useMemo<BatchComboboxOption[]>(() => {
    let sourceBatches = batches;
    if (filterInStockOnly) {
      sourceBatches = sourceBatches.filter((b) => (b.stock_qty || 0) > 0);
    }

    return sourceBatches.map((b) => {
      const prod = productMap[b.product_id];
      const prodName = prod?.name || "Unknown Product";
      const batchNo = b.batch_no || "";
      const secBarcodes = prod?.secondary_barcodes ? prod.secondary_barcodes.join(" ") : "";
      const searchString = `${prodName} ${batchNo} ${prod?.barcode || ""} ${secBarcodes} ${prod?.generic_name || ""} ${prod?.hsn_sac_code || ""}`.toLowerCase();

      return {
        batch: b,
        product: prod,
        productName: prodName,
        batchNo,
        stockQty: b.stock_qty ?? 0,
        formattedExpiry: formatExpiryDisplay(b.expiry_date),
        mrp: b.mrp,
        sellingRate: b.selling_rate,
        searchString,
      };
    });
  }, [batches, productMap, filterInStockOnly]);

  // Find currently selected option
  const selectedOption = useMemo(() => {
    return allOptions.find((opt) => opt.batch.id === value);
  }, [allOptions, value]);

  // Filtered and ranked options based on searchQuery
  const filteredOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      // Sort alphabetically by product name, then FEFO by expiry
      return [...allOptions].sort((a, b) => {
        const nameCmp = a.productName.localeCompare(b.productName);
        if (nameCmp !== 0) return nameCmp;
        return (a.batch.expiry_date || "").localeCompare(b.batch.expiry_date || "");
      });
    }

    const matches = allOptions.filter((opt) => opt.searchString.includes(q));

    // Rank results: product name matches first, then batch number matches
    return matches.sort((a, b) => {
      const aProdStarts = a.productName.toLowerCase().startsWith(q);
      const bProdStarts = b.productName.toLowerCase().startsWith(q);
      if (aProdStarts && !bProdStarts) return -1;
      if (!aProdStarts && bProdStarts) return 1;

      const aProdHas = a.productName.toLowerCase().includes(q);
      const bProdHas = b.productName.toLowerCase().includes(q);
      if (aProdHas && !bProdHas) return -1;
      if (!aProdHas && bProdHas) return 1;

      const aBatchStarts = a.batchNo.toLowerCase().startsWith(q);
      const bBatchStarts = b.batchNo.toLowerCase().startsWith(q);
      if (aBatchStarts && !bBatchStarts) return -1;
      if (!aBatchStarts && bBatchStarts) return 1;

      return a.productName.localeCompare(b.productName);
    });
  }, [allOptions, searchQuery]);

  // Portal positioning
  const [dropdownCoords, setDropdownCoords] = useState<{
    top: number;
    left: number;
    width: number;
    placement: "top" | "bottom";
  } | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const minWidth = Math.max(rect.width, 380);
    let left = rect.left;

    if (left + minWidth > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - minWidth - 16);
    }

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropdownHeight = 300;

    const openUpwards = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    setDropdownCoords({
      top: openUpwards ? Math.max(8, rect.top - dropdownHeight - 4) : rect.bottom + 4,
      left,
      width: minWidth,
      placement: openUpwards ? "top" : "bottom",
    });
  }, []);

  // Recalculate position on resize / scroll
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleScrollOrResize = () => updatePosition();
    window.addEventListener("resize", handleScrollOrResize, { passive: true });
    window.addEventListener("scroll", handleScrollOrResize, { capture: true, passive: true });

    return () => {
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize, { capture: true });
    };
  }, [isOpen, updatePosition]);

  // Reset highlight on search change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      updatePosition();
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 20);
    }
  }, [isOpen, updatePosition]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        setIsOpen(false);
        setSearchQuery("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Auto-scroll highlighted option into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector(
      `[data-index="${highlightedIndex}"]`
    ) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex, isOpen]);

  const selectOption = (opt: BatchComboboxOption) => {
    onChange(opt.batch.id, opt.batch, opt.product);
    setIsOpen(false);
    setSearchQuery("");
    triggerRef.current?.focus();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("", undefined, undefined);
    setSearchQuery("");
  };

  // Keyboard navigation on trigger button
  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsOpen(true);
      return;
    }

    // Direct alphanumeric typing opens dropdown and sets initial search character
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setSearchQuery(e.key);
      setIsOpen(true);
    }
  };

  // Keyboard navigation inside search input
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1 >= filteredOptions.length ? 0 : prev + 1));
        break;

      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 < 0 ? Math.max(0, filteredOptions.length - 1) : prev - 1));
        break;

      case "Enter":
        e.preventDefault();
        if (filteredOptions[highlightedIndex]) {
          selectOption(filteredOptions[highlightedIndex]);
        }
        break;

      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        setSearchQuery("");
        triggerRef.current?.focus();
        break;

      case "Tab":
        setIsOpen(false);
        setSearchQuery("");
        break;
    }
  };

  return (
    <div className={`relative ${className}`}>
      {/* Combobox Trigger */}
      <div
        ref={triggerRef}
        id={inputId}
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        onKeyDown={handleTriggerKeyDown}
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        className={`flex items-center justify-between w-full rounded-btn border bg-surface px-2.5 py-2 text-xs transition-colors cursor-pointer select-none ${
          disabled
            ? "opacity-50 cursor-not-allowed border-border-main"
            : isOpen
            ? "border-accent ring-1 ring-accent/20"
            : "border-border-main hover:border-accent/80 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 pr-1">
          {selectedOption ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Package className="h-4 w-4 text-accent shrink-0" />
              <span className="font-semibold text-text-main truncate">
                {selectedOption.productName}
              </span>
              <span className="shrink-0 font-mono text-[10px] bg-canvas border border-border-main px-1.5 py-0.5 rounded text-text-muted font-medium">
                Batch: {selectedOption.batchNo}
              </span>
              <span
                className={`shrink-0 font-mono text-[10px] ${
                  selectedOption.stockQty <= 0
                    ? "text-status-danger font-bold"
                    : "text-text-muted"
                }`}
              >
                ({selectedOption.stockQty} on hand)
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-text-muted">
              <Search className="h-3.5 w-3.5 shrink-0 text-text-muted/70" />
              <span className="truncate">{placeholder}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 text-text-muted">
          {selectedOption && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              title="Clear selection"
              className="p-0.5 rounded hover:bg-canvas hover:text-text-main transition-colors mr-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-150 ${
              isOpen ? "rotate-180 text-accent" : "text-text-muted"
            }`}
          />
        </div>
      </div>

      {/* Floating Dropdown Portal */}
      {isOpen &&
        dropdownCoords &&
        ReactDOM.createPortal(
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            style={{
              position: "fixed",
              top: `${dropdownCoords.top}px`,
              left: `${dropdownCoords.left}px`,
              width: `${dropdownCoords.width}px`,
              zIndex: 9999,
            }}
            className="flex flex-col max-h-72 rounded-card border border-border-main bg-surface shadow-modal overflow-hidden text-xs animate-in fade-in duration-100"
          >
            {/* Search Input Header */}
            <div className="p-2 border-b border-border-main bg-canvas shrink-0">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 h-3.5 w-3.5 text-text-muted pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search product name or batch number..."
                  className="w-full rounded-btn border border-border-main bg-surface pl-8 pr-7 py-1.5 text-xs text-text-main focus:border-accent focus:outline-none placeholder:text-text-muted"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 text-text-muted hover:text-text-main p-0.5"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Results List */}
            <div className="overflow-y-auto divide-y divide-border-main/50 flex-1">
              {filteredOptions.length === 0 ? (
                <div className="p-6 text-center text-xs text-text-muted">
                  <Search className="mx-auto h-5 w-5 opacity-40 mb-1.5" />
                  <p className="font-medium text-text-main">No batches found</p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    No matching product name or batch for &ldquo;{searchQuery}&rdquo;
                  </p>
                </div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isHighlighted = highlightedIndex === idx;
                  const isCurrent = opt.batch.id === value;

                  return (
                    <div
                      key={opt.batch.id}
                      data-index={idx}
                      role="option"
                      aria-selected={isCurrent}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onClick={() => selectOption(opt)}
                      className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${
                        isHighlighted
                          ? "bg-accent-soft text-text-main border-l-3 border-l-accent pl-2.5"
                          : isCurrent
                          ? "bg-surface-hover/70"
                          : "hover:bg-surface-hover"
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        {/* Primary: Product Name */}
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-xs text-text-main truncate">
                            <HighlightMatch text={opt.productName} query={searchQuery} />
                          </span>
                        </div>

                        {/* Secondary: Batch, Stock, Expiry, Rate */}
                        <div className="flex items-center gap-2 text-[11px] text-text-muted mt-0.5 font-mono">
                          <span className="bg-canvas border border-border-main px-1.5 py-0.2 rounded text-[10px] text-text-main font-semibold">
                            Batch: <HighlightMatch text={opt.batchNo} query={searchQuery} />
                          </span>
                          <span>•</span>
                          <span
                            className={
                              opt.stockQty <= 0
                                ? "text-status-danger font-semibold"
                                : "text-text-main"
                            }
                          >
                            Stock: {opt.stockQty}
                          </span>
                          <span>•</span>
                          <span>Exp: {opt.formattedExpiry}</span>
                          {(opt.sellingRate || opt.mrp) && (
                            <>
                              <span>•</span>
                              <span>₹{Number(opt.sellingRate || opt.mrp || 0).toFixed(2)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Right Checkmark */}
                      {isCurrent && (
                        <div className="shrink-0 text-accent">
                          <Check className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer with total count */}
            <div className="px-3 py-1.5 bg-canvas border-t border-border-main text-[10px] text-text-muted flex justify-between items-center shrink-0">
              <span>
                {filteredOptions.length} batch{filteredOptions.length === 1 ? "" : "es"} available
              </span>
              <span className="font-mono text-[9px] text-text-muted/80">
                ↑↓ Navigate • ↵ Select • Esc Close
              </span>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

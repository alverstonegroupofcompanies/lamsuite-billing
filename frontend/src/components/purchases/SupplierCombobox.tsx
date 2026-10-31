import React, { useState, useEffect, useRef, useId, useCallback } from "react";
import ReactDOM from "react-dom";
import {
  Building2,
  Search,
  X,
  Check,
  Plus,
  CreditCard,
  Clock,
  MapPin,
  AlertCircle,
} from "lucide-react";
import {
  supplierLedgerService,
  type SupplierMaster,
} from "../../lib/purchases/supplierLedgerService";
import { SupplierQuickAddModal } from "./SupplierQuickAddModal";
import { useModalEscape } from "../../lib/ui/modalEscapeManager";

export interface SupplierComboboxProps {
  value: string;
  selectedSupplier: SupplierMaster | null;
  onChange: (supplier: SupplierMaster | null, autoAdvance?: boolean) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onEnterAdvance?: () => void;
}

/** Helper component to highlight matching query substrings */
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

export const SupplierCombobox: React.FC<SupplierComboboxProps> = ({
  value,
  selectedSupplier,
  onChange,
  inputRef: externalInputRef,
  disabled = false,
  placeholder = "Select or search supplier (Alt+S)...",
  className = "",
  onEnterAdvance,
}) => {
  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = externalInputRef || internalInputRef;
  const listboxId = useId();

  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(value || "");
  const [allSuppliers, setAllSuppliers] = useState<SupplierMaster[]>([]);
  const [searchResults, setSearchResults] = useState<SupplierMaster[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  // Quick Add Modal State
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  useModalEscape(isQuickAddOpen, () => setIsQuickAddOpen(false));

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSearchTerm(value || "");
  }, [value]);

  const loadSuppliers = async () => {
    try {
      const sups = await supplierLedgerService.getAllSuppliers();
      setAllSuppliers(sups.filter((s) => s.is_active !== false));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

  // Update floating portal position
  const updatePosition = useCallback(() => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      const minDropdownWidth = Math.max(rect.width, 420);
      let left = rect.left;

      if (left + minDropdownWidth > window.innerWidth - 16) {
        left = Math.max(16, window.innerWidth - minDropdownWidth - 16);
      }

      setDropdownCoords({
        top: rect.bottom + 4,
        left: left,
        width: minDropdownWidth,
      });
    }
  }, [inputRef]);

  // Filter suppliers on searchTerm change
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) {
      setSearchResults(allSuppliers.slice(0, 15));
    } else {
      const filtered = allSuppliers.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.gstin && s.gstin.toLowerCase().includes(q)) ||
          (s.phone && s.phone.includes(q)) ||
          (s.place_of_supply && s.place_of_supply.toLowerCase().includes(q))
      );
      setSearchResults(filtered.slice(0, 20));
    }
    setHighlightedIndex(0);
  }, [searchTerm, allSuppliers]);

  // Position recalculation on resize / scroll
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener("resize", handleScrollOrResize, { passive: true });
    window.addEventListener("scroll", handleScrollOrResize, { passive: true });
    return () => {
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize);
    };
  }, [isOpen, updatePosition]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        inputRef.current &&
        !inputRef.current.contains(target) &&
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, inputRef]);

  const trimmed = searchTerm.trim();
  const exactMatchExists = searchResults.some(
    (s) => s.name.toLowerCase() === trimmed.toLowerCase()
  );
  const showQuickAddOption = trimmed.length > 0 && !exactMatchExists;
  const totalOptionsCount = searchResults.length + (showQuickAddOption ? 1 : 0);

  // Auto-scroll highlighted option into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex, isOpen]);

  const selectSupplier = (supplier: SupplierMaster) => {
    setSearchTerm(supplier.name);
    setIsOpen(false);
    onChange(supplier, true);
    if (onEnterAdvance) {
      setTimeout(() => onEnterAdvance(), 30);
    }
  };

  const openQuickAdd = () => {
    setIsQuickAddOpen(true);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIsOpen(true);
        updatePosition();
        return;
      }
      if (e.key === "Enter") {
        // If already selected, advance to next field
        if (selectedSupplier && onEnterAdvance) {
          e.preventDefault();
          onEnterAdvance();
          return;
        }
        setIsOpen(true);
        updatePosition();
        return;
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1 >= totalOptionsCount ? 0 : prev + 1));
        break;

      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 < 0 ? totalOptionsCount - 1 : prev - 1));
        break;

      case "Enter":
        e.preventDefault();
        if (totalOptionsCount === 0) {
          openQuickAdd();
          return;
        }

        if (highlightedIndex < searchResults.length) {
          selectSupplier(searchResults[highlightedIndex]);
        } else if (showQuickAddOption) {
          openQuickAdd();
        }
        break;

      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        break;

      case "Tab":
        setIsOpen(false);
        break;
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div className="relative flex items-center">
        <Building2 className="absolute left-2.5 h-3.5 w-3.5 text-[var(--color-text-muted)] pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          disabled={disabled}
          placeholder={placeholder}
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls={listboxId}
          role="combobox"
          onFocus={() => {
            setIsOpen(true);
            updatePosition();
            if (inputRef.current) {
              inputRef.current.select();
            }
          }}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            if (!isOpen) setIsOpen(true);
            updatePosition();
          }}
          onKeyDown={handleKeyDown}
          className="w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-7 py-1 text-xs font-semibold text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none shadow-2xs transition-colors"
        />
        {searchTerm ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              setSearchTerm("");
              onChange(null);
              inputRef.current?.focus();
            }}
            className="absolute right-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {/* Supplier Quick Details Chips (under input or inline) */}
      {selectedSupplier && (
        <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--color-text-muted)] font-mono">
          <span className="inline-flex items-center gap-1 font-bold text-[var(--color-text)]">
            <span>Bal:</span>
            <span className={Number(selectedSupplier.outstanding_balance || 0) > 0 ? "text-[var(--color-warning-text)]" : "text-[var(--color-text-muted)]"}>
              ₹ {Number(selectedSupplier.outstanding_balance || 0).toFixed(2)}
            </span>
          </span>
          <span>•</span>
          <span>{selectedSupplier.credit_period_days || 30}d credit</span>
          {selectedSupplier.gstin && (
            <>
              <span>•</span>
              <span className="uppercase">{selectedSupplier.gstin}</span>
            </>
          )}
        </div>
      )}

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
            className="max-h-72 overflow-y-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-dropdown divide-y divide-[var(--color-border-subtle)] text-xs animate-in fade-in duration-75"
          >
            {searchResults.length === 0 && !showQuickAddOption ? (
              <div className="p-4 text-center text-xs text-[var(--color-text-muted)]">
                <Search className="mx-auto h-5 w-5 opacity-40 mb-1" />
                No suppliers found. Press Enter to add.
              </div>
            ) : (
              searchResults.map((sup, idx) => {
                const isSelected = highlightedIndex === idx;
                const isCurrent = selectedSupplier?.id === sup.id;

                return (
                  <div
                    key={sup.id}
                    data-index={idx}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onClick={() => selectSupplier(sup)}
                    className={`flex items-center justify-between px-3.5 py-2 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-[var(--color-accent-soft)] text-[var(--color-text)] border-l-4 border-l-[var(--color-accent)] pl-2.5"
                        : "hover:bg-[var(--color-surface-hover)] text-[var(--color-text)]"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[var(--color-text)]">
                          <HighlightMatch text={sup.name} query={searchTerm} />
                        </span>
                        {isCurrent && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--color-accent)] px-1.5 py-0.2 text-[9px] font-bold text-white">
                            <Check className="h-2.5 w-2.5" /> Selected
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)] font-mono mt-0.5">
                        {sup.gstin && <span>GSTIN: <HighlightMatch text={sup.gstin} query={searchTerm} /></span>}
                        {sup.phone && <span>Ph: <HighlightMatch text={sup.phone} query={searchTerm} /></span>}
                        {sup.place_of_supply && <span>({sup.place_of_supply})</span>}
                      </div>
                    </div>

                    <div className="text-right shrink-0 ml-3 font-mono">
                      <p className="text-[11px] font-bold text-[var(--color-text)]">
                        Bal: ₹{Number(sup.outstanding_balance || 0).toFixed(2)}
                      </p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        Credit: {sup.credit_period_days || 30} days
                      </p>
                    </div>
                  </div>
                );
              })
            )}

            {showQuickAddOption && (
              <div
                data-index={searchResults.length}
                role="option"
                aria-selected={highlightedIndex === searchResults.length}
                onMouseEnter={() => setHighlightedIndex(searchResults.length)}
                onClick={openQuickAdd}
                className={`flex items-center gap-2 px-3.5 py-2.5 cursor-pointer text-xs font-bold text-[var(--color-accent)] border-t border-[var(--color-border)] ${
                  highlightedIndex === searchResults.length
                    ? "bg-[var(--color-accent-soft)]"
                    : "hover:bg-[var(--color-surface-hover)]"
                }`}
              >
                <Plus className="h-4 w-4" />
                <span>Quick Add Supplier: &quot;{trimmed}&quot; (Press Enter)</span>
              </div>
            )}
          </div>,
          document.body
        )}

      {/* Supplier Quick Add Modal */}
      <SupplierQuickAddModal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        onSupplierCreated={(newSup) => {
          loadSuppliers();
          selectSupplier(newSup);
        }}
      />
    </div>
  );
};

import React, { useState, useEffect, useRef, useId, useCallback } from "react";
import ReactDOM from "react-dom";
import {
  User,
  UserCheck,
  UserPlus,
  Search,
  X,
  AlertCircle,
  Check,
  Phone,
  Building,
  CreditCard,
  Percent,
} from "lucide-react";
import {
  partiesStore,
  type Customer,
  isValidIndianPhone,
  isValidGstin,
  normalizeIndianPhone,
} from "../lib/masters/partiesStore";

export interface CustomerComboboxSelection {
  name: string;
  phone?: string;
  gstin?: string;
  customer?: Customer | null;
  isWalkIn?: boolean;
}

interface CustomerComboboxProps {
  value: string;
  phone?: string;
  gstin?: string;
  selectedCustomer?: Customer | null;
  onChange: (selection: CustomerComboboxSelection) => void;
  onQuickAddSuccess?: (customer: Customer) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/** Helper component to highlight matching substrings */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;

  // Escape regex special chars
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

export const CustomerCombobox: React.FC<CustomerComboboxProps> = ({
  value,
  phone = "",
  gstin = "",
  selectedCustomer = null,
  onChange,
  onQuickAddSuccess,
  inputRef: externalInputRef,
  disabled = false,
  placeholder = "Customer Name (F2)",
  className = "",
}) => {
  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = externalInputRef || internalInputRef;
  const listboxId = useId();

  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(value || "");
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  // Quick Add Modal State
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddPhone, setQuickAddPhone] = useState("");
  const [quickAddGstin, setQuickAddGstin] = useState("");
  const [quickAddAddress, setQuickAddAddress] = useState("");
  const [quickAddCreditLimit, setQuickAddCreditLimit] = useState("");
  const [quickAddDiscount, setQuickAddDiscount] = useState("");
  const [quickAddError, setQuickAddError] = useState("");
  const [isSavingQuickAdd, setIsSavingQuickAdd] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  // Synchronize internal input value when external value changes
  useEffect(() => {
    setSearchTerm(value || "");
  }, [value]);

  // Update floating portal position
  const updatePosition = useCallback(() => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      const minDropdownWidth = Math.max(rect.width, 340);
      let left = rect.left;
      
      // Ensure portal doesn't clip off the right edge of viewport
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

  // Live customer search with debouncing
  useEffect(() => {
    let active = true;
    setIsSearching(true);

    const timer = setTimeout(async () => {
      try {
        if (!searchTerm.trim()) {
          const recent = await partiesStore.getRecentOrFrequentCustomers(12);
          if (active) {
            setSearchResults(recent);
            setHighlightedIndex(0);
            setIsSearching(false);
          }
        } else {
          const matches = await partiesStore.searchCustomers(searchTerm.trim(), 20);
          if (active) {
            setSearchResults(matches);
            setHighlightedIndex(0);
            setIsSearching(false);
          }
        }
      } catch (err) {
        if (active) {
          setIsSearching(false);
        }
      }
    }, 60);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchTerm]);

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

  // Close dropdown on click outside
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

  // Calculate list items count:
  // Item 0: Walk-in Customer
  // Item 1..N: Registered Customers
  // If typed query has no exact match:
  // Item N+1: Use '<term>' as walk-in name
  // Item N+2: + Add '<term>' as new customer
  const trimmed = searchTerm.trim();
  const exactMatchExists = searchResults.some(
    (c) => c.name.toLowerCase() === trimmed.toLowerCase() || c.phone === normalizeIndianPhone(trimmed)
  );
  const showFreeTextOptions = trimmed.length > 0 && trimmed.toLowerCase() !== "walk-in customer" && !exactMatchExists;

  const totalOptionsCount = 1 + searchResults.length + (showFreeTextOptions ? 2 : 0);

  // Auto-scroll highlighted option into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex, isOpen]);

  const selectWalkIn = () => {
    setSearchTerm("Walk-in Customer");
    onChange({
      name: "Walk-in Customer",
      phone: "",
      gstin: "",
      customer: null,
      isWalkIn: true,
    });
    setIsOpen(false);
  };

  const selectCustomer = (cust: Customer) => {
    setSearchTerm(cust.name);
    onChange({
      name: cust.name,
      phone: cust.phone,
      gstin: cust.gstin,
      customer: cust,
      isWalkIn: false,
    });
    setIsOpen(false);
  };

  const selectFreeTextWalkIn = (nameText: string) => {
    const cleanName = nameText.trim() || "Walk-in Customer";
    setSearchTerm(cleanName);
    onChange({
      name: cleanName,
      phone: phone,
      gstin: gstin,
      customer: null,
      isWalkIn: true,
    });
    setIsOpen(false);
  };

  const openQuickAddModal = (initialName: string) => {
    setQuickAddName(initialName.trim());
    setQuickAddPhone(phone || "");
    setQuickAddGstin(gstin || "");
    setQuickAddAddress("");
    setQuickAddCreditLimit("");
    setQuickAddDiscount("");
    setQuickAddError("");
    setIsQuickAddOpen(true);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectWalkIn();
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (!isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) {
      e.preventDefault();
      setIsOpen(true);
      updatePosition();
      return;
    }

    if (!isOpen) return;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1 < totalOptionsCount ? prev + 1 : 0));
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : totalOptionsCount - 1));
        break;
      }
      case "Enter": {
        e.preventDefault();
        commitHighlightedSelection();
        break;
      }
      case "Tab": {
        // Tab accepts the current selection or free text and lets browser move to next element
        commitHighlightedSelection();
        setIsOpen(false);
        break;
      }
      case "Escape": {
        e.preventDefault();
        setIsOpen(false);
        break;
      }
    }
  };

  const commitHighlightedSelection = () => {
    if (showFreeTextOptions && highlightedIndex === 0) {
      selectFreeTextWalkIn(searchTerm);
      return;
    }

    if (highlightedIndex === 0) {
      selectWalkIn();
      return;
    }

    const customerIndex = highlightedIndex - 1;
    if (customerIndex >= 0 && customerIndex < searchResults.length) {
      selectCustomer(searchResults[customerIndex]);
      return;
    }

    if (showFreeTextOptions) {
      const freeTextWalkInIndex = 1 + searchResults.length;
      const quickAddIndex = 1 + searchResults.length + 1;

      if (highlightedIndex === freeTextWalkInIndex) {
        selectFreeTextWalkIn(searchTerm);
      } else if (highlightedIndex === quickAddIndex) {
        openQuickAddModal(searchTerm);
      } else {
        selectFreeTextWalkIn(searchTerm);
      }
    } else {
      selectFreeTextWalkIn(searchTerm);
    }
  };

  const handleSaveQuickAdd = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setQuickAddError("");

    const name = quickAddName.trim();
    if (!name) {
      setQuickAddError("Customer name is required.");
      return;
    }

    if (quickAddPhone.trim() && !isValidIndianPhone(quickAddPhone.trim())) {
      setQuickAddError("Please enter a valid 10-digit Indian mobile number.");
      return;
    }

    if (quickAddGstin.trim() && !isValidGstin(quickAddGstin.trim())) {
      setQuickAddError("Please enter a valid 15-character GSTIN or leave blank.");
      return;
    }

    try {
      setIsSavingQuickAdd(true);
      const created = await partiesStore.quickCreateCustomer({
        name,
        phone: quickAddPhone.trim() || undefined,
        gstin: quickAddGstin.trim() ? quickAddGstin.trim().toUpperCase() : undefined,
        address: quickAddAddress.trim() || undefined,
        credit_limit: quickAddCreditLimit ? parseFloat(quickAddCreditLimit) : undefined,
        default_discount_percent: quickAddDiscount ? parseFloat(quickAddDiscount) : undefined,
      });

      setIsQuickAddOpen(false);
      selectCustomer(created);
      if (onQuickAddSuccess) {
        onQuickAddSuccess(created);
      }
    } catch (err) {
      setQuickAddError(err instanceof Error ? err.message : "Failed to save customer");
    } finally {
      setIsSavingQuickAdd(false);
    }
  };

  const isOverCreditLimit =
    selectedCustomer &&
    (selectedCustomer.credit_limit || 0) > 0 &&
    (selectedCustomer.outstanding_balance || 0) > (selectedCustomer.credit_limit || 0);

  return (
    <div className="relative inline-flex items-center">
      {/* Combobox Input Field */}
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          disabled={disabled}
          value={searchTerm}
          placeholder={placeholder}
          onFocus={() => {
            setIsOpen(true);
            updatePosition();
          }}
          onClick={() => {
            setIsOpen(true);
            updatePosition();
          }}
          onBlur={(e) => {
            const related = e.relatedTarget as Node | null;
            if (listRef.current && related && listRef.current.contains(related)) {
              return;
            }
            const cleanTerm = searchTerm.trim();
            if (cleanTerm && cleanTerm !== value) {
              onChange({
                name: cleanTerm,
                phone: phone,
                gstin: gstin,
                customer: selectedCustomer?.name === cleanTerm ? selectedCustomer : null,
                isWalkIn: cleanTerm.toLowerCase() === "walk-in customer",
              });
            }
            setIsOpen(false);
          }}
          onChange={(e) => {
            const val = e.target.value;
            setSearchTerm(val);
            if (!isOpen) setIsOpen(true);
            updatePosition();
          }}
          onKeyDown={handleKeyDown}
          className={`h-7 w-48 rounded border border-slate-200 bg-white pr-6 pl-2 text-xs font-medium text-slate-800 placeholder-slate-400 transition-colors hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 ${className}`}
        />

        {/* Clear Button */}
        {searchTerm && searchTerm !== "Walk-in Customer" && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            onClick={handleClear}
            className="absolute right-1.5 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            title="Reset to Walk-in Customer"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Credit Limit Exceeded Warning Badge */}
      {isOverCreditLimit && (
        <span
          className="ml-1.5 inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950/80 dark:text-red-300"
          title={`Outstanding ₹${selectedCustomer?.outstanding_balance?.toLocaleString()} exceeds credit limit of ₹${selectedCustomer?.credit_limit?.toLocaleString()}`}
        >
          <AlertCircle className="h-3 w-3" />
          <span>Exceeds Limit</span>
        </span>
      )}

      {/* Floating Portal Dropdown */}
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
            className="max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-2xl ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/10"
          >
            {/* Header hint */}
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 text-[10px] font-semibold text-slate-400 dark:border-slate-800 dark:text-slate-500">
              <span className="uppercase tracking-wider">
                {searchTerm.trim() ? "Search Results" : "Recent / Top Customers"}
              </span>
              <span className="text-[9px] text-slate-400">↑↓ to navigate • Enter to select</span>
            </div>

            {/* Option 0: Walk-in Customer */}
            <div
              data-index={0}
              role="option"
              aria-selected={highlightedIndex === 0}
              onMouseEnter={() => setHighlightedIndex(0)}
              onClick={selectWalkIn}
              className={`flex cursor-pointer items-center justify-between px-3 py-2 text-xs transition-colors ${
                highlightedIndex === 0
                  ? "bg-blue-50 text-blue-900 dark:bg-blue-950/70 dark:text-blue-100 font-semibold"
                  : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <User className="h-3.5 w-3.5" />
                </div>
                <div>
                  <div className="font-semibold">Walk-in Customer</div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500">
                    Default retail customer (No registration required)
                  </div>
                </div>
              </div>
              {(!selectedCustomer || selectedCustomer.name === "Walk-in Customer") && (
                <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              )}
            </div>

            {/* Customer List Items */}
            {searchResults.map((cust, idx) => {
              const itemIndex = idx + 1;
              const isSelected = selectedCustomer?.id === cust.id;
              const isHighlighted = highlightedIndex === itemIndex;
              const hasOutstanding = (cust.outstanding_balance || 0) > 0;
              const exceedsLimit =
                (cust.credit_limit || 0) > 0 && (cust.outstanding_balance || 0) > (cust.credit_limit || 0);

              return (
                <div
                  key={cust.id}
                  data-index={itemIndex}
                  role="option"
                  aria-selected={isHighlighted}
                  onMouseEnter={() => setHighlightedIndex(itemIndex)}
                  onClick={() => selectCustomer(cust)}
                  className={`flex cursor-pointer items-center justify-between border-t border-slate-50 px-3 py-2 text-xs transition-colors dark:border-slate-800/40 ${
                    isHighlighted
                      ? "bg-blue-50 text-blue-900 dark:bg-blue-950/70 dark:text-blue-100 font-semibold"
                      : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/80 dark:text-emerald-300 font-bold text-[10px]">
                      {cust.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          <HighlightMatch text={cust.name} query={searchTerm} />
                        </span>
                        {cust.customer_code && (
                          <span className="rounded bg-slate-100 px-1 py-0.2 text-[9px] font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                            <HighlightMatch text={cust.customer_code} query={searchTerm} />
                          </span>
                        )}
                        {cust.default_discount_percent ? (
                          <span className="rounded bg-amber-100 px-1 py-0.2 text-[9px] font-semibold text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
                            {cust.default_discount_percent}% Off
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                        {cust.phone && (
                          <span className="flex items-center gap-0.5">
                            <Phone className="h-2.5 w-2.5 text-slate-400" />
                            <HighlightMatch text={cust.phone} query={searchTerm} />
                          </span>
                        )}
                        {cust.gstin && (
                          <span className="font-mono text-[9px]">
                            GST: <HighlightMatch text={cust.gstin} query={searchTerm} />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Dues & Balance Badge */}
                  <div className="flex flex-col items-end">
                    {hasOutstanding ? (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          exceedsLimit
                            ? "bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300"
                        }`}
                      >
                        ₹{cust.outstanding_balance?.toLocaleString()} due
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">₹0 due</span>
                    )}

                    {isSelected && (
                      <Check className="mt-1 h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    )}
                  </div>
                </div>
              );
            })}

            {/* Free-text walk-in name & Quick-add options */}
            {showFreeTextOptions && (
              <div className="border-t border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/40">
                {/* Use as Walk-in Name option */}
                <div
                  data-index={1 + searchResults.length}
                  role="option"
                  aria-selected={highlightedIndex === 1 + searchResults.length}
                  onMouseEnter={() => setHighlightedIndex(1 + searchResults.length)}
                  onClick={() => selectFreeTextWalkIn(searchTerm)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-xs transition-colors ${
                    highlightedIndex === 1 + searchResults.length
                      ? "bg-blue-50 text-blue-900 dark:bg-blue-950/70 dark:text-blue-100 font-semibold"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/60"
                  }`}
                >
                  <UserCheck className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                  <span>
                    Use <strong className="text-blue-600 dark:text-blue-400">"{searchTerm.trim()}"</strong> as walk-in name
                  </span>
                </div>

                {/* Add as New Customer option */}
                <div
                  data-index={1 + searchResults.length + 1}
                  role="option"
                  aria-selected={highlightedIndex === 1 + searchResults.length + 1}
                  onMouseEnter={() => setHighlightedIndex(1 + searchResults.length + 1)}
                  onClick={() => openQuickAddModal(searchTerm)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors dark:text-emerald-400 ${
                    highlightedIndex === 1 + searchResults.length + 1
                      ? "bg-emerald-100/70 dark:bg-emerald-950/80"
                      : "hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                  }`}
                >
                  <UserPlus className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>+ Add "{searchTerm.trim()}" as new customer</span>
                </div>
              </div>
            )}
          </div>,
          document.body
        )}

      {/* Quick Add Customer Modal */}
      {isQuickAddOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <UserPlus className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Quick Add Customer</h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Save customer master details for billing and ledger tracking
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsQuickAddOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {quickAddError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950/80 dark:text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{quickAddError}</span>
              </div>
            )}

            <form onSubmit={handleSaveQuickAdd} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Customer Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={quickAddName}
                  onChange={(e) => setQuickAddName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Mobile Phone (+91)
                  </label>
                  <input
                    type="text"
                    value={quickAddPhone}
                    onChange={(e) => setQuickAddPhone(e.target.value)}
                    placeholder="10-digit mobile"
                    maxLength={14}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    GSTIN (Optional)
                  </label>
                  <input
                    type="text"
                    value={quickAddGstin}
                    onChange={(e) => setQuickAddGstin(e.target.value.toUpperCase())}
                    placeholder="15-character GSTIN"
                    maxLength={15}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono font-medium uppercase text-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Address (Optional)
                </label>
                <input
                  type="text"
                  value={quickAddAddress}
                  onChange={(e) => setQuickAddAddress(e.target.value)}
                  placeholder="Street / City address"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Credit Limit (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={quickAddCreditLimit}
                    onChange={(e) => setQuickAddCreditLimit(e.target.value)}
                    placeholder="e.g. 5000"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Default Discount (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={quickAddDiscount}
                    onChange={(e) => setQuickAddDiscount(e.target.value)}
                    placeholder="e.g. 5"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingQuickAdd}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  {isSavingQuickAdd ? "Saving..." : "Save Customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

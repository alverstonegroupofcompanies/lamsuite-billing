import React, { useState, useRef, useEffect } from "react";
import { Scale, Check, Plus } from "lucide-react";
import type { UnitMaster } from "../lib/masters/unitsStore";

interface UnitAutocompleteInputProps {
  value: string;
  onChange: (val: string) => void;
  units: UnitMaster[];
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export const UnitAutocompleteInput: React.FC<UnitAutocompleteInputProps> = ({
  value,
  onChange,
  units,
  placeholder = "e.g. Strip, Box, Bottle",
  className = "",
  autoFocus = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cleanQuery = value.trim().toLowerCase();

  // Filter matching units from master
  const filteredUnits = units.filter((u) => {
    if (!cleanQuery) return true;
    return (
      u.name.toLowerCase().includes(cleanQuery) ||
      u.symbol.toLowerCase().includes(cleanQuery)
    );
  });

  // Check if current input exact-matches an existing unit
  const exactMatch = units.some(
    (u) =>
      u.name.toLowerCase() === cleanQuery ||
      u.symbol.toLowerCase() === cleanQuery
  );

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (unitName: string) => {
    onChange(unitName);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    const totalOptions = filteredUnits.length + (!exactMatch && cleanQuery ? 1 : 0);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1 < totalOptions ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : totalOptions - 1));
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < filteredUnits.length) {
        e.preventDefault();
        handleSelect(filteredUnits[highlightedIndex].name);
      } else if (highlightedIndex === filteredUnits.length && !exactMatch && cleanQuery) {
        e.preventDefault();
        handleSelect(value.trim());
      } else {
        setIsOpen(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
          setHighlightedIndex(0);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className={
          className ||
          "w-full px-2.5 py-1.5 rounded-btn border border-border-main bg-surface font-semibold text-text-main text-xs focus:border-accent focus:ring-1 focus:ring-accent outline-none"
        }
      />

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-52 overflow-y-auto rounded-btn border border-border-main bg-surface shadow-modal py-1 font-sans animate-in fade-in duration-75">
          {filteredUnits.length > 0 ? (
            filteredUnits.map((u, idx) => {
              const isSelected = u.name.toLowerCase() === cleanQuery;
              const isHighlighted = idx === highlightedIndex;
              return (
                <div
                  key={u.id}
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent blur
                    handleSelect(u.name);
                  }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                    isHighlighted
                      ? "bg-accent-soft text-accent font-semibold"
                      : "text-text-main hover:bg-canvas"
                  }`}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Scale className="h-3 w-3 opacity-60 flex-shrink-0" />
                    <span className="truncate">{u.name}</span>
                    {isSelected && <Check className="h-3 w-3 text-accent ml-1 flex-shrink-0" />}
                  </div>
                  <span className="font-mono text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-canvas border border-border-main/50 flex-shrink-0 ml-2">
                    {u.symbol}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="px-3 py-2 text-xs text-text-muted italic">
              No matching units in master
            </div>
          )}

          {/* New Unit creation prompt */}
          {!exactMatch && cleanQuery && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(value.trim());
              }}
              onMouseEnter={() => setHighlightedIndex(filteredUnits.length)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer border-t border-border-main/50 transition-colors ${
                highlightedIndex === filteredUnits.length
                  ? "bg-amber-500/20 text-amber-900 dark:text-amber-200 font-bold"
                  : "bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 font-medium"
              }`}
            >
              <Plus className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">
                Create <strong>"{value.trim()}"</strong> in Master
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

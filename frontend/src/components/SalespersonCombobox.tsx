import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Search, Users, X } from "lucide-react";
import { salespersonStore, type SalespersonMaster } from "../lib/masters/salespersonStore";

interface SalespersonComboboxProps {
  /** What the cashier sees: the chosen person's name, or the text being typed. */
  value: string;
  onChangeText: (text: string) => void;
  selected: SalespersonMaster | null;
  onSelect: (person: SalespersonMaster | null) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * GAP-01 / SPR-010 — name the person who sold this bill.
 *
 * The list comes from the device cache, so a till with no network still types
 * ahead; whoever is picked is checked again by the server when the bill lands.
 * Typing without choosing names nobody: a free-typed string is not a person.
 */
export function SalespersonCombobox({
  value,
  onChangeText,
  selected,
  onSelect,
  inputRef,
  required = false,
  disabled = false,
  placeholder = "Salesperson",
}: SalespersonComboboxProps) {
  const listId = useId();
  const localRef = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? localRef;

  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SalespersonMaster[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (term: string) => {
    const rows = await salespersonStore.search(term, 12).catch(() => []);
    setResults(rows);
    setHighlight(rows.length > 0 ? 0 : -1);
  }, []);

  useEffect(() => {
    if (!open) return;
    void load(value);
  }, [open, value, load]);

  const choose = (person: SalespersonMaster) => {
    onChangeText(person.name);
    onSelect(person);
    setOpen(false);
    ref.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Enter") {
      if (open && results[highlight]) {
        event.preventDefault();
        choose(results[highlight]);
      } else {
        setOpen(false);
      }
    }
  };

  return (
    <div className="relative flex items-center gap-1">
      <Users className="h-4 w-4 text-[var(--color-text-muted)]" />
      <input
        ref={ref}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-required={required}
        disabled={disabled}
        value={value}
        placeholder={required ? `${placeholder} *` : placeholder}
        title={
          selected
            ? `Salesperson: ${selected.name}${selected.code ? ` (${selected.code})` : ""}`
            : "Type to find the salesperson who sold this bill"
        }
        onChange={(event) => {
          // Typing replaces the pick: an unchosen string must never name a person.
          onChangeText(event.target.value);
          if (selected) onSelect(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
        className="w-36 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
      />
      {selected && (
        <button
          type="button"
          aria-label="Clear salesperson"
          onClick={() => {
            onChangeText("");
            onSelect(null);
            ref.current?.focus();
          }}
          className="rounded-full p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Salespeople"
          className="absolute left-0 top-full z-50 mt-1 max-h-60 w-64 overflow-auto rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg"
          onMouseDown={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
          }}
        >
          {results.length === 0 && (
            <li className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--color-text-muted)]">
              <Search className="h-3.5 w-3.5" />
              Nobody on this counter&rsquo;s list
            </li>
          )}
          {results.map((person, index) => (
            <li
              key={person.id}
              role="option"
              aria-selected={index === highlight}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-xs ${
                index === highlight ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]" : "text-[var(--color-text)]"
              }`}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => choose(person)}
            >
              <span className="font-medium">{person.name}</span>
              <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                {[person.code, person.phone].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

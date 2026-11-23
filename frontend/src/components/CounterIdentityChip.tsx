import React from "react";
import { Monitor } from "lucide-react";

export interface CounterIdentityChipProps {
  counterName?: string | null;
  counterCode?: string | null;
  fallbackName?: string;
}

/**
 * The till's own identity. When no counter has been assigned, the chip must say
 * so: borrowing another counter's code makes a C02 machine claim to be C01.
 */
export const CounterIdentityChip: React.FC<CounterIdentityChipProps> = ({
  counterName,
  counterCode,
  fallbackName = "Counter",
}) => {
  const name = counterName?.trim() || fallbackName;
  const code = counterCode?.trim().toUpperCase();

  return (
    <div
      title={
        code
          ? "This counter's screens are set by the store owner"
          : "This till has no counter code yet — ask the store owner to assign one"
      }
      className="flex items-center gap-1.5 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] px-3 py-1 shadow-2xs"
    >
      <Monitor className="h-3.5 w-3.5 text-[var(--color-accent)]" />
      <span className="whitespace-nowrap font-bold text-[var(--color-text)]">{name}</span>
      {code ? (
        <span className="text-[10px] font-mono bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-bold px-1.5 py-0.2 rounded-full uppercase">
          {code}
        </span>
      ) : (
        <span className="text-[10px] font-mono bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)] font-bold px-1.5 py-0.2 rounded-full uppercase">
          No counter code
        </span>
      )}
    </div>
  );
};

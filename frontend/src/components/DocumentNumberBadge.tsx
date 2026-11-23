import React from "react";

export interface DocumentNumberBadgeProps {
  savedNumber?: string | null;
  nextNumber?: string | null;
  label?: string;
}

/**
 * The number on the printed paper is the number that was saved. The counter's
 * preview of the next number is a hint for the following bill, never the bill
 * in hand — showing only the preview makes the till read one number ahead.
 */
export const DocumentNumberBadge: React.FC<DocumentNumberBadgeProps> = ({
  savedNumber,
  nextNumber,
  label = "Invoice No",
}) => {
  const saved = savedNumber?.trim();
  const next = nextNumber?.trim();

  return (
    <div className="leading-tight">
      <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
        {label}
      </span>
      {saved ? (
        <p
          className="text-xs font-bold font-mono text-[var(--color-accent)]"
          title="The number saved on the last bill from this till"
        >
          {saved}
        </p>
      ) : (
        <p className="text-xs font-mono text-[var(--color-text-muted)]" title="No bill has been saved from this till yet">
          &mdash;
        </p>
      )}
      {next && (
        <p className="text-[10px] font-mono text-[var(--color-text-faint)]" title="The number this till will use next">
          Next: {next}
        </p>
      )}
    </div>
  );
};

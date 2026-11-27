import React, { useEffect, useState } from "react";
import { X, Loader2, AlertCircle, Copy, Check } from "lucide-react";
import { api } from "../services/api";
import { formatINR } from "../utils/formatters";

export interface InspectorField {
  label: string;
  value?: React.ReactNode;
  money?: boolean;
  mono?: boolean;
  strong?: boolean;
  /** Credit-side amounts read red, money received reads green. */
  tone?: "default" | "credit" | "received";
}

export interface InspectorColumn {
  key?: string;
  label: string;
  align?: "left" | "right" | "center";
  money?: boolean;
  mono?: boolean;
  render?: (line: any) => React.ReactNode;
}

interface RecordInspectorProps {
  /** The document type, shown above the number: "Sales Return / Credit Note". */
  kind: string;
  /** The reference the operator reads first: bill number, cart token, shift id. */
  heading: string;
  subheading?: string;
  /** Full record endpoint. The list row renders immediately and is replaced on load. */
  endpoint?: string;
  row?: any;
  lineKey?: string;
  columns?: InspectorColumn[];
  linesEmpty?: string;
  fields: (record: any) => InspectorField[];
  totals?: (record: any) => InspectorField[];
  note?: string;
  onClose: () => void;
}

const Field: React.FC<{ field: InspectorField }> = ({ field }) => {
  const classes = [
    field.mono || field.money ? "font-mono" : "",
    field.strong ? "font-bold" : "font-semibold",
    field.tone === "credit"
      ? "text-red-600 dark:text-red-400"
      : field.tone === "received"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-slate-900 dark:text-white",
  ].join(" ");

  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{field.label}</div>
      <div className={`text-xs truncate ${classes}`}>
        {field.money ? money(field.value) : display(field.value)}
      </div>
    </div>
  );
};

const display = (value: React.ReactNode) =>
  value === undefined || value === null || value === "" ? "—" : value;

/** An unset amount reads as "no amount stored", not as ₹0.00 — an empty MRP is not a free batch. */
const money = (value: unknown) =>
  value === undefined || value === null || value === "" ? "—" : formatINR(Number(value));

/**
 * Read-only record view for the lists that have no editor: what a credit note, a purchase bill,
 * a held cart or a shift actually contained, without leaving the table. A row the panel already
 * fetched renders straight away; an `endpoint` refills it with the server's own copy of the
 * document, including the lines the list query does not carry.
 */
export const RecordInspector: React.FC<RecordInspectorProps> = ({
  kind,
  heading,
  subheading,
  endpoint,
  row,
  lineKey = "items",
  columns = [],
  linesEmpty = "This document has no line items.",
  fields,
  totals,
  note,
  onClose,
}) => {
  const [record, setRecord] = useState<any>(row);
  const [isLoading, setIsLoading] = useState(Boolean(endpoint));
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!endpoint) {
      setRecord(row);
      setIsLoading(false);
      return undefined;
    }
    setIsLoading(true);
    setError("");
    api
      .get(endpoint)
      .then((res) => {
        if (!cancelled) setRecord({ ...(row || {}), ...(res || {}) });
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || "Could not load the full record.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  // A dotted lineKey reaches into a nested payload: a held cart stores its lines as cart_payload.items.
  const lines: any[] = (() => {
    let value: any = record;
    for (const part of lineKey.split(".")) value = value?.[part];
    return Array.isArray(value) ? value : [];
  })();

  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(heading);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the reference is on screen regardless.
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-slate-900/50 backdrop-blur-xs"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${kind} ${heading}`}
    >
      <div
        data-testid="record-inspector"
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{kind}</div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white font-mono break-all">{display(heading)}</h3>
            {subheading && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subheading}</div>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={copyReference}
              title="Copy reference"
              aria-label="Copy reference"
              className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              aria-label="Close"
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error} Showing the columns this list already carries.</span>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Loading record...</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {fields(record).map((field) => (
            <Field key={field.label} field={field} />
          ))}
        </div>

        {columns.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-[11px] text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 uppercase text-[9px] font-semibold">
                <tr>
                  {columns.map((col) => (
                    <th key={col.label} className={`px-3 py-2 ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-3 py-6 text-center text-slate-400">
                      {linesEmpty}
                    </td>
                  </tr>
                ) : (
                  lines.map((line, idx) => (
                    <tr key={line?.id ?? idx}>
                      {columns.map((col) => {
                        const value = col.render ? col.render(line) : line?.[col.key || ""];
                        return (
                          <td
                            key={col.label}
                            className={`px-3 py-2 ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""} ${
                              col.money || col.mono ? "font-mono" : ""
                            }`}
                          >
                            {col.money ? money(value) : display(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {totals && totals(record).length > 0 && (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 space-y-1.5">
            {totals(record).map((field) => (
              <div key={field.label} className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">{field.label}</span>
                <span
                  className={`font-mono ${field.strong ? "font-bold" : "font-semibold"} ${
                    field.tone === "credit"
                      ? "text-red-600 dark:text-red-400"
                      : field.tone === "received"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-slate-900 dark:text-white"
                  }`}
                >
                  {field.money ? money(field.value) : display(field.value)}
                </span>
              </div>
            ))}
          </div>
        )}

        {note && <p className="text-[11px] text-slate-500 dark:text-slate-400">{note}</p>}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

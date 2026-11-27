import React from "react";
import {
  DOCUMENT_SERIES,
  NUMBERING_SERIES,
  formatDocumentNumber,
  minWidthForSerial,
  readSeries,
  type DocumentSeries,
} from "../../lib/billing/documentNumberFormat";
import { counterSequenceService } from "../../lib/auth/counterSequenceService";
import type { DocumentSequenceConfig } from "../../lib/settings/companySettingsService";

interface SeriesPatch {
  prefix?: string;
  next?: number;
  suffix?: string;
  width?: string;
  padZeros?: boolean;
}

interface DocumentSequencesTabProps {
  sequences?: DocumentSequenceConfig;
  /** `legacy` carries the invoice shortcuts older parts of the till read alongside `sequences`. */
  onChange: (sequences: DocumentSequenceConfig, legacy: Record<string, string | number>) => void;
}

const inputClass =
  "mt-0.5 w-full rounded border border-slate-300 bg-white p-1.5 text-xs font-mono focus:border-blue-500 focus:outline-none";
const labelClass = "text-[10px] uppercase tracking-wide text-slate-500";

/**
 * The store's numbering rules, in the shape Tally operators expect: a prefix, a serial of a fixed
 * digit width that may be zero-filled, and an optional suffix. A series with no rule prints exactly
 * as it did before this screen existed, and a counter that holds its own series on the server prints
 * that series instead — which is why the live counter number is shown beside each card.
 */
export const DocumentSequencesTab: React.FC<DocumentSequencesTabProps> = ({ sequences, onChange }) => {
  const viewOf = (series: DocumentSeries) => {
    const read = readSeries(sequences, series);
    const minWidth = minWidthForSerial(read.next, read.rule.suffix);
    const width = read.rule.width ?? null;
    return {
      ...read,
      width,
      minWidth,
      preview: formatDocumentNumber({ ...read.rule, prefix: read.prefix }, read.next),
      tooNarrow: !!width && width < minWidth,
    };
  };

  const patch = (series: DocumentSeries, changes: SeriesPatch) => {
    const fields = NUMBERING_SERIES[series];
    const next: Record<string, any> = { ...(sequences || {}) };
    const numbering = { ...(next.numbering || {}) };
    const rule = { ...(numbering[series] || {}) };

    if (changes.prefix !== undefined) next[fields.prefixKey] = changes.prefix;
    if (changes.next !== undefined) next[fields.nextKey] = changes.next;
    if (changes.suffix !== undefined) rule.suffix = changes.suffix;
    if (changes.width !== undefined) rule.width = changes.width === "" ? null : Math.trunc(Number(changes.width)) || null;
    if (changes.padZeros !== undefined) rule.padZeros = changes.padZeros;

    numbering[series] = rule;
    next.numbering = numbering;

    const legacy: Record<string, string | number> = {};
    if (series === "invoice") {
      if (changes.prefix !== undefined) legacy.invoice_prefix = changes.prefix;
      if (changes.next !== undefined) legacy.next_invoice_number = changes.next;
    }

    onChange(next as DocumentSequenceConfig, legacy);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-sm font-bold text-slate-800">Document Prefix & Sequential Numbering</h2>
        <p className="text-xs text-slate-500">
          Numbers print as PREFIX-SERIAL then the suffix: the serial is the start number, zero-filled to the digit
          width when padding is on. Leading zeros belong in Digits, not in the start number. Bills already issued keep
          their numbers, and a counter with its own series on the server prints that series for its own bills.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-xs font-bold text-slate-800">Store numbering defaults</span>
          <span className="ml-2 text-[10px] text-slate-500">what this store prints, unless a counter overrides it</span>
        </div>
        <table className="w-full text-[11px]">
          <thead className="bg-slate-100/70 text-left text-slate-600">
            <tr>
              <th className="px-3 py-1.5 font-semibold">Series</th>
              <th className="px-3 py-1.5 font-semibold">Prefix</th>
              <th className="px-3 py-1.5 font-semibold">Suffix</th>
              <th className="px-3 py-1.5 text-right font-semibold">Start from</th>
              <th className="px-3 py-1.5 text-right font-semibold">Digits</th>
              <th className="px-3 py-1.5 font-semibold">Pad</th>
              <th className="px-3 py-1.5 font-semibold">Next number</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {DOCUMENT_SERIES.map((series) => {
              const view = viewOf(series);
              return (
                <tr key={series} className={view.tooNarrow ? "bg-amber-50" : undefined}>
                  <td className="px-3 py-1.5 font-semibold text-slate-700">{NUMBERING_SERIES[series].label}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-600">{view.prefix}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-600">{view.rule.suffix || "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">{view.next}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">{view.width ?? "—"}</td>
                  <td className="px-3 py-1.5 text-slate-600">{view.rule.padZeros ? "Yes" : "No"}</td>
                  <td className="px-3 py-1.5 font-mono font-bold text-blue-700">{view.preview}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {DOCUMENT_SERIES.map((series) => {
          const view = viewOf(series);
          const counterPreview = counterSequenceService.previewForActive(NUMBERING_SERIES[series].docType);

          return (
            <div key={series} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-slate-800">{NUMBERING_SERIES[series].label}</span>
                  {counterPreview && (
                    <p className="text-[10px] font-mono text-slate-500" title="This counter bills from its own series">
                      Counter series: {counterPreview}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 font-mono text-[11px] font-bold text-blue-700">
                  {view.preview}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <span className={labelClass}>Prefix</span>
                  <input
                    type="text"
                    value={view.prefix}
                    onChange={(e) => patch(series, { prefix: e.target.value.toUpperCase() })}
                    className={`${inputClass} uppercase`}
                  />
                </div>
                <div>
                  <span className={labelClass}>Suffix</span>
                  <input
                    type="text"
                    placeholder="optional"
                    value={view.rule.suffix || ""}
                    onChange={(e) => patch(series, { suffix: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <span className={labelClass}>Start from</span>
                  <input
                    type="number"
                    min="1"
                    value={view.next}
                    onChange={(e) => patch(series, { next: Math.trunc(Number(e.target.value)) || 1 })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <span className={labelClass}>Digits</span>
                  <input
                    type="number"
                    min="1"
                    placeholder="no padding"
                    value={view.width ?? ""}
                    onChange={(e) => patch(series, { width: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-600">
                <input
                  type="checkbox"
                  checked={!!view.rule.padZeros}
                  onChange={(e) => patch(series, { padZeros: e.target.checked })}
                />
                Pad the serial with zeros to {view.width ?? view.minWidth} digits
              </label>

              {view.tooNarrow && (
                <p className="mt-1 text-[10px] font-semibold text-red-600">
                  Width cannot be shorter than the serial already issued. Minimum is {view.minWidth}.
                </p>
              )}
              {!view.width && view.rule.padZeros && (
                <p className="mt-1 text-[10px] text-slate-500">
                  No width set, so the serial prints at its own length.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

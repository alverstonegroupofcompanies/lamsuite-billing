import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../../services/api";
import { formatINR } from "../../utils/formatters";
import type { OutstandingDocument, PaymentAllocationInput } from "../../types";

/**
 * PAY-05: a receipt that only moves the party's balance leaves the invoice it paid
 * reading "unpaid". This picker lets the operator name the bills the money settles;
 * leaving everything unchecked sends no allocations at all, and the server then
 * clears the oldest open bills by itself.
 */

interface AllocationPickerProps {
  storeId?: number | string;
  partyType: "customer" | "supplier";
  partyId?: string;
  /** The receipt amount as typed by the operator. */
  amount: string;
  onAllocationsChange: (allocations?: PaymentAllocationInput[]) => void;
}

const money = (value: unknown): number => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;

const keyOf = (doc: OutstandingDocument) => `${doc.document_type}:${doc.document_id}`;

export const AllocationPicker: React.FC<AllocationPickerProps> = ({
  storeId,
  partyType,
  partyId,
  amount,
  onAllocationsChange,
}) => {
  const [documents, setDocuments] = useState<OutstandingDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const changeRef = useRef(onAllocationsChange);

  useEffect(() => {
    changeRef.current = onAllocationsChange;
  }, [onAllocationsChange]);

  const receiptAmount = money(amount);

  useEffect(() => {
    let cancelled = false;
    setDocuments([]);
    setSelected({});
    setDrafts({});
    changeRef.current(undefined);

    if (!storeId || !partyId) return;
    setIsLoading(true);
    (async () => {
      try {
        const res = await api.get<{ data: OutstandingDocument[] }>("/admin/outstanding-documents", {
          store_id: storeId,
          party_type: partyType,
          party_id: partyId,
        });
        if (!cancelled) setDocuments(res.data || []);
      } catch (err) {
        console.error("Failed to load open documents:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storeId, partyType, partyId]);

  // Oldest open bill is filled first, and no line may exceed what the receipt
  // still has to give — so an over-typed amount clamps instead of 422-ing.
  const applied = useMemo(() => {
    let remaining = receiptAmount;
    const result: Record<string, number> = {};
    for (const doc of documents) {
      const key = keyOf(doc);
      if (!selected[key]) continue;
      const take = money(Math.max(0, Math.min(money(doc.outstanding), remaining, money(drafts[key] ?? doc.outstanding))));
      if (take <= 0) continue;
      result[key] = take;
      remaining = money(remaining - take);
    }
    return result;
  }, [documents, selected, drafts, receiptAmount]);

  const allocated = useMemo(
    () => money(Object.values(applied).reduce((sum, value) => sum + value, 0)),
    [applied]
  );

  useEffect(() => {
    const lines: PaymentAllocationInput[] = documents
      .filter((doc) => applied[keyOf(doc)] !== undefined)
      .map((doc) =>
        doc.document_type === "purchase"
          ? { purchase_id: doc.document_id, amount: applied[keyOf(doc)] }
          : { invoice_id: doc.document_id, amount: applied[keyOf(doc)] }
      );
    changeRef.current(lines.length > 0 ? lines : undefined);
  }, [applied, documents]);

  const toggle = (doc: OutstandingDocument, checked: boolean) => {
    const key = keyOf(doc);
    if (!checked) {
      setSelected((prev) => ({ ...prev, [key]: false }));
      return;
    }
    const others = money(allocated - (applied[key] ?? 0));
    const suggested = money(Math.max(0, Math.min(money(doc.outstanding), receiptAmount - others)));
    setSelected((prev) => ({ ...prev, [key]: true }));
    setDrafts((prev) => ({ ...prev, [key]: (prev[key] !== undefined ? money(prev[key]) : suggested).toFixed(2) }));
  };

  const clampOnBlur = (doc: OutstandingDocument) => {
    const key = keyOf(doc);
    const others = money(allocated - (applied[key] ?? 0));
    const max = money(Math.max(0, Math.min(money(doc.outstanding), receiptAmount - others)));
    setDrafts((prev) => ({ ...prev, [key]: money(Math.min(money(prev[key] ?? doc.outstanding), max)).toFixed(2) }));
  };

  const fillOldestFirst = () => {
    let remaining = receiptAmount;
    const nextSelected: Record<string, boolean> = {};
    const nextDrafts: Record<string, string> = {};
    for (const doc of documents) {
      const take = money(Math.min(money(doc.outstanding), remaining));
      if (take <= 0) break;
      const key = keyOf(doc);
      nextSelected[key] = true;
      nextDrafts[key] = take.toFixed(2);
      remaining = money(remaining - take);
    }
    setSelected(nextSelected);
    setDrafts(nextDrafts);
  };

  const clearAll = () => {
    setSelected({});
    setDrafts({});
  };

  const unallocated = money(receiptAmount - allocated);

  if (!storeId) {
    return (
      <p className="text-[11px] text-slate-400">
        Select a store to see this {partyType}'s open bills.
      </p>
    );
  }

  return (
    <div
      data-testid="allocation-picker"
      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <label className="font-semibold text-slate-700 dark:text-slate-300">
          {partyType === "customer" ? "Which bills does this receipt settle?" : "Which purchase bills does this payment settle?"}
        </label>
        <div className="flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={fillOldestFirst}
            disabled={isLoading || documents.length === 0 || receiptAmount <= 0}
            className="px-2 py-1 rounded-lg text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            Fill oldest first
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={isLoading || allocated === 0}
            className="px-2 py-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>

      {isLoading && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading open bills…
        </p>
      )}

      {!isLoading && documents.length === 0 && (
        <p className="text-[11px] text-slate-400">
          No open bills for this {partyType}. The money will only move their balance.
        </p>
      )}

      {documents.map((doc) => {
        const key = keyOf(doc);
        const isOn = Boolean(selected[key]);
        const take = applied[key];
        return (
          <div
            key={key}
            data-testid={`allocation-row-${key}`}
            className="flex items-center gap-2 text-[11px]"
          >
            <input
              type="checkbox"
              checked={isOn}
              onChange={(e) => toggle(doc, e.target.checked)}
              className="w-3.5 h-3.5"
            />
            <span className="font-semibold text-slate-700 dark:text-slate-300">{doc.document_number}</span>
            {doc.document_date && <span className="text-slate-400">{doc.document_date}</span>}
            <span className="ml-auto font-mono text-slate-500 dark:text-slate-400">
              open {formatINR(doc.outstanding)}
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={drafts[key] ?? money(doc.outstanding).toFixed(2)}
              disabled={!isOn}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
              onBlur={() => clampOnBlur(doc)}
              className="w-24 px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono disabled:opacity-50"
            />
            {isOn && take !== undefined && (
              <span className="w-16 text-right font-mono text-emerald-600 dark:text-emerald-400">
                {formatINR(take)}
              </span>
            )}
          </div>
        );
      })}

      <p className="text-[11px] text-slate-400">
        {allocated > 0 ? (
          <>
            Allocating <span className="font-mono">{formatINR(allocated)}</span>
            {unallocated > 0 ? (
              <>
                {" "}— <span className="font-mono">{formatINR(unallocated)}</span> stays on the account.
              </>
            ) : (
              <> in full.</>
            )}
          </>
        ) : (
          <>
            Leave these unchecked and the receipt clears the oldest open bills by itself.
          </>
        )}
      </p>
    </div>
  );
};

import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle, Plus, Trash2, X } from "lucide-react";
import { ModalLayer } from "../../lib/modal/CentralModalManager";
import { shortcutLabel } from "../../lib/keyboard/centralKeyMap";
import type { ChargeHeadMaster } from "../../lib/masters/chargeHeadsStore";
import type { TaxEngineDocumentTotals } from "../../lib/tax-engine/taxEngine";
import {
  PurchaseChargesKeyboardEngine,
  chargeCellText,
  type ChargeColumn,
  type ChargeDraftRow,
} from "../../lib/purchases/chargesGrid";

/**
 * CR-C / PUR-007 — the Alt+F grid where a supplier bill's extra costs are keyed.
 *
 * Every cell is reached with the arrows and set with Space or Enter, and what leaves here is the
 * row as the operator keyed it: the grid prices no rupee and decides no treatment, it only refuses
 * a row this store's own heads could not post (rule R12). The parent re-prices the rows through
 * `resolveCharges` and the shared tax engine, and the totals underneath show that engine's answer
 * for the bill as it will be posted.
 */

export interface PurchaseChargesModalProps {
  isOpen: boolean;
  /** This store's charge heads — the grid offers these and no others. */
  heads: ChargeHeadMaster[];
  rows: ChargeDraftRow[];
  placeOfSupply?: string | null;
  /** The parent's engine totals for the bill with these charges, so the grid never re-prices. */
  totals?: TaxEngineDocumentTotals | null;
  onClose: () => void;
  onApply: (rows: ChargeDraftRow[]) => void;
}

const WIDTHS: Record<ChargeColumn, string> = {
  head_code: "min-w-[112px]",
  amount: "w-[104px]",
  gst_percent: "w-[78px]",
  treatment: "min-w-[104px]",
  spread_method: "min-w-[96px]",
  itc_eligibility: "min-w-[104px]",
  is_rcm: "w-[64px]",
  paid_separately: "w-[104px]",
  paid_to_label: "min-w-[130px]",
  note: "min-w-[170px]",
};

const rupees = (value: number): string => `₹${(Number(value) || 0).toFixed(2)}`;

export const PurchaseChargesModal: React.FC<PurchaseChargesModalProps> = ({
  isOpen,
  heads,
  rows,
  placeOfSupply,
  totals,
  onClose,
  onApply,
}) => {
  const engineRef = useRef(
    new PurchaseChargesKeyboardEngine({ heads, rows, placeOfSupply })
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const engine = engineRef.current;

  // Opening rebuilds the grid from the bill's own rows, so a cancelled session can't leak into the
  // next. Heads, rows and place of supply are read once per opening on purpose: re-building the grid
  // mid-keystroke would move the caret out from under the operator.
  useEffect(() => {
    if (!isOpen) return;
    const next = new PurchaseChargesKeyboardEngine({ heads, rows, placeOfSupply });
    if (!next.rows.length) next.addRow();
    engineRef.current = next;
    bump();
  }, [isOpen]);

  // Keep DOM focus on the engine's active cell, including edit mode.
  useEffect(() => {
    if (!isOpen) return;
    const active = engineRef.current;
    const selector =
      active.editing && active.activeRowIndex !== null
        ? `[data-cell-edit="${active.activeRowIndex}-${active.activeColumn}"]`
        : active.activeRowIndex !== null
        ? `[data-cell="${active.activeRowIndex}-${active.activeColumn}"]`
        : `[data-cell-entry="true"]`;
    containerRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  const problems = engine.errors();

  const apply = () => {
    if (engine.errors().length) {
      bump();
      return;
    }
    onApply(engine.rows);
  };

  const selectCell = (rowIndex: number, column: ChargeColumn) => {
    engine.activeRowIndex = rowIndex;
    engine.activeColumn = column;
    engine.commitEdit();
    bump();
  };

  const editor = (row: ChargeDraftRow, rowIndex: number, column: ChargeColumn) => {
    const common =
      "w-full rounded border border-accent bg-surface px-1.5 py-1 text-xs text-text-main focus:outline-none";
    const value = column === "amount" ? row.amount ?? "" : column === "gst_percent" ? row.gst_percent : row[column as "paid_to_label" | "note"];

    return (
      <input
        data-cell-edit={`${rowIndex}-${column}`}
        type={column === "amount" || column === "gst_percent" ? "number" : "text"}
        step={column === "amount" ? "0.01" : "any"}
        value={value as string | number}
        onChange={(event) => {
          engine.setCellValue(event.target.value);
          bump();
        }}
        onBlur={() => {
          engine.commitEdit();
          bump();
        }}
        className={`${common} ${column === "amount" ? "text-right font-mono tabular-nums" : ""}`}
      />
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const result = engine.handleKeyDown(event.key, {
      ctrlOrCmd: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
    });
    if (!result.handled) return;
    event.preventDefault();
    event.stopPropagation();

    if (result.action === "apply") {
      apply();
      return;
    }
    if (result.action === "close") {
      onClose();
      return;
    }
    bump();
  };

  const posting = engine.filledRows.length;

  // CR-C-11 / PUR-016: money handed to a courier can be both a separate payment and part of what
  // the supplier is owed, so the footer names the two facts apart instead of letting one imply the
  // other. `separate_charge_total` is the money the policy left outside the bill; this is the money
  // it pulled in, which still reads as paid separately.
  const separateInPayable = (totals?.charges || [])
    .filter((charge) => charge.paid_separately && charge.in_payable)
    .reduce((sum, charge) => sum + (Number(charge.total_amount) || 0), 0);

  return (
    <ModalLayer isOpen={isOpen} onClose={onClose} ariaLabel="Supplier bill charges">
      <div
        ref={containerRef}
        onKeyDown={handleKeyDown}
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-card border border-border-main bg-surface shadow-modal"
      >
        <div className="flex items-start justify-between border-b border-border-main bg-canvas px-5 py-3.5">
          <div>
            <h3 className="text-sm font-bold text-text-main">Supplier Bill Charges</h3>
            <p className="text-[11px] text-text-muted">
              Freight, loading, insurance — anything the supplier billed besides the goods.{" "}
              <kbd className="rounded border border-border-main bg-surface px-1 font-mono text-[10px]">
                {shortcutLabel("chargeCycleCell", "modal")}
              </kbd>{" "}
              cycles a cell,{" "}
              <kbd className="rounded border border-border-main bg-surface px-1 font-mono text-[10px]">
                {shortcutLabel("chargeEditCell", "modal")}
              </kbd>{" "}
              types it,{" "}
              <kbd className="rounded border border-border-main bg-surface px-1 font-mono text-[10px]">
                ↑↓←→
              </kbd>{" "}
              moves.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-main">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-border-main bg-canvas text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              <tr>
                <th className="w-10 px-2 py-2 text-center">#</th>
                {engine.columns.map((column) => (
                  <th key={column.key} className={`px-2 py-2 ${WIDTHS[column.key]}`} title={column.hint}>
                    {column.label}
                  </th>
                ))}
                <th className="w-16 px-2 py-2 text-center">Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-main">
              {engine.rows.length === 0 ? (
                <tr>
                  <td colSpan={engine.columns.length + 2} className="py-10 text-center text-text-muted">
                    Press{" "}
                    <kbd className="rounded border border-border-main bg-canvas px-1 font-mono">
                      {shortcutLabel("chargeAddRow", "modal")}
                    </kbd>{" "}
                    to add the first charge.
                  </td>
                </tr>
              ) : (
                engine.rows.map((row, rowIndex) => (
                  <tr key={row.external_id || rowIndex}>
                    <td className="px-2 py-1.5 text-center font-mono text-[10px] text-text-muted">{rowIndex + 1}</td>
                    {engine.columns.map((column) => {
                      const isActive = engine.activeRowIndex === rowIndex && engine.activeColumn === column.key;
                      const isEditing = isActive && engine.editing && column.kind !== "cycle";
                      const head = column.key === "head_code" ? engine.findHead(row.head_code) : null;
                      return (
                        <td key={column.key} className="px-1 py-1">
                          {isEditing ? (
                            editor(row, rowIndex, column.key)
                          ) : (
                            <div
                              data-cell={`${rowIndex}-${column.key}`}
                              tabIndex={0}
                              onClick={() => {
                                engine.activeRowIndex = rowIndex;
                                engine.activeColumn = column.key;
                                bump();
                              }}
                              onDoubleClick={() => {
                                selectCell(rowIndex, column.key);
                                engine.startEdit();
                                bump();
                              }}
                              title={head ? `${head.name} · SAC ${head.sac_code || "—"}` : column.hint}
                              className={`truncate rounded px-1.5 py-1 ${
                                isActive ? "bg-accent-soft ring-1 ring-accent" : ""
                              } ${
                                column.kind === "cycle" ? "cursor-pointer text-text-main" : "text-text-main"
                              } ${
                                column.key === "amount" || column.key === "gst_percent"
                                  ? "text-right font-mono tabular-nums"
                                  : ""
                              }`}
                            >
                              {chargeCellText(row, column.key) || "—"}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          engine.activeRowIndex = rowIndex;
                          engine.deleteActiveRow();
                          bump();
                        }}
                        className="rounded p-1 text-text-muted hover:bg-status-danger/10 hover:text-status-danger"
                        title={shortcutLabel("chargeDeleteRow", "modal")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <button
            type="button"
            data-cell-entry="true"
            onClick={() => {
              engine.addRow();
              bump();
            }}
            className="m-3 flex items-center gap-1.5 rounded-btn border border-dashed border-border-main px-3 py-1.5 text-xs font-medium text-text-muted hover:border-accent hover:text-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add charge</span>
            <kbd className="rounded border border-border-main bg-canvas px-1 text-[10px] font-bold">
              {shortcutLabel("chargeAddRow", "modal")}
            </kbd>
          </button>
        </div>

        {problems.length > 0 && (
          <div className="border-t border-status-danger/20 bg-status-danger/5 px-5 py-2 text-[11px] text-status-danger">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>Fix these before applying</span>
            </div>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {problems.slice(0, 6).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        <div
          data-charge-summary="true"
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border-main bg-canvas px-5 py-3 text-[11px] text-text-muted"
        >
          <div className="flex flex-wrap items-center gap-4">
            <span>
              Charges <strong className="font-mono text-text-main tabular-nums">{rupees(totals?.charge_total || 0)}</strong>
              {separateInPayable > 0.004 ? (
                <span
                  className="ml-1"
                  title="This store bills separately-paid charges into the supplier payable"
                >
                  incl. {rupees(separateInPayable)} paid separately
                </span>
              ) : null}
              {totals && totals.separate_charge_total > 0.004 ? (
                <span className="ml-1" title="Paid to someone other than the supplier, so not in the payable">
                  + {rupees(totals.separate_charge_total)} paid separately outside the bill
                </span>
              ) : null}
            </span>
            <span title="What the supplier is owed after these charges">
              Payable{" "}
              <strong className="font-mono text-text-main tabular-nums">{rupees(totals?.grand_total || 0)}</strong>
            </span>
            <span>
              In stock cost <strong className="font-mono text-text-main tabular-nums">{rupees(totals?.landed_cost_addition || 0)}</strong>
            </span>
            <span>
              To expense <strong className="font-mono text-text-main tabular-nums">{rupees(totals?.expense_charge_total || 0)}</strong>
            </span>
            <span>
              Creditable ITC{" "}
              <strong className="font-mono text-text-main tabular-nums">{rupees(totals?.creditable_input_tax_total || 0)}</strong>
            </span>
            <span className="hidden xl:inline">
              {posting} of {engine.rows.length} rows will post ·{" "}
              <kbd className="rounded border border-border-main bg-surface px-1 font-mono">
                {shortcutLabel("chargeApply", "modal")}
              </kbd>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-btn border border-border-main bg-surface px-3.5 py-2 text-xs font-medium text-text-main hover:bg-canvas"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={problems.length > 0}
              className="flex items-center gap-1.5 rounded-btn bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent/90 disabled:opacity-50"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              <span>Apply charges</span>
              <kbd className="rounded border border-white/30 px-1 text-[10px] font-bold">
                {shortcutLabel("chargeApply", "modal")}
              </kbd>
            </button>
          </div>
        </div>
      </div>
    </ModalLayer>
  );
};

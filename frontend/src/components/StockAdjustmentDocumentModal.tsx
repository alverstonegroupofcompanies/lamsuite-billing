import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle, FileSpreadsheet, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { ModalLayer } from "../lib/modal/CentralModalManager";
import { shortcutLabel } from "../lib/keyboard/centralKeyMap";
import type { ProductBatch, ProductItem } from "../lib/masters/productsStore";
import { formatExpiryDisplay } from "../lib/masters/productsStore";
import {
  STOCK_ADJUSTMENT_REASONS,
  StockAdjustmentPolicyError,
  getStockAdjustmentPolicy,
  parseStockAdjustmentCsv,
  postStockAdjustment,
  type CsvImportResult,
  type StockAdjustmentDocumentInput,
  type StockAdjustmentPostResult,
  type StockAdjustmentReason,
} from "../lib/stock/stockAdjustmentService";
import {
  StockAdjustmentKeyboardEngine,
  type StockAdjustmentColumn,
  type StockAdjustmentRow,
} from "../lib/stock/stockAdjustmentKeyboard";

export interface StockAdjustmentDocumentModalProps {
  isOpen: boolean;
  batches: ProductBatch[];
  products: Record<string, ProductItem>;
  onClose: () => void;
  onPosted: (result: StockAdjustmentPostResult) => void;
}

const NUMERIC_COLUMNS: StockAdjustmentColumn[] = ["counted_qty", "adjustment_qty", "unit_cost"];
const WIDTHS: Record<StockAdjustmentColumn, string> = {
  product_name: "min-w-[190px]",
  batch_no: "min-w-[130px]",
  system_qty: "w-[86px] text-right",
  counted_qty: "w-[96px] text-right",
  adjustment_qty: "w-[110px] text-right",
  reason: "min-w-[140px]",
  unit_cost: "w-[104px] text-right",
  notes: "min-w-[180px]",
};

const emptyRow = (mode: "adjustment" | "physical_count"): StockAdjustmentRow => ({
  product_id: "",
  batch_id: "",
  reason: mode === "physical_count" ? "Physical Count" : "Other",
});

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Keyboard-first, multi-line stock adjustment document. A document posts one
 * ledger entry per line and respects the store policy shared by the desktop,
 * admin panel and sync workers.
 */
export const StockAdjustmentDocumentModal: React.FC<StockAdjustmentDocumentModalProps> = ({
  isOpen,
  batches,
  products,
  onClose,
  onPosted,
}) => {
  const engineRef = useRef(new StockAdjustmentKeyboardEngine({ mode: "adjustment" }));
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const [notes, setNotes] = useState("");
  const [documentDate, setDocumentDate] = useState(today());
  const [errors, setErrors] = useState<string[]>([]);
  const [lineErrors, setLineErrors] = useState<Record<number, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvResult, setCsvResult] = useState<CsvImportResult | null>(null);

  const engine = engineRef.current;
  const policy = useMemo(() => getStockAdjustmentPolicy(), [isOpen]);
  const productList = useMemo(() => Object.values(products), [products]);
  const productsWithBatches = useMemo(() => {
    const ids = new Set(batches.map((batch) => String(batch.product_id)));
    return productList.filter((product) => ids.has(String(product.id)));
  }, [batches, productList]);

  useEffect(() => {
    if (!isOpen) return;
    const next = new StockAdjustmentKeyboardEngine({ mode: "adjustment" });
    next.addRow(emptyRow("adjustment"));
    engineRef.current = next;
    setNotes("");
    setDocumentDate(today());
    setErrors([]);
    setLineErrors({});
    setIsSubmitting(false);
    setCsvOpen(false);
    setCsvText("");
    setCsvResult(null);
    bump();
  }, [isOpen]);

  // Keep DOM focus on the engine's active cell, including edit mode.
  useEffect(() => {
    if (!isOpen || csvOpen) return;
    const active = engineRef.current;
    const selector =
      active.editing && active.activeRowIndex !== null
        ? `[data-cell-edit="${active.activeRowIndex}-${active.activeColumn}"]`
        : active.activeRowIndex !== null
        ? `[data-cell="${active.activeRowIndex}-${active.activeColumn}"]`
        : `[data-cell-entry="true"]`;
    const target = containerRef.current?.querySelector<HTMLElement>(selector);
    target?.focus();
  });

  const batchesFor = (row: StockAdjustmentRow | undefined): ProductBatch[] => {
    if (!row) return [];
    const scoped = row.product_id
      ? batches.filter((batch) => String(batch.product_id) === String(row.product_id))
      : batches;
    return [...scoped].sort((a, b) => (a.expiry_date || "").localeCompare(b.expiry_date || ""));
  };

  const chooseProduct = (rowIndex: number, productId: string) => {
    const row = engine.rows[rowIndex];
    if (!row) return;
    const product = products[productId];
    const firstBatch = batches.find((batch) => String(batch.product_id) === String(productId));
    Object.assign(row, {
      product_id: productId,
      product_name: product?.name || "",
      batch_id: firstBatch?.id || "",
      batch_no: firstBatch?.batch_no || "",
      system_qty: Number(firstBatch?.stock_qty || 0),
      unit_cost: Number(row.unit_cost ?? firstBatch?.purchase_rate ?? 0),
    });
    engine.commitEdit();
    engine.activeColumn = "batch_no";
    bump();
  };

  const chooseBatch = (rowIndex: number, batchId: string) => {
    const row = engine.rows[rowIndex];
    const batch = batches.find((candidate) => candidate.id === batchId);
    if (!row || !batch) {
      engine.commitEdit();
      bump();
      return;
    }
    Object.assign(row, {
      product_id: String(batch.product_id),
      product_name: products[batch.product_id]?.name || row.product_name || "",
      batch_id: batch.id,
      batch_no: batch.batch_no,
      system_qty: Number(batch.stock_qty || 0),
      unit_cost: Number(row.unit_cost ?? batch.purchase_rate ?? 0),
    });
    engine.commitEdit();
    engine.activeColumn = engine.mode === "physical_count" ? "counted_qty" : "adjustment_qty";
    bump();
  };

  const renderEditor = (row: StockAdjustmentRow, rowIndex: number, column: StockAdjustmentColumn) => {
    const commonClass =
      "w-full rounded border border-accent bg-surface px-1.5 py-1 text-xs text-text-main focus:outline-none";

    if (column === "product_name") {
      return (
        <select
          data-cell-edit={`${rowIndex}-${column}`}
          value={row.product_id}
          onChange={(event) => chooseProduct(rowIndex, event.target.value)}
          className={commonClass}
        >
          <option value="">Select product…</option>
          {productsWithBatches.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      );
    }

    if (column === "batch_no") {
      return (
        <select
          data-cell-edit={`${rowIndex}-${column}`}
          value={row.batch_id}
          onChange={(event) => chooseBatch(rowIndex, event.target.value)}
          className={commonClass}
        >
          <option value="">Select batch…</option>
          {batchesFor(row).map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.batch_no} · {formatExpiryDisplay(batch.expiry_date)} · {batch.stock_qty}
            </option>
          ))}
        </select>
      );
    }

    if (column === "reason") {
      return (
        <select
          data-cell-edit={`${rowIndex}-${column}`}
          value={String(row.reason || "Other")}
          onChange={(event) => {
            row.reason = event.target.value as StockAdjustmentReason;
            engine.commitEdit();
            bump();
          }}
          className={commonClass}
        >
          {STOCK_ADJUSTMENT_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {reason}
            </option>
          ))}
        </select>
      );
    }

    const numeric = NUMERIC_COLUMNS.includes(column);
    const value =
      column === "counted_qty"
        ? row.counted_qty ?? ""
        : column === "adjustment_qty"
        ? row.adjustment_qty ?? ""
        : column === "unit_cost"
        ? row.unit_cost ?? ""
        : row.notes ?? "";

    return (
      <input
        data-cell-edit={`${rowIndex}-${column}`}
        type={numeric ? "number" : "text"}
        step={numeric ? "any" : undefined}
        value={value as string | number}
        onChange={(event) => {
          const raw = event.target.value;
          engine.setCellValue(numeric ? (raw === "" ? null : Number(raw)) : raw);
          bump();
        }}
        onBlur={() => {
          engine.commitEdit();
          bump();
        }}
        className={commonClass}
      />
    );
  };

  const cellValue = (row: StockAdjustmentRow, column: StockAdjustmentColumn): string => {
    switch (column) {
      case "product_name":
        return row.product_name || "—";
      case "batch_no":
        return row.batch_no || "—";
      case "system_qty":
        return String(Number(row.system_qty || 0));
      case "counted_qty":
        return row.counted_qty === null || row.counted_qty === undefined ? "—" : String(row.counted_qty);
      case "adjustment_qty":
        return String(engine.effectiveAdjustmentQty(row));
      case "reason":
        return String(row.reason || "—");
      case "unit_cost":
        return Number(row.unit_cost || 0).toFixed(2);
      case "notes":
        return row.notes || "—";
    }
  };

  const preview = useMemo(() => {
    let totalQty = 0;
    let totalValue = 0;
    for (const row of engine.rows) {
      const delta = engine.effectiveAdjustmentQty(row);
      totalQty += Math.abs(delta);
      totalValue += Math.abs(delta) * Number(row.unit_cost || 0);
    }
    return { totalQty: Number(totalQty.toFixed(3)), totalValue: Number(totalValue.toFixed(2)) };
  }, [engine, engine.rows.length, engine.mode, engine.rows.map((row) => `${row.counted_qty}:${row.adjustment_qty}:${row.unit_cost}`).join("|")]);

  const requestClose = (): boolean => {
    // Returning false keeps the modal's Escape handler registered for the next press.
    if (engine.editing) {
      engine.cancelEdit();
      bump();
      return false;
    }
    if (csvOpen) {
      setCsvOpen(false);
      return false;
    }
    onClose();
    return true;
  };

  const runCsvPreview = (text: string) => {
    setCsvText(text);
    if (!text.trim()) {
      setCsvResult(null);
      return;
    }
    setCsvResult(parseStockAdjustmentCsv(text, batches, productList, engine.mode));
  };

  const applyCsvRows = () => {
    if (!csvResult || csvResult.validLines.length === 0) return;
    engine.replaceRows(
      csvResult.validLines.map((line) => ({
        ...line,
        reason: line.reason || (engine.mode === "physical_count" ? "Physical Count" : "Other"),
      }))
    );
    setCsvOpen(false);
    setErrors([]);
    setLineErrors({});
    bump();
  };

  const handlePost = async () => {
    if (isSubmitting) return;
    setErrors([]);
    setLineErrors({});
    setIsSubmitting(true);

    const lines = engine.rows.filter((row) => row.batch_id || row.product_id);
    const document: StockAdjustmentDocumentInput = {
      mode: engine.mode,
      notes,
      document_date: documentDate,
      lines,
    };

    try {
      const result = await postStockAdjustment(document, { policy });
      onPosted(result);
    } catch (error) {
      if (error instanceof StockAdjustmentPolicyError) {
        setErrors(error.errors.slice(0, 6));
        setLineErrors(error.lineErrors);
      } else {
        setErrors([error instanceof Error ? error.message : "Unable to post the stock adjustment."]);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (csvOpen) return;
    const result = engine.handleKeyDown(event.key, {
      ctrlOrCmd: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
    });
    if (!result.handled) return;
    event.preventDefault();
    event.stopPropagation();

    if (result.action === "post") {
      void handlePost();
    } else if (result.action === "import_csv") {
      setCsvOpen(true);
    }
    bump();
  };

  const modeLabel = engine.mode === "physical_count" ? "Physical Count" : "Adjustment";

  return (
    <ModalLayer isOpen={isOpen} onClose={requestClose} ariaLabel="Stock adjustment document">
      <div
        ref={containerRef}
        onKeyDown={handleKeyDown}
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-card border border-border-main bg-surface shadow-modal"
      >
        <div className="flex items-center justify-between border-b border-border-main bg-canvas px-5 py-3.5">
          <div>
            <h3 className="text-sm font-bold text-text-main">Stock Adjustment Document</h3>
            <p className="text-[11px] text-text-muted">
              One ledger entry per line. {policy.allow_negative_stock ? "Negative stock allowed by policy." : "Negative stock is blocked."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                engine.toggleMode();
                bump();
              }}
              className="flex items-center gap-1.5 rounded-btn border border-border-main bg-surface px-3 py-1.5 text-xs font-medium text-text-main hover:bg-canvas"
              title={shortcutLabel("toggleAdjustmentMode", "stock")}
            >
              <RotateCcw className="h-3.5 w-3.5 text-status-warning" />
              <span>{modeLabel}</span>
              <kbd className="rounded border border-border-main bg-canvas px-1 text-[10px] font-bold text-text-muted">
                {shortcutLabel("toggleAdjustmentMode", "stock")}
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => setCsvOpen(true)}
              className="flex items-center gap-1.5 rounded-btn border border-border-main bg-surface px-3 py-1.5 text-xs font-medium text-text-main hover:bg-canvas"
              title={shortcutLabel("importAdjustmentCsv", "stock")}
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Import CSV</span>
              <kbd className="rounded border border-border-main bg-canvas px-1 text-[10px] font-bold text-text-muted">
                {shortcutLabel("importAdjustmentCsv", "stock")}
              </kbd>
            </button>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className="text-text-muted hover:text-text-main"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 border-b border-border-main px-5 py-2.5">
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
            Document Date
            <input
              type="date"
              value={documentDate}
              onChange={(event) => setDocumentDate(event.target.value)}
              className="rounded-btn border border-border-main bg-surface px-2 py-1 text-xs text-text-main focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-1 items-center gap-1.5 text-[11px] font-medium text-text-muted">
            Notes
            <input
              type="text"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={policy.require_notes ? "Notes are required by store policy" : "Reason for this document"}
              className="min-w-0 flex-1 rounded-btn border border-border-main bg-surface px-2 py-1 text-xs text-text-main focus:border-accent focus:outline-none"
            />
          </label>
          <span className="text-[11px] font-mono text-text-muted tabular-nums">
            {engine.rows.length} line{engine.rows.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-border-main bg-canvas text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              <tr>
                <th className="w-10 px-2 py-2 text-center">#</th>
                {engine.columns.map((column) => (
                  <th key={column.key} className={`px-2 py-2 ${WIDTHS[column.key]}`}>
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
                    Press <kbd className="rounded border border-border-main bg-canvas px-1 font-mono">{shortcutLabel("addAdjustmentLine", "stock")}</kbd> to add the first line.
                  </td>
                </tr>
              ) : (
                engine.rows.map((row, rowIndex) => {
                  const rowErrors = lineErrors[rowIndex + 1];
                  return (
                    <React.Fragment key={rowIndex}>
                      <tr className={rowErrors ? "bg-status-danger/5" : "hover:bg-canvas/40"}>
                        <td className="px-2 py-1.5 text-center font-mono text-[10px] text-text-muted">{rowIndex + 1}</td>
                        {engine.columns.map((column) => {
                          const isActive = engine.activeRowIndex === rowIndex && engine.activeColumn === column.key;
                          const isEditing = isActive && engine.editing && column.editable;
                          return (
                            <td key={column.key} className="px-1 py-1">
                              {isEditing ? (
                                renderEditor(row, rowIndex, column.key)
                              ) : (
                                <div
                                  data-cell={`${rowIndex}-${column.key}`}
                                  tabIndex={column.editable ? 0 : -1}
                                  onDoubleClick={() => {
                                    engine.activeRowIndex = rowIndex;
                                    engine.activeColumn = column.key;
                                    engine.startEdit();
                                    bump();
                                  }}
                                  className={`truncate rounded px-1.5 py-1 ${
                                    isActive ? "bg-accent-soft ring-1 ring-accent" : ""
                                  } ${column.key === "system_qty" ? "text-text-muted" : "text-text-main"} ${
                                    NUMERIC_COLUMNS.includes(column.key) ? "font-mono tabular-nums" : ""
                                  }`}
                                >
                                  {cellValue(row, column.key)}
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
                            title={shortcutLabel("removeAdjustmentLine", "stock")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                      {rowErrors && (
                        <tr>
                          <td colSpan={engine.columns.length + 2} className="bg-status-danger/5 px-3 pb-1.5 text-[10px] text-status-danger">
                            {rowErrors.join(" · ")}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
          <button
            type="button"
            data-cell-entry="true"
            onClick={() => {
              engine.addRow(emptyRow(engine.mode));
              engine.editing = true;
              bump();
            }}
            className="m-3 flex items-center gap-1.5 rounded-btn border border-dashed border-border-main px-3 py-1.5 text-xs font-medium text-text-muted hover:border-accent hover:text-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add line</span>
            <kbd className="rounded border border-border-main bg-canvas px-1 text-[10px] font-bold">
              {shortcutLabel("addAdjustmentLine", "stock")}
            </kbd>
          </button>
        </div>

        {errors.length > 0 && (
          <div className="border-t border-status-danger/20 bg-status-danger/5 px-5 py-2 text-[11px] text-status-danger">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>Policy blocked this document</span>
            </div>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border-main bg-canvas px-5 py-3">
          <div className="flex items-center gap-4 text-[11px] text-text-muted">
            <span>
              Total qty <strong className="font-mono text-text-main tabular-nums">{preview.totalQty}</strong>
            </span>
            <span>
              Value <strong className="font-mono text-text-main tabular-nums">₹{preview.totalValue.toFixed(2)}</strong>
            </span>
            <span className="hidden lg:inline">
              Navigate <kbd className="rounded border border-border-main bg-surface px-1 font-mono">↑↓←→</kbd> · Edit{" "}
              <kbd className="rounded border border-border-main bg-surface px-1 font-mono">Enter</kbd> · Delete{" "}
              <kbd className="rounded border border-border-main bg-surface px-1 font-mono">{shortcutLabel("removeAdjustmentLine", "stock")}</kbd>
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={requestClose}
              className="rounded-btn border border-border-main bg-surface px-3.5 py-2 text-xs font-medium text-text-main hover:bg-canvas"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handlePost()}
              disabled={isSubmitting || engine.rows.length === 0}
              className="flex items-center gap-1.5 rounded-btn bg-status-warning px-4 py-2 text-xs font-semibold text-white shadow-xs hover:opacity-90 disabled:opacity-50"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              <span>{isSubmitting ? "Posting…" : "Post Adjustment"}</span>
              <kbd className="rounded border border-white/30 px-1 text-[10px] font-bold">
                {shortcutLabel("postStockAdjustment", "stock")}
              </kbd>
            </button>
          </div>
        </div>
      </div>

      <ModalLayer
        isOpen={csvOpen}
        onClose={() => setCsvOpen(false)}
        className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-4"
        ariaLabel="Import stock adjustment CSV"
      >
        <div className="w-full max-w-2xl overflow-hidden rounded-card border border-border-main bg-surface shadow-modal">
          <div className="flex items-center justify-between border-b border-border-main bg-canvas px-5 py-3.5">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-bold text-text-main">Import CSV / Spreadsheet Rows</h3>
            </div>
            <button type="button" onClick={() => setCsvOpen(false)} aria-label="Close" className="text-text-muted hover:text-text-main">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3 p-5">
            <p className="text-[11px] text-text-muted">
              Paste tab- or comma-separated rows with product/barcode, batch, {engine.mode === "physical_count" ? "counted quantity" : "adjustment quantity"},
              optional reason, notes and unit cost. Invalid rows are reported and never clamped.
            </p>
            <textarea
              value={csvText}
              onChange={(event) => runCsvPreview(event.target.value)}
              rows={8}
              placeholder={"Barcode,Batch,Counted,Reason,Notes\n8901001,B-01,95,Damaged,Broken strip"}
              className="w-full rounded-btn border border-border-main bg-surface px-3 py-2 font-mono text-[11px] text-text-main focus:border-accent focus:outline-none"
            />
            {csvResult && (
              <div className="space-y-2 text-[11px]">
                <div className="flex items-center gap-3">
                  <span className="text-text-muted">
                    Rows: <strong className="text-text-main">{csvResult.summary.totalRows}</strong>
                  </span>
                  <span className="text-accent">
                    Valid: <strong>{csvResult.summary.validCount}</strong>
                  </span>
                  <span className={csvResult.summary.invalidCount > 0 ? "text-status-danger" : "text-text-muted"}>
                    Invalid: <strong>{csvResult.summary.invalidCount}</strong>
                  </span>
                </div>
                {csvResult.invalidRows.length > 0 && (
                  <div className="max-h-36 overflow-auto rounded-btn border border-status-danger/20 bg-status-danger/5 p-2">
                    <ul className="space-y-0.5 text-status-danger">
                      {csvResult.invalidRows.map((row) => (
                        <li key={row.row}>
                          Row {row.row}: {row.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border-main bg-canvas px-5 py-3">
            <button
              type="button"
              onClick={() => setCsvOpen(false)}
              className="rounded-btn border border-border-main bg-surface px-3.5 py-2 text-xs font-medium text-text-main hover:bg-canvas"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyCsvRows}
              disabled={!csvResult || csvResult.validLines.length === 0}
              className="rounded-btn bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
            >
              Apply {csvResult?.validLines.length || 0} valid line{csvResult?.validLines.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </ModalLayer>
    </ModalLayer>
  );
};

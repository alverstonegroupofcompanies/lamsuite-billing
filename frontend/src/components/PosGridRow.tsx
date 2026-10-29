import React, { useState, useRef, useEffect } from "react";
import { Trash2, X, Check } from "lucide-react";
import { SmartQtyInput } from "./SmartQtyInput";
import { formatExpiryDisplay, calculateDerivedLooseRate } from "../lib/billing/unitConversion";
import type { PosCartLine } from "../lib/billing/posCartService";
import type { ColumnSetting } from "../lib/settings/companySettingsService";
import type { RateBasis } from "../lib/tax-engine/taxEngine";

export type PosRateBasis = "sel_rate" | "mrp" | "ptr" | "pts" | "ptss" | "loose_rate";

export interface PosGridRowProps {
  idx: number;
  line: PosCartLine | null;
  isDraft?: boolean;
  isJustAdded?: boolean;
  isSelected?: boolean;
  visibleCols: ColumnSetting[];
  doctorName?: string;

  // Search input props for draft row when no product is picked yet
  searchQuery?: string;
  onSearchChange?: (val: string) => void;
  onSearchFocus?: () => void;
  onSearchBlur?: (e: React.FocusEvent) => void;
  onSearchKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  isDropdownOpen?: boolean;

  // Callbacks
  onSelectRow?: () => void;
  onQtyChange?: (packs: number, loose: number) => void;
  onQtyEnter?: () => void;
  onRateChange?: (newPrice: number, basis: PosRateBasis) => void;
  onDiscountClick?: () => void;
  onEditProductBatch?: () => void;
  onEditConversion?: () => void;
  onClearDraft?: () => void;
  onCommitDraft?: () => void;
  onRemoveLine?: () => void;
}

export const PosGridRow: React.FC<PosGridRowProps> = ({
  idx,
  line,
  isDraft = false,
  isJustAdded = false,
  isSelected = false,
  visibleCols,
  doctorName = "",
  searchQuery = "",
  onSearchChange,
  onSearchFocus,
  onSearchBlur,
  onSearchKeyDown,
  searchInputRef,
  isDropdownOpen = false,
  onSelectRow,
  onQtyChange,
  onQtyEnter,
  onRateChange,
  onDiscountClick,
  onEditProductBatch,
  onEditConversion,
  onClearDraft,
  onCommitDraft,
  onRemoveLine,
}) => {
  const isWarningRow = Boolean(line && (line.selectedBatch?.stock_qty || 0) <= 0);

  // Inline rate editing state
  const [isEditingRate, setIsEditingRate] = useState(false);
  const [rateText, setRateText] = useState(line ? line.unit_price.toFixed(2) : "");
  const rateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (line) {
      setRateText(line.unit_price.toFixed(2));
    }
  }, [line?.unit_price]);

  useEffect(() => {
    if (isEditingRate) {
      rateInputRef.current?.focus();
      rateInputRef.current?.select();
    }
  }, [isEditingRate]);

  // Derived values for MRP & Rate
  const rawBatchMrp = Number(line?.selectedBatch?.mrp ?? line?.product?.mrp ?? 0);
  const unitsPerPack = line?.product?.units_per_pack || 1;
  const isLoose = line?.rate_basis === "loose_rate";
  const unitLabel = isLoose
    ? line?.product?.sub_unit_name || "pc"
    : line?.product?.unit_name || (unitsPerPack > 1 ? "Strip" : "pc");

  let applicableMrp = rawBatchMrp;
  if (line) {
    if (!isLoose && unitsPerPack > 1 && rawBatchMrp < line.unit_price && rawBatchMrp * unitsPerPack >= line.unit_price) {
      applicableMrp = rawBatchMrp * unitsPerPack;
    } else if (isLoose && unitsPerPack > 1 && rawBatchMrp > line.unit_price) {
      applicableMrp = Number((rawBatchMrp / unitsPerPack).toFixed(2));
    }
  }

  const isRateAboveMrp = Boolean(line && line.unit_price > applicableMrp + 0.01);

  // Row styling
  let rowClass = "transition-all cursor-pointer text-[var(--color-text)] ";
  if (isDraft) {
    rowClass += "bg-[var(--color-surface)] border-t border-dashed border-[var(--color-border)] hover:bg-[var(--color-surface)] ";
    if (isSelected) {
      rowClass += "ring-2 ring-inset ring-[var(--color-accent)] ";
    }
  } else if (isSelected) {
    rowClass += "bg-[var(--color-accent-soft)] ring-2 ring-inset ring-[var(--color-accent)] font-semibold shadow-2xs ";
  } else if (isWarningRow) {
    rowClass += "bg-[var(--color-warning-bg)]/40 hover:bg-[var(--color-warning-bg)]/70 ";
  } else {
    rowClass += "hover:bg-[var(--color-surface-hover)] ";
  }

  return (
    <tr
      id={isDraft ? "pos-inline-entry-row" : line ? `cart-row-${line.id}` : undefined}
      role="row"
      aria-selected={isSelected}
      onClick={onSelectRow}
      className={rowClass}
    >
      {visibleCols.map((col) => {
        switch (col.id) {
          case "idx":
            return (
              <td key="idx" className="px-3 py-2 text-center text-text-muted font-mono text-[11px]">
                {isDraft ? (
                  <span className="text-accent font-bold text-xs select-none">+</span>
                ) : (
                  idx + 1
                )}
              </td>
            );

          case "product_name":
            return (
              <td key="product_name" className="px-3 py-2 font-semibold text-text-main">
                {isDraft && !line ? (
                  <div className="relative w-full">
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => onSearchChange?.(e.target.value)}
                      onFocus={onSearchFocus}
                      onBlur={onSearchBlur}
                      onKeyDown={onSearchKeyDown}
                      placeholder="Scan barcode or type product name (e.g. 3*paracetamol)"
                      className="w-full rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all font-normal"
                      aria-label="Scan barcode or type product name"
                      aria-haspopup="listbox"
                      aria-expanded={isDropdownOpen}
                    />
                  </div>
                ) : line ? (
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold">{line.product.name}</span>

                      {/* Pack conversion chip */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditConversion?.();
                        }}
                        className={`inline-flex items-center gap-1 rounded-[6px] border px-1.5 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${
                          line.product.units_per_pack > 1
                            ? "border-accent-soft bg-accent-soft text-accent hover:opacity-90"
                            : "border-border-main bg-canvas text-text-muted hover:bg-surface"
                        }`}
                        title="Click or press Ctrl+E to adjust packaging & unit conversion"
                      >
                        <span>
                          {line.product.units_per_pack > 1
                            ? `1 ${line.product.unit_name || "pack"} = ${line.product.units_per_pack} ${line.product.sub_unit_name || "pcs"}`
                            : (line.product.unit_name || "pc")}
                        </span>
                        <span className="text-[9px] text-text-muted opacity-75">✏️</span>
                      </button>

                      {/* F4 Edit button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditProductBatch?.();
                        }}
                        className="inline-flex items-center gap-1 rounded-[6px] border border-border-main bg-canvas hover:bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-muted hover:text-accent transition-colors cursor-pointer"
                        title="Click or press F4 to edit product, batch, expiry & rate"
                      >
                        <span>Edit F4</span>
                        <span className="text-[9px] text-text-muted opacity-75">✏️</span>
                      </button>

                      {/* Clear / Cancel item button if in draft state or freshly added */}
                      {(isDraft || isJustAdded) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isDraft) {
                              onClearDraft?.();
                            } else {
                              onRemoveLine?.();
                            }
                          }}
                          className="inline-flex items-center gap-0.5 rounded-[6px] border border-border-main bg-canvas hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 px-1 py-0.5 text-[10px] text-text-muted transition-colors cursor-pointer"
                          title="Remove item (Esc)"
                        >
                          <X className="h-3 w-3" />
                          <span className="text-[9px] font-mono opacity-80">Esc</span>
                        </button>
                      )}

                      {/* Schedule prescription badges */}
                      {(line.product.schedule_type === "H" ||
                        line.product.schedule_type === "H1" ||
                        line.product.schedule_type === "X") && (
                        <span
                          className={`rounded-btn px-1.5 py-0.2 text-[10px] font-black border ${
                            doctorName.trim()
                              ? "bg-accent-soft text-accent border-accent/30"
                              : "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] border-[var(--color-danger-border)] animate-pulse"
                          }`}
                          title={
                            doctorName.trim()
                              ? `Prescription drug (Schedule ${line.product.schedule_type}) - Doctor recorded`
                              : `Schedule ${line.product.schedule_type}: Doctor details required by law!`
                          }
                        >
                          Rx Sch-{line.product.schedule_type} {!doctorName.trim() ? "⚠️" : ""}
                        </span>
                      )}
                    </div>

                    {/* Generic name / composition: exact same rendering in both states */}
                    {(line.product.generic_name || line.product.strength) && (
                      <div
                        className="text-[11px] font-normal text-text-muted truncate max-w-[280px]"
                        title={`${line.product.generic_name || ""} ${line.product.strength || ""}`.trim()}
                      >
                        {[line.product.generic_name, line.product.strength].filter(Boolean).join(" • ")}
                      </div>
                    )}

                    {line.isNegativeStock && (
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-[var(--color-warning-text)]">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-warning-text)] animate-pulse" />
                        {(line.availableStockSnapshot ?? 0) <= 0
                          ? "Stock 0 (Selling beyond available)"
                          : `Short by ${line.shortageQty || Math.max(1, line.qty - (line.availableStockSnapshot ?? 0))}`}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="opacity-40">-</span>
                )}
              </td>
            );

          case "batch_no":
            return (
              <td
                key="batch_no"
                className="px-3 py-2 font-mono text-[11px] text-text-muted"
                onClick={(e) => {
                  if (line) {
                    e.stopPropagation();
                    onEditProductBatch?.();
                  }
                }}
              >
                {line ? (
                  <button
                    type="button"
                    className="hover:underline hover:text-accent font-semibold flex items-center gap-1.5 cursor-pointer"
                    title="Click or press F4 to edit product & batch details"
                  >
                    <span>{line.selectedBatch.batch_no}</span>
                    <span className="text-[9px] text-text-muted opacity-75">✏️</span>
                  </button>
                ) : (
                  <span className="opacity-40">-</span>
                )}
              </td>
            );

          case "expiry_date":
            return (
              <td
                key="expiry_date"
                className="px-3 py-2 font-mono text-[11px] text-text-muted"
                onClick={(e) => {
                  if (line) {
                    e.stopPropagation();
                    onEditProductBatch?.();
                  }
                }}
              >
                {line ? (
                  <button
                    type="button"
                    className="hover:underline hover:text-accent font-semibold flex items-center gap-1.5 cursor-pointer"
                    title="Click or press F4 to edit product & batch details"
                  >
                    <span>{formatExpiryDisplay(line.selectedBatch.expiry_date)}</span>
                    <span className="text-[9px] text-text-muted opacity-75">✏️</span>
                  </button>
                ) : (
                  <span className="opacity-40">-</span>
                )}
              </td>
            );

          case "qty":
            return (
              <td key="qty" className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                {line ? (
                  <SmartQtyInput
                    inputId={isDraft ? "qty-input-draft" : `qty-input-${line.id}`}
                    packs={line.qty}
                    loose={line.loose_qty || 0}
                    unitsPerPack={line.product.units_per_pack || 1}
                    packName={line.product.unit_name || (line.product.units_per_pack > 1 ? "strip" : "pc")}
                    looseName={line.product.sub_unit_name || (line.product.units_per_pack > 1 ? "tabl" : "pc")}
                    allowLoose={line.product.allow_loose_sale ?? ((line.product.units_per_pack || 1) > 1)}
                    autoFocusPackOnMount={isDraft}
                    onFocusInput={onSelectRow}
                    onEnter={isDraft ? onCommitDraft : onQtyEnter}
                    onChange={(newPacks, newLoose) => onQtyChange?.(newPacks, newLoose)}
                  />
                ) : (
                  <span className="opacity-40">-</span>
                )}
              </td>
            );

          case "mrp":
            return (
              <td key="mrp" className="px-3 py-2 text-right font-mono text-text-muted">
                {line ? (
                  <div className="flex flex-col items-end">
                    <span>
                      ₹ {applicableMrp.toFixed(2)}
                      <span className="text-[10px] text-text-muted ml-0.5 font-normal">/{unitLabel}</span>
                    </span>
                    {isRateAboveMrp && (
                      <span className="inline-block mt-0.5 rounded px-1 py-0.2 text-[9px] font-bold bg-rose-50 text-rose-600 border border-rose-200">
                        Below Rate
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="opacity-40">-</span>
                )}
              </td>
            );

          case "rate":
            return (
              <td key="rate" className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                {line ? (
                  <div className="flex flex-col items-end">
                    {isEditingRate ? (
                      <input
                        ref={rateInputRef}
                        type="text"
                        inputMode="decimal"
                        value={rateText}
                        onChange={(e) => setRateText(e.target.value)}
                        onBlur={() => {
                          setIsEditingRate(false);
                          const num = parseFloat(rateText);
                          if (!isNaN(num) && num >= 0 && onRateChange) {
                            onRateChange(num, line.rate_basis);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            setIsEditingRate(false);
                            const num = parseFloat(rateText);
                            if (!isNaN(num) && num >= 0 && onRateChange) {
                              onRateChange(num, line.rate_basis);
                            }
                            if (isDraft) onCommitDraft?.();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setIsEditingRate(false);
                            setRateText(line.unit_price.toFixed(2));
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            const next = (parseFloat(rateText) || 0) + 1;
                            setRateText(next.toFixed(2));
                            onRateChange?.(next, line.rate_basis);
                          } else if (e.key === "ArrowDown") {
                            e.preventDefault();
                            const next = Math.max(0, (parseFloat(rateText) || 0) - 1);
                            setRateText(next.toFixed(2));
                            onRateChange?.(next, line.rate_basis);
                          }
                        }}
                        className="w-20 text-right rounded-[6px] border border-accent bg-[var(--color-surface)] px-1.5 py-0.5 text-xs font-mono font-bold text-[var(--color-text)] outline-none ring-2 ring-accent/30"
                      />
                    ) : (
                      <span
                        onClick={() => setIsEditingRate(true)}
                        className="font-mono font-medium text-text-main cursor-pointer hover:underline hover:text-accent"
                        title="Click to edit selling rate"
                      >
                        ₹ {line.unit_price.toFixed(2)}
                        <span className="text-[10px] text-text-muted ml-0.5 font-normal">
                          /{unitLabel}
                        </span>
                      </span>
                    )}

                    {isRateAboveMrp && (
                      <span
                        className="inline-flex items-center gap-0.5 mt-0.5 rounded px-1 py-0.2 text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-300"
                        title={`Warning: Selling rate ₹${line.unit_price.toFixed(2)} is higher than MRP ₹${applicableMrp.toFixed(2)}`}
                      >
                        ⚠️ Rate &gt; MRP
                      </span>
                    )}

                    {unitsPerPack > 1 && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => {
                          const nextBasis: PosRateBasis = line.rate_basis === "loose_rate" ? "sel_rate" : "loose_rate";
                          const newPrice = nextBasis === "loose_rate"
                            ? calculateDerivedLooseRate(line.product.sel_rate, unitsPerPack, line.product.loose_selling_rate)
                            : (line.selectedBatch.selling_rate || line.product.sel_rate);
                          onRateChange?.(newPrice, nextBasis);
                        }}
                        className="text-[9px] text-accent hover:underline mt-0.5 cursor-pointer font-medium"
                      >
                        {line.rate_basis === "loose_rate" ? "switch to pack rate" : "switch to unit rate"}
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="opacity-40">-</span>
                )}
              </td>
            );

          case "discount":
            return (
              <td
                key="discount"
                className="px-3 py-2 text-center"
                onClick={(e) => {
                  if (line) {
                    e.stopPropagation();
                    onDiscountClick?.();
                  }
                }}
              >
                {line ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`group inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-xs font-mono font-semibold cursor-pointer transition-colors ${
                      line.discount_percent > 0 || line.discount_amount > 0
                        ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] hover:opacity-90 border border-[var(--color-warning-border)]"
                        : "text-text-muted hover:bg-canvas hover:text-text-main"
                    }`}
                    title="Click or press F2 to edit item discount"
                  >
                    <span>
                      {line.discount_percent > 0
                        ? `${line.discount_percent}%`
                        : line.discount_amount > 0
                        ? `₹${line.discount_amount.toFixed(2)}`
                        : "-"}
                    </span>
                  </button>
                ) : (
                  <span className="opacity-40">-</span>
                )}
              </td>
            );

          case "gst":
            return (
              <td key="gst" className="px-3 py-2 text-center font-mono text-text-muted">
                {line ? `${line.product.gst_percent}%` : <span className="opacity-40">-</span>}
              </td>
            );

          case "hsn":
            return (
              <td key="hsn" className="px-3 py-2 text-center font-mono text-[11px] text-text-muted">
                {line?.product?.hsn_sac_code || <span className="opacity-40">-</span>}
              </td>
            );

          case "free_qty":
            return (
              <td key="free_qty" className="px-3 py-2 text-center font-mono text-text-muted opacity-40">
                -
              </td>
            );

          case "rack_shelf":
            return (
              <td key="rack_shelf" className="px-3 py-2 text-center text-text-muted">
                {line?.selectedBatch?.rack_location || line?.product?.rack_location || <span className="opacity-40">-</span>}
              </td>
            );

          case "current_stock":
            return (
              <td key="current_stock" className="px-3 py-2 text-right font-mono font-semibold text-text-main">
                {line ? line.selectedBatch.stock_qty ?? line.product.current_stock ?? 0 : <span className="opacity-40">-</span>}
              </td>
            );

          case "total":
            return (
              <td key="total" className="px-3 py-2 text-right font-bold font-mono text-text-main">
                {line ? `₹ ${line.calculated.total_amount.toFixed(2)}` : <span className="opacity-40">-</span>}
              </td>
            );

          case "actions":
            return (
              <td key="actions" className="px-3 py-2 text-center">
                {isDraft ? (
                  line ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCommitDraft?.();
                      }}
                      className="rounded-[6px] p-1 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 cursor-pointer transition-colors"
                      title="Add to bill (Enter)"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  ) : null
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveLine?.();
                    }}
                    className="rounded-[6px] p-1 text-text-muted hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-danger-text)] cursor-pointer transition-colors"
                    title="Delete line (Delete)"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </td>
            );

          default:
            return null;
        }
      })}
    </tr>
  );
};

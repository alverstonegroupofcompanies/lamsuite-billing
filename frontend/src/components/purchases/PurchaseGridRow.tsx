import React, { useState, useRef, useEffect } from "react";
import { Trash2, AlertTriangle, AlertCircle, ArrowUpRight, Search, Barcode, Check } from "lucide-react";
import type { ColumnSetting } from "../../lib/settings/companySettingsService";
import type { PurchaseLineItemInput } from "../../lib/purchases/purchaseService";
import { parseExpiryInput, calculateLineMargin } from "../../lib/purchases/purchaseEntryUtils";
import { purchaseService } from "../../lib/purchases/purchaseService";

export interface PurchaseGridRowProps {
  idx: number;
  line: PurchaseLineItemInput | null;
  isDraft?: boolean;
  isJustAdded?: boolean;
  isSelected?: boolean;
  selectedCellCol?: string;
  isEditingCell?: boolean;
  visibleCols: ColumnSetting[];
  isInterstate?: boolean;
  lastPurchaseDetails?: { rate: number; purchase_number?: string } | null;

  // Draft product search input
  searchQuery?: string;
  onSearchChange?: (val: string) => void;
  onSearchFocus?: () => void;
  onSearchBlur?: (e: React.FocusEvent) => void;
  onSearchKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  isDropdownOpen?: boolean;

  // Navigation and Field edits
  onFieldChange?: (field: keyof PurchaseLineItemInput, value: any) => void;
  onSelectRow?: () => void;
  onCellClick?: (colId: string) => void;
  onCellDoubleClick?: (colId: string) => void;
  onCellEditSave?: () => void;
  onCellEditCancel?: () => void;
  onCommitDraft?: () => void;
  onClearDraft?: () => void;
  onRemoveLine?: () => void;
  onEditConversion?: () => void;
  onEditBatch?: () => void;
}

export const PurchaseGridRow: React.FC<PurchaseGridRowProps> = ({
  idx,
  line,
  isDraft = false,
  isJustAdded = false,
  isSelected = false,
  selectedCellCol = "qty",
  isEditingCell = false,
  visibleCols,
  isInterstate = false,
  lastPurchaseDetails,
  searchQuery = "",
  onSearchChange,
  onSearchFocus,
  onSearchBlur,
  onSearchKeyDown,
  searchInputRef,
  isDropdownOpen = false,
  onFieldChange,
  onSelectRow,
  onCellClick,
  onCellDoubleClick,
  onCellEditSave,
  onCellEditCancel,
  onCommitDraft,
  onClearDraft,
  onRemoveLine,
  onEditConversion,
  onEditBatch,
}) => {
  // Input refs for keyboard loop across the entry row
  const batchInputRef = useRef<HTMLInputElement>(null);
  const expiryInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const freeQtyInputRef = useRef<HTMLInputElement>(null);
  const mrpInputRef = useRef<HTMLInputElement>(null);
  const rateInputRef = useRef<HTMLInputElement>(null);
  const discInputRef = useRef<HTMLInputElement>(null);
  const gstInputRef = useRef<HTMLInputElement>(null);
  const sellRateInputRef = useRef<HTMLInputElement>(null);

  // Compute live calculations
  const calc = line ? purchaseService.calculateLineTotals(line, isInterstate) : null;
  const marginInfo = line
    ? calculateLineMargin(line.purchase_rate, line.selling_rate || 0, line.units_per_pack || 1)
    : { marginPercent: 0, isNegative: false };

  // Last purchase rate surge alert
  const lastRate = lastPurchaseDetails?.rate;
  const isSurge = Boolean(
    line &&
    lastRate &&
    lastRate > 0 &&
    line.purchase_rate > lastRate * 1.15
  );
  const surgePercent = lastRate && line ? Math.round(((line.purchase_rate - lastRate) / lastRate) * 100) : 0;

  // Expiry validation status
  const expiryStatus = line?.expiry_date ? parseExpiryInput(line.expiry_date) : null;

  // Auto focus into Batch input right after product is chosen in entry row
  useEffect(() => {
    if (isDraft && line && line.product_name && !line.batch_no) {
      setTimeout(() => {
        batchInputRef.current?.focus();
        batchInputRef.current?.select();
      }, 50);
    }
  }, [isDraft, line?.product_id]);

  // Row styling
  let rowClass = "transition-all text-[var(--color-text)] ";
  if (isDraft) {
    rowClass += "bg-[var(--color-surface)] border-t border-dashed border-[var(--color-border)] hover:bg-[var(--color-surface)] ";
    if (isSelected) {
      rowClass += "ring-2 ring-inset ring-[var(--color-accent)] ";
    }
  } else if (isSelected) {
    rowClass += "bg-[var(--color-accent-soft)]/20 ring-1 ring-inset ring-[var(--color-accent)]/50 shadow-2xs ";
  } else if (marginInfo.isNegative || expiryStatus?.isExpired) {
    rowClass += "bg-[var(--color-danger-bg)]/30 hover:bg-[var(--color-danger-bg)]/50 ";
  } else if (isSurge || expiryStatus?.isNearExpiry) {
    rowClass += "bg-[var(--color-warning-bg)]/30 hover:bg-[var(--color-warning-bg)]/50 ";
  } else {
    rowClass += "hover:bg-[var(--color-surface-hover)] ";
  }

  const getCellHighlight = (colId: string, baseClass = "") => {
    const isCellActive = !isDraft && isSelected && selectedCellCol === colId;
    let cls = baseClass;
    if (isCellActive) {
      cls += " ring-2 ring-inset ring-[var(--color-accent)] bg-[var(--color-accent-soft)]/40 font-bold rounded-[3px] shadow-2xs";
    }
    return cls;
  };

  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onCellEditSave?.();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCellEditCancel?.();
    }
  };

  const renderCellContent = (colId: string) => {
    const isCellActive = !isDraft && isSelected && selectedCellCol === colId;
    const isCellEditing = isCellActive && isEditingCell;

    switch (colId) {
      case "idx":
        return (
          <td
            key="idx"
            className="px-2.5 py-2 text-center font-mono text-[11px] text-[var(--color-text-muted)] select-none"
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("product_name");
            }}
          >
            {isDraft ? (
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent-soft)] font-bold text-[var(--color-accent)]">
                +
              </span>
            ) : (
              idx + 1
            )}
          </td>
        );

      case "product_name":
        return (
          <td
            key="product_name"
            className={getCellHighlight("product_name", "px-3 py-1.5")}
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("product_name");
            }}
            onDoubleClick={() => {
              onSelectRow?.();
              onCellDoubleClick?.("product_name");
            }}
          >
            {isDraft && (!line || !line.product_name) ? (
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 h-3.5 w-3.5 text-[var(--color-text-faint)] pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  onFocus={onSearchFocus}
                  onBlur={onSearchBlur}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Scan barcode or type product name [F1]..."
                  className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-16 py-1 text-xs font-semibold text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none shadow-2xs"
                />
                <div className="absolute right-2 flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] pointer-events-none">
                  <Barcode className="h-3 w-3 opacity-60" />
                  <span>Scan</span>
                </div>
              </div>
            ) : line ? (
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-xs text-[var(--color-text)]">{line.product_name}</span>
                  {(line.units_per_pack || 1) > 1 && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditConversion?.();
                      }}
                      className="rounded-[4px] bg-[var(--color-accent-soft)] px-1.5 py-0.2 text-[10px] font-semibold text-[var(--color-accent)] hover:underline cursor-pointer"
                      title="Click or press F4 to edit pack size"
                    >
                      Pack of {line.units_per_pack}
                    </button>
                  )}
                  {isSurge && (
                    <span
                      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[10px] font-bold bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
                      title={`Warning: Rate ₹${line.purchase_rate} is +${surgePercent}% above last purchase ₹${lastRate}`}
                    >
                      <ArrowUpRight className="h-3 w-3" />
                      +{surgePercent}% vs last
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)] font-mono mt-0.5">
                  {lastRate ? (
                    <span className="text-[var(--color-accent)] font-medium">Last: ₹{lastRate.toFixed(2)}</span>
                  ) : null}
                  {line.hsn_code ? <span>HSN: {line.hsn_code}</span> : null}
                </div>
              </div>
            ) : (
              <span className="text-[var(--color-text-muted)] opacity-50">—</span>
            )}
          </td>
        );

      case "batch_no":
        return (
          <td
            key="batch_no"
            className={getCellHighlight("batch_no", "px-2 py-1")}
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("batch_no");
            }}
            onDoubleClick={() => {
              onSelectRow?.();
              onCellDoubleClick?.("batch_no");
            }}
          >
            {isDraft && line ? (
              <input
                ref={batchInputRef}
                type="text"
                value={line.batch_no}
                onChange={(e) => onFieldChange?.("batch_no", e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    expiryInputRef.current?.focus();
                    expiryInputRef.current?.select();
                  }
                }}
                placeholder="BATCH"
                className="w-full uppercase font-mono text-xs rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            ) : isCellEditing && line ? (
              <input
                type="text"
                autoFocus
                ref={(el) => el?.select()}
                value={line.batch_no || ""}
                onChange={(e) => onFieldChange?.("batch_no", e.target.value.toUpperCase())}
                onKeyDown={handleCellKeyDown}
                className="w-full uppercase font-mono text-xs rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[var(--color-text)] focus:outline-none shadow-2xs"
              />
            ) : line ? (
              <span className="font-mono text-xs font-semibold text-[var(--color-text)]">
                {line.batch_no || "—"}
              </span>
            ) : (
              <span className="text-[var(--color-text-muted)] opacity-50">—</span>
            )}
          </td>
        );

      case "expiry_date":
        return (
          <td
            key="expiry_date"
            className={getCellHighlight("expiry_date", "px-2 py-1")}
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("expiry_date");
            }}
            onDoubleClick={() => {
              onSelectRow?.();
              onCellDoubleClick?.("expiry_date");
            }}
          >
            {isDraft && line ? (
              <div className="relative">
                <input
                  ref={expiryInputRef}
                  type="text"
                  value={line.expiry_date}
                  onChange={(e) => onFieldChange?.("expiry_date", e.target.value)}
                  onBlur={() => {
                    if (line.expiry_date) {
                      const res = parseExpiryInput(line.expiry_date);
                      if (res.isValid) {
                        onFieldChange?.("expiry_date", res.isoDate);
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const res = parseExpiryInput(line.expiry_date);
                      if (res.isValid) {
                        onFieldChange?.("expiry_date", res.isoDate);
                      }
                      qtyInputRef.current?.focus();
                      qtyInputRef.current?.select();
                    }
                  }}
                  placeholder="MM/YY"
                  className={`w-full font-mono text-xs rounded-[6px] border bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text)] focus:outline-none ${
                    expiryStatus?.isExpired
                      ? "border-[var(--color-danger-border)] text-[var(--color-danger-text)] ring-1 ring-[var(--color-danger-border)]"
                      : "border-[var(--color-border)] focus:border-[var(--color-accent)]"
                  }`}
                />
                {expiryStatus?.isExpired && (
                  <span className="absolute -bottom-3.5 left-0 text-[9px] font-bold text-[var(--color-danger-text)]">
                    Expired!
                  </span>
                )}
                {expiryStatus?.isNearExpiry && (
                  <span className="absolute -bottom-3.5 left-0 text-[9px] font-bold text-[var(--color-warning-text)]">
                    Near Exp
                  </span>
                )}
              </div>
            ) : isCellEditing && line ? (
              <input
                type="text"
                autoFocus
                ref={(el) => el?.select()}
                value={line.expiry_date || ""}
                onChange={(e) => onFieldChange?.("expiry_date", e.target.value)}
                onBlur={() => {
                  if (line.expiry_date) {
                    const res = parseExpiryInput(line.expiry_date);
                    if (res.isValid) onFieldChange?.("expiry_date", res.isoDate);
                  }
                }}
                onKeyDown={handleCellKeyDown}
                placeholder="MM/YY"
                className="w-full font-mono text-xs rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[var(--color-text)] focus:outline-none shadow-2xs"
              />
            ) : line ? (
              <div className="font-mono text-xs">
                <span>{expiryStatus?.display || line.expiry_date || "—"}</span>
                {expiryStatus?.isExpired && (
                  <span className="ml-1 rounded px-1 py-0.2 text-[9px] font-bold bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] border border-[var(--color-danger-border)]">
                    Expired
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[var(--color-text-muted)] opacity-50">—</span>
            )}
          </td>
        );

      case "qty":
        return (
          <td
            key="qty"
            className={getCellHighlight("qty", "px-2 py-1 text-center")}
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("qty");
            }}
            onDoubleClick={() => {
              onSelectRow?.();
              onCellDoubleClick?.("qty");
            }}
          >
            {isDraft && line ? (
              <div className="flex items-center gap-1 justify-center">
                <input
                  ref={qtyInputRef}
                  type="text"
                  value={line.pack_qty ?? line.qty ?? 1}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw.includes("+")) {
                      const parts = raw.split("+");
                      const packs = parseFloat(parts[0]) || 0;
                      const extra = parseFloat(parts[1]) || 0;
                      onFieldChange?.("pack_qty", packs);
                      if (extra > 0) {
                        onFieldChange?.("free_qty", extra);
                      }
                    } else {
                      onFieldChange?.("pack_qty", parseFloat(raw) || 0);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      mrpInputRef.current?.focus();
                      mrpInputRef.current?.select();
                    }
                  }}
                  className="w-14 text-center font-mono font-bold text-xs rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
                  placeholder="Packs"
                />
                {(line.units_per_pack || 1) > 1 && (
                  <input
                    type="number"
                    value={line.loose_qty || 0}
                    onChange={(e) => onFieldChange?.("loose_qty", Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-11 text-center font-mono text-xs rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1 text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                    placeholder="Loose"
                    title="Loose Units"
                  />
                )}
              </div>
            ) : isCellEditing && line ? (
              <input
                type="number"
                step="1"
                autoFocus
                ref={(el) => el?.select()}
                value={line.pack_qty ?? line.qty ?? 0}
                onChange={(e) => onFieldChange?.("pack_qty", Math.max(0, parseFloat(e.target.value) || 0))}
                onKeyDown={handleCellKeyDown}
                className="w-16 font-mono font-bold text-xs rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[var(--color-text)] text-center focus:outline-none shadow-2xs"
              />
            ) : line ? (
              <span className="font-mono font-semibold text-xs text-[var(--color-text)]">
                {line.pack_qty ?? line.qty ?? 0}
                {line.loose_qty ? ` + ${line.loose_qty}u` : ""}
              </span>
            ) : (
              <span className="text-[var(--color-text-muted)] opacity-50">—</span>
            )}
          </td>
        );

      case "free_qty":
        return (
          <td
            key="free_qty"
            className={getCellHighlight("free_qty", "px-2 py-1 text-center")}
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("free_qty");
            }}
            onDoubleClick={() => {
              onSelectRow?.();
              onCellDoubleClick?.("free_qty");
            }}
          >
            {isDraft && line ? (
              <input
                ref={freeQtyInputRef}
                type="number"
                value={line.free_qty || 0}
                onChange={(e) => onFieldChange?.("free_qty", Math.max(0, parseFloat(e.target.value) || 0))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    mrpInputRef.current?.focus();
                    mrpInputRef.current?.select();
                  }
                }}
                className="w-12 text-center font-mono text-xs rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            ) : isCellEditing && line ? (
              <input
                type="number"
                autoFocus
                ref={(el) => el?.select()}
                value={line.free_qty || 0}
                onChange={(e) => onFieldChange?.("free_qty", Math.max(0, parseFloat(e.target.value) || 0))}
                onKeyDown={handleCellKeyDown}
                className="w-14 font-mono text-xs rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[var(--color-text)] text-center focus:outline-none shadow-2xs"
              />
            ) : line ? (
              <span className="font-mono text-xs text-[var(--color-text-muted)]">
                {line.free_qty ? `+${line.free_qty}` : "0"}
              </span>
            ) : (
              <span className="text-[var(--color-text-muted)] opacity-50">—</span>
            )}
          </td>
        );

      case "mrp":
        return (
          <td
            key="mrp"
            className={getCellHighlight("mrp", "px-2 py-1 text-right")}
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("mrp");
            }}
            onDoubleClick={() => {
              onSelectRow?.();
              onCellDoubleClick?.("mrp");
            }}
          >
            {isDraft && line ? (
              <input
                ref={mrpInputRef}
                type="number"
                step="0.01"
                value={line.mrp || ""}
                onChange={(e) => onFieldChange?.("mrp", parseFloat(e.target.value) || 0)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    rateInputRef.current?.focus();
                    rateInputRef.current?.select();
                  }
                }}
                placeholder="MRP"
                className="w-16 text-right font-mono text-xs rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            ) : isCellEditing && line ? (
              <input
                type="number"
                step="0.01"
                autoFocus
                ref={(el) => el?.select()}
                value={line.mrp || ""}
                onChange={(e) => onFieldChange?.("mrp", parseFloat(e.target.value) || 0)}
                onKeyDown={handleCellKeyDown}
                className="w-18 font-mono text-xs rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[var(--color-text)] text-right focus:outline-none shadow-2xs"
              />
            ) : line ? (
              <span className="font-mono text-xs text-[var(--color-text-muted)]">
                ₹ {Number(line.mrp || 0).toFixed(2)}
              </span>
            ) : (
              <span className="text-[var(--color-text-muted)] opacity-50">—</span>
            )}
          </td>
        );

      case "ptr":
        return (
          <td
            key="ptr"
            className={getCellHighlight("ptr", "px-2 py-1 text-right font-mono text-xs text-[var(--color-text-muted)]")}
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("ptr");
            }}
          >
            ₹ {Number(line?.purchase_rate || 0).toFixed(2)}
          </td>
        );

      case "pts":
        return (
          <td
            key="pts"
            className={getCellHighlight("pts", "px-2 py-1 text-right font-mono text-xs text-[var(--color-text-muted)]")}
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("pts");
            }}
          >
            ₹ {Number((line?.purchase_rate || 0) * 1.05).toFixed(2)}
          </td>
        );

      case "ptss":
        return (
          <td
            key="ptss"
            className={getCellHighlight("ptss", "px-2 py-1 text-right font-mono text-xs text-[var(--color-text-muted)]")}
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("ptss");
            }}
          >
            ₹ {Number((line?.purchase_rate || 0) * 1.08).toFixed(2)}
          </td>
        );

      case "purchase_rate":
        return (
          <td
            key="purchase_rate"
            className={getCellHighlight("purchase_rate", "px-2 py-1 text-right")}
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("purchase_rate");
            }}
            onDoubleClick={() => {
              onSelectRow?.();
              onCellDoubleClick?.("purchase_rate");
            }}
          >
            {isDraft && line ? (
              <input
                ref={rateInputRef}
                type="number"
                step="0.01"
                value={line.purchase_rate || ""}
                onChange={(e) => onFieldChange?.("purchase_rate", parseFloat(e.target.value) || 0)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    discInputRef.current?.focus();
                    discInputRef.current?.select();
                  }
                }}
                placeholder="Rate"
                className="w-18 text-right font-mono font-bold text-xs rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            ) : isCellEditing && line ? (
              <input
                type="number"
                step="0.01"
                autoFocus
                ref={(el) => el?.select()}
                value={line.purchase_rate || ""}
                onChange={(e) => onFieldChange?.("purchase_rate", parseFloat(e.target.value) || 0)}
                onKeyDown={handleCellKeyDown}
                className="w-20 font-mono font-bold text-xs rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[var(--color-text)] text-right focus:outline-none shadow-2xs"
              />
            ) : line ? (
              <span className="font-mono font-bold text-xs text-[var(--color-text)]">
                ₹ {Number(line.purchase_rate || 0).toFixed(2)}
              </span>
            ) : (
              <span className="text-[var(--color-text-muted)] opacity-50">—</span>
            )}
          </td>
        );

      case "discount":
        return (
          <td
            key="discount"
            className={getCellHighlight("discount", "px-2 py-1 text-center")}
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("discount");
            }}
            onDoubleClick={() => {
              onSelectRow?.();
              onCellDoubleClick?.("discount");
            }}
          >
            {isDraft && line ? (
              <input
                ref={discInputRef}
                type="number"
                step="0.1"
                value={line.discount_percent || 0}
                onChange={(e) => onFieldChange?.("discount_percent", parseFloat(e.target.value) || 0)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    gstInputRef.current?.focus();
                    gstInputRef.current?.select();
                  }
                }}
                className="w-12 text-center font-mono text-xs rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            ) : isCellEditing && line ? (
              <input
                type="number"
                step="0.1"
                autoFocus
                ref={(el) => el?.select()}
                value={line.discount_percent || 0}
                onChange={(e) => onFieldChange?.("discount_percent", parseFloat(e.target.value) || 0)}
                onKeyDown={handleCellKeyDown}
                className="w-14 font-mono text-xs rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[var(--color-text)] text-center focus:outline-none shadow-2xs"
              />
            ) : line ? (
              <span className="font-mono text-xs text-[var(--color-text-muted)]">
                {line.discount_percent ? `${line.discount_percent}%` : "—"}
              </span>
            ) : (
              <span className="text-[var(--color-text-muted)] opacity-50">—</span>
            )}
          </td>
        );

      case "discount_amount":
        return (
          <td key="discount_amount" className={getCellHighlight("discount_amount", "px-2 py-1 text-right font-mono text-xs text-[var(--color-text-muted)]")}>
            ₹ {calc?.discount_amount ? calc.discount_amount.toFixed(2) : "0.00"}
          </td>
        );

      case "scheme":
        return (
          <td key="scheme" className={getCellHighlight("scheme", "px-2 py-1 text-center font-mono text-xs text-[var(--color-text-muted)]")}>
            {line?.discount_amount ? `₹${line.discount_amount}` : "—"}
          </td>
        );

      case "gst":
        return (
          <td
            key="gst"
            className={getCellHighlight("gst", "px-2 py-1 text-center")}
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("gst");
            }}
            onDoubleClick={() => {
              onSelectRow?.();
              onCellDoubleClick?.("gst");
            }}
          >
            {isDraft && line ? (
              <input
                ref={gstInputRef}
                type="number"
                value={line.gst_percent ?? 12}
                onChange={(e) => onFieldChange?.("gst_percent", parseFloat(e.target.value) || 0)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sellRateInputRef.current?.focus();
                    sellRateInputRef.current?.select();
                  }
                }}
                className="w-12 text-center font-mono text-xs rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            ) : isCellEditing && line ? (
              <input
                type="number"
                step="1"
                autoFocus
                ref={(el) => el?.select()}
                value={line.gst_percent ?? 0}
                onChange={(e) => onFieldChange?.("gst_percent", parseFloat(e.target.value) || 0)}
                onKeyDown={handleCellKeyDown}
                className="w-14 font-mono text-xs rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[var(--color-text)] text-center focus:outline-none shadow-2xs"
              />
            ) : line ? (
              <span className="font-mono text-xs text-[var(--color-text-muted)]">
                {line.gst_percent}%
              </span>
            ) : (
              <span className="text-[var(--color-text-muted)] opacity-50">—</span>
            )}
          </td>
        );

      case "hsn":
        return (
          <td key="hsn" className={getCellHighlight("hsn", "px-2 py-1 text-center font-mono text-xs text-[var(--color-text-muted)]")}>
            {line?.hsn_code || "—"}
          </td>
        );

      case "selling_rate":
        return (
          <td
            key="selling_rate"
            className={getCellHighlight("selling_rate", "px-2 py-1 text-right")}
            onClick={() => {
              onSelectRow?.();
              onCellClick?.("selling_rate");
            }}
            onDoubleClick={() => {
              onSelectRow?.();
              onCellDoubleClick?.("selling_rate");
            }}
          >
            {isDraft && line ? (
              <input
                ref={sellRateInputRef}
                type="number"
                step="0.01"
                value={line.selling_rate || ""}
                onChange={(e) => onFieldChange?.("selling_rate", parseFloat(e.target.value) || 0)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onCommitDraft?.();
                  }
                }}
                placeholder="Sell"
                className="w-16 text-right font-mono text-xs rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            ) : isCellEditing && line ? (
              <input
                type="number"
                step="0.01"
                autoFocus
                ref={(el) => el?.select()}
                value={line.selling_rate || ""}
                onChange={(e) => onFieldChange?.("selling_rate", parseFloat(e.target.value) || 0)}
                onKeyDown={handleCellKeyDown}
                className="w-18 font-mono text-xs rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[var(--color-text)] text-right focus:outline-none shadow-2xs"
              />
            ) : line ? (
              <span className="font-mono text-xs text-[var(--color-text)]">
                ₹ {Number(line.selling_rate || 0).toFixed(2)}
              </span>
            ) : (
              <span className="text-[var(--color-text-muted)] opacity-50">—</span>
            )}
          </td>
        );

      case "margin":
        return (
          <td key="margin" className={getCellHighlight("margin", "px-2 py-1 text-center")}>
            {line ? (
              <span
                className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[10px] font-mono font-bold ${
                  marginInfo.isNegative
                    ? "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] border border-[var(--color-danger-border)]"
                    : marginInfo.marginPercent >= 20
                    ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]"
                    : "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]"
                }`}
                title={marginInfo.isNegative ? "Negative Margin: Selling below purchase cost!" : undefined}
              >
                {marginInfo.isNegative ? <AlertCircle className="h-2.5 w-2.5" /> : null}
                {marginInfo.marginPercent.toFixed(1)}%
              </span>
            ) : (
              <span className="text-[var(--color-text-muted)] opacity-50">—</span>
            )}
          </td>
        );

      case "taxable_value":
        return (
          <td key="taxable_value" className={getCellHighlight("taxable_value", "px-2.5 py-1 text-right font-mono text-xs text-[var(--color-text-muted)]")}>
            ₹ {calc ? calc.taxable_amount.toFixed(2) : "0.00"}
          </td>
        );

      case "tax":
        return (
          <td key="tax" className={getCellHighlight("tax", "px-2.5 py-1 text-right font-mono text-xs text-[var(--color-text-muted)]")}>
            ₹ {calc ? calc.total_tax.toFixed(2) : "0.00"}
          </td>
        );

      case "total":
        return (
          <td key="total" className={getCellHighlight("total", "px-3 py-1.5 text-right font-mono font-bold text-xs text-[var(--color-text)]")}>
            ₹ {calc ? calc.total_amount.toFixed(2) : "0.00"}
          </td>
        );

      case "actions":
        return (
          <td key="actions" className="px-2 py-1 text-center">
            {isDraft ? (
              line?.product_name ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={onClearDraft}
                  className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-danger-text)] cursor-pointer transition-colors"
                  title="Clear draft line (Esc)"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null
            ) : (
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveLine?.();
                }}
                className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-danger-text)] cursor-pointer transition-colors"
                title="Delete line (Delete / Ctrl+D)"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </td>
        );

      default:
        return <td key={colId} className="px-2 py-1">—</td>;
    }
  };

  return (
    <tr className={rowClass} role="row" aria-selected={isSelected}>
      {visibleCols.map((col) => renderCellContent(col.id))}
    </tr>
  );
};

import React, { useState, useEffect, useRef } from "react";
import { X, Percent, Tag, Check } from "lucide-react";
import type { PosCartLine } from "../lib/billing/posCartService";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

interface QuickLineEditModalProps {
  isOpen: boolean;
  type: "discount" | "rate";
  line: PosCartLine | null;
  onClose: () => void;
  onSaveDiscount: (lineId: string, percent: number, amount: number) => void;
  onSaveRate: (lineId: string, unitPrice: number) => void;
}

export const QuickLineEditModal: React.FC<QuickLineEditModalProps> = ({
  isOpen,
  type,
  line,
  onClose,
  onSaveDiscount,
  onSaveRate,
}) => {
  const [value, setValue] = useState<string>("");
  const [discMode, setDiscMode] = useState<"percent" | "amount">("percent");
  const inputRef = useRef<HTMLInputElement>(null);

  useModalEscape(isOpen && Boolean(line), onClose);

  useEffect(() => {
    if (isOpen && line) {
      if (type === "discount") {
        if (line.discount_amount > 0) {
          setDiscMode("amount");
          setValue(line.discount_amount.toString());
        } else {
          setDiscMode("percent");
          setValue((line.discount_percent || 0).toString());
        }
      } else {
        setValue(line.unit_price.toString());
      }
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
    }
  }, [line, type, isOpen]);

  if (!isOpen || !line) return null;

  const handleSave = () => {
    const num = Math.max(0, parseFloat(value) || 0);
    if (type === "discount") {
      if (discMode === "percent") {
        onSaveDiscount(line.id, num, 0);
      } else {
        onSaveDiscount(line.id, 0, num);
      }
    } else {
      onSaveRate(line.id, num);
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const isDiscount = type === "discount";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 select-none font-sans animate-in fade-in duration-100">
      <div className="w-full max-w-xs rounded-card bg-surface shadow-modal border border-border-main overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border-main flex items-center justify-between bg-canvas">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-btn ${isDiscount ? "bg-[var(--color-warning-bg,#FDF1DC)] text-[var(--color-warning-text,#8A5200)]" : "bg-accent-soft text-accent"}`}>
              {isDiscount ? <Percent className="h-4 w-4" /> : <Tag className="h-4 w-4" />}
            </div>
            <div>
              <h3 className="text-xs font-bold text-text-main">
                {isDiscount ? "Quick Edit Discount (F2)" : "Quick Edit Rate (F3)"}
              </h3>
              <p className="text-[11px] text-text-muted font-medium truncate max-w-[180px]">
                {line.product.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-main rounded-btn hover:bg-surface transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3 bg-surface">
          {isDiscount && (
            <div className="flex rounded-btn bg-canvas p-0.5 text-xs font-semibold border border-border-main">
              <button
                type="button"
                onClick={() => setDiscMode("percent")}
                className={`flex-1 py-1 rounded-[6px] transition-all cursor-pointer ${
                  discMode === "percent" ? "bg-surface text-text-main shadow-2xs font-bold" : "text-text-muted hover:text-text-main"
                }`}
              >
                Percentage (%)
              </button>
              <button
                type="button"
                onClick={() => setDiscMode("amount")}
                className={`flex-1 py-1 rounded-[6px] transition-all cursor-pointer ${
                  discMode === "amount" ? "bg-surface text-text-main shadow-2xs font-bold" : "text-text-muted hover:text-text-main"
                }`}
              >
                Amount (₹)
              </button>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">
              {isDiscount
                ? (discMode === "percent" ? "Discount Percentage (%)" : "Flat Discount (₹)")
                : "Unit Selling Rate (₹)"}
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="number"
                step="any"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full rounded-btn border border-border-main bg-surface px-3 py-2 text-sm font-bold font-mono text-text-main focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              />
              <span className="absolute right-3 top-2.5 text-xs font-bold font-mono text-text-muted">
                {isDiscount ? (discMode === "percent" ? "%" : "₹") : "₹"}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border-main bg-canvas flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-btn border border-border-main text-xs font-semibold text-text-muted hover:text-text-main hover:bg-surface transition-colors cursor-pointer"
          >
            Cancel (Esc)
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-btn bg-accent text-xs font-bold text-white hover:opacity-90 shadow-2xs transition-opacity cursor-pointer"
          >
            <Check className="h-3.5 w-3.5" />
            Apply (Enter)
          </button>
        </div>
      </div>
    </div>
  );
};

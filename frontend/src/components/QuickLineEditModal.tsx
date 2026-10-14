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
  useModalEscape(isOpen && Boolean(line), onClose);

  if (!isOpen || !line) return null;

  const [value, setValue] = useState<string>("");
  const [discMode, setDiscMode] = useState<"percent" | "amount">("percent");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (line) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4 select-none animate-in fade-in duration-100">
      <div className="w-full max-w-xs bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${isDiscount ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
              {isDiscount ? <Percent className="h-4 w-4" /> : <Tag className="h-4 w-4" />}
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-800">
                {isDiscount ? "Quick Edit Discount (F2)" : "Quick Edit Rate (F3)"}
              </h3>
              <p className="text-[11px] text-slate-500 font-medium truncate max-w-[180px]">
                {line.product.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-200 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {isDiscount && (
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setDiscMode("percent")}
                className={`flex-1 py-1 rounded-md transition-all ${
                  discMode === "percent" ? "bg-white text-slate-800 shadow-2xs" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Percentage (%)
              </button>
              <button
                type="button"
                onClick={() => setDiscMode("amount")}
                className={`flex-1 py-1 rounded-md transition-all ${
                  discMode === "amount" ? "bg-white text-slate-800 shadow-2xs" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Amount (₹)
              </button>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
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
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
              />
              <span className="absolute right-3 top-2.5 text-xs font-semibold text-slate-400">
                {isDiscount ? (discMode === "percent" ? "%" : "₹") : "₹"}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100"
          >
            Cancel (Esc)
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-blue-600 text-xs font-bold text-white hover:bg-blue-700 shadow-2xs"
          >
            <Check className="h-3.5 w-3.5" />
            Apply (Enter)
          </button>
        </div>
      </div>
    </div>
  );
};

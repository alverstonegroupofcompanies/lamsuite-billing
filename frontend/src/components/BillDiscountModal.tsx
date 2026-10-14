import React, { useState, useEffect, useRef } from "react";
import { X, Percent, Tag, Check, Sparkles, Trash2 } from "lucide-react";
import { round2 } from "../lib/billing/billingCalculations";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

interface BillDiscountModalProps {
  isOpen: boolean;
  currentDiscount: { type: "percent" | "amount"; value: number };
  taxableSubtotal: number;
  totalTax: number;
  onClose: () => void;
  onApplyDiscount: (type: "percent" | "amount", value: number) => void;
}

export const BillDiscountModal: React.FC<BillDiscountModalProps> = ({
  isOpen,
  currentDiscount,
  taxableSubtotal,
  totalTax,
  onClose,
  onApplyDiscount,
}) => {
  useModalEscape(isOpen, onClose);

  const [discType, setDiscType] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setDiscType(currentDiscount.type || "percent");
      setValue(currentDiscount.value > 0 ? currentDiscount.value.toString() : "");
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 40);
    }
  }, [isOpen, currentDiscount]);

  if (!isOpen) return null;

  const numVal = Math.max(0, parseFloat(value) || 0);
  let discountAmount = 0;
  if (discType === "percent") {
    const pct = Math.min(100, numVal);
    discountAmount = round2(taxableSubtotal * (pct / 100));
  } else {
    discountAmount = round2(Math.min(taxableSubtotal, numVal));
  }

  const taxScaleRatio = taxableSubtotal > 0 && discountAmount > 0
    ? Math.max(0, (taxableSubtotal - discountAmount) / taxableSubtotal)
    : 1;
  const scaledTax = round2(totalTax * taxScaleRatio);
  const estimatedPayable = round2(Math.max(0, taxableSubtotal - discountAmount) + scaledTax);

  const handleApply = () => {
    onApplyDiscount(discType, numVal);
    onClose();
  };

  const handleClear = () => {
    onApplyDiscount("amount", 0);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleApply();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4 select-none animate-in fade-in duration-100">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500 text-white shadow-xs">
              <Percent className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">
                Overall Bill Discount <span className="text-xs text-amber-600 font-medium">(Ctrl+F2)</span>
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Apply special discount across entire invoice
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Toggle Type */}
          <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setDiscType("percent");
                inputRef.current?.focus();
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                discType === "percent"
                  ? "bg-white text-amber-700 shadow-xs"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Percent className="h-3.5 w-3.5" />
              <span>Percentage (%)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setDiscType("amount");
                inputRef.current?.focus();
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                discType === "amount"
                  ? "bg-white text-amber-700 shadow-xs"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
              <span>Flat Amount (₹)</span>
            </button>
          </div>

          {/* Value Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {discType === "percent" ? "Discount Percentage" : "Discount Amount"}
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="number"
                step="any"
                min="0"
                max={discType === "percent" ? 100 : taxableSubtotal}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={discType === "percent" ? "e.g. 5 or 10" : "e.g. 50 or 100"}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-bold text-slate-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none"
              />
              <span className="absolute right-3.5 top-3 text-sm font-bold text-slate-400">
                {discType === "percent" ? "%" : "₹"}
              </span>
            </div>
          </div>

          {/* Quick Presets */}
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">
              Quick Presets
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(discType === "percent" ? [2, 5, 10, 15, 20] : [20, 50, 100, 200, 500]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setValue(preset.toString());
                    inputRef.current?.focus();
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-amber-100 hover:text-amber-800 text-xs font-semibold text-slate-600 border border-slate-200 transition-colors cursor-pointer"
                >
                  {discType === "percent" ? `${preset}%` : `₹${preset}`}
                </button>
              ))}
            </div>
          </div>

          {/* Live Preview Summary Card */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-500">
              <span>Taxable Subtotal</span>
              <span className="font-semibold text-slate-700">₹ {taxableSubtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-amber-700 font-semibold">
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Bill Discount {discType === "percent" && numVal > 0 ? `(${numVal}%)` : ""}
              </span>
              <span>- ₹ {discountAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>GST Tax (Pro-rated)</span>
              <span className="font-semibold text-slate-700">₹ {scaledTax.toFixed(2)}</span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-sm font-bold text-slate-900">
              <span>New Payable (approx)</span>
              <span className="text-base text-blue-700 font-black">₹ {Math.round(estimatedPayable).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <div>
            {currentDiscount.value > 0 && (
              <button
                type="button"
                onClick={handleClear}
                className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 hover:underline cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove Discount
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              Cancel (Esc)
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-xs font-bold text-white shadow-sm transition-colors cursor-pointer"
            >
              <Check className="h-4 w-4" />
              Apply Discount (Enter)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

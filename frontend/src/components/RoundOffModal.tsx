import React, { useState, useEffect, useRef } from "react";
import { X, Check, RotateCcw, Calculator, ArrowRightLeft } from "lucide-react";
import { round2, computeAutoRoundOff } from "../lib/billing/billingCalculations";

interface RoundOffModalProps {
  isOpen: boolean;
  netBeforeRound: number;
  currentRoundOff: number;
  isManual: boolean;
  onClose: () => void;
  onApplyRoundOff: (manualAmount: number | null) => void;
}

export const RoundOffModal: React.FC<RoundOffModalProps> = ({
  isOpen,
  netBeforeRound,
  currentRoundOff,
  isManual,
  onClose,
  onApplyRoundOff,
}) => {
  const [entryMode, setEntryMode] = useState<"round_off" | "final_total">("final_total");
  const [roundOffInput, setRoundOffInput] = useState<string>("");
  const [finalTotalInput, setFinalTotalInput] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const autoRo = computeAutoRoundOff(netBeforeRound);

  useEffect(() => {
    if (isOpen) {
      const activeRo = isManual ? currentRoundOff : autoRo.roundOff;
      const activeFinal = round2(netBeforeRound + activeRo);
      setRoundOffInput(activeRo !== 0 ? activeRo.toString() : "0");
      setFinalTotalInput(activeFinal.toString());
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 40);
    }
  }, [isOpen, netBeforeRound, currentRoundOff, isManual]);

  if (!isOpen) return null;

  const handleRoundOffChange = (val: string) => {
    setRoundOffInput(val);
    const num = parseFloat(val) || 0;
    const calcFinal = round2(netBeforeRound + num);
    setFinalTotalInput(calcFinal.toString());
  };

  const handleFinalTotalChange = (val: string) => {
    setFinalTotalInput(val);
    const num = parseFloat(val) || 0;
    const calcRo = round2(num - netBeforeRound);
    setRoundOffInput(calcRo.toString());
  };

  const effectiveRoundOff = round2(parseFloat(roundOffInput) || 0);
  const effectiveFinal = round2(Math.max(0, netBeforeRound + effectiveRoundOff));

  const handleApply = () => {
    onApplyRoundOff(effectiveRoundOff);
    onClose();
  };

  const handleResetAuto = () => {
    onApplyRoundOff(null); // null means revert to auto statutory round-off
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
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-600 text-white shadow-xs">
              <Calculator className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">
                Adjust Round-Off / Net Payable <span className="text-xs text-blue-600 font-medium">(Alt+R)</span>
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Customize statutory rounding or override final invoice amount
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
          {/* Mode Switcher */}
          <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setEntryMode("final_total");
                setTimeout(() => inputRef.current?.focus(), 20);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                entryMode === "final_total"
                  ? "bg-white text-blue-700 shadow-xs"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <span>Desired Final Payable (₹)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setEntryMode("round_off");
                setTimeout(() => inputRef.current?.focus(), 20);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                entryMode === "round_off"
                  ? "bg-white text-blue-700 shadow-xs"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <span>Round-off Delta (+/− ₹)</span>
            </button>
          </div>

          {/* Primary Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {entryMode === "final_total"
                ? "Enter Target Net Payable Amount (₹)"
                : "Enter Round-off Delta (+ or - ₹)"}
            </label>
            <div className="relative">
              {entryMode === "final_total" ? (
                <input
                  ref={inputRef}
                  type="number"
                  step="any"
                  min="0"
                  value={finalTotalInput}
                  onChange={(e) => handleFinalTotalChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. 150.00"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-bold text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                />
              ) : (
                <input
                  ref={inputRef}
                  type="number"
                  step="any"
                  value={roundOffInput}
                  onChange={(e) => handleRoundOffChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. -0.40 or +0.60"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-bold text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                />
              )}
              <span className="absolute right-3.5 top-3 text-sm font-bold text-slate-400">₹</span>
            </div>
          </div>

          {/* Live Calculation Preview */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2 text-xs">
            <div className="flex justify-between text-slate-500">
              <span>Amount Before Round-Off</span>
              <span className="font-semibold text-slate-700">₹ {netBeforeRound.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-slate-700">
              <span className="flex items-center gap-1 font-semibold">
                <ArrowRightLeft className="h-3.5 w-3.5 text-blue-600" />
                Round-off Adjustment
              </span>
              <span className={`font-bold ${effectiveRoundOff < 0 ? "text-amber-600" : effectiveRoundOff > 0 ? "text-emerald-600" : "text-slate-600"}`}>
                {effectiveRoundOff > 0 ? `+ ₹ ${effectiveRoundOff.toFixed(2)}` : effectiveRoundOff < 0 ? `- ₹ ${Math.abs(effectiveRoundOff).toFixed(2)}` : `₹ 0.00`}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-sm font-bold text-slate-900">
              <span>Final Grand Total</span>
              <span className="text-lg text-blue-700 font-black">₹ {effectiveFinal.toFixed(2)}</span>
            </div>
          </div>

          {/* Statutory Auto-Roundoff Recommendation */}
          <div className="flex items-center justify-between rounded-xl bg-blue-50/70 border border-blue-100 p-2.5 text-xs">
            <div>
              <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wide block">Statutory Auto Round</span>
              <span className="text-slate-700 font-medium">
                Nearest ₹ : <strong className="text-blue-900">₹ {autoRo.grandTotal.toFixed(2)}</strong> ({autoRo.roundOff >= 0 ? `+₹${autoRo.roundOff.toFixed(2)}` : `-₹${Math.abs(autoRo.roundOff).toFixed(2)}`})
              </span>
            </div>
            <button
              type="button"
              onClick={handleResetAuto}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              Use Auto
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
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
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-bold text-white shadow-sm transition-colors cursor-pointer"
          >
            <Check className="h-4 w-4" />
            Apply Round-Off (Enter)
          </button>
        </div>
      </div>
    </div>
  );
};

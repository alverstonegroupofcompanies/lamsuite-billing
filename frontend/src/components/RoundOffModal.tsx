import React, { useState, useEffect, useRef } from "react";
import { X, Check, RotateCcw, Calculator, ArrowRightLeft } from "lucide-react";
import { round2, computeAutoRoundOff } from "../lib/billing/billingCalculations";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

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
  useModalEscape(isOpen, onClose);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 select-none font-sans animate-in fade-in duration-100">
      <div className="w-full max-w-md rounded-card bg-surface shadow-modal border border-border-main overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border-main flex items-center justify-between bg-canvas">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-btn bg-accent-soft text-accent shadow-2xs">
              <Calculator className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-text-main">
                  Adjust Round-Off / Net Payable <span className="text-xs text-accent font-mono font-medium">(Alt+R)</span>
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-bold ${
                    effectiveRoundOff < 0
                      ? "bg-[var(--color-warning-bg,#FDF1DC)] text-[var(--color-warning-text,#8A5200)] border border-[var(--color-warning-border,#F5C070)]"
                      : effectiveRoundOff > 0
                      ? "bg-accent-soft text-accent border border-accent/30"
                      : "bg-canvas text-text-muted border border-border-main"
                  }`}
                >
                  Delta: {effectiveRoundOff >= 0 ? `+₹${effectiveRoundOff.toFixed(2)}` : `-₹${Math.abs(effectiveRoundOff).toFixed(2)}`}
                </span>
              </div>
              <p className="text-[11px] text-text-muted font-medium">
                Customize statutory rounding or override final invoice amount
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-main rounded-btn hover:bg-surface transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 bg-surface">
          {/* Mode Switcher */}
          <div className="flex rounded-btn bg-canvas p-1 text-xs font-bold border border-border-main">
            <button
              type="button"
              onClick={() => {
                setEntryMode("final_total");
                setTimeout(() => inputRef.current?.focus(), 20);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[8px] transition-all cursor-pointer ${
                entryMode === "final_total"
                  ? "bg-surface text-accent shadow-2xs font-bold"
                  : "text-text-muted hover:text-text-main"
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
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[8px] transition-all cursor-pointer ${
                entryMode === "round_off"
                  ? "bg-surface text-accent shadow-2xs font-bold"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              <span>Round-off Delta (+/− ₹)</span>
            </button>
          </div>

          {/* Primary Input */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5">
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
                  className="w-full rounded-btn border border-border-main bg-surface px-3.5 py-2.5 text-base font-bold font-mono text-text-main focus:border-accent focus:ring-1 focus:ring-accent outline-none"
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
                  className="w-full rounded-btn border border-border-main bg-surface px-3.5 py-2.5 text-base font-bold font-mono text-text-main focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                />
              )}
              <span className="absolute right-3.5 top-3 text-sm font-bold font-mono text-text-muted">₹</span>
            </div>
          </div>

          {/* Live Calculation Preview */}
          <div className="rounded-card border border-border-main bg-canvas p-3.5 space-y-2 text-xs">
            <div className="flex justify-between text-text-muted">
              <span>Amount Before Round-Off</span>
              <span className="font-mono font-semibold text-text-main">₹ {netBeforeRound.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-text-main">
              <span className="flex items-center gap-1 font-semibold text-text-muted">
                <ArrowRightLeft className="h-3.5 w-3.5 text-accent" />
                Round-off Adjustment
              </span>
              <span className={`font-mono font-bold ${effectiveRoundOff < 0 ? "text-[var(--color-warning-text,#8A5200)]" : effectiveRoundOff > 0 ? "text-accent" : "text-text-muted"}`}>
                {effectiveRoundOff > 0 ? `+ ₹ ${effectiveRoundOff.toFixed(2)}` : effectiveRoundOff < 0 ? `- ₹ ${Math.abs(effectiveRoundOff).toFixed(2)}` : `₹ 0.00`}
              </span>
            </div>
            <div className="pt-2 border-t border-border-main flex justify-between items-center text-sm font-bold text-text-main">
              <span>Final Grand Total</span>
              <span className="text-lg text-accent font-black font-mono">₹ {effectiveFinal.toFixed(2)}</span>
            </div>
          </div>

          {/* Statutory Auto-Roundoff Recommendation */}
          <div className="flex items-center justify-between rounded-card bg-canvas border border-border-main p-2.5 text-xs">
            <div>
              <span className="text-[10px] font-bold text-accent uppercase tracking-wider block">Statutory Auto Round</span>
              <span className="text-text-muted font-medium">
                Nearest ₹ : <strong className="text-text-main font-mono">₹ {autoRo.grandTotal.toFixed(2)}</strong> ({autoRo.roundOff >= 0 ? `+₹${autoRo.roundOff.toFixed(2)}` : `-₹${Math.abs(autoRo.roundOff).toFixed(2)}`})
              </span>
            </div>
            <button
              type="button"
              onClick={handleResetAuto}
              className="flex items-center gap-1 px-2.5 py-1 rounded-btn bg-surface border border-border-main text-accent hover:bg-accent-soft text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              Use Auto
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border-main bg-canvas flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-btn border border-border-main text-xs font-semibold text-text-muted hover:text-text-main hover:bg-surface cursor-pointer transition-colors"
          >
            Cancel (Esc)
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-btn bg-accent hover:opacity-90 text-xs font-bold text-white shadow-xs transition-opacity cursor-pointer"
          >
            <Check className="h-4 w-4" />
            Apply Round-Off (Enter)
          </button>
        </div>
      </div>
    </div>
  );
};

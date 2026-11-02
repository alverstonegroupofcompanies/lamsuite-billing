import React, { useState } from "react";
import { X, Check, RotateCcw, AlertTriangle, ShieldCheck } from "lucide-react";
import { posCartService } from "../lib/billing/posCartService";
import type { CompanyTaxMode } from "../lib/tax-engine/taxEngine";

interface TaxOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplied: () => void;
}

export const TaxOverrideModal: React.FC<TaxOverrideModalProps> = ({
  isOpen,
  onClose,
  onApplied,
}) => {
  if (!isOpen) return null;

  const currentActive = posCartService.getActiveTaxMode();
  const [selectedGstType, setSelectedGstType] = useState<"regular" | "composition" | "no_tax">(currentActive.gstType);
  const [selectedTaxMode, setSelectedTaxMode] = useState<CompanyTaxMode>(currentActive.taxMode);

  const handleApply = () => {
    posCartService.setTaxOverride({
      gstType: selectedGstType,
      taxMode: selectedTaxMode,
    });
    onApplied();
    onClose();
  };

  const handleReset = () => {
    posCartService.clearTaxOverride();
    onApplied();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-[var(--color-accent)]" />
            <h3 className="text-sm font-bold text-[var(--color-text)]">Bill Tax Mode Override</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              This override applies exclusively to the <strong>active bill</strong>. It will automatically reset once this bill is finalized or cleared.
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
              Statutory Tax Regime (GST Type)
            </label>
            <div className="grid grid-cols-1 gap-2">
              {[
                { id: "regular", label: "GST Regular (Tax Invoice)", desc: "Calculates statutory CGST/SGST/IGST tax lines" },
                { id: "composition", label: "Composition Scheme (Bill of Supply)", desc: "0% GST, no tax charged to customer" },
                { id: "no_tax", label: "Unregistered / No Tax (Bill of Supply)", desc: "0% GST, issues statutory Bill of Supply" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedGstType(opt.id as any)}
                  className={`flex items-start text-left gap-3 rounded-xl border p-3 transition-colors cursor-pointer ${
                    selectedGstType === opt.id
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]"
                  }`}
                >
                  <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    selectedGstType === opt.id ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-slate-400"
                  }`}>
                    {selectedGstType === opt.id && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[var(--color-text)]">{opt.label}</div>
                    <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedGstType === "regular" && (
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
                Pricing Calculation Basis
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedTaxMode("inclusive")}
                  className={`rounded-xl border p-2.5 text-center text-xs font-semibold transition-colors cursor-pointer ${
                    selectedTaxMode === "inclusive"
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                      : "border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                  }`}
                >
                  GST Inclusive
                  <div className="text-[10px] text-[var(--color-text-muted)] font-normal mt-0.5">MRP includes tax</div>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTaxMode("exclusive")}
                  className={`rounded-xl border p-2.5 text-center text-xs font-semibold transition-colors cursor-pointer ${
                    selectedTaxMode === "exclusive"
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                      : "border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                  }`}
                >
                  GST Exclusive
                  <div className="text-[10px] text-[var(--color-text-muted)] font-normal mt-0.5">Tax added on top</div>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-5 py-3">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset to Store Defaults</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="rounded-xl bg-[var(--color-accent)] hover:opacity-90 px-4 py-1.5 text-xs font-bold text-white shadow-xs cursor-pointer"
            >
              Apply Override
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

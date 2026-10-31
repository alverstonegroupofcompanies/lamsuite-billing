import React, { useEffect } from "react";
import {
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  X,
  FileCheck,
  Building2,
  Receipt,
  DollarSign,
} from "lucide-react";
import { useModalEscape } from "../../lib/ui/modalEscapeManager";

export interface PostValidationCheckSummary {
  supplierName: string;
  supplierInvoiceNo: string;
  purchaseDate: string;
  itemCount: number;
  totalUnits: number;
  netPayable: number;
  supplierInvoiceTotal?: number;
  difference: number;
  duplicateWarning?: string | null;
  expiredBatches: { product_name: string; batch_no: string; expiry_date: string }[];
  nearExpiryBatches: { product_name: string; batch_no: string; expiry_date: string }[];
  negativeMarginItems: { product_name: string; margin: number; purchase_rate: number; selling_rate: number }[];
  missingHsnGstItems: { product_name: string }[];
  hasBlockers: boolean;
}

interface PurchasePostSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmPost: () => void;
  checks: PostValidationCheckSummary;
  isPosting?: boolean;
}

export const PurchasePostSummaryModal: React.FC<PurchasePostSummaryModalProps> = ({
  isOpen,
  onClose,
  onConfirmPost,
  checks,
  isPosting = false,
}) => {
  useModalEscape(isOpen, onClose);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !checks.hasBlockers && !isPosting) {
        e.preventDefault();
        onConfirmPost();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, checks.hasBlockers, isPosting, onConfirmPost, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 font-sans select-none animate-in fade-in duration-100"
    >
      <div className="w-full max-w-xl rounded-[14px] bg-[var(--color-surface)] shadow-modal border border-[var(--color-border)] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3.5 bg-[var(--color-canvas)]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-btn bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <FileCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--color-text)]">Post Purchase Inward Bill (F12)</h3>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                Review statutory, batch stock & ledger verification checks
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded-btn p-1 transition-colors hover:bg-[var(--color-surface)] cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Summary Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-[10px] bg-[var(--color-canvas)] p-2.5 border border-[var(--color-border)]">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Supplier</span>
              <p className="font-bold text-xs text-[var(--color-text)] truncate mt-0.5">{checks.supplierName}</p>
            </div>
            <div className="rounded-[10px] bg-[var(--color-canvas)] p-2.5 border border-[var(--color-border)]">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Bill Number</span>
              <p className="font-bold text-xs font-mono text-[var(--color-text)] mt-0.5">{checks.supplierInvoiceNo}</p>
            </div>
            <div className="rounded-[10px] bg-[var(--color-canvas)] p-2.5 border border-[var(--color-border)]">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Items / Units</span>
              <p className="font-bold text-xs font-mono text-[var(--color-text)] mt-0.5">{checks.itemCount} / {checks.totalUnits}</p>
            </div>
            <div className="rounded-[10px] bg-[var(--color-canvas)] p-2.5 border border-[var(--color-border)]">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Net Payable</span>
              <p className="font-bold text-sm font-mono text-[var(--color-accent)] mt-0.5">₹ {checks.netPayable.toFixed(2)}</p>
            </div>
          </div>

          {/* Supplier Total Reconciliation Check */}
          {checks.supplierInvoiceTotal !== undefined && (
            <div
              className={`flex items-center justify-between p-3 rounded-[10px] border ${
                Math.abs(checks.difference) < 0.05
                  ? "bg-[var(--color-success-bg)]/30 border-[var(--color-success-border)] text-[var(--color-success-text)]"
                  : "bg-[var(--color-warning-bg)]/40 border-[var(--color-warning-border)] text-[var(--color-warning-text)]"
              }`}
            >
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 shrink-0" />
                <div>
                  <span className="font-bold">Vendor Total Verification:</span>
                  <span className="ml-1 font-mono">₹{checks.supplierInvoiceTotal.toFixed(2)} vs ₹{checks.netPayable.toFixed(2)}</span>
                </div>
              </div>
              <span className="font-bold font-mono text-xs">
                {Math.abs(checks.difference) < 0.05
                  ? "✓ Perfect Match (₹0.00)"
                  : checks.difference > 0
                  ? `▲ Over by ₹${checks.difference.toFixed(2)}`
                  : `▼ Short by ₹${Math.abs(checks.difference).toFixed(2)}`}
              </span>
            </div>
          )}

          {/* Duplicate Bill Warning */}
          {checks.duplicateWarning && (
            <div className="flex items-center gap-2 rounded-[10px] bg-[var(--color-warning-bg)] p-3 text-[var(--color-warning-text)] border border-[var(--color-warning-border)]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{checks.duplicateWarning}</span>
            </div>
          )}

          {/* Blockers: Expired Batches */}
          {checks.expiredBatches.length > 0 && (
            <div className="rounded-[10px] bg-[var(--color-danger-bg)] p-3 text-[var(--color-danger-text)] border border-[var(--color-danger-border)] space-y-1">
              <div className="flex items-center gap-2 font-bold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Expired Batches Detected ({checks.expiredBatches.length}) — Cannot Inward</span>
              </div>
              <ul className="list-disc list-inside text-[11px] pl-2 font-mono">
                {checks.expiredBatches.map((b, i) => (
                  <li key={i}>{b.product_name} (Batch: {b.batch_no}, Exp: {b.expiry_date})</li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings: Near-Expiry Batches */}
          {checks.nearExpiryBatches.length > 0 && (
            <div className="rounded-[10px] bg-[var(--color-warning-bg)]/40 p-3 text-[var(--color-warning-text)] border border-[var(--color-warning-border)] space-y-1">
              <div className="flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Near-Expiry Items (&lt; 90 Days)</span>
              </div>
              <ul className="list-disc list-inside text-[11px] pl-2 font-mono">
                {checks.nearExpiryBatches.map((b, i) => (
                  <li key={i}>{b.product_name} (Batch: {b.batch_no}, Exp: {b.expiry_date})</li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings: Negative Margin Lines */}
          {checks.negativeMarginItems.length > 0 && (
            <div className="rounded-[10px] bg-[var(--color-danger-bg)]/30 p-3 text-[var(--color-danger-text)] border border-[var(--color-danger-border)] space-y-1">
              <div className="flex items-center gap-2 font-bold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Negative Margin Alert: Selling Price Below Purchase Cost!</span>
              </div>
              <ul className="list-disc list-inside text-[11px] pl-2 font-mono">
                {checks.negativeMarginItems.map((m, i) => (
                  <li key={i}>
                    {m.product_name}: Margin {m.margin.toFixed(1)}% (Cost: ₹{m.purchase_rate.toFixed(2)}, Sell: ₹{m.selling_rate.toFixed(2)})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing HSN or GST */}
          {checks.missingHsnGstItems.length > 0 && (
            <div className="rounded-[10px] bg-[var(--color-canvas)] p-3 border border-[var(--color-border)] text-[var(--color-text-muted)] space-y-1">
              <span className="font-bold text-[var(--color-text)]">Missing HSN Code ({checks.missingHsnGstItems.length} items)</span>
              <p className="text-[11px]">Recommended for statutory GSTR-2B ITC filing.</p>
            </div>
          )}

          {/* Double-entry Impact summary */}
          <div className="rounded-[10px] bg-[var(--color-surface-subtle)] p-3 border border-[var(--color-border)] space-y-1 text-[11px]">
            <span className="font-bold text-[var(--color-text)]">Ledger & Inventory Posting Summary:</span>
            <p className="text-[var(--color-text-muted)]">
              • Stock Inward: {checks.totalUnits} smallest units credited to batch inventory and negative stock offset.
            </p>
            <p className="text-[var(--color-text-muted)]">
              • Supplier Ledger: Credit entry of ₹{checks.netPayable.toFixed(2)} posted to {checks.supplierName}.
            </p>
            <p className="text-[var(--color-text-muted)]">
              • Master Rates: Product purchase rates (PTR) and trade pricing updated.
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-[var(--color-border)] px-5 py-3.5 bg-[var(--color-canvas)]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
          >
            Esc to Return &amp; Fix
          </button>

          <button
            type="button"
            disabled={checks.hasBlockers || isPosting}
            onClick={onConfirmPost}
            className="flex items-center gap-2 rounded-[10px] bg-[var(--color-accent)] px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-colors cursor-pointer"
          >
            <CheckCircle className="h-4 w-4" />
            <span>{isPosting ? "Posting..." : "Confirm & Post Purchase (Enter)"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

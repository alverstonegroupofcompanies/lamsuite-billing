import React, { useEffect } from "react";
import {
  CheckCircle,
  Barcode,
  Printer,
  CreditCard,
  PlusCircle,
  X,
  FileText,
} from "lucide-react";
import { useModalEscape } from "../../lib/ui/modalEscapeManager";

interface PurchasePostSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchaseNumber: string;
  purchaseId: string;
  grandTotal: number;
  itemCount: number;
  supplierName: string;
  onPrintLabels: () => void;
  onPrintVoucher: () => void;
  onPaySupplier: () => void;
  onNewBill: () => void;
}

export const PurchasePostSuccessModal: React.FC<PurchasePostSuccessModalProps> = ({
  isOpen,
  onClose,
  purchaseNumber,
  purchaseId,
  grandTotal,
  itemCount,
  supplierName,
  onPrintLabels,
  onPrintVoucher,
  onPaySupplier,
  onNewBill,
}) => {
  useModalEscape(isOpen, onClose);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "l") {
        e.preventDefault();
        onPrintLabels();
      } else if (key === "p") {
        e.preventDefault();
        onPrintVoucher();
      } else if (key === "s") {
        e.preventDefault();
        onPaySupplier();
      } else if (key === "n" || (e.ctrlKey && e.shiftKey && key === "n")) {
        e.preventDefault();
        onNewBill();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onPrintLabels, onPrintVoucher, onPaySupplier, onNewBill, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 font-sans select-none animate-in fade-in duration-100"
    >
      <div className="w-full max-w-md rounded-[14px] bg-[var(--color-surface)] shadow-modal border border-[var(--color-border)] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4 bg-[var(--color-canvas)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-full bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)]">
              <CheckCircle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--color-text)]">Purchase Bill Posted!</h3>
              <p className="text-xs font-mono font-semibold text-[var(--color-accent)]">{purchaseNumber}</p>
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

        {/* Info */}
        <div className="p-5 space-y-4 text-xs">
          <div className="rounded-[10px] bg-[var(--color-surface-subtle)] p-3.5 border border-[var(--color-border)] flex items-center justify-between font-mono">
            <div>
              <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-sans font-bold">Supplier</p>
              <p className="font-bold text-xs text-[var(--color-text)] truncate max-w-[200px]">{supplierName}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-sans font-bold">Total Inward</p>
              <p className="font-bold text-base text-[var(--color-accent)]">₹ {grandTotal.toFixed(2)}</p>
            </div>
          </div>

          <p className="text-[11px] text-[var(--color-text-muted)] text-center">
            Batch stock credited &amp; supplier ledger updated. Select next action with hotkey:
          </p>

          {/* Action options */}
          <div className="grid grid-cols-1 gap-2 pt-1">
            <button
              type="button"
              onClick={onPrintLabels}
              className="flex items-center justify-between rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] p-3 text-xs font-semibold text-[var(--color-text)] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <Barcode className="h-4 w-4 text-[var(--color-accent)]" />
                <span>Print Barcode &amp; Shelf Labels</span>
              </div>
              <kbd className="rounded bg-[var(--color-canvas)] border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--color-text-muted)]">
                L
              </kbd>
            </button>

            <button
              type="button"
              onClick={onPrintVoucher}
              className="flex items-center justify-between rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] p-3 text-xs font-semibold text-[var(--color-text)] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <Printer className="h-4 w-4 text-[var(--color-accent)]" />
                <span>Print Inward Voucher (A4 / Thermal)</span>
              </div>
              <kbd className="rounded bg-[var(--color-canvas)] border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--color-text-muted)]">
                P
              </kbd>
            </button>

            <button
              type="button"
              onClick={onPaySupplier}
              className="flex items-center justify-between rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] p-3 text-xs font-semibold text-[var(--color-text)] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <CreditCard className="h-4 w-4 text-[var(--color-accent)]" />
                <span>Pay Supplier Now (Split Tender)</span>
              </div>
              <kbd className="rounded bg-[var(--color-canvas)] border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--color-text-muted)]">
                S
              </kbd>
            </button>

            <button
              type="button"
              onClick={onNewBill}
              className="flex items-center justify-between rounded-[10px] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white p-3 text-xs font-bold transition-colors cursor-pointer shadow-xs mt-1"
            >
              <div className="flex items-center gap-2.5">
                <PlusCircle className="h-4 w-4" />
                <span>Start New Purchase Bill</span>
              </div>
              <kbd className="rounded bg-black/20 px-2 py-0.5 text-[10px] font-mono text-white/90">
                N
              </kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

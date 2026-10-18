import React, { useState, useEffect } from "react";
import { X, CreditCard, Check, AlertCircle } from "lucide-react";
import { supplierLedgerService, type SupplierMaster } from "../../lib/purchases/supplierLedgerService";
import { useModalEscape } from "../../lib/ui/modalEscapeManager";

interface SupplierPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultSupplierId?: string;
  defaultPurchaseId?: string;
  defaultAmount?: number;
  onPaymentRecorded: () => void;
}

export const SupplierPaymentModal: React.FC<SupplierPaymentModalProps> = ({
  isOpen,
  onClose,
  defaultSupplierId,
  defaultPurchaseId,
  defaultAmount,
  onPaymentRecorded,
}) => {
  useModalEscape(isOpen, onClose);

  const [suppliers, setSuppliers] = useState<SupplierMaster[]>([]);
  const [supplierId, setSupplierId] = useState(defaultSupplierId || "");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState<number | "">(defaultAmount || "");
  const [paymentMode, setPaymentMode] = useState<"Cash" | "Bank Transfer" | "Cheque" | "UPI">("Bank Transfer");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSuppliers();
      if (defaultSupplierId) setSupplierId(defaultSupplierId);
      if (defaultAmount) setAmount(defaultAmount);
    }
  }, [isOpen, defaultSupplierId, defaultAmount]);

  const loadSuppliers = async () => {
    const list = await supplierLedgerService.getAllSuppliers();
    setSuppliers(list);
    if (!supplierId && list.length > 0) {
      setSupplierId(list[0].id);
    }
  };

  if (!isOpen) return null;

  const selectedSupplier = suppliers.find((s) => s.id === supplierId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) {
      setError("Please select a supplier");
      return;
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Please enter a valid positive payment amount");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await supplierLedgerService.recordSupplierPayment({
        supplier_id: supplierId,
        supplier_name: selectedSupplier?.name || "Unknown Supplier",
        payment_date: paymentDate,
        amount: numAmount,
        payment_mode: paymentMode,
        reference_no: referenceNo.trim() || undefined,
        purchase_id: defaultPurchaseId,
        notes: notes.trim() || undefined,
      });

      onPaymentRecorded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 font-sans">
      <div className="w-full max-w-md rounded-[14px] bg-[var(--color-surface)] shadow-modal border border-[var(--color-border)] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3.5 bg-[var(--color-surface)]">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-[var(--color-accent)]" />
            <h3 className="text-sm font-bold text-[var(--color-text)]">Record Supplier Payment</h3>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {error && (
            <div className="flex items-center gap-2 rounded-[10px] bg-[var(--color-danger-bg)] p-2.5 text-[var(--color-danger-text)] border border-[var(--color-danger-border)]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="font-semibold text-[var(--color-text)] block mb-1">Supplier *</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)]"
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (Balance: ₹ {Number(s.outstanding_balance || 0).toFixed(2)})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-[var(--color-text)] block mb-1">Payment Date *</label>
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)] font-mono"
              />
            </div>
            <div>
              <label className="font-semibold text-[var(--color-text)] block mb-1">Amount (₹) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="0.00"
                className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 text-xs font-bold font-mono text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-[var(--color-text)] block mb-1">Payment Mode</label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as any)}
                className="w-full rounded-[10px] border border-[var(--color-border)] px-2.5 py-2 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)]"
              >
                <option value="Bank Transfer">Bank Transfer (NEFT/RTGS/IMPS)</option>
                <option value="UPI">UPI / QR Code</option>
                <option value="Cheque">Cheque</option>
                <option value="Cash">Cash</option>
              </select>
            </div>
            <div>
              <label className="font-semibold text-[var(--color-text)] block mb-1">Ref # / UTR / Cheque #</label>
              <input
                type="text"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder="e.g. UTR-998822"
                className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 text-xs font-mono text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)]"
              />
            </div>
          </div>

          <div>
            <label className="font-semibold text-[var(--color-text)] block mb-1">Notes / Remarks</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cleared bill SUP-9901"
              className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)]"
            />
          </div>

          <div className="border-t border-[var(--color-border)] pt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-accent)] px-4 py-1.5 font-bold text-white shadow-2xs hover:bg-[var(--color-accent-hover)] disabled:opacity-50 cursor-pointer transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
              <span>Record Payment</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

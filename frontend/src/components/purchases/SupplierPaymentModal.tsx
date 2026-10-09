import React, { useState, useEffect } from "react";
import { X, CreditCard, Check, AlertCircle } from "lucide-react";
import { supplierLedgerService, type SupplierMaster } from "../../lib/purchases/supplierLedgerService";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-800">Record Supplier Payment</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-2.5 text-red-700 border border-red-200">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Supplier *</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none bg-white"
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
              <label className="font-semibold text-slate-700 block mb-1">Payment Date *</label>
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Amount (₹) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="0.00"
                className="w-full rounded border border-slate-300 px-3 py-2 text-xs font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Payment Mode</label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as any)}
                className="w-full rounded border border-slate-300 px-2.5 py-2 text-xs focus:border-blue-600 focus:outline-none bg-white"
              >
                <option value="Bank Transfer">Bank Transfer (NEFT/RTGS/IMPS)</option>
                <option value="UPI">UPI / QR Code</option>
                <option value="Cheque">Cheque</option>
                <option value="Cash">Cash</option>
              </select>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Ref # / UTR / Cheque #</label>
              <input
                type="text"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder="e.g. UTR-998822"
                className="w-full rounded border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Notes / Remarks</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cleared bill SUP-9901"
              className="w-full rounded border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="border-t border-slate-200 pt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 bg-white px-3.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded bg-emerald-600 px-4 py-1.5 font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
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

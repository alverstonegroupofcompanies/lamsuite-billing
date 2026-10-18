import React, { useState } from "react";
import { X, Building2, Check, AlertCircle } from "lucide-react";
import { supplierLedgerService, type SupplierMaster } from "../../lib/purchases/supplierLedgerService";
import { isValidGstin, isValidIndianPhone } from "../../lib/masters/partiesStore";
import { useModalEscape } from "../../lib/ui/modalEscapeManager";

interface SupplierQuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSupplierCreated: (supplier: SupplierMaster) => void;
}

export const SupplierQuickAddModal: React.FC<SupplierQuickAddModalProps> = ({
  isOpen,
  onClose,
  onSupplierCreated,
}) => {
  useModalEscape(isOpen, onClose);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  const [address, setAddress] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState("Kerala (32)");
  const [creditDays, setCreditDays] = useState(30);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Supplier name is required");
      return;
    }
    if (gstin.trim() && !isValidGstin(gstin.trim())) {
      setError("Invalid 15-character GSTIN format");
      return;
    }
    if (phone.trim() && !isValidIndianPhone(phone.trim())) {
      setError("Please enter a valid 10-digit mobile number");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const id = `sup_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
      const cleanGstin = gstin.trim().toUpperCase();
      const stateCode = cleanGstin.length >= 2 ? cleanGstin.slice(0, 2) : "32";

      const newSupplier: SupplierMaster = {
        id,
        name: name.trim(),
        phone: phone.trim() || undefined,
        gstin: cleanGstin || undefined,
        address: address.trim() || undefined,
        state_code: stateCode,
        place_of_supply: placeOfSupply,
        credit_period_days: Number(creditDays) || 30,
        opening_balance: Number(openingBalance) || 0,
        outstanding_balance: Number(openingBalance) || 0,
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      await supplierLedgerService.upsertSupplier(newSupplier);
      onSupplierCreated(newSupplier);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create supplier");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 font-sans">
      <div className="w-full max-w-md rounded-[14px] bg-[var(--color-surface)] shadow-modal border border-[var(--color-border)] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3.5 bg-[var(--color-surface)]">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-[var(--color-accent)]" />
            <h3 className="text-sm font-bold text-[var(--color-text)]">Quick Add Supplier</h3>
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
            <label className="font-semibold text-[var(--color-text)] block mb-1">Company / Supplier Name *</label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Apex Health Logistics Pvt Ltd"
              className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-[var(--color-text)] block mb-1">GSTIN (Optional)</label>
              <input
                type="text"
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="32AAAAA0000A1Z5"
                maxLength={15}
                className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 font-mono text-xs uppercase text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)]"
              />
            </div>
            <div>
              <label className="font-semibold text-[var(--color-text)] block mb-1">Mobile / Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9876543210"
                maxLength={12}
                className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-[var(--color-text)] block mb-1">Place of Supply</label>
              <select
                value={placeOfSupply}
                onChange={(e) => setPlaceOfSupply(e.target.value)}
                className="w-full rounded-[10px] border border-[var(--color-border)] px-2.5 py-2 text-xs focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)] text-[var(--color-text)]"
              >
                <option value="Kerala (32)">Kerala (32)</option>
                <option value="Tamil Nadu (33)">Tamil Nadu (33)</option>
                <option value="Karnataka (29)">Karnataka (29)</option>
                <option value="Maharashtra (27)">Maharashtra (27)</option>
                <option value="Delhi (07)">Delhi (07)</option>
                <option value="Other State">Other State</option>
              </select>
            </div>
            <div>
              <label className="font-semibold text-[var(--color-text)] block mb-1">Credit Days</label>
              <input
                type="number"
                min="0"
                value={creditDays}
                onChange={(e) => setCreditDays(Number(e.target.value) || 0)}
                className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)] font-mono"
              />
            </div>
          </div>

          <div>
            <label className="font-semibold text-[var(--color-text)] block mb-1">Address (Optional)</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Door No, Building, Street, City"
              className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)]"
            />
          </div>

          <div>
            <label className="font-semibold text-[var(--color-text)] block mb-1">Opening Balance (₹)</label>
            <input
              type="number"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(Number(e.target.value))}
              placeholder="0.00"
              className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 text-xs font-mono text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)]"
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
              <span>Save Supplier</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

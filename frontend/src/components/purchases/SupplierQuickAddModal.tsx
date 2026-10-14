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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-800">Quick Add Supplier</h3>
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
            <label className="font-semibold text-slate-700 block mb-1">Company / Supplier Name *</label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Apex Health Logistics Pvt Ltd"
              className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">GSTIN (Optional)</label>
              <input
                type="text"
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="32AAAAA0000A1Z5"
                maxLength={15}
                className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs uppercase focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Mobile / Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9876543210"
                maxLength={12}
                className="w-full rounded border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Place of Supply</label>
              <select
                value={placeOfSupply}
                onChange={(e) => setPlaceOfSupply(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-2 text-xs focus:border-blue-600 focus:outline-none bg-white"
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
              <label className="font-semibold text-slate-700 block mb-1">Credit Days</label>
              <input
                type="number"
                min="0"
                value={creditDays}
                onChange={(e) => setCreditDays(Number(e.target.value))}
                placeholder="30"
                className="w-full rounded border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Address (Optional)</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Door No, Building, Street, City"
              className="w-full rounded border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Opening Balance (₹)</label>
            <input
              type="number"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(Number(e.target.value))}
              placeholder="0.00"
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
              className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-1.5 font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
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

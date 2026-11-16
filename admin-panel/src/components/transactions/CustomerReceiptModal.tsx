import React, { useEffect, useState } from "react";
import { X, CreditCard, Loader2 } from "lucide-react";
import { api } from "../../services/api";
import { formatINR } from "../../utils/formatters";

interface CustomerOption {
  id: number;
  name: string;
  phone?: string;
  current_balance?: number;
}

interface CustomerReceiptModalProps {
  storeId?: number | string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const todayValue = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const CustomerReceiptModal: React.FC<CustomerReceiptModalProps> = ({ storeId, onClose, onSaved }) => {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("UPI");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayValue());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!storeId) return;
      try {
        const res = await api.get<{ data: CustomerOption[] }>("/admin/parties", {
          active_store_id: storeId,
          type: "customer",
          per_page: 500,
          export: "true",
        });
        if (!cancelled) setCustomers(res.data || []);
      } catch (err) {
        console.error("Failed to load customers", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const selected = customers.find((c) => String(c.id) === customerId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!customerId || !amount) {
      setError("Choose a customer and enter the received amount.");
      return;
    }

    setIsSaving(true);
    try {
      await api.post("/admin/payments/customer", {
        store_id: storeId,
        customer_id: Number(customerId),
        amount: Number(amount),
        payment_mode: mode,
        reference_no: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        payment_date: paymentDate,
      });
      onSaved(`Receipt of ${formatINR(Number(amount))} recorded for ${selected?.name || "customer"}.`);
    } catch (err: any) {
      setError(err?.message || "Failed to record the receipt.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-brand-600" />
            <span>Record Customer Receipt</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" type="button">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Customer *</label>
            <select
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              disabled={isLoading}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
            >
              <option value="">{isLoading ? "Loading…" : "-- Choose customer --"}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (Outstanding: {formatINR(c.current_balance || 0)})
                </option>
              ))}
            </select>
            {selected && (
              <p className="mt-1 text-[11px] text-slate-400">
                Current outstanding: <span className="font-mono">{formatINR(selected.current_balance || 0)}</span>
                {selected.phone ? ` · ${selected.phone}` : ""}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Amount (₹) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Received On</label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Payment Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
            >
              <option value="UPI">UPI</option>
              <option value="Cash">Cash</option>
              <option value="Card">Card</option>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Cheque">Cheque</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Reference / UTR</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. UPI-2291045"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Part payment against October bills"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white font-bold rounded-xl"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Record Receipt
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

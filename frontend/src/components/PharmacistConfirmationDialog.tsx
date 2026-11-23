import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, Pill, X } from "lucide-react";
import { salespersonStore, type SalespersonMaster } from "../lib/masters/salespersonStore";
import type { PharmacistCredential, PharmacistConfirmationRequiredError } from "../lib/billing/pharmacistGate";

interface PharmacistConfirmationDialogProps {
  open: boolean;
  /** The server's refusal — the held lines and, on a retry, why the last PIN failed. */
  refusal: PharmacistConfirmationRequiredError | null;
  onClose: () => void;
  /** Hands one credential over for one live retry. Nothing keeps it. */
  onConfirmed: (credential: PharmacistCredential) => void;
}

/**
 * GAP-02 / PHR-004, PHR-006 — the pharmacist's moment at the till.
 *
 * A restricted drug is not the counter's to sell: the bill stops here until the
 * person holding a registration says so with their own PIN. The list is pulled
 * fresh because a registration renewed an hour ago has to count on this bill,
 * and the PIN is typed for one request — it is never printed, cached or queued.
 */
export function PharmacistConfirmationDialog({
  open,
  refusal,
  onClose,
  onConfirmed,
}: PharmacistConfirmationDialogProps) {
  const [pharmacists, setPharmacists] = useState<SalespersonMaster[]>([]);
  const [pharmacistId, setPharmacistId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !refusal) return;

    setPharmacistId("");
    setPin("");
    setError("");

    let active = true;
    (async () => {
      // A stale cache has been refusing renewals for months; ask the server.
      await salespersonStore.ensureSalespeoplePopulated(true).catch(() => {});
      const list = await salespersonStore.pharmacists().catch(() => []);
      if (active) setPharmacists(list);
    })();

    return () => {
      active = false;
    };
  }, [open, refusal]);

  if (!open || !refusal) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (pharmacistId === "") {
      setError("Choose the pharmacist on duty.");
      return;
    }

    if (pin.trim() === "") {
      setError("Enter the pharmacist's PIN.");
      return;
    }

    onConfirmed({ pharmacistId, pin: pin.trim() });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Pharmacist confirmation required"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              <Pill className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-[var(--color-text-primary)]">Pharmacist required</h2>
              <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
                This bill has not been saved. A scheduled drug is on it.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-[11px] font-medium text-[var(--color-text-primary)]">{refusal.message}</p>

          <ul className="space-y-1.5 rounded-xl bg-[var(--color-surface-muted)] px-3 py-2.5">
            {refusal.restrictedItems.map((item, index) => (
              <li key={`${item.line}-${item.product_id ?? item.product_name}-${index}`} className="text-[11px]">
                <span className="block font-bold text-[var(--color-text-primary)]">{item.product_name}</span>
                <span className="block text-[10px] text-[var(--color-text-secondary)]">
                  {item.batch_no ? `Batch ${item.batch_no}` : "No batch"}
                  {item.schedule_code ? ` · Schedule ${item.schedule_code}` : ""} · {item.qty} sold
                </span>
              </li>
            ))}
          </ul>

          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">
              Pharmacist
            </span>
            <select
              value={pharmacistId}
              onChange={(event) => setPharmacistId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-emerald-500"
            >
              <option value="">Select the pharmacist on duty</option>
              {pharmacists.map((person) => (
                <option key={person.id} value={String(person.id)}>
                  {person.name}
                  {person.reg_no ? ` — ${person.reg_no}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">
              Pharmacist PIN
            </span>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm tracking-[0.35em] text-[var(--color-text-primary)] outline-none focus:border-emerald-500"
              placeholder="••••••"
            />
          </label>

          {pharmacists.length === 0 ? (
            <p className="text-[10px] text-[var(--color-text-secondary)]">
              No pharmacist with a live registration is on this store&rsquo;s staff list, so this bill cannot be
              saved from this till.
            </p>
          ) : null}

          {refusal.fix ? (
            <p className="text-[10px] text-[var(--color-text-secondary)]">{refusal.fix}</p>
          ) : null}

          {error ? (
            <p className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-[11px] font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="cursor-pointer rounded-lg bg-emerald-600 px-3.5 py-2 text-[11px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
          >
            Confirm & save bill
          </button>
        </div>
      </form>
    </div>
  );
}

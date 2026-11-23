import { FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, KeyRound, ShieldCheck, X } from "lucide-react";
import {
  approvalActionLabel,
  requestApprovalGrant,
  type ApprovalMode,
} from "../lib/billing/approvalGateService";

interface ApprovalDialogProps {
  open: boolean;
  /** The action keys the server said need a grant (`pos.discount`, …). */
  actions: string[];
  /** Why each action was deferred, as the server worded it. */
  reasons: Record<string, string>;
  /** The bill identity the grant is bound to. */
  externalId: string;
  onClose: () => void;
  onGranted: (token: string) => void;
}

/**
 * APR-003..010 — the approver's moment on the till.
 *
 * A bill above the owner's threshold is held here, not saved: an approver types
 * their PIN (or a one-time PIN an administrator issued), the counter exchanges
 * it for a single-use grant, and the same bill is sent again with the grant.
 * No credential is kept after the exchange.
 */
export function ApprovalDialog({ open, actions, reasons, externalId, onClose, onGranted }: ApprovalDialogProps) {
  const [mode, setMode] = useState<ApprovalMode>("approver_pin");
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    setMode("approver_pin");
    setIdentifier("");
    setPin("");
    setReason("");
    setBusy(false);
    setError("");

    const timer = setTimeout(() => pinRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open, externalId]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (mode === "approver_pin" && identifier.trim() === "") {
      setError("Enter the approver's username or email.");
      return;
    }

    if (pin.trim().length < 4) {
      setError("Enter the approver PIN.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const token = await requestApprovalGrant({
        externalId,
        actions,
        mode,
        identifier: mode === "approver_pin" ? identifier : undefined,
        pin: pin.trim(),
        reason,
      });

      onGranted(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The approval could not be granted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Approver required"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-[var(--color-text-primary)]">Approver required</h2>
              <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
                This bill is above what the counter may do on its own. It has not been saved.
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
          <ul className="space-y-1.5 rounded-xl bg-[var(--color-surface-muted)] px-3 py-2.5">
            {actions.map((action) => (
              <li key={action} className="flex items-start gap-2 text-[11px] font-medium text-[var(--color-text-primary)]">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span>
                  {approvalActionLabel(action)}
                  {reasons[action] ? (
                    <span className="block text-[10px] font-normal text-[var(--color-text-secondary)]">{reasons[action]}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: "approver_pin", label: "Approver PIN" },
                { id: "one_time_pin", label: "One-time PIN" },
              ] as Array<{ id: ApprovalMode; label: string }>
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setMode(option.id)}
                className={`rounded-lg border px-3 py-2 text-[11px] font-bold transition-colors cursor-pointer ${
                  mode === option.id
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                    : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {mode === "approver_pin" ? (
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">
                Approver username or email
              </span>
              <input
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-emerald-500"
                placeholder="e.g. floor.manager"
              />
            </label>
          ) : null}

          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">
              {mode === "approver_pin" ? "Approver PIN" : "One-time PIN"}
            </span>
            <div className="relative mt-1">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-secondary)]" />
              <input
                ref={pinRef}
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                autoComplete="off"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 font-mono text-sm tracking-[0.35em] text-[var(--color-text-primary)] outline-none focus:border-emerald-500"
                placeholder="••••••"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">
              Reason <span className="font-normal normal-case">(optional, kept on the audit trail)</span>
            </span>
            <input
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-emerald-500"
              placeholder="e.g. Damaged pack agreed with the customer"
            />
          </label>

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
            disabled={busy}
            className="cursor-pointer rounded-lg bg-emerald-600 px-3.5 py-2 text-[11px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Checking…" : "Approve & save bill"}
          </button>
        </div>
      </form>
    </div>
  );
}

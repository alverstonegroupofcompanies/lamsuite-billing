import React, { useEffect, useState } from "react";
import { AlertCircle, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { ModalLayer } from "../lib/modal/CentralModalManager";
import {
  invoiceApprovalService,
  type InvoiceApprovalAction,
  type InvoiceApprovalGrant,
  type InvoiceApprovalMode,
} from "../lib/billing/invoiceApprovalService";
import type { InvoiceRecord } from "../lib/billing/invoiceManagementService";
import { storeRegistryService } from "../lib/auth/storeRegistryService";
import { staffAuthService } from "../lib/auth/staffAuthService";

export interface InvoiceApprovalDialogProps {
  isOpen: boolean;
  action: InvoiceApprovalAction;
  invoice: InvoiceRecord | null;
  onClose: () => void;
  onApproved: (grant: InvoiceApprovalGrant, reason: string) => void | Promise<void>;
}

/**
 * Shared approval gate for privileged invoice operations. The server verifies
 * the approving manager's own credentials or an admin-issued one-time PIN; no
 * PIN is ever hardcoded or stored on the terminal.
 */
export const InvoiceApprovalDialog: React.FC<InvoiceApprovalDialogProps> = ({
  isOpen,
  action,
  invoice,
  onClose,
  onApproved,
}) => {
  const [mode, setMode] = useState<InvoiceApprovalMode>("manager");
  const [identifier, setIdentifier] = useState("");
  const [secret, setSecret] = useState("");
  const [staffUserId, setStaffUserId] = useState("");
  const [oneTimePin, setOneTimePin] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMode("manager");
    setIdentifier("");
    setSecret("");
    setStaffUserId("");
    setOneTimePin("");
    setReason("");
    setError("");
    setIsSubmitting(false);
  }, [isOpen, invoice?.id, action]);

  const isCancel = action === "cancel";
  const title = isCancel ? "Authorize Invoice Cancellation" : "Authorize Invoice Edit";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!invoice || isSubmitting) return;

    if (isCancel && !reason.trim()) {
      setError("A cancellation reason is mandatory.");
      return;
    }

    const session = staffAuthService.getCurrentSession();
    const activeStore = storeRegistryService.getActiveStore();
    const storeId = String(activeStore?.id || session?.user?.store_id || "");
    if (!storeId) {
      setError("No active store. Select a store before requesting approval.");
      return;
    }
    const counterCode = activeStore?.counter_code || session?.counterCode || "C01";

    setError("");
    setIsSubmitting(true);
    try {
      const result =
        mode === "manager"
          ? await invoiceApprovalService.verifyManager({
              storeId,
              invoiceId: invoice.id,
              action,
              identifier,
              secret,
              requestedBy: session?.user?.full_name || session?.user?.username,
              counterCode,
              reason: reason.trim() || undefined,
            })
          : await invoiceApprovalService.verifyOneTimePin({
              storeId,
              invoiceId: invoice.id,
              action,
              userId: staffUserId.trim(),
              pin: oneTimePin,
              counterCode,
              reason: reason.trim() || undefined,
            });

      if (!result.success || !result.grant) {
        setError(result.error || "Approval failed.");
        return;
      }

      invoiceApprovalService.saveGrant(invoice.id, result.grant);
      await onApproved(result.grant, reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalLayer
      isOpen={isOpen && Boolean(invoice)}
      onClose={onClose}
      ariaLabel={title}
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4 font-sans"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-modal space-y-3.5"
      >
        <div className="flex items-center gap-2 text-[var(--color-warning-text)]">
          <Lock className="h-5 w-5" />
          <div>
            <h3 className="font-bold text-[var(--color-text)] text-sm">{title}</h3>
            <p className="text-[11px] text-[var(--color-text-muted)] font-mono">
              {invoice?.invoice_number}
            </p>
          </div>
        </div>

        <p className="text-xs text-[var(--color-text-muted)]">
          {isCancel
            ? "Cancelling restores stock and reverses payments. Manager credentials or an admin-issued one-time PIN are required."
            : "Editing a saved invoice requires manager verification. The approving manager is recorded in the audit trail."}
        </p>

        <div className="grid grid-cols-2 gap-1.5 rounded-[10px] bg-[var(--color-surface-subtle)] p-1">
          <button
            type="button"
            onClick={() => {
              setMode("manager");
              setError("");
            }}
            className={`flex items-center justify-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[11px] font-bold transition-colors cursor-pointer ${
              mode === "manager"
                ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-2xs"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Manager credentials</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("one_time_pin");
              setError("");
            }}
            className={`flex items-center justify-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[11px] font-bold transition-colors cursor-pointer ${
              mode === "one_time_pin"
                ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-2xs"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>One-time PIN</span>
          </button>
        </div>

        {mode === "manager" ? (
          <>
            <div>
              <label
                htmlFor="invoice-approval-identifier"
                className="text-[11px] font-semibold text-[var(--color-text-muted)] block mb-1"
              >
                Manager Username or Email
              </label>
              <input
                id="invoice-approval-identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="manager"
                autoComplete="username"
                className="w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="invoice-approval-secret"
                className="text-[11px] font-semibold text-[var(--color-text-muted)] block mb-1"
              >
                Manager Password or PIN
              </label>
              <input
                id="invoice-approval-secret"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Enter your own password or PIN"
                autoComplete="current-password"
                className="w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-mono tracking-widest text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label
                htmlFor="invoice-approval-staff-user"
                className="text-[11px] font-semibold text-[var(--color-text-muted)] block mb-1"
              >
                Staff User ID the PIN was issued for
              </label>
              <input
                id="invoice-approval-staff-user"
                type="text"
                value={staffUserId}
                onChange={(e) => setStaffUserId(e.target.value)}
                placeholder="User ID"
                className="w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-mono text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="invoice-approval-one-time-pin"
                className="text-[11px] font-semibold text-[var(--color-text-muted)] block mb-1"
              >
                One-time PIN
              </label>
              <input
                id="invoice-approval-one-time-pin"
                type="password"
                inputMode="numeric"
                value={oneTimePin}
                onChange={(e) => setOneTimePin(e.target.value)}
                placeholder="6-digit PIN"
                className="w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-center text-sm font-mono tracking-[0.35em] text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>
            <p className="text-[10px] leading-relaxed text-[var(--color-text-muted)]">
              An administrator issues this PIN from Admin Panel → Transactions → Allow edit. It is shown
              once, is bound to this invoice and user, and expires in minutes.
            </p>
          </>
        )}

        <div>
          <label
            htmlFor="invoice-approval-reason"
            className="text-[11px] font-semibold text-[var(--color-text-muted)] block mb-1"
          >
            {isCancel ? "Cancellation Reason (mandatory)" : "Reason (optional)"}
          </label>
          <input
            id="invoice-approval-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={isCancel ? "e.g., Customer returned items, Billing mistake..." : "Why is this bill being revised?"}
            className="w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>

        {error && (
          <div className="flex items-start gap-1.5 rounded-[8px] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] p-2 text-[11px] font-semibold text-[var(--color-danger-text)]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className={`rounded-[10px] px-4 py-1.5 text-xs font-bold text-white transition-colors cursor-pointer disabled:opacity-50 ${
              isCancel
                ? "bg-[var(--color-danger-text)] hover:bg-red-700"
                : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
            }`}
          >
            {isSubmitting ? "Verifying..." : isCancel ? "Authorize Cancellation" : "Authorize Edit"}
          </button>
        </div>
      </form>
    </ModalLayer>
  );
};

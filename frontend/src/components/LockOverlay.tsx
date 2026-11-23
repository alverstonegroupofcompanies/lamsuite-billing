import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, KeyRound, Lock, RefreshCw } from "lucide-react";
import { counterLockingService } from "../lib/auth/counterLockingService";

/**
 * PRF-005 — the counter's own lock screen.
 *
 * It is the counter that idle-locked this workstation, so it is the counter's
 * PIN that opens it: what is typed is compared only against this counter's
 * credential — on the server, or against the hash cached for this counter while
 * the till is offline. The screens behind it stay mounted, so an open cart is
 * still there when the PIN is right.
 */
export const LockOverlay: React.FC = () => {
  const [state, setState] = useState(counterLockingService.state());
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => counterLockingService.subscribe(setState), []);

  useEffect(() => {
    setPin("");
    setErrorMsg("");
    if (!state.isLocked) return;
    const focus = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(focus);
  }, [state.isLocked]);

  if (!state.isLocked) return null;

  const handleUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pin || isBusy) return;

    setIsBusy(true);
    setErrorMsg("");
    try {
      const result = await counterLockingService.unlock(pin);
      if (!result.success) {
        const attempts =
          typeof result.remainingAttempts === "number" ? `${result.remainingAttempts} attempts left` : null;
        setErrorMsg([result.error, attempts].filter(Boolean).join(" "));
        setPin("");
        inputRef.current?.focus();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "The counter could not be unlocked.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      data-lock-overlay="true"
      className="fixed inset-0 z-50 bg-black/50 flex flex-col items-center justify-center p-4 font-sans text-[var(--color-text)] select-none"
    >
      <div className="max-w-sm w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[14px] p-6 sm:p-8 shadow-modal text-center space-y-5">
        <div className="mx-auto w-16 h-16 rounded-[12px] bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)]">
          <Lock className="w-8 h-8" />
        </div>

        <div>
          <h2 className="text-base font-bold text-[var(--color-text)]">{state.counterName}</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            {`${state.counterCode ? `${state.counterCode} • ` : ""}Locked after ${state.idleLockMinutes} idle minutes`}
          </p>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="p-2.5 rounded-[10px] bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] text-xs text-[var(--color-danger-text)] flex items-center justify-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {state.pinSet ? (
          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label
                htmlFor="counter-unlock-pin"
                className="block text-[11px] text-[var(--color-text-muted)] mb-1.5 font-medium uppercase tracking-wider"
              >
                Unlock PIN
              </label>
              <input
                ref={inputRef}
                id="counter-unlock-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                required
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
                className="w-full tracking-widest text-center text-xl font-mono py-2.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[10px] text-[var(--color-text)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={isBusy || pin === "" || state.ownerResetRequired}
              className="w-full py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-bold text-xs rounded-[10px] shadow-xs flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBusy ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Unlock counter</span>
                </>
              )}
            </button>
          </form>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">
            This counter has no unlock PIN yet. Ask the store owner to set one in Admin Panel → Counters.
          </p>
        )}
      </div>
    </div>
  );
};

import React, { useState, useEffect, useRef } from "react";
import { Lock, User, KeyRound, LogOut, RefreshCw, AlertCircle, Users } from "lucide-react";
import { staffAuthService, type ActiveStaffSession } from "../lib/auth/staffAuthService";

interface LockOverlayProps {
  session: ActiveStaffSession;
  onSwitchUser: () => void;
}

export const LockOverlay: React.FC<LockOverlayProps> = ({ session, onSwitchUser }) => {
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPin("");
    setErrorMsg("");
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  }, [session.isLocked]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    setIsUnlocking(true);
    setErrorMsg("");

    try {
      const res = await staffAuthService.unlockCurrentSession(pin);
      if (!res.success) {
        setErrorMsg(res.error || "Incorrect PIN");
        setPin("");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to unlock.");
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <div
      data-lock-overlay="true"
      className="fixed inset-0 z-50 bg-black/50 flex flex-col items-center justify-center p-4 font-sans text-[var(--color-text)] select-none"
    >
      <div className="max-w-sm w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[14px] p-6 sm:p-8 shadow-modal text-center space-y-5">
        <div className="relative mx-auto w-16 h-16 rounded-[12px] bg-[var(--color-surface-subtle)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)]">
          <User className="w-8 h-8" />
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)] flex items-center justify-center shadow-xs">
            <Lock className="w-3.5 h-3.5" />
          </div>
        </div>

        <div>
          <h2 className="text-base font-bold text-[var(--color-text)]">{session.user.full_name}</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            {session.counterName} • Locked for security
          </p>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded-[10px] bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] text-xs text-[var(--color-danger-text)] flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <label className="block text-[11px] text-[var(--color-text-muted)] mb-1.5 font-medium uppercase tracking-wider">
              Enter Quick PIN to Resume
            </label>
            <input
              ref={inputRef}
              type="password"
              maxLength={6}
              required
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              className="w-full tracking-widest text-center text-xl font-mono py-2.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[10px] text-[var(--color-text)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={isUnlocking}
            className="w-full py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-bold text-xs rounded-[10px] shadow-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
          >
            {isUnlocking ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <KeyRound className="w-4 h-4" />
                <span>Unlock Terminal</span>
              </>
            )}
          </button>
        </form>

        <div className="pt-2 border-t border-[var(--color-border)] flex justify-between text-xs text-[var(--color-text-muted)]">
          <button
            type="button"
            onClick={onSwitchUser}
            className="hover:text-[var(--color-text)] flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Users className="w-3.5 h-3.5" />
            <span>Switch Cashier</span>
          </button>

          <button
            type="button"
            onClick={() => staffAuthService.logout()}
            className="text-[var(--color-danger-text)] hover:opacity-80 flex items-center gap-1.5 cursor-pointer font-medium transition-opacity"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};

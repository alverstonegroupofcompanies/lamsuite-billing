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
      className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-4 font-sans text-white select-none"
    >
      <div className="max-w-sm w-full bg-slate-900 border border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl text-center space-y-5">
        <div className="relative mx-auto w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-blue-400">
          <User className="w-8 h-8" />
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center shadow-md">
            <Lock className="w-3.5 h-3.5" />
          </div>
        </div>

        <div>
          <h2 className="text-base font-bold text-white">{session.user.full_name}</h2>
          <p className="text-xs text-slate-400">
            {session.counterName} • Locked for security
          </p>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1.5 font-medium">
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
              className="w-full tracking-widest text-center text-xl font-mono py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={isUnlocking}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 cursor-pointer transition-all"
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

        <div className="pt-2 border-t border-slate-800 flex justify-between text-xs text-slate-400">
          <button
            type="button"
            onClick={onSwitchUser}
            className="hover:text-blue-400 flex items-center gap-1.5 cursor-pointer"
          >
            <Users className="w-3.5 h-3.5" />
            <span>Switch Cashier</span>
          </button>

          <button
            type="button"
            onClick={() => staffAuthService.logout()}
            className="hover:text-red-400 flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect, useRef } from "react";
import { Users, Lock, KeyRound, X, AlertCircle, RefreshCw } from "lucide-react";
import { staffAuthService, type StaffUser } from "../lib/auth/staffAuthService";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

interface AccountSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitched: () => void;
}

export const AccountSwitcherModal: React.FC<AccountSwitcherModalProps> = ({
  isOpen,
  onClose,
  onSwitched,
}) => {
  useModalEscape(isOpen, onClose);

  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<StaffUser | null>(null);
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      staffAuthService.listActiveStaff().then((list) => {
        setStaffList(list);
        const currentSession = staffAuthService.getCurrentSession();
        const otherUsers = list.filter((u) => u.id !== currentSession?.user.id);
        if (otherUsers.length > 0) {
          setSelectedUser(otherUsers[0]);
        } else if (list.length > 0) {
          setSelectedUser(list[0]);
        }
      });
      setPin("");
      setErrorMsg("");
      setTimeout(() => pinInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSwitchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !pin) return;
    setIsLoading(true);
    setErrorMsg("");

    try {
      const res = await staffAuthService.switchUser(selectedUser.id, pin);
      if (!res.success) {
        setErrorMsg(res.error || "Failed to switch cashier.");
        setPin("");
      } else {
        onSwitched();
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to switch user.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 font-sans select-none">
      <div className="bg-slate-900 border border-slate-700 max-w-md w-full rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Users className="w-4 h-4 text-blue-400" />
            <span>Switch Counter Cashier</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-400">
          Changing cashiers preserves all active cart lines and held bills without interruption.
        </p>

        {errorMsg && (
          <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSwitchSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Select Incoming Operator
            </label>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {staffList.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => {
                    setSelectedUser(user);
                    setPin("");
                    pinInputRef.current?.focus();
                  }}
                  className={`w-full text-left p-2.5 rounded-xl border flex items-center justify-between text-xs transition-colors cursor-pointer ${
                    selectedUser?.id === user.id
                      ? "bg-blue-600/20 border-blue-500 text-white"
                      : "bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <div className="font-bold">{user.full_name}</div>
                  <div className="text-[11px] text-slate-400 capitalize">{user.role}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Enter Quick PIN for {selectedUser?.full_name || "Operator"}
            </label>
            <input
              ref={pinInputRef}
              type="password"
              maxLength={6}
              required
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              className="w-full tracking-widest text-center text-lg font-mono py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              {isLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>Switch Cashier</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

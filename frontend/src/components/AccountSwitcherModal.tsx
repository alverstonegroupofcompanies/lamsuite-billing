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
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 font-sans select-none animate-in fade-in duration-100">
      <div className="bg-surface border border-border-main max-w-md w-full rounded-card p-6 shadow-modal space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-border-main">
          <div className="flex items-center gap-2 text-sm font-bold text-text-main">
            <Users className="w-4 h-4 text-accent" />
            <span>Switch Counter Cashier</span>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-main p-1 rounded-btn hover:bg-canvas transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-text-muted">
          Changing cashiers preserves all active cart lines and held bills without interruption.
        </p>

        {errorMsg && (
          <div className="p-2.5 rounded-btn bg-status-danger/10 border border-status-danger/30 text-xs text-status-danger flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSwitchSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">
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
                  className={`w-full text-left p-2.5 rounded-btn border flex items-center justify-between text-xs transition-colors cursor-pointer ${
                    selectedUser?.id === user.id
                      ? "bg-accent-soft border-accent text-accent font-bold"
                      : "bg-surface border-border-main text-text-main hover:bg-canvas"
                  }`}
                >
                  <div className="font-bold">{user.full_name}</div>
                  <div className="text-[11px] text-text-muted capitalize">{user.role}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">
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
              className="w-full tracking-widest text-center text-lg font-mono py-2 bg-surface border border-border-main rounded-btn text-text-main focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border-main">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-btn border border-border-main text-text-muted text-xs font-semibold hover:bg-canvas hover:text-text-main cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 rounded-btn bg-accent hover:opacity-90 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
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

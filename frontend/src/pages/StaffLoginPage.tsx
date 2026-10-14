import React, { useState, useEffect, useRef } from "react";
import {
  User,
  KeyRound,
  Shield,
  Fingerprint,
  Lock,
  AlertTriangle,
  Building2,
  Monitor,
  CheckCircle2,
  RefreshCw,
  LogOut,
  HelpCircle,
} from "lucide-react";
import { staffAuthService, type StaffUser } from "../lib/auth/staffAuthService";
import { storeDeviceService, type StoreDeviceProfile } from "../lib/auth/storeDeviceService";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

interface StaffLoginPageProps {
  onLoginSuccess: () => void;
}

export const StaffLoginPage: React.FC<StaffLoginPageProps> = ({ onLoginSuccess }) => {
  const [deviceProfile, setDeviceProfile] = useState<StoreDeviceProfile | null>(null);
  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<StaffUser | null>(null);
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordMode, setIsPasswordMode] = useState(false);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Forced password change modal
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPin, setNewPin] = useState("");

  // Admin Unlock modal
  const [showAdminUnlockModal, setShowAdminUnlockModal] = useState(false);
  useModalEscape(showAdminUnlockModal, () => setShowAdminUnlockModal(false));
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminCredentials, setAdminCredentials] = useState("");
  const [adminUnlockMsg, setAdminUnlockMsg] = useState("");

  const pinInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    storeDeviceService.getDeviceProfile().then(setDeviceProfile);
    staffAuthService.listActiveStaff().then((list) => {
      setStaffList(list);
      if (list.length > 0) setSelectedUser(list[0]);
    });
    staffAuthService.isBiometricsAvailable().then(setHasBiometrics);
  }, []);

  useEffect(() => {
    setPin("");
    setPassword("");
    setErrorMsg("");
    setTimeout(() => {
      pinInputRef.current?.focus();
    }, 50);
  }, [selectedUser, isPasswordMode]);

  // Global keyboard shortcuts (1-9 to select operator, Enter to submit, Alt+P to toggle PIN/password)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (mustChangePassword || showAdminUnlockModal) return;

      // 1-9 selection if not typing inside input
      const isInput = e.target instanceof HTMLInputElement;
      if (!isInput && e.key >= "1" && e.key <= "9") {
        const index = parseInt(e.key, 10) - 1;
        if (staffList[index]) {
          e.preventDefault();
          setSelectedUser(staffList[index]);
        }
      }

      // Alt+P toggles PIN / Password
      if (e.altKey && (e.key.toLowerCase() === "p" || e.code === "KeyP")) {
        e.preventDefault();
        setIsPasswordMode((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [staffList, mustChangePassword, showAdminUnlockModal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setErrorMsg("");
    setIsLoading(true);

    try {
      const res = isPasswordMode
        ? await staffAuthService.authenticateWithPassword(selectedUser.id, password)
        : await staffAuthService.authenticateWithPin(selectedUser.id, pin);

      if (!res.success) {
        setErrorMsg(res.error || "Authentication failed.");
        setPin("");
        setPassword("");
        // Refresh staff state to catch lockouts
        const updated = await staffAuthService.listActiveStaff();
        setStaffList(updated);
        const cur = updated.find((u) => u.id === selectedUser.id);
        if (cur) setSelectedUser(cur);
      } else {
        if (res.mustChangePassword) {
          setMustChangePassword(true);
        } else {
          onLoginSuccess();
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Authentication error.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBiometricAuth = async () => {
    if (!selectedUser) return;
    setIsLoading(true);
    setErrorMsg("");

    try {
      const res = await staffAuthService.authenticateWithBiometrics(selectedUser.id);
      if (!res.success) {
        setErrorMsg(res.error || "Biometric sign-in failed.");
      } else {
        onLoginSuccess();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Biometrics unavailable. Use PIN.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdminUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setAdminUnlockMsg("");

    const res = await staffAuthService.adminUnlock(
      adminUsername,
      adminCredentials,
      selectedUser.username
    );

    if (res.success) {
      setShowAdminUnlockModal(false);
      setErrorMsg("");
      setAdminCredentials("");
      const updated = await staffAuthService.listActiveStaff();
      setStaffList(updated);
      const cur = updated.find((u) => u.id === selectedUser.id);
      if (cur) setSelectedUser(cur);
    } else {
      setAdminUnlockMsg(res.error || "Failed to unlock account.");
    }
  };

  const handleForcePasswordChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setErrorMsg("");

    const res = await staffAuthService.changePasswordOrPin(
      selectedUser.id,
      newPassword || undefined,
      newPin || undefined
    );

    if (res.success) {
      setMustChangePassword(false);
      onLoginSuccess();
    } else {
      setErrorMsg(res.error || "Failed to update credentials.");
    }
  };

  const isUserLocked = selectedUser?.locked_until && Date.now() < selectedUser.locked_until;

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-between p-6 font-sans text-slate-100 select-none">
      {/* Top Store Info Bar */}
      <header className="flex justify-between items-center max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white leading-tight">
              {deviceProfile?.store_name || "LamStone Pharmacy & Clinic"}
            </h2>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span>{deviceProfile?.store_code || "STORE-01"}</span>
              <span>•</span>
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                Offline Ready
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-semibold text-blue-400">
            <Monitor className="w-4 h-4 text-slate-400" />
            <span>{deviceProfile?.counter_name || "Counter 01"}</span>
          </div>
        </div>
      </header>

      {/* Center Layout: Staff Grid on Left, Login Form on Right */}
      <div className="max-w-4xl mx-auto w-full grid grid-cols-1 md:grid-cols-12 gap-6 my-auto max-h-[calc(100vh-140px)] overflow-y-auto pr-1">
        {/* Left Column: Staff Accounts List */}
        <div className="md:col-span-5 space-y-3">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Select Operator
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Press 1-9 to select</span>
          </div>

          <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
            {staffList.map((user, idx) => {
              const isSelected = selectedUser?.id === user.id;
              const isLocked = user.locked_until && Date.now() < user.locked_until;

              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelectedUser(user)}
                  className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? "bg-blue-600/15 border-blue-500 shadow-md ring-1 ring-blue-500/50"
                      : "bg-slate-800/80 border-slate-700/80 hover:bg-slate-800 hover:border-slate-600"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs ${
                        isSelected ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {user.full_name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span>{user.full_name}</span>
                        {isLocked && <Lock className="w-3 h-3 text-red-400" />}
                      </div>
                      <div className="text-[11px] text-slate-400 capitalize">
                        {user.role} • @{user.username}
                      </div>
                    </div>
                  </div>
                  <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-slate-400">
                    {idx + 1}
                  </kbd>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Keypad & Auth Form */}
        <div className="md:col-span-7 bg-slate-800/90 border border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md flex flex-col justify-center">
          <div className="mb-4">
            <h3 className="text-lg font-black text-white">
              Welcome, {selectedUser?.full_name || "Operator"}
            </h3>
            <p className="text-xs text-slate-400">
              Enter your {isPasswordMode ? "account password" : "quick 4-digit PIN"} to open the terminal.
            </p>
          </div>

          {errorMsg && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-400 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span>{errorMsg}</span>
                {isUserLocked && (
                  <button
                    type="button"
                    onClick={() => setShowAdminUnlockModal(true)}
                    className="block mt-1 text-xs text-blue-400 hover:underline font-bold"
                  >
                    Request Administrator Unlock
                  </button>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isPasswordMode ? (
              /* Quick PIN Field */
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Quick PIN (Numpad Friendly)
                </label>
                <input
                  ref={pinInputRef}
                  type="password"
                  maxLength={6}
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                  className="w-full tracking-widest text-center text-xl font-mono py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            ) : (
              /* Password Field */
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Account Password
                </label>
                <input
                  ref={pinInputRef}
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full text-xs py-2.5 px-3 bg-slate-900 border border-slate-700 rounded-xl text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            )}

            {/* Quick PIN Numpad grid for touchscreen or mouse */}
            {!isPasswordMode && (
              <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto py-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => setPin((prev) => (prev.length < 6 ? prev + digit : prev))}
                    className="py-2.5 rounded-xl bg-slate-900 hover:bg-slate-700 border border-slate-700/80 text-sm font-bold text-white transition-colors"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPin("")}
                  className="py-2.5 rounded-xl bg-slate-900 hover:bg-slate-700 border border-slate-700/80 text-xs font-semibold text-slate-400"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setPin((prev) => (prev.length < 6 ? prev + "0" : prev))}
                  className="py-2.5 rounded-xl bg-slate-900 hover:bg-slate-700 border border-slate-700/80 text-sm font-bold text-white"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => setPin((prev) => prev.slice(0, -1))}
                  className="py-2.5 rounded-xl bg-slate-900 hover:bg-slate-700 border border-slate-700/80 text-xs font-semibold text-slate-400"
                >
                  ⌫
                </button>
              </div>
            )}

            {/* Submit & Mode Toggles */}
            <div className="space-y-2 pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                {isLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>Authorize & Open Terminal</span>
                  </>
                )}
              </button>

              {/* Biometric Button (Windows Hello) */}
              {hasBiometrics && selectedUser?.biometric_registered && (
                <button
                  type="button"
                  onClick={handleBiometricAuth}
                  className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <Fingerprint className="w-4 h-4 text-emerald-400" />
                  <span>Sign in with Windows Hello</span>
                </button>
              )}

              <div className="flex justify-between items-center text-[11px] pt-1">
                <button
                  type="button"
                  onClick={() => setIsPasswordMode(!isPasswordMode)}
                  className="text-blue-400 hover:underline cursor-pointer"
                >
                  {isPasswordMode ? "Switch to Quick PIN (Alt+P)" : "Switch to Password (Alt+P)"}
                </button>

                <button
                  type="button"
                  onClick={() => setShowAdminUnlockModal(true)}
                  className="text-slate-400 hover:text-white"
                >
                  Forgot / Reset PIN?
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Footer Info */}
      <footer className="text-center text-[11px] text-slate-500 max-w-5xl mx-auto w-full flex justify-between items-center">
        <span>LamSuite Billing v2.0 • Offline-First Retail POS</span>
        <span>Keyboard shortcuts active (1-9 Operator, Enter Submit, Alt+P Mode)</span>
      </footer>

      {/* Admin Unlock Modal */}
      {showAdminUnlockModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-400" />
              Administrator Authorization & Unlock
            </h4>
            <p className="text-xs text-slate-300">
              Enter store administrator credentials to clear the lockout for{" "}
              <strong>@{selectedUser?.username}</strong>.
            </p>

            {adminUnlockMsg && (
              <div className="p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg">
                {adminUnlockMsg}
              </div>
            )}

            <form onSubmit={handleAdminUnlockSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Admin Username</label>
                <input
                  type="text"
                  required
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Admin Password or PIN</label>
                <input
                  type="password"
                  required
                  value={adminCredentials}
                  onChange={(e) => setAdminCredentials(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdminUnlockModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold text-xs"
                >
                  Clear Lockout
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Force Password Change Modal */}
      {mustChangePassword && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400" />
              Mandatory Password & PIN Update
            </h4>
            <p className="text-xs text-slate-300">
              Your administrator requires you to set a personal password and quick PIN before your first session.
            </p>

            <form onSubmit={handleForcePasswordChangeSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">New Password (min 6 chars)</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">New Quick PIN (4-6 digits)</label>
                <input
                  type="password"
                  required
                  maxLength={6}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full mt-2 py-2 bg-blue-600 text-white font-bold text-xs rounded-xl shadow-md"
              >
                Save Credentials & Open Terminal
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

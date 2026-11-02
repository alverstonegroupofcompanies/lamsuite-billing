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
  UserPlus,
  ArrowRight,
  Eye,
  EyeOff,
} from "lucide-react";
import { staffAuthService, type StaffUser } from "../lib/auth/staffAuthService";
import { storeDeviceService, type StoreDeviceProfile } from "../lib/auth/storeDeviceService";
import { useModalEscape } from "../lib/ui/modalEscapeManager";
import { API_BASE_URL } from "../config/env";

interface StaffLoginPageProps {
  onLoginSuccess: () => void;
  onBackToStores?: () => void;
  activeStore?: { id: string; name: string; code: string; counter_name?: string } | null;
}

export const StaffLoginPage: React.FC<StaffLoginPageProps> = ({
  onLoginSuccess,
  onBackToStores,
  activeStore,
}) => {
  const [deviceProfile, setDeviceProfile] = useState<StoreDeviceProfile | null>(null);
  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<StaffUser | null>(null);
  const [manualUsername, setManualUsername] = useState("");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isPasswordMode, setIsPasswordMode] = useState(false);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    let mounted = true;
    const checkOnline = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/license/check`, { method: "GET" });
        if (mounted) setIsOnline(res.ok);
      } catch {
        if (mounted) setIsOnline(false);
      }
    };
    checkOnline();
    const timer = setInterval(checkOnline, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

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

  const loadStaffAndProfile = async () => {
    const targetStoreId = activeStore?.id || (await storeDeviceService.getDeviceProfile())?.store_id || "1";
    const prof = await storeDeviceService.getDeviceProfile();
    setDeviceProfile(prof);
    const list = await staffAuthService.listActiveStaff(targetStoreId, activeStore || undefined);
    setStaffList(list);
    if (list.length > 0) {
      // Prefer selecting an unlocked operator who has a PIN configured
      const preferred =
        list.find((u) => u.pin_hash && (!u.locked_until || Date.now() >= u.locked_until)) ||
        list.find((u) => !u.locked_until || Date.now() >= u.locked_until) ||
        list[0];
      setSelectedUser(preferred);
    } else {
      setSelectedUser(null);
      setIsPasswordMode(true);
    }
  };

  useEffect(() => {
    loadStaffAndProfile();
    staffAuthService.isBiometricsAvailable().then(setHasBiometrics);
  }, [activeStore?.id]);

  const handleSeedDefaultStaff = async () => {
    setIsSeeding(true);
    setErrorMsg("");
    try {
      const targetStoreId = activeStore?.id || (await storeDeviceService.getDeviceProfile())?.store_id || "1";
      await staffAuthService.initDemoStaffIfEmpty(targetStoreId, activeStore || undefined);
      const list = await staffAuthService.listActiveStaff(targetStoreId, activeStore || undefined);
      setStaffList(list);
      if (list.length > 0) {
        setSelectedUser(list[0]);
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to initialize staff operators.");
    } finally {
      setIsSeeding(false);
    }
  };

  useEffect(() => {
    setPin("");
    setPassword("");
    setErrorMsg("");
    if (selectedUser && !selectedUser.pin_hash) {
      setIsPasswordMode(true);
    }
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
    const targetUserIdOrUsername = selectedUser ? selectedUser.id : manualUsername.trim();
    if (!targetUserIdOrUsername) {
      setErrorMsg("Please select an operator or enter your username.");
      return;
    }
    setErrorMsg("");
    setIsLoading(true);

    try {
      const res = isPasswordMode
        ? await staffAuthService.authenticateWithPassword(targetUserIdOrUsername, password)
        : await staffAuthService.authenticateWithPin(targetUserIdOrUsername, pin);

      if (!res.success) {
        setErrorMsg(res.error || "Authentication failed.");
        setPin("");
        setPassword("");
        // Refresh staff state to catch lockouts
        const updated = await staffAuthService.listActiveStaff();
        setStaffList(updated);
        if (selectedUser) {
          const cur = updated.find((u) => u.id === selectedUser.id);
          if (cur) setSelectedUser(cur);
        }
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
      if (selectedUser) {
        setSelectedUser({ ...selectedUser, locked_until: null, failed_attempts: 0 });
      }
      const updated = await staffAuthService.listActiveStaff();
      setStaffList(updated);
      const cur = updated.find((u) => u.id === selectedUser?.id);
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
    <div className="min-h-screen bg-canvas flex flex-col justify-between p-6 font-sans text-text-main select-none">
      {/* Top Store Info Bar */}
      <header className="flex justify-between items-center max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-btn bg-accent flex items-center justify-center text-white shadow-xs">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text-main leading-tight">
              {deviceProfile?.store_name || "LamStone Pharmacy & Clinic"}
            </h2>
            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              <span className="font-mono tabular-nums">{deviceProfile?.store_code || "STORE-01"}</span>
              <span>•</span>
              {isOnline ? (
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Online Active</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-amber-400 font-medium">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Offline Mode</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {onBackToStores && (
            <button
              type="button"
              onClick={onBackToStores}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn bg-surface hover:bg-canvas border border-border-main text-xs font-semibold text-text-main shadow-xs transition-colors cursor-pointer"
              title="Return to Store / Company Gateway"
            >
              <Building2 className="w-3.5 h-3.5 text-accent" />
              <span>Switch Store (Alt+S)</span>
            </button>
          )}

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn bg-surface border border-border-main text-xs font-semibold text-accent shadow-xs">
            <Monitor className="w-4 h-4 text-text-muted" />
            <span>{deviceProfile?.counter_name || "Counter 01"}</span>
          </div>
        </div>
      </header>

      {/* Center Layout: Staff Grid on Left, Login Form on Right */}
      <div className="max-w-4xl mx-auto w-full grid grid-cols-1 md:grid-cols-12 gap-6 my-auto max-h-[calc(100vh-140px)] overflow-y-auto pr-1">
        {/* Left Column: Staff Accounts List */}
        <div className="md:col-span-5 space-y-3">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Select Operator
            </span>
            <span className="text-[10px] text-text-muted font-mono">Press 1-9 to select</span>
          </div>

          <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
            {staffList.length === 0 ? (
              <div className="p-5 rounded-card border border-dashed border-border-main bg-surface/50 text-center space-y-3">
                <div className="w-10 h-10 rounded-full bg-accent-soft text-accent flex items-center justify-center mx-auto">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-text-main">No Staff Operators Registered</h4>
                  <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                    No operator accounts exist for this store partition yet. Enter your Administrator / Store Owner credentials on the right to sign in and open this terminal.
                  </p>
                </div>
              </div>
            ) : (
              staffList.map((user, idx) => {
                const isSelected = selectedUser?.id === user.id;
                const isLocked = user.locked_until && Date.now() < user.locked_until;

                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => {
                      setSelectedUser(user);
                      setManualUsername(user.username);
                    }}
                    className={`w-full text-left p-3 rounded-card border transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? "bg-accent-soft text-accent border-accent/40 shadow-xs ring-1 ring-accent/30 font-semibold"
                        : "bg-surface border-border-main hover:bg-canvas text-text-main"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-btn flex items-center justify-center font-bold text-xs ${
                          isSelected ? "bg-accent text-white" : "bg-canvas text-text-muted border border-border-main"
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
                        <div className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                          <span>{user.full_name}</span>
                          {isLocked ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/20 text-rose-500 border border-rose-500/30 flex items-center gap-1">
                              <Lock className="w-2.5 h-2.5" /> Locked
                            </span>
                          ) : !user.pin_hash ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
                              Password Only
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-text-muted capitalize">
                          {user.role} • @{user.username}
                        </div>
                      </div>
                    </div>
                    <kbd className="px-2 py-0.5 rounded-btn bg-canvas border border-border-main text-[10px] font-mono text-text-muted tabular-nums">
                      {idx + 1}
                    </kbd>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Keypad & Auth Form */}
        <div className="md:col-span-7 bg-surface border border-border-main rounded-card p-6 sm:p-8 shadow-xs flex flex-col justify-center">
          <div className="mb-4">
            <h3 className="text-lg font-bold text-text-main">
              {selectedUser ? `Welcome, ${selectedUser.full_name}` : "Sign In to Terminal"}
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              {selectedUser
                ? !selectedUser.pin_hash
                  ? "No Quick PIN configured for this account. Enter your password to open the terminal."
                  : `Enter your ${isPasswordMode ? "account password" : "quick 4-digit PIN"} to open the terminal.`
                : "Enter your username and password to open the store workstation."}
            </p>
          </div>

          {/* Prominent Lockout Alert with Instant Unlock Button */}
          {isUserLocked && (
            <div className="mb-4 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3.5 flex items-center justify-between text-xs text-rose-500 shadow-xs">
              <div className="flex items-center gap-2.5">
                <Lock className="w-4 h-4 shrink-0 text-rose-500" />
                <div>
                  <span className="font-bold block">Account Temporarily Locked</span>
                  <span className="text-[11px] text-rose-400">
                    {selectedUser?.locked_until
                      ? `Locked until ${new Date(selectedUser.locked_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} due to failed attempts`
                      : "Locked due to failed attempts"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAdminUnlockMsg("");
                  setShowAdminUnlockModal(true);
                }}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Unlock Now</span>
              </button>
            </div>
          )}

          {errorMsg && !isUserLocked && (
            <div className="mb-4 bg-status-danger/10 border border-status-danger/20 rounded-btn p-3 text-xs text-status-danger flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span>{errorMsg}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!selectedUser && (
              <div>
                <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Operator Username or Email
                </label>
                <input
                  type="text"
                  required
                  value={manualUsername}
                  onChange={(e) => setManualUsername(e.target.value)}
                  placeholder="e.g. admin or owner@lamstone.in"
                  className="w-full text-xs py-2.5 px-3 bg-canvas border border-border-main rounded-btn text-text-main focus:border-accent focus:outline-none"
                />
              </div>
            )}

            {!isPasswordMode && selectedUser ? (
              /* Quick PIN Field */
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                    Quick PIN (Numpad Friendly)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    className="text-[11px] text-accent hover:underline flex items-center gap-1 cursor-pointer font-medium"
                  >
                    {showPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showPin ? "Hide PIN" : "See PIN"}</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    ref={pinInputRef}
                    type={showPin ? "text" : "password"}
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••"
                    className="w-full tracking-widest text-center text-xl font-mono py-2.5 bg-canvas border border-border-main rounded-btn text-text-main focus:border-accent focus:outline-none tabular-nums"
                  />
                </div>
              </div>
            ) : (
              /* Password Field */
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                    Account Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-[11px] text-accent hover:underline flex items-center gap-1 cursor-pointer font-medium"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showPassword ? "Hide" : "See Password"}</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    ref={pinInputRef}
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full text-xs py-2.5 px-3 bg-canvas border border-border-main rounded-btn text-text-main focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Quick PIN Numpad grid for touchscreen or mouse */}
            {!isPasswordMode && selectedUser && (
              <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto py-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => setPin((prev) => (prev.length < 6 ? prev + digit : prev))}
                    className="py-2.5 rounded-btn bg-surface hover:bg-canvas border border-border-main text-sm font-mono font-bold text-text-main transition-colors tabular-nums"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPin("")}
                  className="py-2.5 rounded-btn bg-surface hover:bg-canvas border border-border-main text-xs font-semibold text-text-muted transition-colors"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setPin((prev) => (prev.length < 6 ? prev + "0" : prev))}
                  className="py-2.5 rounded-btn bg-surface hover:bg-canvas border border-border-main text-sm font-mono font-bold text-text-main transition-colors tabular-nums"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => setPin((prev) => prev.slice(0, -1))}
                  className="py-2.5 rounded-btn bg-surface hover:bg-canvas border border-border-main text-xs font-semibold text-text-muted transition-colors"
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
                className="w-full py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold text-xs rounded-btn shadow-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
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
                  className="w-full py-2 bg-accent-soft hover:bg-accent-soft/80 text-accent text-xs font-semibold rounded-btn border border-accent/20 flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <Fingerprint className="w-4 h-4 text-accent" />
                  <span>Sign in with Windows Hello</span>
                </button>
              )}

              <div className="flex justify-between items-center text-[11px] pt-1">
                <button
                  type="button"
                  onClick={() => setIsPasswordMode(!isPasswordMode)}
                  className="text-accent hover:underline cursor-pointer font-medium"
                >
                  {isPasswordMode ? "Switch to Quick PIN (Alt+P)" : "Switch to Password (Alt+P)"}
                </button>

                <button
                  type="button"
                  onClick={() => setShowAdminUnlockModal(true)}
                  className="text-text-muted hover:text-text-main transition-colors"
                >
                  Forgot / Reset PIN?
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Footer Info */}
      <footer className="text-center text-[11px] text-text-muted max-w-5xl mx-auto w-full flex justify-between items-center">
        <span>LamSuite Billing v2.0 • Multi-Store Retail POS</span>
        <span>Keyboard shortcuts active (1-9 Operator, Enter Submit, Alt+P Mode)</span>
      </footer>

      {/* Admin Unlock Modal */}
      {showAdminUnlockModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-surface border border-border-main rounded-card max-w-md w-full p-6 shadow-modal space-y-4">
            <h4 className="text-sm font-bold text-text-main flex items-center gap-2">
              <Shield className="w-4 h-4 text-accent" />
              Administrator Authorization & Unlock
            </h4>
            <p className="text-xs text-text-muted">
              Enter store administrator credentials to clear the lockout for{" "}
              <strong className="text-text-main">@{selectedUser?.username}</strong>.
            </p>

            {adminUnlockMsg && (
              <div className="p-2 bg-status-danger/10 border border-status-danger/20 text-status-danger text-xs rounded-btn">
                {adminUnlockMsg}
              </div>
            )}

            <form onSubmit={handleAdminUnlockSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wider">Admin Username</label>
                <input
                  type="text"
                  required
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface border border-border-main rounded-btn text-text-main text-xs focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wider">Admin Password or PIN</label>
                <input
                  type="password"
                  required
                  value={adminCredentials}
                  onChange={(e) => setAdminCredentials(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface border border-border-main rounded-btn text-text-main text-xs focus:border-accent focus:outline-none"
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

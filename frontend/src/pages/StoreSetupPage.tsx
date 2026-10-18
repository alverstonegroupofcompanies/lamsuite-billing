import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  Building2,
  KeyRound,
  Network,
  Cpu,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  Server,
  Lock,
} from "lucide-react";
import { storeDeviceService, type StoreDeviceProfile } from "../lib/auth/storeDeviceService";
import { INITIAL_BRANCH_STORES, type BranchStore } from "../lib/masters/storeService";

interface StoreSetupPageProps {
  onSetupComplete: (profile: StoreDeviceProfile) => void;
}

export const StoreSetupPage: React.FC<StoreSetupPageProps> = ({ onSetupComplete }) => {
  const [setupMode, setSetupMode] = useState<"activation_key" | "owner_login" | "lan_secondary">("activation_key");
  const [activationKey, setActivationKey] = useState("");
  const [counterName, setCounterName] = useState("Counter 01");
  const [isHub, setIsHub] = useState(true);

  // Owner login mode
  const [ownerEmail, setOwnerEmail] = useState("owner@lamstone.in");
  const [ownerPassword, setOwnerPassword] = useState("password123");
  const [branches, setBranches] = useState<BranchStore[]>(INITIAL_BRANCH_STORES);
  const [selectedBranchId, setSelectedBranchId] = useState("store_main");

  // Secondary counter LAN mode
  const [hubIp, setHubIp] = useState("192.168.1.100");
  const [isDiscoveringLan, setIsDiscoveringLan] = useState(false);

  // First admin setup
  const [needsFirstAdmin, setNeedsFirstAdmin] = useState(false);
  const [firstAdminName, setFirstAdminName] = useState("Store Admin");
  const [firstAdminUsername, setFirstAdminUsername] = useState("admin");
  const [firstAdminPassword, setFirstAdminPassword] = useState("admin123");
  const [firstAdminPin, setFirstAdminPin] = useState("1234");

  // Progress screen
  const [isProgressing, setIsProgressing] = useState(false);
  const [progressStep, setProgressStep] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const handleLanDiscovery = () => {
    setIsDiscoveringLan(true);
    setErrorMsg("");
    setTimeout(() => {
      setHubIp("192.168.1.50");
      setIsDiscoveringLan(false);
    }, 700);
  };

  const handleStartSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setIsProgressing(true);
    setProgressPercent(10);
    setProgressStep("Initializing workstation registration handshake...");

    try {
      let profile: StoreDeviceProfile;

      if (setupMode === "activation_key") {
        profile = await storeDeviceService.registerWithActivationKey(
          activationKey,
          counterName,
          isHub,
          (step, pct) => {
            setProgressStep(step);
            setProgressPercent(pct);
          }
        );
      } else if (setupMode === "owner_login") {
        profile = await storeDeviceService.registerWithOwnerCredentials(
          ownerEmail,
          ownerPassword,
          selectedBranchId,
          counterName,
          isHub,
          (step, pct) => {
            setProgressStep(step);
            setProgressPercent(pct);
          }
        );
      } else {
        // LAN secondary counter pairing
        profile = await storeDeviceService.registerWithActivationKey(
          `LAN-${hubIp.replace(/\./g, "")}-KEY`,
          counterName,
          false,
          (step, pct) => {
            setProgressStep(step);
            setProgressPercent(pct);
          }
        );
      }

      if (needsFirstAdmin) {
        setProgressStep("Provisioning first store administrator account...");
        await storeDeviceService.setupFirstAdmin({
          name: firstAdminName,
          username: firstAdminUsername,
          password: firstAdminPassword,
          pin: firstAdminPin,
        });
      }

      setTimeout(() => {
        onSetupComplete(profile);
      }, 500);
    } catch (err: any) {
      setIsProgressing(false);
      setErrorMsg(err?.message || "Device registration failed. Please check credentials or network.");
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center items-center p-4 font-sans text-text-main select-none">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-card bg-accent flex items-center justify-center text-white mx-auto shadow-xs mb-3">
            <Building2 className="w-7 h-7" />
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-text-main">LamSuite Billing Setup</h1>
          <p className="text-xs text-text-muted mt-1">
            Workstation Device Registration & Offline Master Data Ingestion
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-surface border border-border-main rounded-card p-6 sm:p-8 shadow-xs">
          {errorMsg && (
            <div className="mb-4 bg-status-danger/10 border border-status-danger/20 rounded-btn p-3 text-xs text-status-danger flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isProgressing ? (
            /* Progress Screen */
            <div className="py-6 space-y-6 text-center">
              <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
                <RefreshCw className="w-12 h-12 text-accent animate-spin" />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-text-main">Synchronizing Store Environment</h3>
                <p className="text-xs text-accent font-mono animate-pulse">{progressStep}</p>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-canvas rounded-full h-2.5 overflow-hidden border border-border-main">
                <div
                  className="bg-accent h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="flex justify-between text-[11px] text-text-muted">
                <span>OS Secure Token Vault</span>
                <span className="font-mono font-bold text-text-main tabular-nums">{progressPercent}%</span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleStartSetup} className="space-y-4">
              {/* Setup Mode Navigation */}
              <div className="grid grid-cols-3 gap-2 p-1 bg-canvas rounded-btn border border-border-main text-xs">
                <button
                  type="button"
                  onClick={() => setSetupMode("activation_key")}
                  className={`py-2 rounded-btn font-medium transition-colors ${
                    setupMode === "activation_key"
                      ? "bg-surface text-accent shadow-xs font-semibold"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  Store Key
                </button>
                <button
                  type="button"
                  onClick={() => setSetupMode("owner_login")}
                  className={`py-2 rounded-btn font-medium transition-colors ${
                    setupMode === "owner_login"
                      ? "bg-surface text-accent shadow-xs font-semibold"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  Owner Login
                </button>
                <button
                  type="button"
                  onClick={() => setSetupMode("lan_secondary")}
                  className={`py-2 rounded-btn font-medium transition-colors ${
                    setupMode === "lan_secondary"
                      ? "bg-surface text-accent shadow-xs font-semibold"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  LAN Counter
                </button>
              </div>

              {/* Mode 1: Activation Key */}
              {setupMode === "activation_key" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                      Store Activation Key / License Token
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-text-muted absolute left-3 top-3" />
                      <input
                        type="text"
                        required
                        value={activationKey}
                        onChange={(e) => setActivationKey(e.target.value.toUpperCase())}
                        placeholder="LAM-STORE-XXXX-YYYY"
                        className="w-full pl-9 pr-3.5 py-2.5 bg-surface border border-border-main rounded-btn text-text-main font-mono text-xs focus:border-accent focus:outline-none"
                      />
                    </div>
                    <p className="text-[11px] text-text-muted mt-1">
                      Provided on store creation in Central Admin or license dispatch letter.
                    </p>
                  </div>
                </div>
              )}

              {/* Mode 2: Store Owner Login */}
              {setupMode === "owner_login" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">Owner Email</label>
                    <input
                      type="email"
                      required
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      className="w-full px-3.5 py-2 bg-surface border border-border-main rounded-btn text-text-main text-xs focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">Password</label>
                    <input
                      type="password"
                      required
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      className="w-full px-3.5 py-2 bg-surface border border-border-main rounded-btn text-text-main text-xs focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                      Select Store / Branch (Multi-Store Ownership)
                    </label>
                    <select
                      value={selectedBranchId}
                      onChange={(e) => setSelectedBranchId(e.target.value)}
                      className="w-full px-3.5 py-2 bg-surface border border-border-main rounded-btn text-text-main text-xs focus:border-accent focus:outline-none"
                    >
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.code}) — {b.city}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Mode 3: LAN Secondary Counter */}
              {setupMode === "lan_secondary" && (
                <div className="space-y-3">
                  <div className="bg-accent-soft p-3 rounded-card border border-accent/20 text-xs text-accent">
                    <p className="flex items-center gap-1.5 font-bold mb-1">
                      <Network className="w-4 h-4 shrink-0 text-accent" />
                      Connecting as a Secondary Terminal
                    </p>
                    <p className="text-[11px] text-text-muted">
                      This terminal will synchronize catalog, pricing and shifts from your Main Counter Server over LAN.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                      Store Main Hub IP Address
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        required
                        value={hubIp}
                        onChange={(e) => setHubIp(e.target.value)}
                        placeholder="192.168.1.100"
                        className="flex-1 px-3.5 py-2 bg-surface border border-border-main rounded-btn text-text-main font-mono text-xs focus:border-accent focus:outline-none tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={handleLanDiscovery}
                        disabled={isDiscoveringLan}
                        className="px-3 py-2 bg-accent-soft hover:bg-accent-soft/80 text-accent border border-accent/20 rounded-btn text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isDiscoveringLan ? "animate-spin" : ""}`} />
                        Scan LAN
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Counter Designation */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border-main">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">Counter Name</label>
                  <input
                    type="text"
                    required
                    value={counterName}
                    onChange={(e) => setCounterName(e.target.value)}
                    placeholder="Counter 01"
                    className="w-full px-3 py-2 bg-surface border border-border-main rounded-btn text-text-main text-xs focus:border-accent focus:outline-none"
                  />
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 cursor-pointer pb-2">
                    <input
                      type="checkbox"
                      checked={setupMode === "lan_secondary" ? false : isHub}
                      disabled={setupMode === "lan_secondary"}
                      onChange={(e) => setIsHub(e.target.checked)}
                      className="rounded border-border-main text-accent focus:ring-accent h-4 w-4"
                    />
                    <span className="text-xs text-text-main font-medium">Designate as Store Hub</span>
                  </label>
                </div>
              </div>

              {/* Toggle First Admin Onboarding */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setNeedsFirstAdmin(!needsFirstAdmin)}
                  className="text-xs text-accent hover:underline font-semibold flex items-center gap-1"
                >
                  {needsFirstAdmin ? "− Hide First-Admin Setup" : "+ Initialize First Store Admin (New Store)"}
                </button>
              </div>

              {needsFirstAdmin && (
                <div className="bg-canvas p-4 rounded-card border border-border-main space-y-3">
                  <h4 className="text-xs font-bold text-text-main flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-accent" />
                    First Administrator Account
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wider">Full Name</label>
                      <input
                        type="text"
                        value={firstAdminName}
                        onChange={(e) => setFirstAdminName(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-text-main focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wider">Username</label>
                      <input
                        type="text"
                        value={firstAdminUsername}
                        onChange={(e) => setFirstAdminUsername(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-text-main focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wider">Password</label>
                      <input
                        type="password"
                        value={firstAdminPassword}
                        onChange={(e) => setFirstAdminPassword(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-text-main focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wider">Quick PIN (4 digits)</label>
                      <input
                        type="password"
                        maxLength={6}
                        value={firstAdminPin}
                        onChange={(e) => setFirstAdminPin(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-text-main font-mono focus:border-accent focus:outline-none tabular-nums"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                className="w-full mt-4 py-2.5 px-4 bg-accent hover:bg-accent/90 text-white text-xs font-semibold rounded-btn shadow-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <span>Complete Store Onboarding</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

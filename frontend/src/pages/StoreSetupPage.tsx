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
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4 font-sans text-slate-100 select-none">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white mx-auto shadow-lg shadow-blue-500/20 mb-3">
            <Building2 className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">LamSuite Billing Setup</h1>
          <p className="text-xs text-slate-400 mt-1">
            Workstation Device Registration & Offline Master Data Ingestion
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
          {errorMsg && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-400 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isProgressing ? (
            /* Progress Screen */
            <div className="py-6 space-y-6 text-center">
              <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
                <RefreshCw className="w-12 h-12 text-blue-500 animate-spin" />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-white">Synchronizing Store Environment</h3>
                <p className="text-xs text-blue-400 font-mono animate-pulse">{progressStep}</p>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="flex justify-between text-[11px] text-slate-400">
                <span>OS Secure Token Vault</span>
                <span className="font-mono font-bold text-white">{progressPercent}%</span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleStartSetup} className="space-y-4">
              {/* Setup Mode Navigation */}
              <div className="grid grid-cols-3 gap-2 p-1 bg-slate-900 rounded-xl border border-slate-700/70 text-xs">
                <button
                  type="button"
                  onClick={() => setSetupMode("activation_key")}
                  className={`py-2 rounded-lg font-medium transition-colors ${
                    setupMode === "activation_key"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Store Key
                </button>
                <button
                  type="button"
                  onClick={() => setSetupMode("owner_login")}
                  className={`py-2 rounded-lg font-medium transition-colors ${
                    setupMode === "owner_login"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Owner Login
                </button>
                <button
                  type="button"
                  onClick={() => setSetupMode("lan_secondary")}
                  className={`py-2 rounded-lg font-medium transition-colors ${
                    setupMode === "lan_secondary"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  LAN Counter
                </button>
              </div>

              {/* Mode 1: Activation Key */}
              {setupMode === "activation_key" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Store Activation Key / License Token
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                      <input
                        type="text"
                        required
                        value={activationKey}
                        onChange={(e) => setActivationKey(e.target.value.toUpperCase())}
                        placeholder="LAM-STORE-XXXX-YYYY"
                        className="w-full pl-9 pr-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Provided on store creation in Central Admin or license dispatch letter.
                    </p>
                  </div>
                </div>
              )}

              {/* Mode 2: Store Owner Login */}
              {setupMode === "owner_login" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Owner Email</label>
                    <input
                      type="email"
                      required
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      className="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Password</label>
                    <input
                      type="password"
                      required
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      className="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Select Store / Branch (Multi-Store Ownership)
                    </label>
                    <select
                      value={selectedBranchId}
                      onChange={(e) => setSelectedBranchId(e.target.value)}
                      className="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
                  <div className="bg-blue-950/40 p-3 rounded-xl border border-blue-800/40 text-xs text-blue-300">
                    <p className="flex items-center gap-1.5 font-bold mb-1">
                      <Network className="w-4 h-4 shrink-0" />
                      Connecting as a Secondary Terminal
                    </p>
                    <p className="text-[11px] text-slate-400">
                      This terminal will synchronize catalog, pricing and shifts from your Main Counter Server over LAN.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Store Main Hub IP Address
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        required
                        value={hubIp}
                        onChange={(e) => setHubIp(e.target.value)}
                        placeholder="192.168.1.100"
                        className="flex-1 px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleLanDiscovery}
                        disabled={isDiscoveringLan}
                        className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-xs font-medium text-white flex items-center gap-1.5 shrink-0"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isDiscoveringLan ? "animate-spin" : ""}`} />
                        Scan LAN
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Counter Designation */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-700/60">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Counter Name</label>
                  <input
                    type="text"
                    required
                    value={counterName}
                    onChange={(e) => setCounterName(e.target.value)}
                    placeholder="Counter 01"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 cursor-pointer pb-2">
                    <input
                      type="checkbox"
                      checked={setupMode === "lan_secondary" ? false : isHub}
                      disabled={setupMode === "lan_secondary"}
                      onChange={(e) => setIsHub(e.target.checked)}
                      className="rounded border-slate-700 text-blue-600 focus:ring-blue-500 h-4 w-4"
                    />
                    <span className="text-xs text-slate-300 font-medium">Designate as Store Hub</span>
                  </label>
                </div>
              </div>

              {/* Toggle First Admin Onboarding */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setNeedsFirstAdmin(!needsFirstAdmin)}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
                >
                  {needsFirstAdmin ? "− Hide First-Admin Setup" : "+ Initialize First Store Admin (New Store)"}
                </button>
              </div>

              {needsFirstAdmin && (
                <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700 space-y-3">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    First Administrator Account
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Full Name</label>
                      <input
                        type="text"
                        value={firstAdminName}
                        onChange={(e) => setFirstAdminName(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Username</label>
                      <input
                        type="text"
                        value={firstAdminUsername}
                        onChange={(e) => setFirstAdminUsername(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Password</label>
                      <input
                        type="password"
                        value={firstAdminPassword}
                        onChange={(e) => setFirstAdminPassword(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Quick PIN (4 digits)</label>
                      <input
                        type="password"
                        maxLength={6}
                        value={firstAdminPin}
                        onChange={(e) => setFirstAdminPin(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                className="w-full mt-4 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 cursor-pointer transition-all"
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

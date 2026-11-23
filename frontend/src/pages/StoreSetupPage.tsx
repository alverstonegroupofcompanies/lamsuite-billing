import React, { useState } from "react";
import { Building2, KeyRound, AlertCircle, ArrowRight, RefreshCw } from "lucide-react";
import { storeDeviceService, type StoreDeviceProfile } from "../lib/auth/storeDeviceService";
import { cloudDeltaSyncService } from "../lib/sync/cloudDeltaSyncService";
import { API_BASE_URL, getResolvedApiBaseUrl, setApiBaseUrl } from "../config/env";
import { APP_VERSION } from "../config/version";

interface StoreSetupPageProps {
  onSetupComplete: (profile: StoreDeviceProfile) => void;
  onCancel?: () => void;
}

/**
 * CNT-006 / CNT-013: this screen has one job — hand a counter code to the
 * server. Owner logins, shared store keys and locally-named counters are gone;
 * the counter, its store and its name come back from the claim.
 */
export const StoreSetupPage: React.FC<StoreSetupPageProps> = ({ onSetupComplete, onCancel }) => {
  const [activationCode, setActivationCode] = useState("");

  // Server endpoint configuration
  const [currentApiUrl, setCurrentApiUrl] = useState<string>(() => getResolvedApiBaseUrl());
  const [isEditingServer, setIsEditingServer] = useState(false);
  const [customServerInput, setCustomServerInput] = useState(currentApiUrl);

  // Progress screen
  const [isProgressing, setIsProgressing] = useState(false);
  const [progressStep, setProgressStep] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const handleStartSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    const code = activationCode.trim();
    if (!code) {
      setErrorMsg("Enter the counter activation code from the store owner.");
      return;
    }

    setIsProgressing(true);
    setProgressPercent(10);
    setProgressStep("Claiming this workstation onto its counter...");

    try {
      const profile = await storeDeviceService.claimCounter(code, (step, pct) => {
        setProgressStep(step);
        setProgressPercent(pct);
      });

      // A claimed counter still needs this store's catalog before it can bill.
      setProgressStep("Fetching this store's master catalog...");
      setProgressPercent(85);
      try {
        const syncRes = await cloudDeltaSyncService.pullMasterDelta({
          fetchMasterDeltas: async (wm) => {
            const res = await fetch(`${API_BASE_URL}/api/sync/pull/deltas?store_id=${profile.store_id}&since_watermark=${wm}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          },
        });
        const totalFetched = (syncRes.appliedProducts || 0) + (syncRes.appliedBatches || 0) + (syncRes.appliedParties || 0);
        if (totalFetched > 0) {
          setProgressStep(`Ingested ${totalFetched} items from backend server.`);
        }
      } catch (fetchErr) {
        console.warn("Backend delta fetch deferred:", fetchErr);
      }

      setProgressStep(`Counter "${profile.counter_name}" is ready.`);
      setProgressPercent(100);

      setTimeout(() => {
        onSetupComplete(profile);
      }, 400);
    } catch (err: any) {
      setIsProgressing(false);
      setErrorMsg(
        err?.message ||
          "That activation code is not valid here. Ask the store owner for a current counter code."
      );
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center items-center p-4 font-sans text-text-main select-none">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="relative text-center mb-6">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="absolute left-0 top-0 px-3 py-1.5 rounded-btn border border-border-main bg-surface hover:bg-canvas text-xs font-medium text-text-muted transition-colors"
            >
              ← Back to Stores
            </button>
          )}
          <div className="w-14 h-14 rounded-card bg-accent flex items-center justify-center text-white mx-auto shadow-xs mb-3">
            <Building2 className="w-7 h-7" />
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-text-main">LamSuite Billing Setup</h1>
          <p className="text-xs text-text-muted mt-1">
            Enter your counter activation code
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-surface border border-border-main rounded-card p-6 sm:p-8 shadow-xs">
          {errorMsg && (
            <div
              role="alert"
              className="mb-4 bg-status-danger/10 border border-status-danger/20 rounded-btn p-3 text-xs text-status-danger flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
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
                <h3 className="text-base font-bold text-text-main">Bringing the counter online</h3>
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
              <div>
                <label
                  htmlFor="counter-activation-code"
                  className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1"
                >
                  Counter activation code
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-text-muted absolute left-3 top-3" aria-hidden="true" />
                  <input
                    id="counter-activation-code"
                    type="text"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    value={activationCode}
                    onChange={(e) => {
                      // A pasted QR payload is JSON and must keep its case; a typed code is not.
                      const raw = e.target.value.trim();
                      setActivationCode(raw.startsWith("{") ? raw : raw.toUpperCase());
                    }}
                    placeholder="LAM-C01-XXXX-XXXX"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-surface border border-border-main rounded-btn text-text-main font-mono text-xs focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="w-full mt-4 py-2.5 px-4 bg-accent hover:bg-accent/90 text-white text-xs font-semibold rounded-btn shadow-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <span>Activate this counter</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>

              {/* Server Endpoint Indicator & Switcher */}
              <div className="pt-3 border-t border-border-main text-center">
                {!isEditingServer ? (
                  <div className="flex items-center justify-between text-[11px] text-text-muted">
                    <span className="tabular-nums">Version {APP_VERSION}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomServerInput(currentApiUrl);
                        setIsEditingServer(true);
                      }}
                      className="text-text-muted hover:text-accent hover:underline cursor-pointer text-[11px]"
                    >
                      Server settings
                    </button>
                  </div>
                ) : (
                  <div className="bg-canvas p-3 rounded-btn border border-border-main space-y-2 text-left">
                    <div className="flex items-center justify-between">
                      <label htmlFor="backend-api-endpoint" className="text-[11px] font-bold text-text-main">
                        Backend API endpoint
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsEditingServer(false)}
                        className="text-[10px] text-text-muted hover:text-text-main cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        id="backend-api-endpoint"
                        type="text"
                        value={customServerInput}
                        onChange={(e) => setCustomServerInput(e.target.value)}
                        placeholder="http://127.0.0.1:8000"
                        className="flex-1 px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-text-main text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const cleaned = customServerInput.trim().replace(/\/+$/, "");
                          if (cleaned) {
                            setApiBaseUrl(cleaned);
                            setCurrentApiUrl(cleaned);
                            setIsEditingServer(false);
                          }
                        }}
                        className="px-3 py-1.5 bg-accent text-white text-xs font-semibold rounded-btn cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                    <div className="flex gap-2 text-[10px]">
                      <button
                        type="button"
                        onClick={() => {
                          setApiBaseUrl("http://127.0.0.1:8000");
                          setCurrentApiUrl("http://127.0.0.1:8000");
                          setCustomServerInput("http://127.0.0.1:8000");
                          setIsEditingServer(false);
                        }}
                        className="text-accent underline font-semibold cursor-pointer"
                      >
                        Local Dev (127.0.0.1:8000)
                      </button>
                      <span className="text-text-muted">•</span>
                      <button
                        type="button"
                        onClick={() => {
                          setApiBaseUrl("https://api.lamstonehealthcare.com");
                          setCurrentApiUrl("https://api.lamstonehealthcare.com");
                          setCustomServerInput("https://api.lamstonehealthcare.com");
                          setIsEditingServer(false);
                        }}
                        className="text-accent underline font-semibold cursor-pointer"
                      >
                        Cloud (api.lamstonehealthcare.com)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

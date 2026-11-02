import React, { useState, useEffect } from "react";
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Server,
  Layers,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  ShieldCheck,
  Radio,
  Clock,
} from "lucide-react";
import {
  autoUpdateService,
  type UpdateChannel,
  type UpdateCheckDiagnostic,
  type UpdateInfo,
  type UpdateSettingsConfig,
} from "../../lib/settings/autoUpdateService";

interface SoftwareUpdatesTabProps {
  onFoundUpdate: (info: UpdateInfo) => void;
  showNotification: (msg: string, type?: "success" | "error") => void;
}

export const SoftwareUpdatesTab: React.FC<SoftwareUpdatesTabProps> = ({
  onFoundUpdate,
  showNotification,
}) => {
  const [config, setConfig] = useState<UpdateSettingsConfig>(autoUpdateService.getConfig());
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<UpdateInfo | null>(null);
  const [lastDiagnostic, setLastDiagnostic] = useState<UpdateCheckDiagnostic | null>(null);
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const [copiedDiag, setCopiedDiag] = useState<boolean>(false);
  const [unsyncedCount, setUnsyncedCount] = useState<number>(0);

  const currentVersion = autoUpdateService.getCurrentVersion();
  const primaryEndpoint = autoUpdateService.getPrimaryEndpoint(config.channel);

  useEffect(() => {
    const cfg = autoUpdateService.getConfig();
    setConfig(cfg);
    if (cfg.lastCheckResult) {
      setLastResult(cfg.lastCheckResult);
    }
    const diag = autoUpdateService.getLastDiagnostic();
    if (diag) {
      setLastDiagnostic(diag);
    }
    autoUpdateService.getUnsyncedBillsCount().then(setUnsyncedCount);
  }, []);

  const handleCheckNow = async () => {
    setIsChecking(true);
    try {
      const result = await autoUpdateService.checkForUpdates();
      setLastResult(result);
      if (result.diagnostic) {
        setLastDiagnostic(result.diagnostic);
      }
      if (result.shouldUpdate) {
        onFoundUpdate(result);
        showNotification(`Update available: version ${result.manifest?.version || "New Release"}`, "success");
      } else {
        showNotification(result.message || `You are on the latest version (${currentVersion})`, "success");
      }
    } catch (err: any) {
      const diag = err?.diagnostic || autoUpdateService.getLastDiagnostic();
      if (diag) {
        setLastDiagnostic(diag);
      }
      const msg = err?.message || "Failed to query update feed";
      showNotification(`Update check failed: ${msg}`, "error");
    } finally {
      setIsChecking(false);
      autoUpdateService.getUnsyncedBillsCount().then(setUnsyncedCount);
    }
  };

  const handleChannelChange = (newChannel: UpdateChannel) => {
    const updated = autoUpdateService.saveConfig({ channel: newChannel });
    setConfig(updated);
    showNotification(`Release channel switched to ${newChannel.toUpperCase()}`, "success");
  };

  const handleStartupToggle = (enabled: boolean) => {
    const updated = autoUpdateService.saveConfig({ autoCheckOnStartup: enabled });
    setConfig(updated);
  };

  const handleIntervalChange = (hours: number) => {
    const updated = autoUpdateService.saveConfig({ backgroundCheckIntervalHours: hours });
    setConfig(updated);
    showNotification(`Background check schedule updated`, "success");
  };

  const copyDiagnosticText = () => {
    if (!lastDiagnostic) return;
    const jsonStr = JSON.stringify(lastDiagnostic, null, 2);
    navigator.clipboard.writeText(jsonStr);
    setCopiedDiag(true);
    setTimeout(() => setCopiedDiag(false), 2000);
    showNotification("Diagnostic details copied to clipboard", "success");
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-slate-800">Software Updates & Channel Management</h2>
        <p className="text-xs text-slate-500">
          Manage workstation updates, switch release channels, and inspect update diagnostics.
        </p>
      </div>

      {/* Main Release Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current Workstation Release</span>
            <div className="flex items-center gap-2.5 mt-1">
              <span className="text-lg font-mono font-bold text-slate-900">v{currentVersion}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                Active Build
              </span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Selected Channel</span>
            <div className="mt-1 font-semibold text-xs text-indigo-700 uppercase">
              {config.channel === "legacy_win7" ? "Windows 7/8.1 Legacy" : config.channel}
            </div>
          </div>
        </div>

        {/* Unsynced Transactions Alert Banner */}
        {unsyncedCount > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-amber-900 text-xs">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>{unsyncedCount} unsynced bill(s)</strong> in local offline queue. Pending bills will remain safe during update.
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-100 text-amber-800 rounded">
              Sync Queue
            </span>
          </div>
        )}

        {/* Action Buttons & Status */}
        <div className="flex items-center justify-between pt-1">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Server className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-mono text-[11px]">{primaryEndpoint}</span>
            </div>
            {config.lastCheckTimestamp && (
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Clock className="w-3 h-3" />
                <span>Last checked: {new Date(config.lastCheckTimestamp).toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCheckNow}
              disabled={isChecking}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition shadow-xs cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isChecking ? "animate-spin" : ""}`} />
              <span>{isChecking ? "Checking Feed..." : "Check for Software Updates Now"}</span>
            </button>
          </div>
        </div>

        {/* Diagnostic Accordion */}
        {lastDiagnostic && (
          <div className="rounded-lg border border-slate-100 bg-slate-50 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-100 text-slate-700 font-medium transition cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    lastDiagnostic.errorCategory === "success" ? "bg-emerald-500" : "bg-rose-500"
                  }`}
                />
                <span>Diagnostic Status: {lastDiagnostic.readableMessage}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span>{showDetails ? "Hide details" : "Show details"}</span>
                {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>

            {showDetails && (
              <div className="p-4 border-t border-slate-200/80 bg-white space-y-3 font-mono text-[11px]">
                <div className="grid grid-cols-2 gap-3 text-slate-600">
                  <div>
                    <span className="font-bold text-slate-400 block text-[10px] uppercase">Query URL</span>
                    <span className="text-slate-800 break-all">{lastDiagnostic.url}</span>
                  </div>
                  <div>
                    <span className="font-bold text-slate-400 block text-[10px] uppercase">HTTP Response Status</span>
                    <span className="text-slate-800">
                      {lastDiagnostic.status !== null ? `${lastDiagnostic.status} ${lastDiagnostic.statusText || ""}` : "No response / Network error"}
                    </span>
                  </div>
                  <div>
                    <span className="font-bold text-slate-400 block text-[10px] uppercase">Response Time</span>
                    <span className="text-slate-800">{lastDiagnostic.responseTimeMs ? `${lastDiagnostic.responseTimeMs} ms` : "—"}</span>
                  </div>
                  <div>
                    <span className="font-bold text-slate-400 block text-[10px] uppercase">Error Classification</span>
                    <span className="text-slate-800">{lastDiagnostic.errorCategory}</span>
                  </div>
                </div>

                {lastDiagnostic.rawError && (
                  <div>
                    <span className="font-bold text-slate-400 block text-[10px] uppercase">Raw Error Payload</span>
                    <pre className="p-2.5 rounded bg-slate-900 text-rose-300 overflow-x-auto text-[10px] whitespace-pre-wrap">
                      {lastDiagnostic.rawError}
                    </pre>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={copyDiagnosticText}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-sans font-semibold transition cursor-pointer"
                  >
                    {copiedDiag ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedDiag ? "Copied" : "Copy Diagnostic Info"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Release Channel & Preferences */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Release Channel Selector */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-indigo-600" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Release Channel</h3>
          </div>
          <p className="text-[11px] text-slate-500">
            Select the build channel appropriate for this workstation OS and stability preference.
          </p>

          <div className="space-y-2 pt-1">
            <label
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                config.channel === "stable" ? "bg-indigo-50/50 border-indigo-300" : "bg-white border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="update_channel"
                checked={config.channel === "stable"}
                onChange={() => handleChannelChange("stable")}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <div className="font-semibold text-xs text-slate-800">Production (Stable)</div>
                <div className="text-[10px] text-slate-500">Standard release stream tested for production retail environments.</div>
              </div>
            </label>

            <label
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                config.channel === "legacy_win7" ? "bg-amber-50/50 border-amber-300" : "bg-white border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="update_channel"
                checked={config.channel === "legacy_win7"}
                onChange={() => handleChannelChange("legacy_win7")}
                className="mt-0.5 text-amber-600 focus:ring-amber-500"
              />
              <div>
                <div className="font-semibold text-xs text-slate-800">Legacy Windows (Win 7/8.1)</div>
                <div className="text-[10px] text-slate-500">Dedicated channel bundled with Fixed WebView2 109 and Win7 compatibility.</div>
              </div>
            </label>

            <label
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                config.channel === "beta" ? "bg-purple-50/50 border-purple-300" : "bg-white border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="update_channel"
                checked={config.channel === "beta"}
                onChange={() => handleChannelChange("beta")}
                className="mt-0.5 text-purple-600 focus:ring-purple-500"
              />
              <div>
                <div className="font-semibold text-xs text-slate-800">Preview (Beta)</div>
                <div className="text-[10px] text-slate-500">Early access builds to test preview features before general rollout.</div>
              </div>
            </label>
          </div>
        </div>

        {/* Automated Background Checking */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-600" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Automated Verification</h3>
          </div>
          <p className="text-[11px] text-slate-500">
            Control automated background update queries and cashier notification policies.
          </p>

          <div className="space-y-4 pt-1">
            <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
              <div>
                <div className="font-semibold text-xs text-slate-800">Check on App Startup</div>
                <div className="text-[10px] text-slate-500">Silently check update server when LamSuite launches.</div>
              </div>
              <input
                type="checkbox"
                checked={config.autoCheckOnStartup}
                onChange={(e) => handleStartupToggle(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
              />
            </label>

            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
              <div className="font-semibold text-xs text-slate-800">Background Check Frequency</div>
              <div className="text-[10px] text-slate-500">Periodic query interval while workstation is active.</div>
              <select
                value={config.backgroundCheckIntervalHours}
                onChange={(e) => handleIntervalChange(parseInt(e.target.value, 10))}
                className="w-full mt-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              >
                <option value={0}>Disabled (Manual only)</option>
                <option value={4}>Every 4 Hours</option>
                <option value={12}>Every 12 Hours</option>
                <option value={24}>Daily (Every 24 Hours)</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from "react";
import { windows7PrereqService, type Windows7PrereqStatus } from "../lib/lan/windows7PrereqService";

interface Props {
  status: Windows7PrereqStatus;
  onClose: () => void;
  onRefresh: () => void;
}

export const Windows7PrereqModal: React.FC<Props> = ({ status, onClose, onRefresh }) => {
  const [isRetrying, setIsRetrying] = useState(false);

  const handleDownloadReg = () => {
    const regContent = windows7PrereqService.generateTls12RegistryScript();
    const blob = new Blob([regContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "enable-tls12-windows7.reg";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    await windows7PrereqService.runDiagnostics();
    setIsRetrying(false);
    onRefresh();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 rounded-xl shadow-2xl max-w-2xl w-full p-6 text-slate-800 dark:text-slate-100 flex flex-col max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b pb-4 mb-4 border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 font-bold text-xl">
              ⚠️
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Legacy Windows Connectivity & Prerequisite Notice
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Operating System Detected: <span className="font-semibold">{status.osName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 text-sm">
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            LamSuite Billing requires secure HTTPS and WebSocket communication with cloud sync and licensing servers.
            On <span className="font-semibold">{status.osName}</span>, missing security updates or disabled TLS 1.2
            can prevent network connections.
          </p>

          {/* Diagnostic Indicators */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <span className="font-medium text-xs">Cloud HTTPS API:</span>
              <span className={`text-xs px-2 py-0.5 rounded font-semibold ${status.httpsProbePassed ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'}`}>
                {status.httpsProbePassed ? "✓ Connected" : "✗ Blocked / Handshake Fail"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-xs">Live Sync WebSocket:</span>
              <span className={`text-xs px-2 py-0.5 rounded font-semibold ${status.wsProbePassed ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'}`}>
                {status.wsProbePassed ? "✓ Ready" : "⚠ Disconnected"}
              </span>
            </div>
          </div>

          {/* Required Fixes */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">
              Required Prerequisites for Windows 7 / 8.1:
            </h3>

            {/* 1. TLS 1.2 */}
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-semibold text-xs text-slate-900 dark:text-white">
                    1. Enable TLS 1.2 in WinHTTP & Schannel
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Windows 7 disables TLS 1.2 by default, which blocks all connections to modern HTTPS endpoints.
                  </p>
                </div>
                <button
                  onClick={handleDownloadReg}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium whitespace-nowrap ml-3"
                >
                  Download .reg Fix
                </button>
              </div>
            </div>

            {/* 2. Root Certificates */}
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-semibold text-xs text-slate-900 dark:text-white">
                    2. Install Modern Root Certificate (ISRG Root X1)
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Windows 7 root store does not recognize modern Let's Encrypt certificates. Download and import
                    <code className="text-xs bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded mx-1">isrgrootx1.der</code>
                    into "Trusted Root Certification Authorities".
                  </p>
                </div>
                <a
                  href="https://letsencrypt.org/certs/isrgrootx1.der"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1 bg-slate-700 hover:bg-slate-800 text-white rounded text-xs font-medium whitespace-nowrap ml-3 text-center"
                >
                  Get Root CA
                </a>
              </div>
            </div>

            {/* 3. Essential Windows Updates */}
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
              <h4 className="font-semibold text-xs text-slate-900 dark:text-white">
                3. Essential Windows 7 Updates Checklist
              </h4>
              <ul className="text-xs text-slate-500 dark:text-slate-400 list-disc list-inside mt-1 space-y-0.5">
                <li><strong>Service Pack 1 (SP1)</strong>: Required baseline.</li>
                <li><strong>KB4474419</strong>: SHA-2 code-signing support.</li>
                <li><strong>KB4490628</strong>: Servicing Stack Update (SSU).</li>
                <li><strong>KB2999226 / KB3118401</strong>: Universal C Runtime (UCRT).</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <button
            onClick={handleRetry}
            disabled={isRetrying}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold"
          >
            {isRetrying ? "Probing Network..." : "🔄 Re-test Connectivity"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-lg text-xs font-semibold"
          >
            Continue to App
          </button>
        </div>
      </div>
    </div>
  );
};

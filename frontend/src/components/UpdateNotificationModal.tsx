import React, { useState } from "react";
import { Download, RefreshCw, AlertCircle, CheckCircle2, X } from "lucide-react";
import { autoUpdateService, type UpdateInfo } from "../lib/settings/autoUpdateService";

interface UpdateModalProps {
  updateInfo: UpdateInfo;
  onClose: () => void;
}

export const UpdateNotificationModal: React.FC<UpdateModalProps> = ({ updateInfo, onClose }) => {
  const [isInstalling, setIsInstalling] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const handleInstall = async () => {
    setIsInstalling(true);
    setError(null);
    setStatusMessage("Preparing update...");

    try {
      await autoUpdateService.installAndRestart((event) => {
        if (event.status === "PENDING") {
          setStatusMessage("Downloading update package...");
        } else if (event.status === "DONE") {
          setStatusMessage("Update downloaded. Restarting application...");
        } else if (event.status === "ERROR") {
          setError(event.error || "Failed to download update.");
          setIsInstalling(false);
        }
      });
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred during installation.");
      setIsInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl max-w-md w-full overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-blue-900/40 via-indigo-900/30 to-slate-900 border-b border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg border border-blue-500/20">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm tracking-wide text-white">Software Update Available</h3>
              <p className="text-[11px] text-slate-400">Version {updateInfo.manifest?.version || "New Release"}</p>
            </div>
          </div>
          {!isInstalling && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          {updateInfo.manifest?.body && (
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 text-slate-300 max-h-48 overflow-y-auto whitespace-pre-line font-mono text-[11px]">
              {updateInfo.manifest.body}
            </div>
          )}

          {!updateInfo.manifest?.body && (
            <p className="text-slate-300 leading-relaxed">
              A new update of <strong>LamSuite Billing</strong> is ready to install. Updating includes important
              improvements, tax calculation updates, and bug fixes.
            </p>
          )}

          {statusMessage && (
            <div className="flex items-center gap-2 text-blue-400 bg-blue-950/40 border border-blue-800/50 p-2.5 rounded-lg">
              <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-rose-400 bg-rose-950/40 border border-rose-800/50 p-2.5 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-950/40 border-t border-slate-800 flex justify-end gap-2.5">
          {!isInstalling && (
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-medium transition"
            >
              Remind Me Later
            </button>
          )}
          <button
            type="button"
            disabled={isInstalling}
            onClick={handleInstall}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition"
          >
            {isInstalling ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                Update & Relaunch
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from "react";
import { Download, RefreshCw, AlertCircle, CheckCircle2, X, AlertTriangle, Layers } from "lucide-react";
import { autoUpdateService, type UpdateInfo } from "../lib/settings/autoUpdateService";

interface UpdateModalProps {
  updateInfo: UpdateInfo;
  onClose: () => void;
}

export const UpdateNotificationModal: React.FC<UpdateModalProps> = ({ updateInfo, onClose }) => {
  const [isInstalling, setIsInstalling] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unsyncedCount, setUnsyncedCount] = useState<number>(0);
  const [showUnsyncedWarning, setShowUnsyncedWarning] = useState<boolean>(false);

  useEffect(() => {
    autoUpdateService.getUnsyncedBillsCount().then((count) => {
      setUnsyncedCount(count);
    });
  }, []);

  const handleStartUpdate = async (ignoreWarning: boolean = false) => {
    if (!ignoreWarning && unsyncedCount > 0) {
      setShowUnsyncedWarning(true);
      return;
    }

    setShowUnsyncedWarning(false);
    setIsInstalling(true);
    setError(null);
    setStatusMessage("Connecting to update server...");
    setDownloadProgress(null);

    try {
      await autoUpdateService.installAndRestart((event) => {
        if (event.status === "PENDING") {
          setStatusMessage("Downloading verified update package...");
          setDownloadProgress(30);
        } else if (event.status === "DONE") {
          setStatusMessage("Update verified. Restarting application...");
          setDownloadProgress(100);
        } else if (event.status === "ERROR") {
          setError(event.error || "Failed to download update.");
          setIsInstalling(false);
          setDownloadProgress(null);
        }
      }, true, updateInfo.manifest?.downloadUrl);
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred during update.");
      setIsInstalling(false);
      setDownloadProgress(null);
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
              className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          {showUnsyncedWarning ? (
            <div className="p-3.5 rounded-lg bg-amber-950/60 border border-amber-800/80 text-amber-200 space-y-2.5">
              <div className="flex items-center gap-2 font-bold text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Pending Offline Sync Detected</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-200">
                You have <strong className="font-semibold underline">{unsyncedCount} unsynced bill(s)</strong> waiting to sync to the server. Updating will close and restart LamSuite.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowUnsyncedWarning(false)}
                  className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold"
                >
                  Cancel & Sync First
                </button>
                <button
                  type="button"
                  onClick={() => handleStartUpdate(true)}
                  className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold"
                >
                  Proceed Anyway
                </button>
              </div>
            </div>
          ) : (
            <>
              {unsyncedCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-950/30 border border-amber-800/40 rounded-lg text-amber-300 text-[11px]">
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>{unsyncedCount} unsynced transaction(s) pending sync.</span>
                </div>
              )}

              {updateInfo.manifest?.body && (
                <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 text-slate-300 max-h-48 overflow-y-auto whitespace-pre-line font-mono text-[11px]">
                  {updateInfo.manifest.body}
                </div>
              )}

              {!updateInfo.manifest?.body && (
                <p className="text-slate-300 leading-relaxed">
                  A new release of <strong>LamSuite Billing</strong> is ready to install. Updating includes important
                  improvements, tax calculation updates, and offline engine enhancements.
                </p>
              )}

              {downloadProgress !== null && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Download & Verification</span>
                    <span>{downloadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {statusMessage && (
                <div className="flex items-center gap-2 text-blue-400 bg-blue-950/40 border border-blue-800/50 p-2.5 rounded-lg">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span>{statusMessage}</span>
                </div>
              )}

              {error && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2.5 text-rose-300 bg-rose-950/60 border border-rose-800/80 p-3 rounded-lg text-xs leading-relaxed">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                    <div className="space-y-1 overflow-hidden">
                      <p className="font-semibold text-rose-200">Update Download Interrupted</p>
                      <p className="font-mono text-[11px] break-all text-rose-300 select-all">{error}</p>
                      <p className="text-[10px] text-slate-400 pt-1">
                        Current version remains active and fully functional. You can retry the download or contact support.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-950/40 border-t border-slate-800 flex justify-end gap-2.5">
          {!isInstalling && (
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-medium transition cursor-pointer"
            >
              {error ? "Keep Current Version Running" : "Remind Me Later"}
            </button>
          )}
          {error && !isInstalling ? (
            <button
              type="button"
              onClick={() => handleStartUpdate(true)}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          ) : (
            <button
              type="button"
              disabled={isInstalling || showUnsyncedWarning}
              onClick={() => handleStartUpdate(false)}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition cursor-pointer"
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
          )}
        </div>
      </div>
    </div>
  );
};

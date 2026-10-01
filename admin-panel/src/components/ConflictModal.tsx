import React from "react";
import { AlertCircle, RefreshCw, X } from "lucide-react";

interface ConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReload: () => void;
  currentVersion?: number;
  clientVersion?: number;
  message?: string;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({
  isOpen,
  onClose,
  onReload,
  currentVersion,
  clientVersion,
  message = "This record has been modified concurrently by an offline sync cycle or another user.",
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-amber-500/30 max-w-md w-full overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-500">
            <AlertCircle className="w-5 h-5" />
            <h3 className="font-bold text-slate-800 dark:text-slate-100">Conflict Detected (Optimistic Lock)</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{message}</p>

          {(currentVersion || clientVersion) && (
            <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs font-mono space-y-1">
              <div>Your submitted version: <span className="text-amber-500 font-bold">{clientVersion ?? "N/A"}</span></div>
              <div>Current server version: <span className="text-emerald-500 font-bold">{currentVersion ?? "N/A"}</span></div>
            </div>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400">
            To prevent silent overwrite of newly synced transactions, your changes have been held. Please reload the latest state and apply your changes.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={onReload}
              className="px-3.5 py-1.5 text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-lg flex items-center gap-1.5 shadow-sm"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reload Latest State</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

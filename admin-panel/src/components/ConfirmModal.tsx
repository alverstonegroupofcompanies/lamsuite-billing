import React, { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  requiredPhrase?: string;
  requireReason?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm Action",
  danger = true,
  requiredPhrase,
  requireReason = true,
}) => {
  const [typedPhrase, setTypedPhrase] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (requiredPhrase && typedPhrase.trim() !== requiredPhrase) {
      setError(`Phrase mismatch! You must type exactly: "${requiredPhrase}"`);
      return;
    }
    if (requireReason && !reason.trim()) {
      setError("Please provide a mandatory reason for this action.");
      return;
    }
    setError("");
    onConfirm(reason);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl ${danger ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-500"}`}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{message}</p>

          {requiredPhrase && (
            <div className="space-y-1.5 bg-red-50 dark:bg-red-950/30 p-3.5 rounded-xl border border-red-200 dark:border-red-900/50">
              <label className="text-xs font-semibold text-red-800 dark:text-red-300 block">
                Type <span className="font-mono bg-white dark:bg-black px-1.5 py-0.5 rounded border border-red-300 dark:border-red-800">{requiredPhrase}</span> to confirm:
              </label>
              <input
                type="text"
                value={typedPhrase}
                onChange={(e) => {
                  setTypedPhrase(e.target.value);
                  setError("");
                }}
                placeholder={requiredPhrase}
                className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-red-300 dark:border-red-800 dark:bg-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-red-500"
              />
            </div>
          )}

          {requireReason && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Reason for this action <span className="text-red-500">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError("");
                }}
                required
                rows={2}
                placeholder="e.g. Authorized customer return or stock reconciliation audit..."
                className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500"
              />
            </div>
          )}

          {error && <div className="text-xs font-medium text-red-600 dark:text-red-400">{error}</div>}

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`px-4 py-2 text-xs font-bold rounded-lg text-white transition-all shadow-sm ${
                danger ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700"
              }`}
            >
              {confirmText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

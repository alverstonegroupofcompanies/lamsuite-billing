import React, { useState, useEffect } from "react";
import { X, History, RotateCcw, CheckCircle, AlertCircle, Calendar, FileText, User } from "lucide-react";
import { transactionalImporter } from "../engine/transactionalImporter";
import { useModalEscape } from "../../ui/modalEscapeManager";

interface ImportHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ImportHistoryModal: React.FC<ImportHistoryModalProps> = ({ isOpen, onClose }) => {
  useModalEscape(isOpen, onClose);
  const [history, setHistory] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const records = await transactionalImporter.getImportHistory();
      setHistory(records);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRollback = async (batchId: string) => {
    if (!window.confirm(`Are you sure you want to rollback import batch "${batchId}"? This will reverse all created and modified records.`)) {
      return;
    }

    setRevertingId(batchId);
    try {
      const res = await transactionalImporter.rollbackImport(batchId);
      setMessage({
        text: `Successfully rolled back batch ${batchId}. ${res.revertedCount} records were reversed.`,
        type: "success",
      });
      await loadHistory();
    } catch (err: any) {
      setMessage({ text: err?.message || "Rollback failed.", type: "error" });
    } finally {
      setRevertingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 select-none">
      <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-600 text-white shadow-xs">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">Import History & Audit Trail</h3>
              <p className="text-xs text-slate-500 font-medium">
                Review past batch imports, record counts, and perform one-click rollbacks
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Status Message */}
        {message && (
          <div
            className={`px-6 py-2.5 text-xs font-semibold flex items-center gap-2 ${
              message.type === "success" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
            }`}
          >
            {message.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span>{message.text}</span>
          </div>
        )}

        {/* Content Table */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-slate-500">Loading audit history...</div>
          ) : history.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 italic">No import history found.</div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                  <tr>
                    <th className="px-4 py-2.5">Date & Time</th>
                    <th className="px-4 py-2.5">Entity / Type</th>
                    <th className="px-4 py-2.5">File Name</th>
                    <th className="px-4 py-2.5 text-center">Created</th>
                    <th className="px-4 py-2.5 text-center">Updated</th>
                    <th className="px-4 py-2.5 text-center">Skipped</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-2.5 text-slate-600 font-mono text-[11px]">
                        {new Date(item.created_at).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-2.5 font-bold text-slate-800 capitalize">
                        {item.entity_type}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 truncate max-w-[180px]" title={item.file_name}>
                        {item.file_name}
                      </td>
                      <td className="px-4 py-2.5 text-center font-bold text-emerald-600">
                        {item.created_count}
                      </td>
                      <td className="px-4 py-2.5 text-center font-bold text-blue-600">
                        {item.updated_count}
                      </td>
                      <td className="px-4 py-2.5 text-center text-slate-500">
                        {item.skipped_count}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.status === "completed"
                              ? "bg-emerald-100 text-emerald-800"
                              : item.status === "rolled_back"
                              ? "bg-slate-200 text-slate-700"
                              : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {item.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {item.status === "completed" ? (
                          <button
                            onClick={() => handleRollback(item.id)}
                            disabled={revertingId === item.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-300 font-semibold text-[11px] transition-colors"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>{revertingId === item.id ? "Reverting..." : "Undo"}</span>
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Reverted</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from "react";
import {
  Database,
  ArrowRight,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Building2,
  CheckCircle,
  AlertTriangle,
  Play,
  FileSpreadsheet,
} from "lucide-react";

interface MigrationRunItem {
  id: number;
  run_uuid: string;
  store_id: number;
  source_type: string;
  source_reference: string;
  status: string;
  is_dry_run: boolean;
  progress_stats: Record<string, number>;
  reconciliation_report?: {
    is_passed: boolean;
    financial_comparison?: any;
    stock_comparison?: any;
    discrepancies?: any[];
  };
  created_at: string;
}

export const MigrationCenterPage: React.FC = () => {
  const [runs, setRuns] = useState<MigrationRunItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedRun, setSelectedRun] = useState<MigrationRunItem | null>(null);
  const [storeId, setStoreId] = useState<number>(1);
  const [sourceType, setSourceType] = useState<"api" | "file" | "device">("file");
  const [filePath, setFilePath] = useState<string>("/Users/anshad/migration_bundle.json");
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchRuns = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/migrations?store_id=${storeId}`);
      const data = await res.json();
      if (data.success) {
        setRuns(data.data || []);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, [storeId]);

  const handleStartMigration = async (isDryRun: boolean) => {
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/admin/migrations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: storeId,
          source_type: sourceType,
          config: { file_path: filePath },
          is_dry_run: isDryRun,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      fetchRuns();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRollback = async (uuid: string) => {
    if (!confirm("Are you sure you want to completely rollback this migration run?")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/migrations/${uuid}/rollback`, { method: "POST" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      fetchRuns();
    } catch (err: any) {
      alert("Rollback failed: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-slate-100 font-sans">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-white">
            <Database className="h-6 w-6 text-blue-500" /> Multi-Store Migration Hub
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Centrally manage store onboarding, live delta migrations, financial reconciliations, and rollbacks.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchRuns}
            className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-slate-300"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-950/60 border border-red-800 rounded-lg text-red-200 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          {errorMsg}
        </div>
      )}

      {/* Migration Run Launcher */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Building2 className="h-4 w-4 text-blue-400" /> Launch Store Migration Run
        </h2>
        <div className="grid grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Target Store ID</label>
            <input
              type="number"
              value={storeId}
              onChange={(e) => setStoreId(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Source Ingestion Mode</label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
            >
              <option value="file">Offline File Bundle (.json / .gz)</option>
              <option value="api">Direct Laravel Sanctum API</option>
              <option value="device">Device Local Recovery (Holds/Queue)</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-slate-400 mb-1">Source Path or Host</label>
            <input
              type="text"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            disabled={actionLoading}
            onClick={() => handleStartMigration(true)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-medium flex items-center gap-1.5 transition"
          >
            <Play className="h-3.5 w-3.5 text-blue-400" /> Run Dry-Run Simulation
          </button>
          <button
            type="button"
            disabled={actionLoading}
            onClick={() => handleStartMigration(false)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition"
          >
            {actionLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            Execute Live Migration
          </button>
        </div>
      </div>

      {/* Migration Run History Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 font-semibold text-xs text-slate-300">
          Store Migration Audit Runs & Reconciliations
        </div>
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
            <tr>
              <th className="p-3">Run UUID</th>
              <th className="p-3">Source</th>
              <th className="p-3">Status</th>
              <th className="p-3">Products</th>
              <th className="p-3">Batches</th>
              <th className="p-3">Invoices</th>
              <th className="p-3">Reconciliation</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {runs.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-500">
                  No migration runs found for store ID {storeId}.
                </td>
              </tr>
            ) : (
              runs.map((r) => (
                <tr key={r.run_uuid} className="hover:bg-slate-800/50">
                  <td className="p-3 font-mono text-[11px] text-blue-400">{r.run_uuid.substring(0, 8)}...</td>
                  <td className="p-3">
                    <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {r.source_type}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        r.status === "completed"
                          ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                          : r.status === "failed"
                          ? "bg-red-950 text-red-400 border border-red-800"
                          : "bg-amber-950 text-amber-400 border border-amber-800"
                      }`}
                    >
                      {r.is_dry_run ? `DRY-RUN (${r.status})` : r.status}
                    </span>
                  </td>
                  <td className="p-3">{r.progress_stats?.products || 0}</td>
                  <td className="p-3">{r.progress_stats?.batches || 0}</td>
                  <td className="p-3">{r.progress_stats?.invoices || 0}</td>
                  <td className="p-3">
                    {r.reconciliation_report ? (
                      r.reconciliation_report.is_passed ? (
                        <span className="text-emerald-400 flex items-center gap-1 font-medium">
                          <CheckCircle className="h-3.5 w-3.5" /> Passed (Paisa Match)
                        </span>
                      ) : (
                        <span className="text-amber-400 flex items-center gap-1 font-medium">
                          <AlertTriangle className="h-3.5 w-3.5" /> Variance Flagged
                        </span>
                      )
                    ) : (
                      <span className="text-slate-500">N/A</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {r.status === "completed" && !r.is_dry_run && (
                      <button
                        onClick={() => handleRollback(r.run_uuid)}
                        className="text-red-400 hover:text-red-300 flex items-center gap-1 ml-auto text-[11px]"
                      >
                        <RotateCcw className="h-3 w-3" /> Rollback
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MigrationCenterPage;

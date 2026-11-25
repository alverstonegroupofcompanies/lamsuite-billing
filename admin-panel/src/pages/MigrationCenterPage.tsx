import React, { useEffect, useState } from "react";
import {
  Database,
  ArrowRight,
  RefreshCw,
  RotateCcw,
  Upload,
  CheckCircle,
  AlertTriangle,
  Play,
  FlaskConical,
  Search,
} from "lucide-react";
import { api, ApiError, LEGACY_PANEL_URL } from "../services/api";
import { useAuth } from "../context/AuthContext";

interface MigrationRun {
  id: number;
  run_uuid: string;
  store_id: number;
  source_type: string;
  source_reference: string;
  status: string;
  is_dry_run: boolean;
  cutover_at?: string | null;
  cutover_phrase?: string | null;
  progress_stats?: Record<string, number>;
  reconciliation_report?: {
    is_passed: boolean;
    discrepancies?: Array<{ entity?: string; message?: string; severity?: string }>;
  } | null;
  created_at: string;
}

interface PrecheckReport {
  can_proceed: boolean;
  record_counts?: Record<string, number>;
  issues?: Array<{ type: string; category: string; message: string }>;
  summary?: {
    total_entities?: number;
    total_records?: number;
    warnings_count?: number;
    errors_count?: number;
  };
}

interface StartResult {
  run: MigrationRun;
  stats: Record<string, number>;
  is_dry_run: boolean;
  reconciliation: { is_passed: boolean; discrepancies?: unknown[] } | null;
  cutover_phrase?: string;
}

const unwrap = <T,>(payload: { success: boolean; data: T; message?: string }): T => {
  if (!payload?.success) throw new ApiError(payload?.message || "The server refused this request.", 200, payload);
  return payload.data;
};

/**
 * MIG-01 from the admin panel: the run happens on the server, so this page only asks
 * for a source and reports the answer. It used to type a server path into `config` and
 * declare success whatever came back — the reader now accepts only a bundle reference
 * this service issued, and the numbers below come from the run row, not from here.
 */
export const MigrationCenterPage: React.FC = () => {
  const { stores, activeStore, setActiveStore } = useAuth();

  const [runs, setRuns] = useState<MigrationRun[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [busyLabel, setBusyLabel] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [sourceType, setSourceType] = useState<"api" | "file" | "device">("file");
  const [bundle, setBundle] = useState<{ ref: string; entities: Record<string, number> } | null>(null);
  const [apiUrl, setApiUrl] = useState<string>(LEGACY_PANEL_URL);
  const [apiToken, setApiToken] = useState<string>("");
  const [legacyStoreId, setLegacyStoreId] = useState<string>("");
  const [deviceJson, setDeviceJson] = useState<string>("");

  const [precheck, setPrecheck] = useState<PrecheckReport | null>(null);
  const [result, setResult] = useState<StartResult | null>(null);

  const storeId = activeStore?.id;

  const describe = (err: unknown) => {
    if (err instanceof ApiError && err.status === 403 && err.data?.code === "data_migration_disabled") {
      return `${err.message} This switch lives under Menu & Feature Control.`;
    }
    return err instanceof Error ? err.message : "The request failed.";
  };

  const fetchRuns = async () => {
    if (!storeId) {
      setRuns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get(`/admin/migrations?store_id=${storeId}`);
      setRuns(unwrap<MigrationRun[]>(res));
    } catch (err) {
      setErrorMsg(describe(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPrecheck(null);
    setResult(null);
    void fetchRuns();
  }, [storeId]);

  const pickStore = (id: string) => {
    const target = stores.find((s) => String(s.id) === id);
    if (target) setActiveStore(target);
  };

  /**
   * The source the server reads. A bundle is uploaded once and referred to by the
   * reference the upload issued — this page cannot name a file on the server.
   */
  const sourceConfig = (): Record<string, unknown> => {
    if (sourceType === "file") {
      if (!bundle) throw new ApiError("Choose the exported bundle file first.", 0);
      return { bundle_ref: bundle.ref };
    }
    if (sourceType === "api") {
      if (!apiUrl.trim()) throw new ApiError("The legacy panel URL is required.", 0);
      if (!apiToken.trim()) {
        throw new ApiError(
          "The legacy pull needs a token. Mint one on the legacy panel at /admin/migration-token against the store being migrated.",
          0
        );
      }
      return {
        url: apiUrl.trim(),
        token: apiToken.trim(),
        ...(legacyStoreId.trim() ? { store_id: Number(legacyStoreId.trim()) } : {}),
      };
    }

    if (!deviceJson.trim()) throw new ApiError("Paste the device recovery export as JSON.", 0);
    let parsed: unknown;
    try {
      parsed = JSON.parse(deviceJson);
    } catch {
      throw new ApiError("The device payload is not readable JSON.", 0);
    }
    return { payload: parsed };
  };

  const runStep = async <T,>(label: string, work: () => Promise<T>): Promise<T | null> => {
    setActionLoading(true);
    setBusyLabel(label);
    setErrorMsg(null);
    try {
      return await work();
    } catch (err) {
      setErrorMsg(describe(err));
      return null;
    } finally {
      setActionLoading(false);
      setBusyLabel("");
    }
  };

  const uploadBundle = async (file: File) => {
    const form = new FormData();
    form.append("bundle", file);
    const data = await runStep(`Uploading ${file.name}`, async () =>
      unwrap<{ bundle_ref: string; entities: Record<string, number> }>(await api.upload("/admin/migrations/bundle", form))
    );
    if (!data) return;
    setBundle({ ref: data.bundle_ref, entities: data.entities || {} });
    setResult(null);
    setPrecheck(null);
  };

  const handlePrecheck = () =>
    runStep("Scanning the source", async () => {
      const config = sourceConfig();
      setPrecheck(unwrap<PrecheckReport>(await api.post("/admin/migrations/precheck", { store_id: storeId, source_type: sourceType, config })));
    });

  const handleStart = (isDryRun: boolean) =>
    runStep(isDryRun ? "Running the dry-run" : "Writing the migration", async () => {
      const config = sourceConfig();
      const answer = unwrap<StartResult>(
        await api.post("/admin/migrations/start", { store_id: storeId, source_type: sourceType, config, is_dry_run: isDryRun })
      );
      setResult(answer);
      setPrecheck(null);
      await fetchRuns();
    });

  const handleRollback = async (uuid: string) => {
    if (!confirm("Roll back this run? Every row it wrote for this branch is removed.")) return;
    await runStep("Rolling the run back", async () => {
      unwrap(await api.post(`/admin/migrations/${uuid}/rollback`));
      setResult(null);
      await fetchRuns();
    });
  };

  const statPairs = result ? Object.entries(result.stats || {}).filter(([, v]) => typeof v === "number") : [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-slate-100 font-sans">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-white">
            <Database className="h-6 w-6 text-blue-500" /> Multi-Store Migration Hub
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Imports legacy masters, batches, stock and bills into the branch's own server database, then reconciles what landed.
          </p>
        </div>
        <button
          onClick={fetchRuns}
          className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-slate-300"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-950/60 border border-red-800 rounded-lg text-red-200 text-xs flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Migration Run Launcher */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Play className="h-4 w-4 text-blue-400" /> Launch Store Migration Run
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label htmlFor="migration-store" className="block text-slate-400 mb-1">Branch being migrated</label>
            <select
              id="migration-store"
              value={storeId ?? ""}
              onChange={(e) => pickStore(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
            >
              {stores.length === 0 && <option value="">No store in scope</option>}
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.id} — {s.name} ({s.code})
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 mt-1">
              A store account always migrates its own branch; this list only moves for an account that sees every store.
            </p>
          </div>
          <div>
            <label htmlFor="migration-source" className="block text-slate-400 mb-1">Source</label>
            <select
              id="migration-source"
              value={sourceType}
              onChange={(e) => {
                setSourceType(e.target.value as "api" | "file" | "device");
                setPrecheck(null);
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
            >
              <option value="file">Exported bundle (.json / .gz)</option>
              <option value="api">Direct legacy panel pull</option>
              <option value="device">Device recovery export (holds / queue)</option>
            </select>
          </div>

          {sourceType === "file" && (
            <div className="md:col-span-2">
              <label htmlFor="migration-bundle" className="block text-slate-400 mb-1">Bundle file</label>
              <div className="flex items-center gap-3">
                <input
                  id="migration-bundle"
                  type="file"
                  accept=".json,.gz,application/json,application/gzip"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadBundle(file);
                  }}
                  className="text-xs text-slate-400 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-slate-800 file:text-slate-200"
                />
                <span className="text-[11px] text-slate-500 flex items-center gap-1">
                  <Upload className="h-3.5 w-3.5" />
                  {bundle
                    ? `Held on the server as ${bundle.ref.slice(0, 8)}… (${Object.keys(bundle.entities).length} entity kinds)`
                    : "Nothing uploaded yet"}
                </span>
              </div>
              {bundle && Object.keys(bundle.entities).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Object.entries(bundle.entities).map(([entity, count]) => (
                    <span
                      key={entity}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300"
                    >
                      {entity}: {count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {sourceType === "api" && (
            <>
              <div>
                <label htmlFor="migration-api-url" className="block text-slate-400 mb-1">Legacy panel URL</label>
                <input
                  id="migration-api-url"
                  type="text"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono"
                />
              </div>
              <div>
                <label htmlFor="migration-api-token" className="block text-slate-400 mb-1">Legacy token</label>
                <input
                  id="migration-api-token"
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="Minted at /admin/migration-token"
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono"
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="migration-legacy-store" className="block text-slate-400 mb-1">Legacy store id (optional)</label>
                <input
                  id="migration-legacy-store"
                  type="number"
                  value={legacyStoreId}
                  onChange={(e) => setLegacyStoreId(e.target.value)}
                  className="w-40 bg-slate-950 border border-slate-700 rounded p-2 text-white"
                />
              </div>
            </>
          )}

          {sourceType === "device" && (
            <div className="md:col-span-2">
              <label htmlFor="migration-device-json" className="block text-slate-400 mb-1">Device recovery JSON</label>
              <textarea
                id="migration-device-json"
                value={deviceJson}
                onChange={(e) => setDeviceJson(e.target.value)}
                rows={6}
                placeholder='{ "invoices": [...], "device_holds": [...] }'
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono text-[11px]"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <button
            type="button"
            disabled={actionLoading || !storeId}
            onClick={handlePrecheck}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50"
          >
            <Search className="h-3.5 w-3.5 text-blue-400" /> Scan &amp; Pre-check
          </button>
          <button
            type="button"
            disabled={actionLoading || !storeId}
            onClick={() => handleStart(true)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50"
          >
            <FlaskConical className="h-3.5 w-3.5 text-blue-400" /> Run Dry-Run Simulation
          </button>
          <button
            type="button"
            disabled={actionLoading || !storeId}
            onClick={() => handleStart(false)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
          >
            {actionLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            {busyLabel || "Execute Live Migration"}
          </button>
        </div>
      </div>

      {precheck && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">
              Pre-check: {precheck.summary?.total_records ?? Object.keys(precheck.record_counts || {}).length} records found
            </h2>
            <span
              className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                precheck.can_proceed
                  ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                  : "bg-red-950 text-red-400 border border-red-800"
              }`}
            >
              {precheck.can_proceed ? "Cleared to migrate" : "Blocked"}
            </span>
          </div>
          {(precheck.issues || []).length === 0 ? (
            <p className="text-xs text-slate-400">No quality issues found in the source.</p>
          ) : (
            <ul className="space-y-1.5">
              {(precheck.issues || []).map((issue, i) => (
                <li
                  key={i}
                  className={`text-xs flex items-start gap-2 ${issue.type === "error" ? "text-red-300" : "text-amber-300"}`}
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    <span className="uppercase text-[10px] mr-1">{issue.category}</span>
                    {issue.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white">
            {result.is_dry_run ? "Dry-run completed — nothing was written" : "Migration run finished"}
          </h2>
          <div className="text-[11px] text-slate-400 font-mono">Run {result.run?.run_uuid}</div>
          <div className="flex flex-wrap gap-1.5">
            {statPairs.map(([entity, count]) => (
              <span key={entity} className="text-[10px] px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-200">
                {entity}: {count}
              </span>
            ))}
          </div>
          {result.reconciliation ? (
            result.reconciliation.is_passed ? (
              <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                <CheckCircle className="h-4 w-4" /> Reconciliation passed. The branch can be cut over from a till with{" "}
                <span className="font-mono">{result.cutover_phrase || result.run?.cutover_phrase}</span>.
              </p>
            ) : (
              <p className="text-xs text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                {result.reconciliation.discrepancies?.length || 0} mismatches remain — cutover stays refused until they are resolved.
              </p>
            )
          ) : (
            <p className="text-xs text-slate-500">
              A dry run reconciles against nothing: run it live to get counts the database actually holds.
            </p>
          )}
        </div>
      )}

      {/* Migration Run History Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 font-semibold text-xs text-slate-300">
          Store Migration Audit Runs &amp; Reconciliations
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
              <th className="p-3">Cutover phrase</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {runs.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-slate-500">
                  {storeId ? `No migration run has been recorded for ${activeStore?.name || `store ${storeId}`}.` : "Pick a branch to see its runs."}
                </td>
              </tr>
            ) : (
              runs.map((r) => (
                <tr key={r.run_uuid} className="hover:bg-slate-800/50">
                  <td className="p-3 font-mono text-[11px] text-blue-400">{r.run_uuid.substring(0, 8)}…</td>
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
                  <td className="p-3 font-mono text-[11px] text-slate-400">
                    {r.cutover_at ? "Cut over" : r.cutover_phrase || "—"}
                  </td>
                  <td className="p-3 text-right">
                    {r.status === "completed" && !r.is_dry_run && !r.cutover_at && (
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

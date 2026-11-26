import React, { useCallback, useEffect, useState } from "react";
import {
  Database,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  Play,
  RotateCcw,
  ShieldCheck,
  FileText,
  Server,
  Smartphone,
  BarChart,
  RefreshCw,
  FolderOpen,
  History,
} from "lucide-react";
import {
  MigrationRequestError,
  tillMigrationService,
  type MigrationRun,
  type MigrationSourceType,
  type PrecheckReport,
  type StartResult,
} from "../lib/migration/tillMigrationService";
import { LEGACY_API_URL } from "../config/env";
import { companySettingsService } from "../lib/settings/companySettingsService";

/**
 * MIG-01 — the wizard runs the server pipeline.
 *
 * It used to import into this workstation's own SQLite copy and call that a
 * migration: six green steps, and the store's database stayed empty. Every
 * action here is now one call to /api/till/migrations/*, so the numbers on the
 * screen are the numbers the branch's database actually holds, and the cutover
 * phrase is the server's, not a string this page invented.
 */

const STEPS = [
  "1. Source Setup",
  "2. Pre-Check",
  "3. Field Mapping",
  "4. Dry Run",
  "5. Migration & Reconciliation",
  "6. Final Cutover",
];

type PricingMode = "" | "inclusive" | "exclusive";

const PRICING_MODES: { value: PricingMode; label: string; hint: string }[] = [
  {
    value: "",
    label: "Read it from the source",
    hint: "Use whatever the old system states; fall back to this till's billing setting.",
  },
  {
    value: "inclusive",
    label: "Shown price includes GST",
    hint: "₹118.00 printed on an old bill is the whole amount the customer paid.",
  },
  {
    value: "exclusive",
    label: "GST added on the rate",
    hint: "₹118.00 on an old bill is before tax; the tax was added on top of it.",
  },
];

const explain = (err: unknown): string => {
  if (err instanceof MigrationRequestError) {
    if (err.code === "data_migration_disabled") {
      return `${err.message} (Switched in the admin panel under Menu & Feature Control.)`;
    }

    if (err.code === "counter_action_not_permitted") {
      return `This counter's permission profile does not include the Migration screen. ${err.message}`;
    }

    if (err.status === 401) {
      return "The server no longer accepts this terminal's device token. Re-claim the counter, then try again.";
    }
  }

  return err instanceof Error ? err.message : String(err);
};

export const DataMigrationPage: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [sourceType, setSourceType] = useState<MigrationSourceType>("api");
  const [apiUrl, setApiUrl] = useState<string>(LEGACY_API_URL);
  const [apiToken, setApiToken] = useState<string>("");
  const [legacyStoreId, setLegacyStoreId] = useState<string>("");
  const [bundleFile, setBundleFile] = useState<File | null>(null);
  const [bundleRef, setBundleRef] = useState<string | null>(null);
  const [deviceJson, setDeviceJson] = useState<string>("");
  const [pricingMode, setPricingMode] = useState<PricingMode>("");

  const [loading, setLoading] = useState<boolean>(false);
  const [busyLabel, setBusyLabel] = useState<string>("");
  const [runs, setRuns] = useState<MigrationRun[]>([]);
  const [precheck, setPrecheck] = useState<PrecheckReport | null>(null);
  const [dryRun, setDryRun] = useState<StartResult | null>(null);
  const [liveRun, setLiveRun] = useState<StartResult | null>(null);
  const [cutoverPhrase, setCutoverPhrase] = useState<string>("");
  const [cutoverDone, setCutoverDone] = useState<MigrationRun | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await tillMigrationService.list());
    } catch {
      // An unclaimed terminal has no history to show; the action itself reports why.
    }
  }, []);

  useEffect(() => {
    refreshRuns();
  }, [refreshRuns]);

  /**
   * The config the server reads this source with. A bundle is uploaded once and
   * referred to by the reference the upload issued.
   */
  const sourceFields = async (): Promise<Record<string, unknown>> => {
    if (sourceType === "api") {
      if (!apiUrl.trim()) {
        throw new Error("Enter the legacy server URL, e.g. https://admin.example.com");
      }

      if (!apiToken.trim()) {
        throw new Error(
          `The legacy pull needs a token. Mint one at ${LEGACY_API_URL}/admin/migration-token against the store being migrated.`
        );
      }

      return {
        url: apiUrl.trim(),
        token: apiToken.trim(),
        ...(legacyStoreId.trim() ? { store_id: legacyStoreId.trim() } : {}),
      };
    }

    if (sourceType === "file") {
      if (bundleRef) {
        return { bundle_ref: bundleRef };
      }

      if (!bundleFile) {
        throw new Error("Choose the JSON bundle produced by lamsuite:export-store first.");
      }

      setBusyLabel("Uploading bundle…");
      const uploaded = await tillMigrationService.uploadBundle(bundleFile);
      setBundleRef(uploaded.bundle_ref);

      return { bundle_ref: uploaded.bundle_ref };
    }

    if (!deviceJson.trim()) {
      throw new Error("Paste the device recovery export JSON from the workstation being rescued.");
    }

    try {
      return { payload: JSON.parse(deviceJson) };
    } catch {
      throw new Error("That is not valid JSON.");
    }
  };

  /**
   * The pricing mode, sent with the source fields on every step of one wizard session.
   *
   * The legacy panel keeps no record of whether its shelf prices already carried the GST, so
   * without this the import guesses from the till's own setting. A wrong guess re-derives every
   * migrated price while the rupee totals still reconcile, which is why the number stated here
   * also goes to the pre-check and is stored on the run.
   */
  const sourceConfig = async (): Promise<Record<string, unknown>> => {
    const fields = await sourceFields();

    return pricingMode ? { ...fields, tax_mode: pricingMode } : fields;
  };

  /** Every rupee figure a scan described changes with the pricing answer, so the scan is dropped. */
  const choosePricingMode = (mode: PricingMode) => {
    if (mode === pricingMode) {
      return;
    }

    setPricingMode(mode);
    setPrecheck(null);
    setDryRun(null);
    setLiveRun(null);
    setCutoverDone(null);
  };

  const runStep = async (label: string, work: () => Promise<void>) => {
    setLoading(true);
    setBusyLabel(label);
    setErrorMessage(null);
    setNotice(null);

    try {
      await work();
    } catch (err) {
      setErrorMessage(explain(err));
    } finally {
      setLoading(false);
      setBusyLabel("");
    }
  };

  const handleRunPrecheck = () =>
    runStep("Scanning source…", async () => {
      const config = await sourceConfig();
      const report = await tillMigrationService.precheck(sourceType, config);
      setPrecheck(report);
      setCurrentStep(2);
    });

  const handleExecuteMigration = (isDryRun: boolean) =>
    runStep(isDryRun ? "Simulating run…" : "Writing to the store database…", async () => {
      const result = await tillMigrationService.start(sourceType, await sourceConfig(), isDryRun);

      if (isDryRun) {
        setDryRun(result);
        setCurrentStep(4);
        return;
      }

      setLiveRun(result);
      setCutoverPhrase("");
      setCutoverDone(null);
      setCurrentStep(5);
      await refreshRuns();
    });

  const handleRollback = (uuid: string) =>
    runStep("Rolling back…", async () => {
      const stats = await tillMigrationService.rollback(uuid);
      setLiveRun(null);
      setDryRun(null);
      setCutoverDone(null);
      setNotice(
        `Run rolled back: ${stats.products_deleted ?? 0} product(s), ${stats.invoices_deleted ?? 0} invoice(s) and their batches removed from this branch.`
      );
      setCurrentStep(1);
      await refreshRuns();
    });

  const handleCutover = (uuid: string, expected: string) =>
    runStep("Confirming cutover…", async () => {
      if (cutoverPhrase.trim() !== expected) {
        throw new Error(`Confirmation phrase must match "${expected}" exactly.`);
      }

      const run = await tillMigrationService.cutover(uuid, cutoverPhrase.trim());
      setCutoverDone(run);
      await refreshRuns();
    });

  const startFromRun = (run: MigrationRun) => {
    setLiveRun({
      run,
      stats: run.progress_stats || {},
      is_dry_run: false,
      reconciliation: run.reconciliation_report || null,
      cutover_phrase: run.cutover_phrase,
    });
    setNotice(null);
    setErrorMessage(null);
    setCurrentStep(run.cutover_at ? 6 : 5);
  };

  /**
   * MIG-02: the store owns this switch, so a branch that has it off gets the reason
   * rather than a wizard whose every button 403s. The server refuses the same request
   * whether or not this screen is reached by the tab or by typing the URL.
   */
  if (!companySettingsService.isMigrationAllowed()) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 space-y-2 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-amber-600" />
          <h1 className="text-base font-bold text-amber-900">Data migration is switched off for this branch</h1>
          <p className="text-xs text-amber-800">
            A store owner controls it under Admin Panel → Menu &amp; Feature Control → Data migration
            allowed. Nothing this branch already imported is affected, and past runs stay listed under
            Admin Panel → Migration Center for a store account.
          </p>
        </div>
      </div>
    );
  }

  const stats = liveRun?.stats ?? dryRun?.stats;
  const reconciliation = liveRun?.reconciliation ?? null;
  const expectedPhrase = liveRun?.cutover_phrase || liveRun?.run?.cutover_phrase || "";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-800">
            <Database className="h-6 w-6 text-indigo-600" />
            Store Data Migration Wizard
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Imports legacy masters, batches, stock, invoices and held bills into this branch's server database.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2 py-1 bg-indigo-50 text-indigo-700 rounded border border-indigo-200">
            Guided Step {currentStep} of 6
          </span>
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="flex-1 whitespace-pre-wrap">{errorMessage}</div>
        </div>
      )}

      {notice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm flex items-start gap-2">
          <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="flex-1">{notice}</div>
        </div>
      )}

      <div className="grid grid-cols-6 gap-2 text-center text-xs font-medium">
        {STEPS.map((title, idx) => (
          <div
            key={title}
            className={`p-2 rounded border transition ${
              currentStep === idx + 1
                ? "bg-indigo-600 text-white border-indigo-600 shadow"
                : currentStep > idx + 1
                ? "bg-slate-100 text-emerald-700 border-emerald-300 font-semibold"
                : "bg-white text-slate-400 border-slate-200"
            }`}
          >
            {title}
          </div>
        ))}
      </div>

      {/* Step 1: Source Setup */}
      {currentStep === 1 && (
        <>
          <div className="bg-white border rounded-lg p-6 space-y-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Server className="h-4 w-4 text-indigo-600" /> Choose Migration Source
            </h2>

            <div className="grid grid-cols-3 gap-4">
              <button
                type="button"
                onClick={() => setSourceType("file")}
                className={`p-4 border rounded-lg text-left transition flex flex-col gap-2 ${
                  sourceType === "file" ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-slate-800 text-sm">
                  <FolderOpen className="h-4 w-4 text-indigo-600" /> Exported File Bundle
                </div>
                <p className="text-xs text-slate-500">
                  Upload the JSON backup from <span className="font-mono">lamsuite:export-store</span>. The server keeps it and
                  imports from it.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setSourceType("api")}
                className={`p-4 border rounded-lg text-left transition flex flex-col gap-2 ${
                  sourceType === "api" ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-slate-800 text-sm">
                  <Server className="h-4 w-4 text-indigo-600" /> Direct Laravel API
                </div>
                <p className="text-xs text-slate-500">
                  The server pulls a full snapshot from the running legacy panel with a migration token.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setSourceType("device")}
                className={`p-4 border rounded-lg text-left transition flex flex-col gap-2 ${
                  sourceType === "device" ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-slate-800 text-sm">
                  <Smartphone className="h-4 w-4 text-indigo-600" /> Device Recovery
                </div>
                <p className="text-xs text-slate-500">
                  Recover held bills and unsynced drafts a workstation exported before it was wiped.
                </p>
              </button>
            </div>

            <div className="pt-4 border-t space-y-4">
              {sourceType === "file" && (
                <div className="space-y-3">
                  <label className="block text-xs font-medium text-slate-700">
                    Select Migration Bundle JSON File
                  </label>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 border rounded cursor-pointer text-xs font-medium text-slate-700 transition">
                      <FolderOpen className="h-4 w-4 text-slate-600" />
                      Browse JSON File
                      <input
                        type="file"
                        accept=".json,.json.gz"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          setBundleFile(file);
                          // A new file invalidates the copy the server already holds.
                          setBundleRef(null);
                        }}
                      />
                    </label>
                    <span className="text-xs text-slate-500 font-mono">
                      {bundleFile?.name || "No bundle file selected"}
                      {bundleRef && " · uploaded"}
                    </span>
                  </div>
                </div>
              )}

              {sourceType === "api" && (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Legacy Server URL</label>
                    <input
                      type="text"
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                      className="w-full text-xs p-2.5 border rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                      placeholder="https://admin.example.com"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      The legacy v1 panel host — the one serving /api/sync/pull, not the portal.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">API Token / Bearer Key</label>
                    <input
                      type="password"
                      value={apiToken}
                      onChange={(e) => setApiToken(e.target.value)}
                      className="w-full text-xs p-2.5 border rounded focus:ring-1 focus:ring-indigo-500"
                      placeholder="Sanctum token"
                      autoComplete="off"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Mint it at {LEGACY_API_URL}/admin/migration-token against the store being migrated.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Legacy Store ID <span className="text-slate-400">(only for a multi-store legacy install)</span>
                    </label>
                    <input
                      type="text"
                      value={legacyStoreId}
                      onChange={(e) => setLegacyStoreId(e.target.value)}
                      className="w-full text-xs p-2.5 border rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                      placeholder="blank = the token's store"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Leave blank unless the legacy panel hosts several stores and the token covers more than one.
                    </p>
                  </div>
                </div>
              )}

              {sourceType === "device" && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Paste Device Recovery Export JSON
                  </label>
                  <textarea
                    rows={4}
                    value={deviceJson}
                    onChange={(e) => setDeviceJson(e.target.value)}
                    className="w-full text-xs p-2.5 border rounded focus:ring-1 focus:ring-indigo-500 font-mono"
                    placeholder='{"device_holds": [...], "sync_queue": [...]}'
                  />
                </div>
              )}
            </div>

            {sourceType !== "device" && (
              <div className="pt-4 border-t space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    How the old system priced a bill
                  </label>
                  <p className="text-[11px] text-slate-500 mt-1">
                    A legacy panel stores this switch nowhere, so a migrated year is read with whichever answer is
                    chosen here. Get it wrong and every price in the store is re-derived while the totals still add up.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {PRICING_MODES.map((mode) => (
                    <button
                      key={mode.value || "source"}
                      type="button"
                      onClick={() => choosePricingMode(mode.value)}
                      className={`p-3 border rounded-lg text-left transition ${
                        pricingMode === mode.value
                          ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="text-xs font-medium text-slate-800">{mode.label}</div>
                      <p className="text-[11px] text-slate-500 mt-1">{mode.hint}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t">
              <span className="text-[11px] text-slate-500">
                The store is decided by this terminal's claim — nothing here names a branch.
              </span>
              <button
                type="button"
                disabled={loading}
                onClick={handleRunPrecheck}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium flex items-center gap-2 transition cursor-pointer"
              >
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {busyLabel || "Scan & Pre-check Quality"}
              </button>
            </div>
          </div>

          <div className="bg-white border rounded-lg p-6 space-y-3 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <History className="h-4 w-4 text-indigo-600" /> Migration Runs On This Branch
            </h2>
            <p className="text-xs text-slate-500">
              Counts come from the server's own records, so a run that wrote nothing reads as zero.
            </p>
            {runs.length === 0 ? (
              <div className="text-xs text-slate-500 p-3 bg-slate-50 border rounded">
                No migration run has been recorded for this branch yet.
              </div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b text-slate-600 font-semibold">
                  <tr>
                    <th className="p-2">Run</th>
                    <th className="p-2">Source</th>
                    <th className="p-2">Status</th>
                    <th className="p-2 text-right">Products</th>
                    <th className="p-2 text-right">Invoices</th>
                    <th className="p-2">Reconciled</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y text-slate-700">
                  {runs.map((run) => (
                    <tr key={run.run_uuid}>
                      <td className="p-2 font-mono text-[11px]">{run.run_uuid.slice(0, 8)}…</td>
                      <td className="p-2 uppercase text-[10px]">{run.source_type}</td>
                      <td className="p-2">
                        {run.is_dry_run ? "dry-run " : ""}
                        {run.status}
                        {run.cutover_at && " · cut over"}
                      </td>
                      <td className="p-2 text-right">{run.progress_stats?.products ?? 0}</td>
                      <td className="p-2 text-right">{run.progress_stats?.invoices ?? 0}</td>
                      <td className="p-2">
                        {run.reconciliation_report ? (
                          run.reconciliation_report.is_passed ? (
                            <span className="text-emerald-600">Passed</span>
                          ) : (
                            <span className="text-amber-600">
                              {run.reconciliation_report.discrepancies?.length ?? 0} flagged
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {run.status === "completed" && !run.is_dry_run && (
                          <button
                            type="button"
                            onClick={() => startFromRun(run)}
                            className="text-indigo-600 hover:underline cursor-pointer"
                          >
                            Open
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Step 2: Pre-Check Diagnostics */}
      {currentStep === 2 && precheck && (
        <div className="bg-white border rounded-lg p-6 space-y-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" /> Pre-Flight Data Quality Diagnostics
            </h2>
            <span
              className={`text-xs px-2.5 py-1 rounded font-semibold ${
                precheck.can_proceed ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
              }`}
            >
              {precheck.can_proceed ? "Passed Quality Checks" : "Blockers Detected"}
            </span>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3 text-center">
            {[
              ["Total Records", precheck.summary.total_records],
              ["Products", precheck.record_counts.products || 0],
              ["Batches & Stocks", precheck.record_counts.product_batches || 0],
              ["Sales Invoices", precheck.record_counts.sales_invoices ?? (precheck.record_counts.invoices || 0)],
              ["Credit Bills", precheck.record_counts.credit_bills || 0],
              ["Purchases", precheck.record_counts.purchases || 0],
              ["Customers", precheck.record_counts.customers || 0],
              ["Held Bills", precheck.record_counts.device_holds || 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="p-3 bg-slate-50 border rounded">
                <div className="text-[11px] text-slate-500">{label}</div>
                <div className="text-base font-bold text-slate-800">{value}</div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-700">Diagnostic Findings & Warnings:</h3>
            {precheck.issues.length === 0 ? (
              <div className="p-3 bg-emerald-50 text-emerald-700 text-xs rounded border border-emerald-200 flex items-center gap-2">
                <CheckCircle className="h-4 w-4" /> All integrity checks clean. No duplicate barcodes or orphan records detected.
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {precheck.issues.map((issue, idx) => (
                  <div
                    key={idx}
                    className={`p-2.5 text-xs rounded border flex items-start gap-2 ${
                      issue.type === "error"
                        ? "bg-red-50 border-red-200 text-red-700"
                        : issue.type === "info"
                        ? "bg-slate-50 border-slate-200 text-slate-600"
                        : "bg-amber-50 border-amber-200 text-amber-700"
                    }`}
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold uppercase tracking-wider text-[10px] mr-1">
                        [{issue.category}]
                      </span>
                      {issue.message}
                      {issue.details && issue.details.length > 0 && (
                        <div className="font-mono text-[10px] mt-1 opacity-80">{issue.details.join(", ")}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-between pt-4 border-t">
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="px-3 py-1.5 border rounded text-xs text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Back to Source Setup
            </button>
            <button
              type="button"
              disabled={!precheck.can_proceed}
              onClick={() => setCurrentStep(3)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium flex items-center gap-2 transition disabled:opacity-50 cursor-pointer"
            >
              Continue to Entity Mapping <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Entity Mapping Review */}
      {currentStep === 3 && (
        <div className="bg-white border rounded-lg p-6 space-y-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <FileText className="h-4 w-4 text-indigo-600" /> Automatic Field & Status Mapping
          </h2>
          <p className="text-xs text-slate-500">
            These are the correspondences the server pipeline applies. Nothing is written until you run it.
          </p>

          <table className="w-full text-xs text-left border rounded">
            <thead className="bg-slate-50 border-b text-slate-600 font-semibold">
              <tr>
                <th className="p-2.5">Source Entity</th>
                <th className="p-2.5">Target Destination</th>
                <th className="p-2.5">Transformation Strategy</th>
                <th className="p-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y text-slate-700">
              {[
                ["stores, store_settings", "stores, company_settings", "Preserve tax mode, GSTIN, invoice prefix"],
                ["master_groups, brands, units", "master_lookups", "Polymorphic type mapping, pack conversions preserved"],
                ["customers, suppliers", "parties", "Opening balances, credit limits, GSTIN reconciled"],
                ["billing_app_users", "users", "Bcrypt hash reuse; force reset if unrecognized"],
                ["products, product_batches", "products, product_batches", "Rates, MRP, HSN, batch stock preserved to exact paisa"],
                ["invoices, invoice_items", "invoices, invoice_items", "Original document numbers & cancellation dates kept"],
                ["device_holds", "invoices (draft)", "Held POS carts recovered as editable drafts"],
              ].map(([source, target, strategy]) => (
                <tr key={source}>
                  <td className="p-2.5 font-mono">{source}</td>
                  <td className="p-2.5 font-mono">{target}</td>
                  <td className="p-2.5">{strategy}</td>
                  <td className="p-2.5 text-emerald-600 font-semibold">Auto-Mapped</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-between pt-4 border-t">
            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              className="px-3 py-1.5 border rounded text-xs text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Back to Pre-Check
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleExecuteMigration(true)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded text-xs font-medium flex items-center gap-2 transition cursor-pointer"
              >
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {busyLabel || "Run Dry-Run Simulation"}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleExecuteMigration(false)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium flex items-center gap-2 transition cursor-pointer"
              >
                Execute Live Migration <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4 & 5: Dry Run Summary / Live Run & Reconciliation */}
      {(currentStep === 4 || currentStep === 5) && stats && (
        <div className="bg-white border rounded-lg p-6 space-y-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <BarChart className="h-4 w-4 text-indigo-600" />
              {currentStep === 4 ? "Dry-Run Simulation Summary" : "Live Migration Execution & Reconciliation"}
            </h2>
            {currentStep === 5 ? (
              reconciliation ? (
                <span
                  className={`text-xs px-2.5 py-1 rounded font-semibold ${
                    reconciliation.is_passed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {reconciliation.is_passed
                    ? "Reconciliation Passed: Paisa-Level Match"
                    : `${reconciliation.discrepancies?.length ?? 0} Discrepancies Flagged`}
                </span>
              ) : (
                <span className="text-xs px-2.5 py-1 rounded font-semibold bg-slate-100 text-slate-600">
                  Not Reconciled
                </span>
              )
            ) : (
              <span className="text-xs px-2.5 py-1 rounded font-semibold bg-slate-100 text-slate-600">
                Nothing written
              </span>
            )}
          </div>

          {currentStep === 5 && liveRun?.run.run_uuid && (
            <div className="text-[11px] text-slate-500 font-mono">
              Run {liveRun.run.run_uuid} · branch database rows, not local drafts
            </div>
          )}

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
            {[
              ["Products", stats.products || 0],
              ["Batches & Stocks", stats.batches || 0],
              ["Sales Invoices", stats.invoices || 0],
              ["Credit Bills", stats.credit_notes || 0],
              ["Purchases", stats.purchases || 0],
              ["Purchase Returns", stats.debit_notes || 0],
              ["Parties", stats.parties || 0],
              ["Held Bills", stats.held_bills || 0],
              ["Rates From Master/Bill", stats.guessed_rates || 0],
              ["Unlinked References", stats.unlinked || 0],
              ["Listed For Review", stats.unresolved || 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="p-3 bg-slate-50 border rounded">
                <div className="text-[11px] text-slate-500">{label}</div>
                <div className="text-base font-bold text-slate-800">{value}</div>
              </div>
            ))}
          </div>

          {((stats.credit_notes || 0) + (stats.guessed_rates || 0) + (stats.unresolved || 0)) > 0 && (
            <div className="p-3 bg-slate-50 border rounded text-xs text-slate-600">
              Credit bills are stored against the sale they reverse, and turnover is reported net of them. A rate under
              "Rates From Master/Bill" came from the product catalog or the bill's own totals rather than the line, so
              read those slabs before filing. Anything counted under "Listed For Review" was left out of the import and
              is waiting on a corrected export.
            </div>
          )}

          {stats.errors && stats.errors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 space-y-1">
              <div className="font-semibold">{stats.errors.length} record(s) could not be migrated:</div>
              {stats.errors.slice(0, 8).map((err, idx) => (
                <div key={idx} className="font-mono text-[10px]">
                  {err}
                </div>
              ))}
            </div>
          )}

          {currentStep === 4 ? (
            <div className="p-3 bg-slate-50 border rounded text-xs text-slate-600">
              A dry run writes inside a transaction and rolls it back, so these numbers describe what a live run would
              create — no row survives it.
            </div>
          ) : (
            reconciliation && (
              <div className="p-4 bg-slate-50 border rounded space-y-2 text-xs">
                <h3 className="font-semibold text-slate-700">Financial Side-by-Side Audit:</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-white border rounded">
                    <div className="text-slate-500">Sales Turnover Match</div>
                    <div className="text-sm font-bold text-slate-800">
                      Source ₹{reconciliation.financial_comparison?.sales?.source ?? 0} · Target ₹
                      {reconciliation.financial_comparison?.sales?.target ?? 0}
                    </div>
                    <div
                      className={`text-[11px] font-medium ${
                        (reconciliation.financial_comparison?.sales?.diff ?? 0) > 0 ? "text-amber-600" : "text-emerald-600"
                      }`}
                    >
                      Variance: ₹{reconciliation.financial_comparison?.sales?.diff ?? 0}
                    </div>
                  </div>
                  <div className="p-3 bg-white border rounded">
                    <div className="text-slate-500">Purchases Match</div>
                    <div className="text-sm font-bold text-slate-800">
                      Source ₹{reconciliation.financial_comparison?.purchases?.source ?? 0} · Target ₹
                      {reconciliation.financial_comparison?.purchases?.target ?? 0}
                    </div>
                    <div
                      className={`text-[11px] font-medium ${
                        (reconciliation.financial_comparison?.purchases?.diff ?? 0) > 0
                          ? "text-amber-600"
                          : "text-emerald-600"
                      }`}
                    >
                      Variance: ₹{reconciliation.financial_comparison?.purchases?.diff ?? 0}
                    </div>
                  </div>
                  <div className="p-3 bg-white border rounded">
                    <div className="text-slate-500">Migrated Stock Valuation</div>
                    <div className="text-sm font-bold text-slate-800">
                      ₹{reconciliation.stock_comparison?.valuation ?? 0}
                    </div>
                    <div className="text-[11px] text-emerald-600 font-medium">
                      {reconciliation.stock_comparison?.total_stock_qty ?? 0} units on-hand
                    </div>
                  </div>
                  <div className="p-3 bg-white border rounded">
                    <div className="text-slate-500">Count Comparison</div>
                    <div className="text-sm font-bold text-slate-800">
                      {Object.entries(reconciliation.counts_comparison?.target ?? {})
                        .map(([entity, count]) => `${entity.slice(0, 3)} ${count}`)
                        .join(" · ") || "—"}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      source {Object.values(reconciliation.counts_comparison?.source ?? {}).reduce((a, b) => a + b, 0)}
                    </div>
                  </div>
                </div>

                {reconciliation.discrepancies && reconciliation.discrepancies.length > 0 && (
                  <div className="space-y-1 pt-2 border-t">
                    {reconciliation.discrepancies.map((d, idx) => (
                      <div key={idx} className="text-[11px] text-amber-700 flex items-start gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>{d.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          )}

          <div className="flex justify-between pt-4 border-t">
            {currentStep === 5 ? (
              <button
                type="button"
                disabled={loading || !liveRun?.run.run_uuid}
                onClick={() => liveRun?.run.run_uuid && handleRollback(liveRun.run.run_uuid)}
                className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" /> Rollback Migration Run
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCurrentStep(3)}
                className="px-3 py-1.5 border rounded text-xs text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Back to Mapping
              </button>
            )}

            <div className="flex gap-2">
              {currentStep === 4 && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleExecuteMigration(false)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium flex items-center gap-2 transition cursor-pointer"
                >
                  Proceed with Live Migration <ArrowRight className="h-4 w-4" />
                </button>
              )}
              {currentStep === 5 && (
                <button
                  type="button"
                  disabled={!reconciliation?.is_passed}
                  title={
                    reconciliation?.is_passed
                      ? undefined
                      : "Reconcile the run without critical mismatches before cutting over"
                  }
                  onClick={() => setCurrentStep(6)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-medium flex items-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  Proceed to Store Cutover <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 6: Store Cutover */}
      {currentStep === 6 && (
        <div className="bg-white border rounded-lg p-6 space-y-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-emerald-600" /> Final Cutover & System Activation
          </h2>

          {cutoverDone ? (
            <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-lg text-center space-y-3">
              <CheckCircle className="h-10 w-10 text-emerald-600 mx-auto" />
              <h3 className="text-base font-bold text-emerald-800">Migration & Cutover Fully Complete!</h3>
              <p className="text-xs text-emerald-700 max-w-md mx-auto">
                Run {cutoverDone.run_uuid.slice(0, 8)}… is recorded as cut over at {String(cutoverDone.cutover_at)}.
                The branch's data already lives in the server database, so every counter and the admin panel see it.
              </p>
              <div className="pt-2">
                <a
                  href="/pos"
                  className="inline-block px-4 py-2 bg-emerald-600 text-white text-xs font-medium rounded hover:bg-emerald-700 transition"
                >
                  Launch POS & Start Billing
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-600">
                This records the cutover against run {liveRun?.run.run_uuid.slice(0, 8) || "—"} on the server. The
                migration itself already wrote to the branch database; confirming is the bookkeeping step that marks the
                legacy store superseded.
              </p>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 space-y-1">
                <div className="font-semibold">Security Confirmation Required:</div>
                <div>The server asks for this branch's own phrase — type it exactly:</div>
                <div className="font-mono font-bold text-amber-900">{expectedPhrase || "CUTOVER-<store code>"}</div>
              </div>

              <div>
                <input
                  type="text"
                  value={cutoverPhrase}
                  onChange={(e) => setCutoverPhrase(e.target.value)}
                  className="w-full text-xs p-2.5 border rounded focus:ring-1 focus:ring-emerald-500 font-mono"
                  placeholder={expectedPhrase || "CUTOVER-<store code>"}
                />
              </div>

              <div className="flex justify-between pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setCurrentStep(5)}
                  className="px-3 py-1.5 border rounded text-xs text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Back to Reconciliation
                </button>
                <button
                  type="button"
                  disabled={loading || !liveRun?.run.run_uuid || !expectedPhrase}
                  onClick={() =>
                    liveRun?.run.run_uuid && handleCutover(liveRun.run.run_uuid, expectedPhrase)
                  }
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                >
                  {loading ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : null}
                  Confirm Cutover & Activate Store
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DataMigrationPage;

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  RefreshCw,
  Search,
  X,
  Download,
  Upload,
  History,
  Ban,
  CheckCircle2,
  AlertTriangle,
  Clock,
  QrCode,
  Truck,
  SlidersHorizontal,
  FileSpreadsheet,
  Copy,
  ChevronLeft,
  ChevronRight,
  Save,
  ScanLine,
} from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatDateTime, formatINR } from "../utils/formatters";

interface ComplianceInvoice {
  id: number;
  invoice_number: string;
  invoice_date: string | null;
  customer_name: string;
  customer_gstin: string | null;
  place_of_supply: string | null;
  grand_total: number;
  status: string;
  store?: { id: number; name: string; code?: string } | null;
  irn: string | null;
  irn_ack_no: string | null;
  irn_ack_date: string | null;
  irn_qr: string | null;
  irn_status: string | null;
  irn_cancelled_at: string | null;
  irn_cancel_reason: string | null;
  irn_error: string | null;
  ewb_number: string | null;
  ewb_date: string | null;
  ewb_valid_until: string | null;
  ewb_status: string | null;
  ewb_part_a: Record<string, unknown> | null;
  ewb_part_b: Record<string, unknown> | null;
  irn_status_effective: string;
  ewb_status_effective: string;
  irn_applicable: boolean;
  ewb_applicable: boolean;
}

interface ComplianceSummary {
  applicable_b2b: number;
  irn_pending: number;
  irn_generated: number;
  irn_cancelled: number;
  ewb_pending: number;
  ewb_active: number;
  ewb_expired: number;
  ewb_cancelled: number;
}

interface ComplianceConfig {
  enabled: boolean;
  provider: string;
  irn: { enabled: boolean; b2b_only: boolean; turnover_threshold: number };
  eway: { enabled: boolean; threshold_amount: number; default_distance_km: number };
}

interface ComplianceEventRow {
  id: number;
  entity_type: string;
  entity_id: string;
  event: string;
  status: string | null;
  message: string | null;
  payload: Record<string, unknown> | null;
  created_at: string | null;
}

interface ListResponse {
  data: ComplianceInvoice[];
  meta: {
    total: number;
    page: number;
    per_page: number;
    last_page: number;
    document: "irn" | "ewb";
    status: string;
    store_id: number | null;
  };
  summary: ComplianceSummary;
  provider: { driver: string; label: string };
}

interface ImportResultRow {
  row: number;
  invoice_number?: string;
  ok: boolean;
  error?: string;
}

const EMPTY_SUMMARY: ComplianceSummary = {
  applicable_b2b: 0,
  irn_pending: 0,
  irn_generated: 0,
  irn_cancelled: 0,
  ewb_pending: 0,
  ewb_active: 0,
  ewb_expired: 0,
  ewb_cancelled: 0,
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
  generated: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
  active: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
  cancelled: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800",
  expired: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:border-slate-600",
  failed: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800",
  not_applicable: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
};

const IRN_STATUS_TABS = ["pending", "generated", "cancelled", "all"];
const EWB_STATUS_TABS = ["pending", "active", "expired", "cancelled", "all"];

const INPUT_CLASS =
  "w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500";

function todayInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const CompliancePage: React.FC = () => {
  const { activeStore, isAllStores, hasPermission } = useAuth();
  const canEdit = hasPermission("compliance", "edit") && !isAllStores;

  const [document, setDocument] = useState<"irn" | "ewb">("irn");
  const [statusTab, setStatusTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<ComplianceInvoice[]>([]);
  const [meta, setMeta] = useState<ListResponse["meta"] | null>(null);
  const [summary, setSummary] = useState<ComplianceSummary>(EMPTY_SUMMARY);
  const [providerLabel, setProviderLabel] = useState("Manual portal entry");
  const [recentEvents, setRecentEvents] = useState<ComplianceEventRow[]>([]);
  const [config, setConfig] = useState<ComplianceConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [irnTarget, setIrnTarget] = useState<ComplianceInvoice | null>(null);
  const [irnForm, setIrnForm] = useState({ irn: "", ack_no: "", ack_date: "", qr: "", force: false });
  const [ewbTarget, setEwbTarget] = useState<ComplianceInvoice | null>(null);
  const [ewbForm, setEwbForm] = useState({
    ewb_number: "",
    ewb_date: todayInput(),
    transporter_name: "",
    transporter_id: "",
    transport_mode: "road",
    vehicle_number: "",
    distance_km: "10",
    transport_doc_no: "",
  });
  const [partBTarget, setPartBTarget] = useState<ComplianceInvoice | null>(null);
  const [partBForm, setPartBForm] = useState({ vehicle_number: "", transport_doc_no: "", transport_doc_date: "" });
  const [cancelTarget, setCancelTarget] = useState<{ kind: "irn" | "ewb"; invoice: ComplianceInvoice } | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const [historyTarget, setHistoryTarget] = useState<ComplianceInvoice | null>(null);
  const [historyEvents, setHistoryEvents] = useState<ComplianceEventRow[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    enabled: true,
    irn_enabled: true,
    irn_b2b_only: true,
    irn_turnover_threshold: "0",
    eway_enabled: true,
    eway_threshold_amount: "50000",
    eway_default_distance_km: "10",
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const [showImport, setShowImport] = useState(false);
  const [importCsv, setImportCsv] = useState("");
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importResults, setImportResults] = useState<ImportResultRow[] | null>(null);
  const [importCounts, setImportCounts] = useState({ applied: 0, failed: 0 });
  const [isImporting, setIsImporting] = useState(false);
  const [backfillCount, setBackfillCount] = useState<number | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get<{
        summary: ComplianceSummary;
        recent_events: ComplianceEventRow[];
        config: ComplianceConfig;
        provider: { label: string };
      }>("/admin/compliance/summary");
      setSummary(res.summary || EMPTY_SUMMARY);
      setRecentEvents(res.recent_events || []);
      setConfig(res.config || null);
      setProviderLabel(res.provider?.label || "Manual portal entry");
      if (res.config) {
        setSettingsForm({
          enabled: !!res.config.enabled,
          irn_enabled: !!res.config.irn?.enabled,
          irn_b2b_only: !!res.config.irn?.b2b_only,
          irn_turnover_threshold: String(res.config.irn?.turnover_threshold ?? 0),
          eway_enabled: !!res.config.eway?.enabled,
          eway_threshold_amount: String(res.config.eway?.threshold_amount ?? 50000),
          eway_default_distance_km: String(res.config.eway?.default_distance_km ?? 10),
        });
      }
    } catch {
      // Summary is auxiliary; the work queue still renders.
    }
  }, []);

  const fetchRows = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<ListResponse>("/admin/compliance", {
        document,
        status: statusTab,
        search: searchTerm,
        from: fromDate,
        to: toDate,
        page,
        per_page: 25,
      });
      setRows(res.data || []);
      setMeta(res.meta || null);
      setSummary(res.summary || EMPTY_SUMMARY);
      setProviderLabel(res.provider?.label || "Manual portal entry");
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to load compliance queue");
    } finally {
      setIsLoading(false);
    }
  }, [document, statusTab, searchTerm, fromDate, toDate, page]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary, activeStore?.id]);

  useEffect(() => {
    setStatusTab("pending");
    setPage(1);
  }, [document]);

  const refreshAll = async () => {
    await Promise.all([fetchRows(), fetchSummary()]);
  };

  const afterMutation = async (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
    await refreshAll();
  };

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setActionError(null);
    try {
      await action();
    } catch (err: unknown) {
      setActionError((err as Error).message || "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const openIrnModal = (invoice: ComplianceInvoice) => {
    setIrnTarget(invoice);
    setIrnForm({ irn: "", ack_no: "", ack_date: nowLocalInput(), qr: "", force: !invoice.irn_applicable });
    setActionError(null);
  };

  const submitIrn = async () => {
    if (!irnTarget) return;
    await runAction("irn", async () => {
      await api.post(`/admin/compliance/${irnTarget.id}/irn`, {
        irn: irnForm.irn.trim(),
        ack_no: irnForm.ack_no.trim(),
        ack_date: irnForm.ack_date,
        qr: irnForm.qr.trim() || undefined,
        force: irnForm.force || undefined,
      });
      setIrnTarget(null);
      await afterMutation(`IRN recorded for ${irnTarget.invoice_number}`);
    });
  };

  const openEwbModal = (invoice: ComplianceInvoice) => {
    setEwbTarget(invoice);
    setEwbForm({
      ewb_number: "",
      ewb_date: todayInput(),
      transporter_name: "",
      transporter_id: "",
      transport_mode: "road",
      vehicle_number: "",
      distance_km: String(config?.eway.default_distance_km ?? 10),
      transport_doc_no: "",
    });
    setActionError(null);
  };

  const submitEwb = async () => {
    if (!ewbTarget) return;
    await runAction("ewb", async () => {
      await api.post(`/admin/compliance/${ewbTarget.id}/eway-bill`, {
        ewb_number: ewbForm.ewb_number.trim(),
        ewb_date: ewbForm.ewb_date || undefined,
        transporter_name: ewbForm.transporter_name.trim() || undefined,
        transporter_id: ewbForm.transporter_id.trim() || undefined,
        transport_mode: ewbForm.transport_mode,
        vehicle_number: ewbForm.vehicle_number.trim() || undefined,
        distance_km: ewbForm.distance_km ? Number(ewbForm.distance_km) : undefined,
        transport_doc_no: ewbForm.transport_doc_no.trim() || undefined,
        force: !ewbTarget.ewb_applicable || undefined,
      });
      setEwbTarget(null);
      await afterMutation(`E-way bill recorded for ${ewbTarget.invoice_number}`);
    });
  };

  const openPartB = (invoice: ComplianceInvoice) => {
    setPartBTarget(invoice);
    setPartBForm({
      vehicle_number: String(invoice.ewb_part_b?.vehicle_number ?? ""),
      transport_doc_no: String(invoice.ewb_part_b?.transport_doc_no ?? ""),
      transport_doc_date: String(invoice.ewb_part_b?.transport_doc_date ?? ""),
    });
    setActionError(null);
  };

  const submitPartB = async () => {
    if (!partBTarget) return;
    await runAction("partb", async () => {
      await api.put(`/admin/compliance/${partBTarget.id}/eway-bill`, {
        vehicle_number: partBForm.vehicle_number.trim() || undefined,
        transport_doc_no: partBForm.transport_doc_no.trim() || undefined,
        transport_doc_date: partBForm.transport_doc_date.trim() || undefined,
      });
      setPartBTarget(null);
      await afterMutation(`Part-B updated for ${partBTarget.invoice_number}`);
    });
  };

  const submitCancel = async () => {
    if (!cancelTarget) return;
    const { kind, invoice } = cancelTarget;
    await runAction("cancel", async () => {
      const path = kind === "irn" ? "irn/cancel" : "eway-bill/cancel";
      await api.post(`/admin/compliance/${invoice.id}/${path}`, { reason: cancelReason.trim() });
      setCancelTarget(null);
      setCancelReason("");
      await afterMutation(`${kind === "irn" ? "IRN" : "E-way bill"} cancelled for ${invoice.invoice_number}`);
    });
  };

  const openHistory = async (invoice: ComplianceInvoice) => {
    setHistoryTarget(invoice);
    setHistoryEvents([]);
    setIsLoadingHistory(true);
    try {
      const res = await api.get<{ events: ComplianceEventRow[] }>(`/admin/compliance/${invoice.id}`);
      setHistoryEvents(res.events || []);
    } catch (err: unknown) {
      setActionError((err as Error).message || "Failed to load compliance history");
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const saveSettings = async () => {
    setIsSavingSettings(true);
    setActionError(null);
    try {
      await api.post("/admin/compliance/settings", {
        enabled: settingsForm.enabled,
        irn: {
          enabled: settingsForm.irn_enabled,
          b2b_only: settingsForm.irn_b2b_only,
          turnover_threshold: Number(settingsForm.irn_turnover_threshold || 0),
        },
        eway: {
          enabled: settingsForm.eway_enabled,
          threshold_amount: Number(settingsForm.eway_threshold_amount || 0),
          default_distance_km: Number(settingsForm.eway_default_distance_km || 10),
        },
      });
      await afterMutation("Compliance settings saved");
      setShowSettings(false);
    } catch (err: unknown) {
      setActionError((err as Error).message || "Failed to save settings");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const exportPending = async () => {
    await runAction("export", async () => {
      const payload = await api.get<{ invoices: unknown[]; count: number }>("/admin/compliance/export-pending", {
        from: fromDate,
        to: toDate,
      });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `compliance_pending_${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${payload.count} pending invoice(s)`);
      setTimeout(() => setNotice(null), 4000);
    });
  };

  const previewBackfill = async () => {
    await runAction("backfill", async () => {
      const res = await api.get<{ count: number }>("/admin/compliance/backfill/preview", {
        from: fromDate,
        to: toDate,
      });
      setBackfillCount(res.count ?? 0);
      setShowImport(true);
    });
  };

  const submitImport = async () => {
    if (!importCsv.trim()) return;
    setIsImporting(true);
    setActionError(null);
    try {
      const res = await api.post<{ applied: number; failed: number; results: ImportResultRow[] }>(
        "/admin/compliance/import",
        { csv: importCsv, active_store_id: activeStore?.id }
      );
      setImportResults(res.results || []);
      setImportCounts({ applied: res.applied, failed: res.failed });
      await refreshAll();
    } catch (err: unknown) {
      setActionError((err as Error).message || "Import failed");
    } finally {
      setIsImporting(false);
    }
  };

  const readCsvFile = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      setImportCsv(text);
      setImportFileName(file.name);
      setImportResults(null);
    } catch {
      setActionError("Could not read the selected file.");
    }
  };

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Copied to clipboard");
      setTimeout(() => setNotice(null), 2500);
    } catch {
      setActionError("Clipboard is not available in this browser.");
    }
  };

  const cards = useMemo(() => {
    if (document === "irn") {
      return [
        { label: "B2B invoices", value: summary.applicable_b2b, icon: FileSpreadsheet, tone: "text-slate-700 dark:text-slate-200" },
        { label: "IRN pending", value: summary.irn_pending, icon: Clock, tone: "text-amber-600 dark:text-amber-400" },
        { label: "IRN generated", value: summary.irn_generated, icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
        { label: "IRN cancelled", value: summary.irn_cancelled, icon: Ban, tone: "text-rose-600 dark:text-rose-400" },
      ];
    }
    return [
      { label: "EWB pending", value: summary.ewb_pending, icon: Clock, tone: "text-amber-600 dark:text-amber-400" },
      { label: "EWB active", value: summary.ewb_active, icon: Truck, tone: "text-emerald-600 dark:text-emerald-400" },
      { label: "EWB expired", value: summary.ewb_expired, icon: AlertTriangle, tone: "text-slate-600 dark:text-slate-300" },
      { label: "EWB cancelled", value: summary.ewb_cancelled, icon: Ban, tone: "text-rose-600 dark:text-rose-400" },
    ];
  }, [document, summary]);

  const statusTabs = document === "irn" ? IRN_STATUS_TABS : EWB_STATUS_TABS;
  const currentStatus = (invoice: ComplianceInvoice) =>
    document === "irn" ? invoice.irn_status_effective : invoice.ewb_status_effective;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Statutory Compliance</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Track IRN and e-way bill references per invoice. Provider: <span className="font-medium">{providerLabel}</span>
            {config && !config.enabled ? " — compliance tracking is turned off for this store." : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowSettings(true)}
            disabled={isAllStores}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Settings
          </button>
          <button
            onClick={previewBackfill}
            disabled={isAllStores || busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            Import / Backfill
          </button>
          <button
            onClick={exportPending}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Export pending
          </button>
          <button
            onClick={refreshAll}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-xs text-blue-800 dark:text-blue-300">
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          This platform ships without a GSP/IRP connection. Generate references on the government portal, then record
          them here (single invoice or bulk CSV import). Historic bills can be backfilled the same way.
        </span>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4" />
          {notice}
        </div>
      )}
      {actionError && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-4 py-2 text-sm text-rose-800 dark:text-rose-300">
          <span className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {actionError}
          </span>
          <button onClick={() => setActionError(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{card.label}</span>
              <card.icon className={`w-4 h-4 ${card.tone}`} />
            </div>
            <div className={`text-2xl font-bold mt-2 ${card.tone}`}>{card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3 space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <button
                    onClick={() => setDocument("irn")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition ${
                      document === "irn"
                        ? "bg-brand-600 text-white"
                        : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                    }`}
                  >
                    <QrCode className="w-4 h-4" />
                    E-Invoice (IRN)
                  </button>
                  <button
                    onClick={() => setDocument("ewb")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition ${
                      document === "ewb"
                        ? "bg-brand-600 text-white"
                        : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                    }`}
                  >
                    <Truck className="w-4 h-4" />
                    E-Way Bill
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {statusTabs.map((status) => (
                    <button
                      key={status}
                      onClick={() => {
                        setStatusTab(status);
                        setPage(1);
                      }}
                      className={`px-2.5 py-1 text-xs font-medium rounded-full border capitalize transition ${
                        statusTab === status
                          ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100"
                          : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
                      }`}
                    >
                      {status === "all" ? "All" : status}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setSearchTerm(search.trim());
                        setPage(1);
                      }
                    }}
                    placeholder="Search invoice no, customer or GSTIN"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => {
                      setFromDate(e.target.value);
                      setPage(1);
                    }}
                    className="px-2 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <span className="text-xs text-slate-400">to</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => {
                      setToDate(e.target.value);
                      setPage(1);
                    }}
                    className="px-2 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button
                    onClick={() => {
                      setSearchTerm(search.trim());
                      setPage(1);
                    }}
                    className="px-3 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition"
                  >
                    Apply
                  </button>
                </div>
              </div>
              {isAllStores && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Consolidated view — switch to a single store to record or cancel references.
                </p>
              )}
            </div>

            {error ? (
              <div className="p-8 text-center text-sm text-rose-600 dark:text-rose-400">{error}</div>
            ) : isLoading ? (
              <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                <RefreshCw className="w-4 h-4 inline animate-spin mr-2" />
                Loading compliance queue…
              </div>
            ) : rows.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
                No {document === "irn" ? "IRN" : "e-way bill"} records match this filter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                      <th className="px-4 py-2.5 font-medium">Invoice</th>
                      <th className="px-4 py-2.5 font-medium">Customer</th>
                      <th className="px-4 py-2.5 font-medium text-right">Value</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {rows.map((invoice) => {
                      const status = currentStatus(invoice);
                      return (
                        <tr key={invoice.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-900 dark:text-white">{invoice.invoice_number}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {formatDate(invoice.invoice_date)}
                              {isAllStores && invoice.store ? ` · ${invoice.store.name}` : ""}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-slate-800 dark:text-slate-200">{invoice.customer_name}</div>
                            <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                              {invoice.customer_gstin || "B2C"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-800 dark:text-slate-200">
                            {formatINR(invoice.grand_total)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full border capitalize ${
                                STATUS_STYLES[status] || STATUS_STYLES.not_applicable
                              }`}
                            >
                              {status.replace(/_/g, " ")}
                            </span>
                            {document === "irn" && invoice.irn && (
                              <div className="text-[11px] font-mono text-slate-400 mt-1 truncate max-w-[200px]">
                                {invoice.irn.slice(0, 18)}…
                              </div>
                            )}
                            {document === "ewb" && invoice.ewb_number && (
                              <div className="text-[11px] font-mono text-slate-400 mt-1">
                                {invoice.ewb_number}
                                {invoice.ewb_valid_until ? ` · till ${formatDate(invoice.ewb_valid_until)}` : ""}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {canEdit && document === "irn" && !invoice.irn && invoice.status !== "cancelled" && (
                                <button
                                  onClick={() => openIrnModal(invoice)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-brand-600 text-white hover:bg-brand-700"
                                >
                                  <ScanLine className="w-3.5 h-3.5" />
                                  Record IRN
                                </button>
                              )}
                              {canEdit &&
                                document === "irn" &&
                                invoice.irn &&
                                invoice.irn_status_effective === "generated" &&
                                invoice.status !== "cancelled" && (
                                  <button
                                    onClick={() => {
                                      setCancelTarget({ kind: "irn", invoice });
                                      setCancelReason("");
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                  >
                                    <Ban className="w-3.5 h-3.5" />
                                    Cancel
                                  </button>
                                )}
                              {canEdit && document === "ewb" && !invoice.ewb_number && invoice.status !== "cancelled" && (
                                <button
                                  onClick={() => openEwbModal(invoice)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-brand-600 text-white hover:bg-brand-700"
                                >
                                  <Truck className="w-3.5 h-3.5" />
                                  Record EWB
                                </button>
                              )}
                              {canEdit && document === "ewb" && invoice.ewb_status_effective === "active" && (
                                <>
                                  <button
                                    onClick={() => openPartB(invoice)}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                                  >
                                    Part-B
                                  </button>
                                  <button
                                    onClick={() => {
                                      setCancelTarget({ kind: "ewb", invoice });
                                      setCancelReason("");
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                  >
                                    <Ban className="w-3.5 h-3.5" />
                                    Cancel
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => openHistory(invoice)}
                                title="Compliance history"
                                className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                              >
                                <History className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {meta && meta.last_page > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  Page {meta.page} of {meta.last_page} · {meta.total} records
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={meta.page <= 1}
                    className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                    disabled={meta.page >= meta.last_page}
                    className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Recent activity</h2>
            {recentEvents.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">No compliance events recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {recentEvents.slice(0, 8).map((event) => (
                  <li key={event.id} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800 dark:text-slate-200 capitalize">
                        {event.event.replace(/_/g, " ")}
                      </span>
                      <span className="text-[11px] text-slate-400">{formatDateTime(event.created_at)}</span>
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                      {event.message ||
                        String(
                          (event.payload?.invoice_number as string) ||
                            (event.payload?.ewb_number as string) ||
                            event.entity_id
                        )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {irnTarget && (
        <Modal title={`Record IRN · ${irnTarget.invoice_number}`} onClose={() => setIrnTarget(null)}>
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Paste the IRN generated on the IRP portal. {irnTarget.irn_applicable ? "" : "This invoice is outside the configured applicability rules; tick Force to store a reference anyway."}
            </p>
            <Field label="IRN (64 hex characters)">
              <input
                value={irnForm.irn}
                onChange={(e) => setIrnForm({ ...irnForm, irn: e.target.value })}
                className={INPUT_CLASS}
                placeholder="e.g. 64-character hexadecimal IRN"
                maxLength={64}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Acknowledgement number">
                <input
                  value={irnForm.ack_no}
                  onChange={(e) => setIrnForm({ ...irnForm, ack_no: e.target.value })}
                  className={INPUT_CLASS}
                  placeholder="Digits from the portal"
                />
              </Field>
              <Field label="Acknowledgement date & time">
                <input
                  type="datetime-local"
                  value={irnForm.ack_date}
                  onChange={(e) => setIrnForm({ ...irnForm, ack_date: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>
            <Field label="Signed QR payload (optional)">
              <textarea
                value={irnForm.qr}
                onChange={(e) => setIrnForm({ ...irnForm, qr: e.target.value })}
                className={`${INPUT_CLASS} font-mono text-[11px]`}
                rows={3}
                placeholder="Paste the signed QR string from the portal"
              />
            </Field>
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={irnForm.force}
                onChange={(e) => setIrnForm({ ...irnForm, force: e.target.checked })}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Force record even if this invoice is not applicable
            </label>
            <ModalActions
              onCancel={() => setIrnTarget(null)}
              onSubmit={submitIrn}
              submitLabel="Save IRN"
              busy={busy === "irn"}
            />
          </div>
        </Modal>
      )}

      {ewbTarget && (
        <Modal title={`Record E-Way Bill · ${ewbTarget.invoice_number}`} onClose={() => setEwbTarget(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="E-Way bill number (12 digits)">
                <input
                  value={ewbForm.ewb_number}
                  onChange={(e) => setEwbForm({ ...ewbForm, ewb_number: e.target.value })}
                  className={INPUT_CLASS}
                  maxLength={12}
                />
              </Field>
              <Field label="E-Way bill date">
                <input
                  type="date"
                  value={ewbForm.ewb_date}
                  onChange={(e) => setEwbForm({ ...ewbForm, ewb_date: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Transporter name">
                <input
                  value={ewbForm.transporter_name}
                  onChange={(e) => setEwbForm({ ...ewbForm, transporter_name: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Transporter GSTIN / ID">
                <input
                  value={ewbForm.transporter_id}
                  onChange={(e) => setEwbForm({ ...ewbForm, transporter_id: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Transport mode">
                <select
                  value={ewbForm.transport_mode}
                  onChange={(e) => setEwbForm({ ...ewbForm, transport_mode: e.target.value })}
                  className={INPUT_CLASS}
                >
                  <option value="road">Road</option>
                  <option value="rail">Rail</option>
                  <option value="air">Air</option>
                  <option value="ship">Ship</option>
                </select>
              </Field>
              <Field label="Vehicle number">
                <input
                  value={ewbForm.vehicle_number}
                  onChange={(e) => setEwbForm({ ...ewbForm, vehicle_number: e.target.value })}
                  className={INPUT_CLASS}
                  placeholder="KA01AB1234"
                />
              </Field>
              <Field label="Distance (km)">
                <input
                  type="number"
                  min={1}
                  value={ewbForm.distance_km}
                  onChange={(e) => setEwbForm({ ...ewbForm, distance_km: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Transport document no.">
                <input
                  value={ewbForm.transport_doc_no}
                  onChange={(e) => setEwbForm({ ...ewbForm, transport_doc_no: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>
            <p className="text-[11px] text-slate-400">
              Validity is derived from distance (1 day per 200 km, minimum 1 day). {ewbTarget.ewb_applicable ? "" : "This invoice is below the threshold; it will be recorded with force."}
            </p>
            <ModalActions
              onCancel={() => setEwbTarget(null)}
              onSubmit={submitEwb}
              submitLabel="Save E-Way Bill"
              busy={busy === "ewb"}
            />
          </div>
        </Modal>
      )}

      {partBTarget && (
        <Modal title={`Update Part-B · ${partBTarget.invoice_number}`} onClose={() => setPartBTarget(null)}>
          <div className="space-y-3">
            <Field label="Vehicle number">
              <input
                value={partBForm.vehicle_number}
                onChange={(e) => setPartBForm({ ...partBForm, vehicle_number: e.target.value })}
                className={INPUT_CLASS}
                placeholder="KA01AB1234"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Transport document no.">
                <input
                  value={partBForm.transport_doc_no}
                  onChange={(e) => setPartBForm({ ...partBForm, transport_doc_no: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Document date">
                <input
                  value={partBForm.transport_doc_date}
                  onChange={(e) => setPartBForm({ ...partBForm, transport_doc_date: e.target.value })}
                  className={INPUT_CLASS}
                  placeholder="YYYY-MM-DD"
                />
              </Field>
            </div>
            <ModalActions
              onCancel={() => setPartBTarget(null)}
              onSubmit={submitPartB}
              submitLabel="Update Part-B"
              busy={busy === "partb"}
            />
          </div>
        </Modal>
      )}

      {cancelTarget && (
        <Modal
          title={`Cancel ${cancelTarget.kind === "irn" ? "IRN" : "E-Way Bill"} · ${cancelTarget.invoice.invoice_number}`}
          onClose={() => setCancelTarget(null)}
        >
          <div className="space-y-3">
            {cancelTarget.kind === "irn" && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                IRNs can only be cancelled within 24 hours of acknowledgement, and only after cancelling any linked
                e-way bill.
              </p>
            )}
            <Field label="Cancellation reason">
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className={INPUT_CLASS}
                rows={3}
                placeholder="Minimum 3 characters"
              />
            </Field>
            <ModalActions
              onCancel={() => setCancelTarget(null)}
              onSubmit={submitCancel}
              submitLabel="Confirm cancellation"
              busy={busy === "cancel"}
              danger
              disabled={cancelReason.trim().length < 3}
            />
          </div>
        </Modal>
      )}

      {historyTarget && (
        <Modal title={`Compliance history · ${historyTarget.invoice_number}`} onClose={() => setHistoryTarget(null)} wide>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1">
                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <QrCode className="w-3.5 h-3.5" />
                  E-Invoice
                </div>
                <div className="text-slate-500 dark:text-slate-400">
                  Status: <span className="capitalize">{historyTarget.irn_status_effective.replace(/_/g, " ")}</span>
                </div>
                {historyTarget.irn ? (
                  <>
                    <div className="font-mono text-[10px] break-all text-slate-700 dark:text-slate-300">
                      {historyTarget.irn}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">
                      Ack {historyTarget.irn_ack_no || "—"} · {formatDateTime(historyTarget.irn_ack_date)}
                    </div>
                    <button
                      onClick={() => copyToClipboard(historyTarget.irn || "")}
                      className="inline-flex items-center gap-1 text-[11px] text-brand-600 hover:underline"
                    >
                      <Copy className="w-3 h-3" />
                      Copy IRN
                    </button>
                    {historyTarget.irn_qr && (
                      <details className="text-[11px] text-slate-500 dark:text-slate-400">
                        <summary className="cursor-pointer">Signed QR payload</summary>
                        <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px]">
                          {historyTarget.irn_qr}
                        </pre>
                      </details>
                    )}
                    {historyTarget.irn_cancel_reason && (
                      <div className="text-rose-600 dark:text-rose-400">
                        Cancelled: {historyTarget.irn_cancel_reason}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-slate-500 dark:text-slate-400">No IRN recorded.</div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1">
                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5" />
                  E-Way Bill
                </div>
                <div className="text-slate-500 dark:text-slate-400">
                  Status: <span className="capitalize">{historyTarget.ewb_status_effective.replace(/_/g, " ")}</span>
                </div>
                {historyTarget.ewb_number ? (
                  <>
                    <div className="font-mono text-slate-700 dark:text-slate-300">{historyTarget.ewb_number}</div>
                    <div className="text-slate-500 dark:text-slate-400">
                      {formatDate(historyTarget.ewb_date)} → {formatDate(historyTarget.ewb_valid_until)}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">
                      {String(historyTarget.ewb_part_a?.transporter_name || "—")} ·{" "}
                      {String(historyTarget.ewb_part_b?.vehicle_number || "—")} ·{" "}
                      {String(historyTarget.ewb_part_a?.distance_km ?? "—")} km
                    </div>
                  </>
                ) : (
                  <div className="text-slate-500 dark:text-slate-400">No e-way bill recorded.</div>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Event trail</h3>
              {isLoadingHistory ? (
                <p className="text-xs text-slate-500">Loading…</p>
              ) : historyEvents.length === 0 ? (
                <p className="text-xs text-slate-500">No events recorded for this invoice.</p>
              ) : (
                <ul className="space-y-2">
                  {historyEvents.map((event) => (
                    <li
                      key={event.id}
                      className="flex items-start justify-between gap-3 text-xs border border-slate-100 dark:border-slate-700 rounded-lg px-3 py-2"
                    >
                      <div>
                        <div className="font-medium text-slate-800 dark:text-slate-200 capitalize">
                          {event.event.replace(/_/g, " ")}
                        </div>
                        {event.message && (
                          <div className="text-slate-500 dark:text-slate-400">{event.message}</div>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 whitespace-nowrap">
                        {formatDateTime(event.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Modal>
      )}

      {showSettings && (
        <Modal title="Compliance settings" onClose={() => setShowSettings(false)}>
          <div className="space-y-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={settingsForm.enabled}
                onChange={(e) => setSettingsForm({ ...settingsForm, enabled: e.target.checked })}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Enable statutory compliance tracking for this store
            </label>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={settingsForm.irn_enabled}
                  onChange={(e) => setSettingsForm({ ...settingsForm, irn_enabled: e.target.checked })}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                E-Invoice (IRN)
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 ml-6">
                <input
                  type="checkbox"
                  checked={settingsForm.irn_b2b_only}
                  onChange={(e) => setSettingsForm({ ...settingsForm, irn_b2b_only: e.target.checked })}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Apply to B2B invoices only (requires customer GSTIN)
              </label>
              <Field label="Turnover threshold (₹, informational)">
                <input
                  type="number"
                  min={0}
                  value={settingsForm.irn_turnover_threshold}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, irn_turnover_threshold: e.target.value })
                  }
                  className={INPUT_CLASS}
                />
              </Field>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={settingsForm.eway_enabled}
                  onChange={(e) => setSettingsForm({ ...settingsForm, eway_enabled: e.target.checked })}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                E-Way Bill
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Threshold amount (₹)">
                  <input
                    type="number"
                    min={0}
                    value={settingsForm.eway_threshold_amount}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, eway_threshold_amount: e.target.value })
                    }
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label="Default distance (km)">
                  <input
                    type="number"
                    min={1}
                    value={settingsForm.eway_default_distance_km}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, eway_default_distance_km: e.target.value })
                    }
                    className={INPUT_CLASS}
                  />
                </Field>
              </div>
            </div>
            <ModalActions
              onCancel={() => setShowSettings(false)}
              onSubmit={saveSettings}
              submitLabel="Save settings"
              busy={isSavingSettings}
              icon={<Save className="w-4 h-4" />}
            />
          </div>
        </Modal>
      )}

      {showImport && (
        <Modal title="Import / backfill compliance references" onClose={() => setShowImport(false)} wide>
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Upload or paste a CSV with columns: <span className="font-mono">invoice_number, irn, ack_no, ack_date, qr,
              ewb_number, ewb_date, vehicle_number, distance_km, transporter_name</span>. Rows are matched by invoice
              number within the active store. {backfillCount !== null && `${backfillCount} invoice(s) are currently pending.`}
            </p>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition">
                <FileSpreadsheet className="w-4 h-4" />
                Choose CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => readCsvFile(e.target.files?.[0])}
                />
              </label>
              {importFileName && (
                <span className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                  {importFileName}
                  <button
                    onClick={() => {
                      setImportFileName(null);
                      setImportCsv("");
                      setImportResults(null);
                    }}
                    className="text-slate-400 hover:text-rose-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              )}
            </div>
            <textarea
              rows={6}
              value={importCsv}
              onChange={(e) => {
                setImportCsv(e.target.value);
                setImportResults(null);
              }}
              placeholder={"invoice_number,irn,ack_no,ack_date\nINV-1001,<64 hex>,115011223344,2026-11-17"}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {importResults && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700/40 text-slate-600 dark:text-slate-300">
                  {importCounts.applied} applied · {importCounts.failed} failed
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {importResults.map((row) => (
                    <li key={row.row} className="px-3 py-1.5 text-xs flex items-start gap-2">
                      {row.ok ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600 mt-0.5" />
                      )}
                      <span className="text-slate-600 dark:text-slate-300">
                        Row {row.row}
                        {row.invoice_number ? ` · ${row.invoice_number}` : ""}
                        {row.error ? ` — ${row.error}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ModalActions
              onCancel={() => setShowImport(false)}
              onSubmit={submitImport}
              submitLabel="Import rows"
              busy={isImporting}
              disabled={!importCsv.trim() || isAllStores}
            />
          </div>
        </Modal>
      )}
    </div>
  );
};

const Modal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}> = ({ title, onClose, children, wide }) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
    <div
      className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} my-8 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700`}
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block text-xs">
    <span className="block font-medium text-slate-600 dark:text-slate-300 mb-1">{label}</span>
    {children}
  </label>
);

const ModalActions: React.FC<{
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  busy?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
}> = ({ onCancel, onSubmit, submitLabel, busy, danger, disabled, icon }) => (
  <div className="flex items-center justify-end gap-2 pt-2">
    <button
      onClick={onCancel}
      className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
    >
      Close
    </button>
    <button
      onClick={onSubmit}
      disabled={busy || disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-white transition disabled:opacity-50 ${
        danger ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-600 hover:bg-brand-700"
      }`}
    >
      {busy && <RefreshCw className="w-4 h-4 animate-spin" />}
      {!busy && icon}
      {submitLabel}
    </button>
  </div>
);

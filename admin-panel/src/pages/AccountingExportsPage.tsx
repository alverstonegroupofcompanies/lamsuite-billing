import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Package,
  Receipt,
  RefreshCw,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { api, downloadFile } from "../services/api";
import { useAuth } from "../context/AuthContext";

type ExportFormat = "tally" | "busy" | "csv";

interface ExportTypeInfo {
  type: string;
  label: string;
  formats: ExportFormat[];
  requires_party: boolean;
}

interface PartyOption {
  id: number;
  type: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  store: string | null;
}

interface CatalogResponse {
  success: boolean;
  store_scope: string;
  date_defaults: { from: string; to: string };
  types: ExportTypeInfo[];
}

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500";

const FORMAT_LABEL: Record<ExportFormat, string> = {
  tally: "Tally XML",
  busy: "Busy XML",
  csv: "CSV",
};

const TYPE_META: Record<string, { icon: React.ElementType; description: string }> = {
  sales: {
    icon: Receipt,
    description: "Sales invoices and credit notes with ledger, tax and inventory lines.",
  },
  purchases: {
    icon: Truck,
    description: "Purchase bills with supplier, input tax, freight and item lines.",
  },
  customers: {
    icon: Users,
    description: "Customer masters exported as Sundry Debtors with GSTIN and opening balances.",
  },
  suppliers: {
    icon: Building2,
    description: "Supplier masters exported as Sundry Creditors with GSTIN and balances.",
  },
  products: {
    icon: Package,
    description: "Item masters with HSN, GST rate, selling rates and closing stock.",
  },
  "gst-summary": {
    icon: FileText,
    description: "HSN and rate-wise taxable, CGST, SGST, IGST and cess totals for the period.",
  },
  daybook: {
    icon: BookOpen,
    description: "Chronological day book of sales, purchase and expense vouchers.",
  },
  "party-statement": {
    icon: Wallet,
    description: "Running ledger statement with opening and closing balance for one party.",
  },
};

export const AccountingExportsPage: React.FC = () => {
  const { user, isAllStores, hasPermission } = useAuth();

  const [types, setTypes] = useState<ExportTypeInfo[]>([]);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [partyId, setPartyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);

  const canExport = hasPermission("reports", "export");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [catalog, partyRes] = await Promise.all([
        api.get<CatalogResponse>("/admin/accounting/exports"),
        api.get<{ success: boolean; parties: PartyOption[] }>("/admin/accounting/export-parties"),
      ]);
      setTypes(catalog.types || []);
      setParties(partyRes.parties || []);
      setFrom((current) => current || catalog.date_defaults?.from || "");
      setTo((current) => current || catalog.date_defaults?.to || "");
    } catch (e: any) {
      setError(e?.message || "Failed to load export catalog.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const partyLabel = useMemo(() => {
    const selected = parties.find((p) => String(p.id) === partyId);
    if (!selected) return "";
    return `${selected.name}${selected.phone ? ` · ${selected.phone}` : ""}`;
  }, [parties, partyId]);

  const runExport = async (type: string, format: ExportFormat, requiresParty: boolean) => {
    setNotice("");
    setError("");

    if (from && to && from > to) {
      setError("The from date must be before the to date.");
      return;
    }
    if (requiresParty && !partyId) {
      setError("Select a party before exporting a ledger statement.");
      return;
    }

    const key = `${type}:${format}`;
    setDownloading(key);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (requiresParty) params.set("party_id", partyId);
      const query = params.toString();
      const extension = format === "csv" ? "csv" : "xml";
      const fallback = `${type}-${from || "start"}-to-${to || "today"}.${extension}`;

      await downloadFile(
        `/admin/accounting/exports/${type}/${format}${query ? `?${query}` : ""}`,
        fallback
      );
      setNotice(
        `${FORMAT_LABEL[format]} export started${partyLabel && requiresParty ? ` for ${partyLabel}` : ""}.`
      );
    } catch (e: any) {
      setError(e?.message || "Export failed.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-brand-500" />
            Accounting Exports
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Download Tally XML, Busy XML and CSV files for accounting, GST filing and audits.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 self-start"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {!canExport && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Your role can view export options but does not have export permission.
        </div>
      )}
      {isAllStores && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <Building2 className="w-4 h-4 shrink-0" />
          All Stores scope: exports consolidate data from every accessible store.
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {notice}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs font-medium text-rose-800 dark:text-rose-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Period & scope</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              From
            </label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT_CLASS} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              To
            </label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT_CLASS} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              Party (ledger statement)
            </label>
            <select value={partyId} onChange={(e) => setPartyId(e.target.value)} className={INPUT_CLASS}>
              <option value="">Select customer or supplier</option>
              {parties.map((party) => (
                <option key={party.id} value={party.id}>
                  [{party.type === "supplier" ? "Supplier" : "Customer"}] {party.name}
                  {party.phone ? ` · ${party.phone}` : ""}
                  {isAllStores && party.store ? ` — ${party.store}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          Signed in as {user?.name || "admin"}. Sales, purchase and GST exports use the selected period;
          master exports ignore it.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {loading && types.length === 0 ? (
          <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Loading export catalog…
          </div>
        ) : (
          types.map((info) => {
            const meta = TYPE_META[info.type] || {
              icon: FileText,
              description: info.label,
            };
            const Icon = meta.icon;
            return (
              <div
                key={info.type}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 flex flex-col"
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-300 flex items-center justify-center shrink-0">
                    <Icon className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-slate-900 dark:text-white">{info.label}</div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{meta.description}</p>
                    {info.requires_party && !partyId && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5">
                        Select a party above to enable this export.
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {info.formats.map((format) => {
                    const key = `${info.type}:${format}`;
                    const isBusy = downloading === key;
                    const disabled =
                      !canExport || downloading !== null || (info.requires_party && !partyId);
                    return (
                      <button
                        key={format}
                        type="button"
                        disabled={disabled}
                        onClick={() => runExport(info.type, format, info.requires_party)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          format === "csv"
                            ? "border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                            : "border-brand-300 dark:border-brand-800 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950/40"
                        }`}
                      >
                        {isBusy ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        {FORMAT_LABEL[format]}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-xs text-slate-500 dark:text-slate-400 space-y-1.5">
        <p className="font-semibold text-slate-700 dark:text-slate-200">Import notes</p>
        <p>Tally XML uses the Import Data envelope and can be loaded via Tally Gateway or manual import.</p>
        <p>Busy XML provides voucher and item blocks for accounting import; CSV opens directly in Excel.</p>
        <p>Cancelled invoices and purchase bills are excluded from every export.</p>
      </div>
    </div>
  );
};

export default AccountingExportsPage;

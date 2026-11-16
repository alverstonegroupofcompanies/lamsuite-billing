import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  X,
} from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";

interface CustomerRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  credit_limit: string | number | null;
  is_active: boolean;
}

interface PortalStatus {
  active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
}

interface IssuedLink {
  token: string;
  portal_url: string;
  expires_at: string | null;
  party: { id: number; name: string; phone: string | null; gstin: string | null };
}

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500";

const formatDate = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const DAY_OPTIONS = [7, 30, 90, 180, 365];

export const PortalAccessPage: React.FC = () => {
  const { isAllStores, hasPermission } = useAuth();
  const canManage = hasPermission("masters", "edit");

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [status, setStatus] = useState<PortalStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [copied, setCopied] = useState(false);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ data: CustomerRow[] }>("/admin/parties", {
        type: "customer",
        per_page: 500,
      });
      setCustomers(res.data || []);
    } catch (e: any) {
      setError(e.message || "Failed to load customers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter((c) =>
      [c.name, c.phone, c.gstin, c.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [customers, search]);

  const openCustomer = async (customer: CustomerRow) => {
    setSelected(customer);
    setStatus(null);
    setIssued(null);
    setCopied(false);
    setStatusLoading(true);
    try {
      const res = await api.get<{ success: boolean } & PortalStatus>(
        `/admin/parties/${customer.id}/portal-status`
      );
      setStatus({ active: res.active, last_used_at: res.last_used_at, expires_at: res.expires_at });
    } catch (e: any) {
      setError(e.message || "Failed to load portal status.");
    } finally {
      setStatusLoading(false);
    }
  };

  const closeModal = () => {
    setSelected(null);
    setStatus(null);
    setIssued(null);
    setCopied(false);
  };

  const generateLink = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await api.post<
        { success: boolean } & IssuedLink
      >(`/admin/parties/${selected.id}/portal-link`, {
        days,
        portal_base_url: window.location.origin,
      });
      setIssued({
        token: res.token,
        portal_url: res.portal_url,
        expires_at: res.expires_at,
        party: res.party,
      });
      setStatus({ active: true, last_used_at: null, expires_at: res.expires_at });
      setNotice(`Portal link generated for ${res.party.name}.`);
    } catch (e: any) {
      setError(e.message || "Failed to generate portal link.");
    } finally {
      setBusy(false);
    }
  };

  const revokeLink = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.delete(`/admin/parties/${selected.id}/portal-link`);
      setStatus({ active: false, last_used_at: null, expires_at: null });
      setIssued(null);
      setNotice(`Portal access revoked for ${selected.name}.`);
    } catch (e: any) {
      setError(e.message || "Failed to revoke portal access.");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.portal_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Could not copy automatically. Select the link and copy it manually.");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Link2 className="w-5 h-5 text-brand-600" />
            B2B Portal Access
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Issue secure links so wholesale customers can view invoices, ledger and statements, and
            place re-orders from their own portal.
          </p>
        </div>
        <button
          type="button"
          onClick={loadCustomers}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {!canManage && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <Lock className="w-4 h-4 shrink-0" />
          Your role can view customers but cannot issue or revoke portal links.
        </div>
      )}

      {isAllStores && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          You are in All-Stores view. Switch to a specific store to issue links for that store&apos;s
          customers.
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice("")}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs font-medium text-rose-800 dark:text-rose-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError("")}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="p-3 border-b border-slate-200 dark:border-slate-800">
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer by name, phone, GSTIN or email"
              className={`${INPUT_CLASS} pl-9`}
            />
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <tr>
              <th className="text-left px-3 py-2.5 font-semibold">Customer</th>
              <th className="text-left px-3 py-2.5 font-semibold">Phone</th>
              <th className="text-left px-3 py-2.5 font-semibold">GSTIN</th>
              <th className="text-center px-3 py-2.5 font-semibold">Status</th>
              <th className="text-right px-3 py-2.5 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  Loading customers…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  {customers.length === 0 ? "No customers found. Add customers under Master Data first." : "No customers match this search."}
                </td>
              </tr>
            ) : (
              filtered.map((customer) => (
                <tr key={customer.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-slate-900 dark:text-white">{customer.name}</div>
                    {customer.email && (
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">{customer.email}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">{customer.phone || "—"}</td>
                  <td className="px-3 py-2.5 text-xs font-mono text-slate-600 dark:text-slate-300">{customer.gstin || "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        customer.is_active
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {customer.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => openCustomer(customer)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      Portal link
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900 dark:text-white">{selected.name}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selected.phone || "No phone"}
                  {selected.gstin ? ` · GSTIN ${selected.gstin}` : ""}
                </p>
              </div>
              <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
              {statusLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Checking link status…
                </div>
              ) : status?.active ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    <ShieldCheck className="w-4 h-4" />
                    Active portal link
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300">
                    Expires {formatDate(status.expires_at)}
                    {status.last_used_at ? ` · last used ${formatDate(status.last_used_at)}` : " · never used yet"}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <ShieldOff className="w-4 h-4" />
                  No active portal link for this customer.
                </div>
              )}
            </div>

            {issued ? (
              <div className="mt-4 space-y-3">
                <div className="text-[11px] text-slate-600 dark:text-slate-300">
                  Share this link with {issued.party.name}. It grants access until{" "}
                  {formatDate(issued.expires_at)} and will not be shown again.
                </div>
                <div className="flex gap-2">
                  <input readOnly value={issued.portal_url} className={`${INPUT_CLASS} font-mono text-xs`} onFocus={(e) => e.target.select()} />
                  <button
                    type="button"
                    onClick={copyLink}
                    className="shrink-0 flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 px-3 py-2 text-xs font-semibold text-white"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <a
                  href={issued.portal_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open portal in new tab
                </a>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <div className="w-28">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Valid for
                  </label>
                  <select
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    className={INPUT_CLASS}
                  >
                    {DAY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option} days
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={generateLink}
                  disabled={!canManage || busy || !selected.is_active}
                  className="flex-1 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 px-3 py-2 text-sm font-semibold text-white"
                >
                  {busy ? "Working…" : status?.active ? "Regenerate link" : "Generate link"}
                </button>
                {status?.active && (
                  <button
                    type="button"
                    onClick={revokeLink}
                    disabled={!canManage || busy}
                    className="rounded-lg border border-rose-300 dark:border-rose-800 px-3 py-2 text-sm font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </div>
            )}

            {!selected.is_active && (
              <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-300">
                Reactivate this customer before issuing a portal link.
              </p>
            )}
            {issued && status?.active && (
              <button
                type="button"
                onClick={revokeLink}
                disabled={!canManage || busy}
                className="mt-4 rounded-lg border border-rose-300 dark:border-rose-800 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
              >
                Revoke this link
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalAccessPage;

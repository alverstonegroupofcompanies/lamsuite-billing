import React, { useCallback, useEffect, useState } from "react";
import * as QRCodeModule from "qrcode";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { formatDateTime } from "../utils/formatters";
import {
  Plus,
  QrCode,
  KeyRound,
  Lock,
  Unlock,
  Pencil,
  Trash2,
  RefreshCw,
  X,
  Cpu,
  Users2,
  Clock,
  AlertTriangle,
  ListChecks,
  ShieldCheck,
} from "lucide-react";

const QRCodeLib: any = (QRCodeModule as any).default || QRCodeModule;

export interface AdminCounter {
  id: number;
  store_id?: number;
  counter_code: string;
  counter_name: string;
  location_name: string | null;
  status: "unclaimed" | "active" | "locked" | "revoked";
  retired_at?: string | null;
  device_uuid: string | null;
  is_online?: boolean;
  last_seen_at: string | null;
  last_sync_at: string | null;
  last_salesperson_name?: string | null;
  idle_lock_minutes?: number | null;
  grace_hours?: number | null;
  is_remote?: boolean;
  is_hub?: boolean;
  is_digital_only?: boolean;
  unlock_pin_set?: boolean;
  // CNT-01: the activity the list carries with each counter.
  last_activity_at?: string | null;
  last_bill_at?: string | null;
  last_bill_number?: string | null;
  last_operator_name?: string | null;
  unsynced_items_count?: number;
  offline_since?: string | null;
  offline_periods?: Array<{ started_at: string; ended_at: string | null; minutes: number }>;
}

interface ActivationCodeReply {
  code: string;
  key_prefix?: string;
  expires_at?: string | null;
  qr_payload?: string;
  message?: string;
}

interface ActivationCodeRow {
  id: number;
  label: string | null;
  key_prefix: string;
  state: "open" | "consumed" | "expired" | "revoked";
  expires_at: string | null;
  consumed_at?: string | null;
}

const STATUS_LABEL: Record<AdminCounter["status"], string> = {
  unclaimed: "Unclaimed",
  active: "Active",
  locked: "Locked",
  revoked: "Revoked",
};

/**
 * APR-003..010: the actions a one-time PIN may settle. The list mirrors the
 * server's approvable actions; a key the server does not take is never shown.
 */
const APPROVABLE_ACTIONS: Array<{ key: string; label: string }> = [
  { key: "pos.discount", label: "Discount above the counter threshold" },
  { key: "pos.price_override", label: "Price change above the threshold" },
  { key: "invoice.edit", label: "Edit an issued invoice" },
  { key: "invoice.cancel", label: "Cancel an issued invoice" },
  { key: "return.create", label: "Sales return" },
  { key: "return.purchase", label: "Purchase return" },
  { key: "stock.adjust", label: "Stock adjustment" },
];

function counterStatus(c: AdminCounter): string {
  if (c.status === "revoked") return c.retired_at ? "Retired" : "Revoked";
  return STATUS_LABEL[c.status];
}

/** CNT-01: how long the counter has been dark, or that it is here now. */
function offlineSummary(counter: AdminCounter): string {
  if (counter.status === "revoked") return "—";
  if (counter.is_online) return "Online now";
  const open = counter.offline_periods?.find((p) => p.ended_at === null);
  if (open) return `Offline for ${open.minutes} min`;
  if (counter.offline_since) return `Offline since ${formatDateTime(counter.offline_since)}`;
  return "No presence yet";
}

/** CNT-01: the closed gaps the server reported over its lookback window. */
function offlineHistory(counter: AdminCounter): string | null {
  const closed = (counter.offline_periods ?? []).filter((p) => p.ended_at !== null);
  if (closed.length === 0) return null;
  const minutes = closed.reduce((total, p) => total + (Number(p.minutes) || 0), 0);
  return `${closed.length} offline period${closed.length === 1 ? "" : "s"} in 24 h · ${minutes} min`;
}

const statusTone: Record<string, string> = {
  Unclaimed: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  Active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  Locked: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  Revoked: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  Retired: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

/** The QR is drawn as paths so no scannable secret ever sits in the text. */
function activationQrSvg(text: string, size = 168): string {
  try {
    const qr = QRCodeLib.create(text, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    let paths = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.modules.get(r, c)) paths += `M${c},${r}h1v1h-1z `;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Activation QR code" viewBox="0 0 ${count} ${count}" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#ffffff"/><path fill="#0f172a" d="${paths}"/></svg>`;
  } catch {
    return "";
  }
}

const Dialog: React.FC<{
  label: string;
  children: React.ReactNode;
  onClose: () => void;
}> = ({ label, children, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
    <div
      role="dialog"
      aria-label={label}
      className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4"
    >
      {children}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-1.5"
        >
          <X className="w-3.5 h-3.5" />
          Close
        </button>
      </div>
    </div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block space-y-1">
    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
    {children}
  </label>
);

const inputClass =
  "w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white";

const emptyForm = {
  store_id: "",
  counter_name: "",
  counter_code: "",
  location_name: "",
  is_remote: false,
  is_hub: false,
  is_digital_only: false,
  idle_lock_minutes: 5,
  grace_hours: 24,
};

/**
 * The store numbers its own counters C01, C02, … — the same rule the server
 * applies when the panel sends no code. Returns null when this page cannot see
 * that store's numbering, so the admin is never shown a guess.
 */
const nextCounterCode = (rows: AdminCounter[], storeId: string): string | null => {
  if (!storeId) return null;
  const own = rows.filter((row) => String(row.store_id ?? "") === storeId);
  if (own.length === 0) return null;

  const taken = new Set(own.map((row) => String(row.counter_code || "").toUpperCase()));
  let highest = 0;
  for (const code of taken) {
    const match = /^C(\d+)$/.exec(code);
    if (match) highest = Math.max(highest, Number(match[1]));
  }

  let candidate = `C${String(highest + 1).padStart(2, "0")}`;
  while (taken.has(candidate)) {
    candidate = `C${String(Number(candidate.slice(1)) + 1).padStart(2, "0")}`;
  }
  return candidate;
};

/**
 * The counter credential domain, judged in the browser exactly as PinPolicy
 * judges it on the server: six digits, no run of one digit, no whole-length
 * run up or down. A PIN that fails here is never sent anywhere.
 */
const counterPinProblem = (pin: string): string | null => {
  if (!/^\d{6}$/.test(pin)) return "PIN must be 6 numeric digits.";
  if (/^(.)\1+$/.test(pin)) return "PIN cannot consist of repeated digits (e.g. 1111).";

  const digits = pin.split("").map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  if (ascending || descending) return "Trivial sequential PINs are not allowed for security reasons.";

  return null;
};

export const CountersPage: React.FC = () => {
  const { hasPermission, isAllStores, stores, activeStore, setActiveStore } = useAuth();
  const canEdit = hasPermission("devices", "edit");

  const [counters, setCounters] = useState<AdminCounter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [panel, setPanel] = useState<{ mode: "create" | "edit"; counter?: AdminCounter } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [isAutoCode, setIsAutoCode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [issued, setIssued] = useState<{ counter: AdminCounter; reply: ActivationCodeReply } | null>(null);
  const [codes, setCodes] = useState<{ counter: AdminCounter; rows: ActivationCodeRow[] } | null>(null);
  const [retire, setRetire] = useState<{ counter: AdminCounter; message: string } | null>(null);
  const [pinDialog, setPinDialog] = useState<AdminCounter | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  const [approvalDialog, setApprovalDialog] = useState<AdminCounter | null>(null);
  const [approvalForm, setApprovalForm] = useState<{ actions: string[]; minutes: number; reason: string }>({
    actions: ["pos.discount", "pos.price_override"],
    minutes: 10,
    reason: "",
  });
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalIssued, setApprovalIssued] = useState<{
    counter: AdminCounter;
    reply: { pin: string; message?: string };
  } | null>(null);

  const fetchCounters = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; counters: AdminCounter[] }>("/admin/counters");
      setCounters(res.counters || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load counters.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCounters();
    // The roster is live: a till that claims or syncs shows up without a reload.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchCounters();
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [fetchCounters]);

  const openCreate = () => {
    const storeId = activeStore ? String(activeStore.id) : "";
    const suggested = nextCounterCode(counters, storeId);
    setIsAutoCode(suggested !== null);
    setForm({ ...emptyForm, store_id: storeId, counter_code: suggested ?? "" });
    setPanel({ mode: "create" });
  };

  const pickStore = (storeId: string) => {
    if (isAutoCode || form.counter_code === "") {
      const suggested = nextCounterCode(counters, storeId);
      setIsAutoCode(suggested !== null);
      setForm({ ...form, store_id: storeId, counter_code: suggested ?? "" });
    } else {
      setForm({ ...form, store_id: storeId });
    }
  };

  const openEdit = (counter: AdminCounter) => {
    setIsAutoCode(false);
    setForm({
      store_id: String(counter.store_id ?? activeStore?.id ?? ""),
      counter_name: counter.counter_name,
      counter_code: counter.counter_code,
      location_name: counter.location_name || "",
      is_remote: Boolean(counter.is_remote),
      is_hub: Boolean(counter.is_hub),
      is_digital_only: Boolean(counter.is_digital_only),
      idle_lock_minutes: counter.idle_lock_minutes ?? 5,
      grace_hours: counter.grace_hours ?? 24,
    });
    setPanel({ mode: "edit", counter });
  };

  const submitPanel = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!panel) return;
    setIsSaving(true);
    try {
      if (panel.mode === "create") {
        // The counter is born in exactly one store, so the panel's scope moves
        // there first — the POST then carries that store as its X-Store-Id.
        const target = stores.find((s) => String(s.id) === form.store_id);
        if (!target) return;
        if (String(activeStore?.id) !== String(target.id)) setActiveStore(target);
        await api.post("/admin/counters", {
          counter_name: form.counter_name.trim(),
          counter_code: form.counter_code.trim(),
          location_name: form.location_name.trim(),
          is_remote: form.is_remote,
          is_hub: form.is_hub,
          is_digital_only: form.is_digital_only,
        });
      } else if (panel.counter) {
        await api.put(`/admin/counters/${panel.counter.id}`, {
          counter_name: form.counter_name.trim(),
          counter_code: form.counter_code.trim(),
          location_name: form.location_name.trim(),
          is_remote: form.is_remote,
          is_hub: form.is_hub,
          is_digital_only: form.is_digital_only,
          idle_lock_minutes: Number(form.idle_lock_minutes),
          grace_hours: Number(form.grace_hours),
        });
      }
      setPanel(null);
      await fetchCounters();
    } catch (err: any) {
      setError(err?.message || "The counter could not be saved.");
    } finally {
      setIsSaving(false);
    }
  };

  const runAction = async (counter: AdminCounter, path: string, verb: "post" | "delete" = "post") => {
    setError(null);
    try {
      await api[verb](path);
      await fetchCounters();
    } catch (err: any) {
      if (err?.status === 409 && err?.data?.error === "counter_has_documents") {
        setRetire({ counter, message: err.data.message });
        return;
      }
      setError(err?.message || `The ${counter.counter_name} action failed.`);
    }
  };

  const issueCode = async (counter: AdminCounter, path: string) => {
    setError(null);
    try {
      const reply = await api.post<ActivationCodeReply>(path);
      setIssued({ counter, reply });
      await fetchCounters();
    } catch (err: any) {
      setError(err?.message || "The activation code could not be issued.");
    }
  };

  const openCodes = async (counter: AdminCounter) => {
    setError(null);
    try {
      const res = await api.get<{ success: boolean; codes: ActivationCodeRow[] }>(
        `/admin/counters/${counter.id}/activation-codes`
      );
      setCodes({ counter, rows: res.codes || [] });
    } catch (err: any) {
      setError(err?.message || "The code history could not be read.");
    }
  };

  const revokeCode = async (row: ActivationCodeRow) => {
    if (!codes) return;
    setError(null);
    try {
      await api.post(`/admin/counters/${codes.counter.id}/activation-codes/${row.id}/revoke`, {
        reason: "Revoked by owner",
      });
      const res = await api.get<{ success: boolean; codes: ActivationCodeRow[] }>(
        `/admin/counters/${codes.counter.id}/activation-codes`
      );
      setCodes({ counter: codes.counter, rows: res.codes || [] });
    } catch (err: any) {
      setError(err?.message || "The activation code could not be revoked.");
    }
  };

  const confirmRetire = async () => {
    if (!retire) return;
    const counter = retire.counter;
    setRetire(null);
    setError(null);
    try {
      await api.delete(`/admin/counters/${counter.id}`, { confirm_retire: true, reason: "Retired by owner" });
      await fetchCounters();
    } catch (err: any) {
      setError(err?.message || "The counter could not be retired.");
    }
  };

  const openApprovalDialog = (counter: AdminCounter) => {
    setApprovalForm({ actions: ["pos.discount", "pos.price_override"], minutes: 10, reason: "" });
    setApprovalError(null);
    setApprovalDialog(counter);
  };

  const toggleApprovalAction = (key: string) => {
    setApprovalForm((prev) => ({
      ...prev,
      actions: prev.actions.includes(key)
        ? prev.actions.filter((a) => a !== key)
        : [...prev.actions, key],
    }));
  };

  const issueApprovalPin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!approvalDialog) return;
    if (approvalForm.actions.length === 0) {
      setApprovalError("Choose at least one action this PIN may approve.");
      return;
    }
    setIsSaving(true);
    setApprovalError(null);
    try {
      const reply = await api.post<{ success: boolean; pin: string; message?: string }>(
        "/admin/approvals/one-time-pins",
        {
          counter_id: approvalDialog.id,
          actions: approvalForm.actions,
          minutes: Number(approvalForm.minutes),
          reason: approvalForm.reason.trim() || undefined,
        }
      );
      setApprovalIssued({ counter: approvalDialog, reply });
      setApprovalDialog(null);
    } catch (err: any) {
      // The grant endpoint reports its refusals in `error`; validation errors
      // arrive in `message`.
      setApprovalError(err?.data?.error || err?.message || "The approval PIN could not be issued.");
    } finally {
      setIsSaving(false);
    }
  };

  const openPinDialog = (counter: AdminCounter) => {
    setPinValue("");
    setPinError(null);
    setPinDialog(counter);
  };

  const submitPin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pinDialog) return;
    setIsSaving(true);
    setPinError(null);
    try {
      await api.post(`/admin/counters/${pinDialog.id}/unlock-pin/reset`, { pin: pinValue });
      setPinDialog(null);
      setPinValue("");
      await fetchCounters();
    } catch (err: any) {
      setPinError(err?.message || "The unlock PIN could not be set.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <ListChecks className="w-6 h-6 text-emerald-600" />
            <span>Counters</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The counter master: create it, name it, issue its activation code and watch what it is doing.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={openCreate}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            New counter
          </button>
        )}
      </div>

      {isAllStores && (
        <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
          Select one store to create or change its counters.
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading counters...
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {counters.map((counter) => (
            <div
              key={counter.id}
              role="group"
              aria-label={counter.counter_name}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-slate-900 dark:text-white">{counter.counter_name}</p>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400">{counter.counter_code}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{counter.location_name || "—"}</p>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${statusTone[counterStatus(counter)]}`}
                >
                  {counterStatus(counter)}
                </span>
              </div>

              <dl className="text-[11px] space-y-1 text-slate-600 dark:text-slate-300">
                <div className="flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-slate-400" />
                  {counter.device_uuid ? (
                    <span className="font-mono">{counter.device_uuid}</span>
                  ) : (
                    <span>No workstation yet</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Last activity</span>
                  <span className="font-mono">{formatDateTime(counter.last_activity_at || counter.last_seen_at)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                  <span>Last bill</span>
                  <span className="font-mono">{counter.last_bill_at ? formatDateTime(counter.last_bill_at) : "No bill yet"}</span>
                  {counter.last_bill_number ? <span className="font-mono text-slate-400">({counter.last_bill_number})</span> : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <Users2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>Last salesperson</span>
                  <span>{counter.last_salesperson_name || "None yet"}</span>
                  {counter.last_operator_name ? (
                    <span className="text-slate-400">· signed in: {counter.last_operator_name}</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                  <span>Unsynced items: {counter.unsynced_items_count ?? 0}</span>
                  {counter.is_online ? <span className="text-emerald-600 font-bold">· online</span> : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-slate-400" />
                  <span>{offlineSummary(counter)}</span>
                  {offlineHistory(counter) ? <span className="text-slate-400">· {offlineHistory(counter)}</span> : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                  <span>{counter.unlock_pin_set ? "Unlock PIN set" : "No unlock PIN"}</span>
                </div>
              </dl>

              {canEdit && !isAllStores && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {counter.status === "unclaimed" && (
                    <button
                      type="button"
                      onClick={() => issueCode(counter, `/admin/counters/${counter.id}/activation-code`)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-600 text-white flex items-center gap-1"
                    >
                      <KeyRound className="w-3 h-3" />
                      Generate code
                    </button>
                  )}
                  {counter.status !== "unclaimed" && counter.status !== "revoked" && (
                    <button
                      type="button"
                      onClick={() => issueCode(counter, `/admin/counters/${counter.id}/reissue`)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-600 text-white flex items-center gap-1"
                    >
                      <KeyRound className="w-3 h-3" />
                      Re-issue code
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openCodes(counter)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-1"
                  >
                    <QrCode className="w-3 h-3" />
                    Codes
                  </button>
                  {counter.status !== "revoked" && (
                    <>
                      {counter.status === "locked" ? (
                        <button
                          type="button"
                          onClick={() => runAction(counter, `/admin/counters/${counter.id}/unlock`)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 flex items-center gap-1"
                        >
                          <Unlock className="w-3 h-3" />
                          Unlock
                        </button>
                      ) : counter.status === "active" ? (
                        <button
                          type="button"
                          onClick={() => runAction(counter, `/admin/counters/${counter.id}/lock`)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 flex items-center gap-1"
                        >
                          <Lock className="w-3 h-3" />
                          Lock
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => openPinDialog(counter)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-1"
                      >
                        <ShieldCheck className="w-3 h-3" />
                        {counter.unlock_pin_set ? "Reset unlock PIN" : "Set unlock PIN"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openApprovalDialog(counter)}
                        title="Issue a one-time PIN that authorises one save above the counter's threshold"
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 flex items-center gap-1"
                      >
                        <KeyRound className="w-3 h-3" />
                        Approval PIN
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(counter)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-1"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction(counter, `/admin/counters/${counter.id}`, "delete")}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {panel && (
        <Dialog label={panel.mode === "create" ? "New counter" : `Edit ${panel.counter?.counter_name}`} onClose={() => setPanel(null)}>
          <form onSubmit={submitPanel} className="space-y-3">
            <Field label="Store">
              <select
                className={inputClass}
                value={form.store_id}
                onChange={(e) => (panel.mode === "create" ? pickStore(e.target.value) : setForm({ ...form, store_id: e.target.value }))}
                disabled={panel.mode === "edit"}
                required={panel.mode === "create"}
              >
                <option value="">Select a store</option>
                {stores.map((store) => (
                  <option key={store.id} value={String(store.id)}>
                    {store.name} ({store.code})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Counter name">
              <input
                className={inputClass}
                value={form.counter_name}
                onChange={(e) => setForm({ ...form, counter_name: e.target.value })}
                required
              />
            </Field>
            <Field label="Counter code">
              <input
                className={inputClass}
                value={form.counter_code}
                maxLength={20}
                required={panel.mode === "edit"}
                onChange={(e) => {
                  setIsAutoCode(false);
                  setForm({ ...form, counter_code: e.target.value });
                }}
              />
              {panel.mode === "create" &&
                (isAutoCode ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Next free code in {stores.find((s) => String(s.id) === form.store_id)?.name || "this store"}.
                  </p>
                ) : form.counter_code === "" ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Leave blank and the store numbers it automatically.
                  </p>
                ) : null)}
            </Field>
            <Field label="Location within the store">
              <input
                className={inputClass}
                placeholder="e.g. Main Shop, Warehouse"
                value={form.location_name}
                onChange={(e) => setForm({ ...form, location_name: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                name="is_remote"
                role="checkbox"
                checked={form.is_remote}
                onChange={(e) => setForm({ ...form, is_remote: e.target.checked })}
              />
              Remote counter
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                name="is_hub"
                role="checkbox"
                checked={form.is_hub}
                onChange={(e) => setForm({ ...form, is_hub: e.target.checked })}
              />
              Hub counter
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                name="is_digital_only"
                role="checkbox"
                checked={form.is_digital_only}
                onChange={(e) => setForm({ ...form, is_digital_only: e.target.checked })}
              />
              Digital-only counter
            </label>
            {panel.mode === "edit" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Idle lock minutes">
                  <input
                    type="number"
                    min={0}
                    max={240}
                    className={inputClass}
                    value={form.idle_lock_minutes}
                    onChange={(e) => setForm({ ...form, idle_lock_minutes: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Offline grace hours">
                  <input
                    type="number"
                    min={0}
                    max={720}
                    className={inputClass}
                    value={form.grace_hours}
                    onChange={(e) => setForm({ ...form, grace_hours: Number(e.target.value) })}
                  />
                </Field>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPanel(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || (panel.mode === "create" && !form.store_id)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white disabled:opacity-60"
              >
                {panel.mode === "create" ? "Create counter" : "Save changes"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {pinDialog && (
        <Dialog
          label={`Unlock PIN for ${pinDialog.counter_name}`}
          onClose={() => {
            setPinDialog(null);
            setPinValue("");
          }}
        >
          <form onSubmit={submitPin} className="space-y-3">
            <Field label="New unlock PIN">
              <input
                className={inputClass}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
                autoFocus
              />
            </Field>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Six digits. Five wrong attempts locks the counter for 15 minutes and it stays locked until this PIN is
              reset here.
            </p>
            {pinValue !== "" && counterPinProblem(pinValue) && (
              <p className="text-[11px] font-bold text-rose-700 dark:text-rose-300">{counterPinProblem(pinValue)}</p>
            )}
            {pinError && (
              <p role="alert" className="text-xs font-bold text-rose-700 dark:text-rose-300">
                {pinError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPinDialog(null);
                  setPinValue("");
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || pinValue === "" || counterPinProblem(pinValue) !== null}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white disabled:opacity-60"
              >
                {pinDialog.unlock_pin_set ? "Reset unlock PIN" : "Set unlock PIN"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {approvalIssued && (
        <Dialog
          label={`One-time approval PIN for ${approvalIssued.counter.counter_name}`}
          onClose={() => setApprovalIssued(null)}
        >
          <div className="space-y-3">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {approvalIssued.reply.message || "Show this PIN once. It cannot be retrieved again."}
            </p>
            <code className="block text-center font-mono text-3xl font-black tracking-[0.3em] bg-slate-100 dark:bg-slate-800 rounded-lg p-4 text-slate-900 dark:text-white">
              {approvalIssued.reply.pin}
            </code>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Enter it at {approvalIssued.counter.counter_name} when the bill asks for approval. It settles one
              save and expires on its own.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setApprovalIssued(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white"
              >
                Done — hide this PIN
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {approvalDialog && (
        <Dialog
          label={`Issue an approval PIN for ${approvalDialog.counter_name}`}
          onClose={() => setApprovalDialog(null)}
        >
          <form onSubmit={issueApprovalPin} className="space-y-3">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              The PIN lets {approvalDialog.counter_name} save one bill that crosses its threshold for the actions
              below. It is shown once and expires automatically.
            </p>

            <fieldset className="space-y-1.5">
              <legend className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                What this PIN may approve
              </legend>
              {APPROVABLE_ACTIONS.map((action) => (
                <label
                  key={action.key}
                  className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200"
                >
                  <input
                    type="checkbox"
                    checked={approvalForm.actions.includes(action.key)}
                    onChange={() => toggleApprovalAction(action.key)}
                  />
                  <span>{action.label}</span>
                </label>
              ))}
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Valid for (minutes)">
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  max={60}
                  value={approvalForm.minutes}
                  onChange={(e) =>
                    setApprovalForm({ ...approvalForm, minutes: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Reason (optional)">
                <input
                  className={inputClass}
                  value={approvalForm.reason}
                  maxLength={1000}
                  placeholder="e.g. Regular customer bulk order"
                  onChange={(e) => setApprovalForm({ ...approvalForm, reason: e.target.value })}
                />
              </Field>
            </div>

            {approvalError && (
              <p role="alert" className="text-xs font-bold text-rose-700 dark:text-rose-300">
                {approvalError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setApprovalDialog(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || approvalForm.actions.length === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white disabled:opacity-60"
              >
                Issue PIN
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {issued && (
        <Dialog label={`Activation code for ${issued.counter.counter_name}`} onClose={() => setIssued(null)}>
          <div className="space-y-3">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {issued.reply.message || "Show or send this code once. It cannot be retrieved again."}
            </p>
            <code className="block break-all font-mono text-sm bg-slate-100 dark:bg-slate-800 rounded-lg p-3 text-slate-900 dark:text-white">
              {issued.reply.code}
            </code>
            {issued.reply.qr_payload && (
              <div
                className="flex justify-center"
                aria-label="Activation QR code"
                dangerouslySetInnerHTML={{ __html: activationQrSvg(issued.reply.qr_payload) }}
              />
            )}
            {issued.reply.expires_at && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Expires {formatDateTime(issued.reply.expires_at)}
              </p>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIssued(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white"
              >
                Done — hide this code
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {codes && (
        <Dialog label={`Activation codes for ${codes.counter.counter_name}`} onClose={() => setCodes(null)}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className="py-1">Code</th>
                <th className="py-1">State</th>
                <th className="py-1">Expires</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {codes.rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 font-mono">{row.key_prefix}</td>
                  <td className="py-1.5">{row.state}</td>
                  <td className="py-1.5 font-mono">{formatDateTime(row.expires_at)}</td>
                  <td className="py-1.5 text-right">
                    {row.state === "open" && canEdit ? (
                      <button
                        type="button"
                        onClick={() => revokeCode(row)}
                        className="px-2 py-1 rounded-lg text-[11px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300"
                      >
                        Revoke code
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {codes.rows.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">No code has been issued for this counter yet.</p>
          )}
        </Dialog>
      )}

      {retire && (
        <Dialog label={`Retire ${retire.counter.counter_name}?`} onClose={() => setRetire(null)}>
          <p className="text-sm text-slate-700 dark:text-slate-200">{retire.message}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRetire(null)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={confirmRetire}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 text-white"
            >
              Retire counter
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
};

export default CountersPage;

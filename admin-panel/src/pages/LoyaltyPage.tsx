import React, { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { formatINR, formatDate, formatDateTime } from "../utils/formatters";
import {
  Gift,
  Ticket,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  X,
  CheckCircle2,
  Power,
  Search,
  SlidersHorizontal,
} from "lucide-react";

interface ProgramRow {
  id: number;
  store_id: number;
  is_active: boolean;
  earn_points_per_100: number;
  redeem_value_per_point: number;
  min_redeem_points: number;
  expiry_days: number | null;
}

interface ProgramStats {
  members: number;
  points_outstanding: number;
  redemptions_value: number;
}

interface CouponRow {
  id: number;
  code: string;
  description?: string | null;
  discount_type: "percent" | "amount";
  value: number;
  min_bill_amount: number;
  max_discount: number | null;
  valid_from: string | null;
  valid_to: string | null;
  usage_limit: number | null;
  used_count: number;
  is_active: boolean;
  is_valid_now: boolean;
}

interface LedgerEntry {
  id: number;
  customer_id: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  invoice_id: number | null;
  type: string;
  points_delta: number;
  balance_after: number;
  note?: string | null;
  created_at?: string | null;
}

interface CustomerOption {
  id: number;
  name: string;
  phone?: string | null;
}

const INPUT_CLASS =
  "w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500";

const TYPE_STYLES: Record<string, string> = {
  earn: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  redeem: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  adjust: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  reversal: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
};

const emptyCouponForm = {
  code: "",
  description: "",
  discount_type: "percent" as "percent" | "amount",
  value: "10",
  min_bill_amount: "0",
  max_discount: "",
  valid_from: "",
  valid_to: "",
  usage_limit: "",
  is_active: true,
};

export const LoyaltyPage: React.FC = () => {
  const { hasPermission, isAllStores } = useAuth();
  const canEdit = hasPermission("loyalty", "edit") && !isAllStores;

  const [tab, setTab] = useState<"coupons" | "ledger">("coupons");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [program, setProgram] = useState<ProgramRow | null>(null);
  const [stats, setStats] = useState<ProgramStats>({ members: 0, points_outstanding: 0, redemptions_value: 0 });
  const [programForm, setProgramForm] = useState({
    is_active: false,
    earn_points_per_100: "1",
    redeem_value_per_point: "0.25",
    min_redeem_points: "100",
    expiry_days: "",
  });
  const [programSaving, setProgramSaving] = useState(false);

  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [couponSearch, setCouponSearch] = useState("");
  const [couponFormOpen, setCouponFormOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<CouponRow | null>(null);
  const [couponForm, setCouponForm] = useState({ ...emptyCouponForm });
  const [couponSaving, setCouponSaving] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);

  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ customer_id: "", points_delta: "", note: "" });
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const loadProgram = async () => {
    const res = await api.get<{ program: ProgramRow; stats: ProgramStats }>("/admin/loyalty/program");
    setProgram(res.program);
    setStats(res.stats || { members: 0, points_outstanding: 0, redemptions_value: 0 });
    setProgramForm({
      is_active: res.program.is_active,
      earn_points_per_100: String(res.program.earn_points_per_100),
      redeem_value_per_point: String(res.program.redeem_value_per_point),
      min_redeem_points: String(res.program.min_redeem_points),
      expiry_days: res.program.expiry_days != null ? String(res.program.expiry_days) : "",
    });
  };

  const loadCoupons = async () => {
    const res = await api.get<{ coupons: CouponRow[] }>("/admin/loyalty/coupons");
    setCoupons(res.coupons || []);
  };

  const loadLedger = async (search = ledgerSearch) => {
    const res = await api.get<{ entries: LedgerEntry[] }>("/admin/loyalty/ledger", {
      search: search.trim() || undefined,
      per_page: 200,
    });
    setEntries(res.entries || []);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadProgram(), loadCoupons(), loadLedger()]);
    } catch (err) {
      setError((err as Error).message || "Failed to load loyalty data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (tab !== "ledger") return;
    const timer = setTimeout(() => {
      loadLedger(ledgerSearch).catch((err) => setError((err as Error).message || "Could not load ledger"));
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerSearch, tab]);

  useEffect(() => {
    if (!adjustOpen || customers.length > 0) return;
    api
      .get<{ data: CustomerOption[] }>("/admin/parties", { type: "customer", per_page: 500 })
      .then((res) => setCustomers(res.data || []))
      .catch(() => setCustomers([]));
  }, [adjustOpen, customers.length]);

  const filteredCoupons = useMemo(() => {
    const term = couponSearch.trim().toLowerCase();
    if (!term) return coupons;
    return coupons.filter(
      (c) => c.code.toLowerCase().includes(term) || (c.description || "").toLowerCase().includes(term)
    );
  }, [coupons, couponSearch]);

  const activeCoupons = coupons.filter((c) => c.is_valid_now).length;

  const saveProgram = async () => {
    setProgramSaving(true);
    setError(null);
    try {
      await api.put("/admin/loyalty/program", {
        is_active: programForm.is_active,
        earn_points_per_100: Number(programForm.earn_points_per_100) || 0,
        redeem_value_per_point: Number(programForm.redeem_value_per_point) || 0,
        min_redeem_points: Math.max(0, Number(programForm.min_redeem_points) || 0),
        expiry_days: programForm.expiry_days ? Number(programForm.expiry_days) : null,
      });
      await loadProgram();
      setNotice("Loyalty program settings saved.");
    } catch (err) {
      setError((err as Error).message || "Could not save loyalty program");
    } finally {
      setProgramSaving(false);
    }
  };

  const openCouponCreate = () => {
    setEditingCoupon(null);
    setCouponForm({ ...emptyCouponForm });
    setCouponError(null);
    setCouponFormOpen(true);
  };

  const openCouponEdit = (coupon: CouponRow) => {
    setEditingCoupon(coupon);
    setCouponForm({
      code: coupon.code,
      description: coupon.description || "",
      discount_type: coupon.discount_type,
      value: String(coupon.value),
      min_bill_amount: String(coupon.min_bill_amount ?? 0),
      max_discount: coupon.max_discount != null ? String(coupon.max_discount) : "",
      valid_from: coupon.valid_from || "",
      valid_to: coupon.valid_to || "",
      usage_limit: coupon.usage_limit != null ? String(coupon.usage_limit) : "",
      is_active: coupon.is_active,
    });
    setCouponError(null);
    setCouponFormOpen(true);
  };

  const saveCoupon = async () => {
    if (!couponForm.code.trim()) {
      setCouponError("Coupon code is required.");
      return;
    }
    setCouponSaving(true);
    setCouponError(null);
    try {
      const payload = {
        code: couponForm.code.trim().toUpperCase(),
        description: couponForm.description.trim() || null,
        discount_type: couponForm.discount_type,
        value: Number(couponForm.value) || 0,
        min_bill_amount: Number(couponForm.min_bill_amount) || 0,
        max_discount: couponForm.max_discount ? Number(couponForm.max_discount) : null,
        valid_from: couponForm.valid_from || null,
        valid_to: couponForm.valid_to || null,
        usage_limit: couponForm.usage_limit ? Number(couponForm.usage_limit) : null,
        is_active: couponForm.is_active,
      };
      if (editingCoupon) {
        await api.put(`/admin/loyalty/coupons/${editingCoupon.id}`, payload);
        setNotice(`Coupon "${payload.code}" updated.`);
      } else {
        await api.post("/admin/loyalty/coupons", payload);
        setNotice(`Coupon "${payload.code}" created.`);
      }
      setCouponFormOpen(false);
      await loadCoupons();
    } catch (err) {
      setCouponError((err as Error).message || "Could not save coupon");
    } finally {
      setCouponSaving(false);
    }
  };

  const toggleCoupon = async (coupon: CouponRow) => {
    try {
      await api.put(`/admin/loyalty/coupons/${coupon.id}`, { is_active: !coupon.is_active });
      await loadCoupons();
      setNotice(`"${coupon.code}" ${coupon.is_active ? "deactivated" : "activated"}.`);
    } catch (err) {
      setError((err as Error).message || "Could not update coupon");
    }
  };

  const removeCoupon = async (coupon: CouponRow) => {
    if (!window.confirm(`Delete coupon "${coupon.code}"? Past redemptions stay in reports.`)) return;
    try {
      await api.delete(`/admin/loyalty/coupons/${coupon.id}`);
      await loadCoupons();
      setNotice(`Coupon "${coupon.code}" deleted.`);
    } catch (err) {
      setError((err as Error).message || "Could not delete coupon");
    }
  };

  const openAdjust = () => {
    setAdjustForm({ customer_id: "", points_delta: "", note: "" });
    setAdjustError(null);
    setAdjustOpen(true);
  };

  const saveAdjust = async () => {
    if (!adjustForm.customer_id) {
      setAdjustError("Select a customer.");
      return;
    }
    if (!adjustForm.points_delta || Number(adjustForm.points_delta) === 0) {
      setAdjustError("Enter a non-zero points value.");
      return;
    }
    setAdjustSaving(true);
    setAdjustError(null);
    try {
      const res = await api.post<{ balance: number }>("/admin/loyalty/points/adjust", {
        customer_id: Number(adjustForm.customer_id),
        points_delta: Number(adjustForm.points_delta),
        note: adjustForm.note.trim() || null,
      });
      setAdjustOpen(false);
      setNotice(`Points adjusted. New balance: ${res.balance}.`);
      await Promise.all([loadProgram(), loadLedger()]);
    } catch (err) {
      setAdjustError((err as Error).message || "Could not adjust points");
    } finally {
      setAdjustSaving(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Gift className="w-5 h-5 text-brand-500" />
            Loyalty & Coupons
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Points earn/redeem rules and checkout coupons applied at the POS counter.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {tab === "coupons" ? (
            <button
              type="button"
              onClick={openCouponCreate}
              disabled={!canEdit}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white"
            >
              <Plus className="w-4 h-4" />
              New Coupon
            </button>
          ) : (
            <button
              type="button"
              onClick={openAdjust}
              disabled={!canEdit}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white"
            >
              <SlidersHorizontal className="w-4 h-4" />
              Adjust Points
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4" />
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs font-medium text-rose-800 dark:text-rose-300">
          {error}
        </div>
      )}
      {isAllStores && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          Switch to a specific store to manage its loyalty program and coupons.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Program", value: program?.is_active ? "Active" : "Off" },
          { label: "Loyalty members", value: stats.members },
          { label: "Points outstanding", value: Number(stats.points_outstanding || 0).toFixed(2) },
          { label: "Coupon discounts given", value: formatINR(stats.redemptions_value) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{s.label}</div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Program configuration */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Gift className="w-4 h-4 text-brand-500" />
            Points program
          </h2>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={programForm.is_active}
              disabled={!canEdit}
              onChange={(e) => setProgramForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Program enabled
          </label>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
            Points earned per ₹100
            <input
              type="number"
              min="0"
              step="0.5"
              value={programForm.earn_points_per_100}
              disabled={!canEdit}
              onChange={(e) => setProgramForm((f) => ({ ...f, earn_points_per_100: e.target.value }))}
              className={INPUT_CLASS}
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
            ₹ value per point
            <input
              type="number"
              min="0"
              step="0.05"
              value={programForm.redeem_value_per_point}
              disabled={!canEdit}
              onChange={(e) => setProgramForm((f) => ({ ...f, redeem_value_per_point: e.target.value }))}
              className={INPUT_CLASS}
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
            Minimum redeem points
            <input
              type="number"
              min="0"
              value={programForm.min_redeem_points}
              disabled={!canEdit}
              onChange={(e) => setProgramForm((f) => ({ ...f, min_redeem_points: e.target.value }))}
              className={INPUT_CLASS}
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
            Expiry (days, optional)
            <input
              type="number"
              min="1"
              value={programForm.expiry_days}
              disabled={!canEdit}
              placeholder="No expiry"
              onChange={(e) => setProgramForm((f) => ({ ...f, expiry_days: e.target.value }))}
              className={INPUT_CLASS}
            />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={saveProgram}
            disabled={!canEdit || programSaving}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white"
          >
            {programSaving ? "Saving…" : "Save Program"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700">
        {[
          { id: "coupons" as const, label: `Coupons (${coupons.length})`, icon: Ticket },
          { id: "ledger" as const, label: `Points Ledger (${entries.length})`, icon: Gift },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border-b-2 -mb-px ${
              tab === t.id
                ? "border-brand-600 text-brand-700 dark:text-brand-400"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "coupons" ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                value={couponSearch}
                onChange={(e) => setCouponSearch(e.target.value)}
                placeholder="Search code or description"
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400"
              />
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {activeCoupons} redeemable now · {coupons.length - activeCoupons} inactive/expired
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Coupon</th>
                <th className="text-left px-4 py-3 font-semibold">Discount</th>
                <th className="text-right px-4 py-3 font-semibold">Min bill</th>
                <th className="text-left px-4 py-3 font-semibold">Validity</th>
                <th className="text-right px-4 py-3 font-semibold">Usage</th>
                <th className="text-center px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    Loading coupons…
                  </td>
                </tr>
              ) : filteredCoupons.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    No coupons yet. Create one to run checkout promotions.
                  </td>
                </tr>
              ) : (
                filteredCoupons.map((coupon) => (
                  <tr key={coupon.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-mono font-bold text-slate-900 dark:text-white">{coupon.code}</div>
                      {coupon.description && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">{coupon.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300">
                      {coupon.discount_type === "percent" ? `${coupon.value}%` : formatINR(coupon.value)}
                      {coupon.discount_type === "percent" && coupon.max_discount != null && (
                        <span className="text-slate-400"> · max {formatINR(coupon.max_discount)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{formatINR(coupon.min_bill_amount)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      {coupon.valid_from || coupon.valid_to
                        ? `${coupon.valid_from ? formatDate(coupon.valid_from) : "—"} → ${coupon.valid_to ? formatDate(coupon.valid_to) : "—"}`
                        : "Always on"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {coupon.used_count}
                      {coupon.usage_limit != null ? ` / ${coupon.usage_limit}` : ""}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          coupon.is_valid_now
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {coupon.is_valid_now ? "Live" : coupon.is_active ? "Inactive" : "Off"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openCouponEdit(coupon)}
                          disabled={!canEdit}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                          title="Edit coupon"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleCoupon(coupon)}
                          disabled={!canEdit}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                          title={coupon.is_active ? "Deactivate" : "Activate"}
                        >
                          <Power className={`w-3.5 h-3.5 ${coupon.is_active ? "text-emerald-600" : "text-slate-400"}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeCoupon(coupon)}
                          disabled={!canEdit}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 disabled:opacity-50"
                          title="Delete coupon"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
                placeholder="Search customer name or phone"
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400"
              />
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Latest 200 movements</div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">When</th>
                <th className="text-left px-4 py-3 font-semibold">Customer</th>
                <th className="text-center px-4 py-3 font-semibold">Type</th>
                <th className="text-right px-4 py-3 font-semibold">Points</th>
                <th className="text-right px-4 py-3 font-semibold">Balance</th>
                <th className="text-left px-4 py-3 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    {ledgerSearch ? "No movements match this search." : "No points activity yet."}
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      {formatDateTime(entry.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{entry.customer_name || "—"}</div>
                      {entry.customer_phone && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">{entry.customer_phone}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          TYPE_STYLES[entry.type] || TYPE_STYLES.adjust
                        }`}
                      >
                        {entry.type}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono text-xs font-semibold ${
                        entry.points_delta >= 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {entry.points_delta >= 0 ? "+" : ""}
                      {Number(entry.points_delta).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {Number(entry.balance_after).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                      {entry.note || (entry.invoice_id ? `Invoice #${entry.invoice_id}` : "—")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Coupon form modal */}
      {couponFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700">
              <h2 className="font-semibold text-slate-900 dark:text-white">
                {editingCoupon ? `Edit coupon ${editingCoupon.code}` : "New coupon"}
              </h2>
              <button onClick={() => setCouponFormOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {couponError && <div className="text-xs text-rose-600">{couponError}</div>}
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                  Code
                  <input
                    value={couponForm.code}
                    onChange={(e) => setCouponForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="SAVE10"
                    className={`${INPUT_CLASS} font-mono`}
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                  Type
                  <select
                    value={couponForm.discount_type}
                    onChange={(e) =>
                      setCouponForm((f) => ({ ...f, discount_type: e.target.value as "percent" | "amount" }))
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="percent">Percent off</option>
                    <option value="amount">Flat amount off</option>
                  </select>
                </label>
              </div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Description
                <input
                  value={couponForm.description}
                  onChange={(e) => setCouponForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Festive offer"
                  className={INPUT_CLASS}
                />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                  {couponForm.discount_type === "percent" ? "Percent" : "Amount (₹)"}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={couponForm.value}
                    onChange={(e) => setCouponForm((f) => ({ ...f, value: e.target.value }))}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                  Min bill (₹)
                  <input
                    type="number"
                    min="0"
                    value={couponForm.min_bill_amount}
                    onChange={(e) => setCouponForm((f) => ({ ...f, min_bill_amount: e.target.value }))}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                  Max discount (₹)
                  <input
                    type="number"
                    min="0"
                    value={couponForm.max_discount}
                    placeholder="No cap"
                    onChange={(e) => setCouponForm((f) => ({ ...f, max_discount: e.target.value }))}
                    className={INPUT_CLASS}
                  />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                  Valid from
                  <input
                    type="date"
                    value={couponForm.valid_from}
                    onChange={(e) => setCouponForm((f) => ({ ...f, valid_from: e.target.value }))}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                  Valid to
                  <input
                    type="date"
                    value={couponForm.valid_to}
                    onChange={(e) => setCouponForm((f) => ({ ...f, valid_to: e.target.value }))}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                  Usage limit
                  <input
                    type="number"
                    min="1"
                    value={couponForm.usage_limit}
                    placeholder="Unlimited"
                    onChange={(e) => setCouponForm((f) => ({ ...f, usage_limit: e.target.value }))}
                    className={INPUT_CLASS}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={couponForm.is_active}
                  onChange={(e) => setCouponForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Active and redeemable at checkout
              </label>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setCouponFormOpen(false)}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveCoupon}
                disabled={couponSaving}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white"
              >
                {couponSaving ? "Saving…" : editingCoupon ? "Save Changes" : "Create Coupon"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual points adjustment modal */}
      {adjustOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700">
              <h2 className="font-semibold text-slate-900 dark:text-white">Adjust points</h2>
              <button onClick={() => setAdjustOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {adjustError && <div className="text-xs text-rose-600">{adjustError}</div>}
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Customer
                <select
                  value={adjustForm.customer_id}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, customer_id: e.target.value }))}
                  className={INPUT_CLASS}
                >
                  <option value="">Select customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.phone ? ` · ${c.phone}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Points (+ credit / − debit)
                <input
                  type="number"
                  step="0.5"
                  value={adjustForm.points_delta}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, points_delta: e.target.value }))}
                  placeholder="e.g. 100 or -50"
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Note
                <input
                  value={adjustForm.note}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Reason for adjustment"
                  className={INPUT_CLASS}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setAdjustOpen(false)}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAdjust}
                disabled={adjustSaving}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white"
              >
                {adjustSaving ? "Applying…" : "Apply Adjustment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

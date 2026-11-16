import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Building2,
  CheckCircle2,
  FileText,
  LogOut,
  Minus,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShoppingCart,
  X,
} from "lucide-react";
import { API_BASE, ApiError } from "../services/api";

interface PortalParty {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  credit_limit: number;
}

interface PortalStore {
  id: number;
  name: string;
  gstin: string | null;
  phone: string | null;
  address: string | null;
}

interface PortalMe {
  party: PortalParty;
  store: PortalStore;
  summary: {
    outstanding_balance: number;
    open_orders: number;
    loyalty_points: number;
    invoice_count: number;
  };
}

interface InvoiceRow {
  id: number;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;
  document: string;
  grand_total: number;
  paid_amount: number;
  balance: number;
  status: string;
  payment_status: string | null;
  items_count: number;
}

interface InvoiceDetail extends InvoiceRow {
  customer_name: string;
  customer_gstin: string | null;
  place_of_supply: string | null;
  subtotal: number;
  discount_total: number;
  taxable_subtotal: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  cess_total: number;
  tax_total: number;
  round_off: number;
  store: { name: string; gstin: string | null; address: string | null; phone: string | null } | null;
  items: Array<{
    id: number;
    product_name: string;
    batch_no: string | null;
    qty: number;
    loose_qty: number;
    units_per_pack: number;
    unit_price: number;
    discount_amount: number;
    taxable_amount: number;
    gst_percent: number;
    tax_amount: number;
    total_amount: number;
  }>;
}

interface StatementRow {
  date: string | null;
  document: string;
  number: string;
  due_date: string | null;
  total: number;
  paid: number;
  balance_delta: number;
  running_balance: number;
}

interface StatementResponse {
  period: { from: string; to: string };
  opening_balance: number;
  closing_balance: number;
  rows: StatementRow[];
}

interface CatalogProduct {
  id: number;
  name: string;
  barcode: string | null;
  hsn_code: string | null;
  gst_percent: number;
  units_per_pack: number;
  mrp: number;
  sel_rate: number;
  rate: number;
  discount_percent: number;
  min_qty: number;
  current_stock: number;
}

interface OrderRow {
  id: number;
  order_number: string;
  order_date: string | null;
  expected_delivery_date: string | null;
  status: string;
  grand_total: number;
  items_count: number;
  notes: string | null;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500";

const formatINR = (value: number) =>
  `₹ ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  confirmed: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  partially_fulfilled: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  fulfilled: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  cancelled: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
};

export const PortalPage: React.FC = () => {
  const [token, setToken] = useState(
    () => new URLSearchParams(window.location.search).get("token") || sessionStorage.getItem("portal_token") || ""
  );
  const [tokenInput, setTokenInput] = useState("");
  const [me, setMe] = useState<PortalMe | null>(null);
  const [booting, setBooting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [tab, setTab] = useState<"invoices" | "statement" | "catalog" | "orders">("invoices");

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetail | null>(null);
  const [invLoading, setInvLoading] = useState(false);

  const [statement, setStatement] = useState<StatementResponse | null>(null);
  const [stFrom, setStFrom] = useState("");
  const [stTo, setStTo] = useState("");
  const [stLoading, setStLoading] = useState(false);

  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [priceListName, setPriceListName] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [catLoading, setCatLoading] = useState(false);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [ordering, setOrdering] = useState(false);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderNotes, setOrderNotes] = useState("");

  const portalRequest = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new ApiError((data as any)?.message || `Request failed (${response.status})`, response.status, data);
      }
      return data as T;
    },
    [token]
  );

  const clearSession = useCallback(() => {
    sessionStorage.removeItem("portal_token");
    setToken("");
    setMe(null);
    setInvoices([]);
    setStatement(null);
    setCatalog([]);
    setOrders([]);
    setCart({});
  }, []);

  useEffect(() => {
    if (!token) {
      setMe(null);
      return;
    }
    sessionStorage.setItem("portal_token", token);
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    let cancelled = false;
    setBooting(true);
    setError("");

    portalRequest<{ success: boolean } & PortalMe>("/portal/me")
      .then((data) => {
        if (cancelled) return;
        setMe({ party: data.party, store: data.store, summary: data.summary });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || "Unable to open the portal.");
        sessionStorage.removeItem("portal_token");
        setToken("");
        setMe(null);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, portalRequest]);

  const loadInvoices = useCallback(async () => {
    if (!token) return;
    setInvLoading(true);
    try {
      const data = await portalRequest<{ data: InvoiceRow[] }>("/portal/invoices?per_page=50");
      setInvoices(data.data || []);
    } catch (e: any) {
      setError(e.message || "Failed to load invoices.");
    } finally {
      setInvLoading(false);
    }
  }, [token, portalRequest]);

  const loadStatement = useCallback(async () => {
    if (!token) return;
    setStLoading(true);
    try {
      const params = new URLSearchParams();
      if (stFrom) params.set("from", stFrom);
      if (stTo) params.set("to", stTo);
      const data = await portalRequest<StatementResponse>(`/portal/statement${params.toString() ? `?${params}` : ""}`);
      setStatement(data);
      setStFrom(data.period.from);
      setStTo(data.period.to);
    } catch (e: any) {
      setError(e.message || "Failed to load statement.");
    } finally {
      setStLoading(false);
    }
  }, [token, portalRequest, stFrom, stTo]);

  const loadCatalog = useCallback(async () => {
    if (!token) return;
    setCatLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      const data = await portalRequest<{ price_list: { name: string } | null; products: CatalogProduct[] }>(
        `/portal/catalog${params.toString() ? `?${params}` : ""}`
      );
      setCatalog(data.products || []);
      setPriceListName(data.price_list?.name ?? null);
    } catch (e: any) {
      setError(e.message || "Failed to load catalog.");
    } finally {
      setCatLoading(false);
    }
  }, [token, portalRequest, search]);

  const loadOrders = useCallback(async () => {
    if (!token) return;
    try {
      const data = await portalRequest<{ orders: OrderRow[] }>("/portal/sales-orders");
      setOrders(data.orders || []);
    } catch (e: any) {
      setError(e.message || "Failed to load orders.");
    }
  }, [token, portalRequest]);

  useEffect(() => {
    if (!me) return;
    if (tab === "invoices" && invoices.length === 0) loadInvoices();
    if (tab === "orders" && orders.length === 0) loadOrders();
    if (tab === "catalog" && catalog.length === 0) loadCatalog();
    if (tab === "statement" && !statement) loadStatement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, tab]);

  const openInvoice = async (id: number) => {
    try {
      const data = await portalRequest<{ invoice: InvoiceDetail }>(`/portal/invoices/${id}`);
      setInvoiceDetail(data.invoice);
    } catch (e: any) {
      setError(e.message || "Failed to load invoice.");
    }
  };

  const cartLines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ product: catalog.find((p) => p.id === Number(id)), qty }))
        .filter((line): line is { product: CatalogProduct; qty: number } => Boolean(line.product) && line.qty > 0),
    [cart, catalog]
  );

  const cartEstimate = useMemo(
    () =>
      cartLines.reduce((sum, line) => {
        const rate = line.qty >= line.product.min_qty ? line.product.rate : line.product.sel_rate;
        return sum + rate * line.qty * line.product.units_per_pack;
      }, 0),
    [cartLines]
  );

  const submitOrder = async () => {
    if (cartLines.length === 0) return;
    setOrdering(true);
    setError("");
    setNotice("");
    try {
      const data = await portalRequest<{ order: { order_number: string } }>("/portal/sales-orders", {
        method: "POST",
        body: JSON.stringify({
          items: cartLines.map((line) => ({ product_id: line.product.id, qty: line.qty })),
          notes: orderNotes.trim() || null,
        }),
      });
      setNotice(`Order ${data.order.order_number} placed. Our team will confirm it shortly.`);
      setCart({});
      setOrderNotes("");
      setTab("orders");
      await loadOrders();
    } catch (e: any) {
      setError(e.message || "Could not place the order.");
    } finally {
      setOrdering(false);
    }
  };

  const logout = async () => {
    try {
      await portalRequest("/portal/logout", { method: "POST" });
    } catch {
      // token may already be invalid
    }
    clearSession();
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 dark:text-white">B2B Customer Portal</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Invoices, ledger and wholesale ordering</p>
            </div>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
            Paste the secure portal link token shared by your supplier.
          </p>
          <input
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value.trim())}
            placeholder="lmp_…"
            className={INPUT_CLASS}
          />
          {error && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-800 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={() => setToken(tokenInput)}
            disabled={!tokenInput}
            className="mt-4 w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white"
          >
            Open portal
          </button>
        </div>
      </div>
    );
  }

  if (booting) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Opening secure portal…
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-rose-200 dark:border-rose-900 bg-white dark:bg-slate-900 p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-3" />
          <h1 className="font-bold text-slate-900 dark:text-white">Portal link unavailable</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{error || "This link may have expired."}</p>
          <button
            type="button"
            onClick={clearSession}
            className="mt-4 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Try another token
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-600 text-white flex items-center justify-center shrink-0">
            <Building2 className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm text-slate-900 dark:text-white truncate">{me.store.name}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Portal for {me.party.name}
              {me.party.gstin ? ` · GSTIN ${me.party.gstin}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4 space-y-4">
        {notice && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {notice}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs font-medium text-rose-800 dark:text-rose-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError("")} className="shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Outstanding", value: formatINR(me.summary.outstanding_balance) },
            { label: "Open orders", value: String(me.summary.open_orders) },
            { label: "Invoices", value: String(me.summary.invoice_count) },
            { label: "Loyalty points", value: String(me.summary.loyalty_points) },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{stat.label}</div>
              <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">{stat.value}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: "invoices" as const, label: "Invoices", icon: Receipt },
            { id: "statement" as const, label: "Ledger", icon: BookOpen },
            { id: "catalog" as const, label: "Order", icon: ShoppingCart },
            { id: "orders" as const, label: "My orders", icon: FileText },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-brand-600 text-white"
                    : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              if (tab === "invoices") loadInvoices();
              if (tab === "statement") loadStatement();
              if (tab === "catalog") loadCatalog();
              if (tab === "orders") loadOrders();
            }}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {tab === "invoices" && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold">Invoice</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Date</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Total</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Paid</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Balance</th>
                  <th className="text-center px-3 py-2.5 font-semibold">Status</th>
                  <th className="text-right px-3 py-2.5 font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {invLoading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-500 dark:text-slate-400 text-xs">
                      Loading invoices…
                    </td>
                  </tr>
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-500 dark:text-slate-400 text-xs">
                      No invoices yet.
                    </td>
                  </tr>
                ) : (
                  invoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-900 dark:text-white">{invoice.invoice_number}</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">{invoice.document}</div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">{formatDate(invoice.invoice_date)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{formatINR(invoice.grand_total)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{formatINR(invoice.paid_amount)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold">{formatINR(invoice.balance)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="inline-flex rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                          {invoice.payment_status || invoice.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => openInvoice(invoice.id)}
                          className="text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "statement" && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">From</label>
                <input type="date" value={stFrom} onChange={(e) => setStFrom(e.target.value)} className={`${INPUT_CLASS} w-auto`} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">To</label>
                <input type="date" value={stTo} onChange={(e) => setStTo(e.target.value)} className={`${INPUT_CLASS} w-auto`} />
              </div>
              <button
                type="button"
                onClick={loadStatement}
                className="rounded-lg bg-brand-600 hover:bg-brand-700 px-3 py-2 text-xs font-semibold text-white"
              >
                Apply
              </button>
              {stLoading && <RefreshCw className="w-4 h-4 animate-spin text-slate-400 ml-1" />}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">Opening balance</div>
                <div className="text-base font-bold text-slate-900 dark:text-white">{formatINR(statement?.opening_balance ?? 0)}</div>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">Closing balance</div>
                <div className="text-base font-bold text-slate-900 dark:text-white">{formatINR(statement?.closing_balance ?? 0)}</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Date</th>
                    <th className="text-left px-3 py-2 font-semibold">Document</th>
                    <th className="text-left px-3 py-2 font-semibold">Number</th>
                    <th className="text-right px-3 py-2 font-semibold">Total</th>
                    <th className="text-right px-3 py-2 font-semibold">Paid</th>
                    <th className="text-right px-3 py-2 font-semibold">Running balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(statement?.rows || []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                        No ledger entries in this period.
                      </td>
                    </tr>
                  ) : (
                    statement?.rows.map((row) => (
                      <tr key={`${row.number}-${row.date}`}>
                        <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{formatDate(row.date)}</td>
                        <td className="px-3 py-2 text-xs">{row.document}</td>
                        <td className="px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white">{row.number}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{formatINR(row.total)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{formatINR(row.paid)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-semibold">{formatINR(row.running_balance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "catalog" && (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") loadCatalog();
                    }}
                    placeholder="Search products by name, barcode or HSN"
                    className={`${INPUT_CLASS} pl-9`}
                  />
                </div>
                <button
                  type="button"
                  onClick={loadCatalog}
                  className="rounded-lg bg-brand-600 hover:bg-brand-700 px-3 py-2 text-xs font-semibold text-white"
                >
                  Search
                </button>
              </div>
              {priceListName && (
                <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
                  Your price list: <span className="font-semibold">{priceListName}</span>
                </div>
              )}
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {catLoading ? (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">Loading catalog…</div>
                ) : catalog.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">No products found.</div>
                ) : (
                  catalog.map((product) => (
                    <div key={product.id} className="py-2.5 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                        <Package className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{product.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {formatINR(product.rate)} / pack of {product.units_per_pack}
                          {product.min_qty > 0 ? ` · min ${product.min_qty} packs` : ""} · GST {product.gst_percent}%
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCart((prev) => ({ ...prev, [product.id]: (prev[product.id] || 0) + 1 }))}
                        className="flex items-center gap-1 rounded-lg border border-brand-300 dark:border-brand-800 px-2 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950/40"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 h-fit lg:sticky lg:top-4">
              <div className="flex items-center gap-2 mb-3">
                <ShoppingCart className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-semibold text-slate-900 dark:text-white">Order cart</span>
              </div>
              {cartLines.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">Add products to build a wholesale order.</p>
              ) : (
                <div className="space-y-2">
                  {cartLines.map((line) => (
                    <div key={line.product.id} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {line.product.name}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setCart((prev) => {
                              const next = { ...prev };
                              delete next[line.product.id];
                              return next;
                            })
                          }
                          className="text-slate-400 hover:text-rose-500"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setCart((prev) => ({
                                ...prev,
                                [line.product.id]: Math.max(0, (prev[line.product.id] || 0) - 1),
                              }))
                            }
                            className="w-6 h-6 rounded border border-slate-300 dark:border-slate-600 flex items-center justify-center"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-8 text-center text-xs font-mono">{line.qty}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setCart((prev) => ({ ...prev, [line.product.id]: (prev[line.product.id] || 0) + 1 }))
                            }
                            className="w-6 h-6 rounded border border-slate-300 dark:border-slate-600 flex items-center justify-center"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-xs font-mono text-slate-700 dark:text-slate-200">
                          {formatINR(
                            (line.qty >= line.product.min_qty ? line.product.rate : line.product.sel_rate) *
                              line.qty *
                              line.product.units_per_pack
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1 text-xs">
                    <span className="text-slate-500 dark:text-slate-400">Estimated before tax</span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-white">{formatINR(cartEstimate)}</span>
                  </div>
                  <textarea
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="Delivery notes (optional)"
                    rows={2}
                    className={INPUT_CLASS}
                  />
                  <button
                    type="button"
                    onClick={submitOrder}
                    disabled={ordering}
                    className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 px-3 py-2 text-sm font-semibold text-white"
                  >
                    {ordering ? "Placing order…" : "Place order"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "orders" && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold">Order</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Date</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Items</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Total</th>
                  <th className="text-center px-3 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                      No orders placed yet.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id}>
                      <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">{order.order_number}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">{formatDate(order.order_date)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{order.items_count}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{formatINR(order.grand_total)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            STATUS_STYLE[order.status] || STATUS_STYLE.draft
                          }`}
                        >
                          {order.status.replace(/_/g, " ")}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {invoiceDetail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900 dark:text-white">
                  {invoiceDetail.document} {invoiceDetail.invoice_number}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDate(invoiceDetail.invoice_date)} · {invoiceDetail.store?.name || me.store.name}
                </p>
              </div>
              <button type="button" onClick={() => setInvoiceDetail(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="text-left px-2 py-2 font-semibold">Product</th>
                    <th className="text-right px-2 py-2 font-semibold">Qty</th>
                    <th className="text-right px-2 py-2 font-semibold">Rate</th>
                    <th className="text-right px-2 py-2 font-semibold">GST</th>
                    <th className="text-right px-2 py-2 font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {invoiceDetail.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-2 py-2 text-xs">
                        <div className="font-medium text-slate-800 dark:text-slate-100">{item.product_name}</div>
                        {item.batch_no && <div className="text-[10px] text-slate-500">Batch {item.batch_no}</div>}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-xs">
                        {item.qty}
                        {item.loose_qty ? ` + ${item.loose_qty}` : ""}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-xs">{formatINR(item.unit_price)}</td>
                      <td className="px-2 py-2 text-right font-mono text-xs">{item.gst_percent}%</td>
                      <td className="px-2 py-2 text-right font-mono text-xs">{formatINR(item.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 ml-auto w-full max-w-xs space-y-1 text-xs">
              {[
                ["Taxable", invoiceDetail.taxable_subtotal],
                ["CGST", invoiceDetail.cgst_total],
                ["SGST", invoiceDetail.sgst_total],
                ["IGST", invoiceDetail.igst_total],
                ["Round off", invoiceDetail.round_off],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                  <span>{label}</span>
                  <span className="font-mono">{formatINR(Number(value))}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 pt-1 font-semibold text-slate-900 dark:text-white">
                <span>Grand total</span>
                <span className="font-mono">{formatINR(invoiceDetail.grand_total)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                <span>Paid</span>
                <span className="font-mono">{formatINR(invoiceDetail.paid_amount)}</span>
              </div>
              <div className="flex items-center justify-between font-semibold text-rose-700 dark:text-rose-300">
                <span>Balance</span>
                <span className="font-mono">{formatINR(invoiceDetail.balance)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalPage;

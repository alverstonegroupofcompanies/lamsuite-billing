import React, { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { formatINR, formatDate } from "../utils/formatters";
import {
  ClipboardList,
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  Truck,
  CheckCircle2,
  XCircle,
  Search,
  X,
  PackageCheck,
  Save,
  SendHorizonal,
} from "lucide-react";

interface OrderItem {
  id?: number;
  product_id: number | null;
  product_name: string;
  hsn_code?: string | null;
  qty: number;
  loose_qty: number;
  units_per_pack: number;
  unit_price: number;
  discount_percent: number;
  gst_percent: number;
  taxable_amount?: number;
  tax_amount?: number;
  total_amount?: number;
  ordered_base_units?: number;
  fulfilled_base_units?: number;
  remaining_base_units?: number;
}

interface SalesOrderRow {
  id: number;
  order_number: string;
  order_date: string;
  expected_delivery_date?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  status: string;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  notes?: string | null;
  cancel_reason?: string | null;
  items_count: number;
  challans_count: number;
  items?: OrderItem[];
}

interface ChallanRow {
  id: number;
  challan_number: string;
  challan_date: string;
  sales_order_id?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  status: string;
  transporter_name?: string | null;
  vehicle_no?: string | null;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  items_count: number;
  items?: Array<{
    id: number;
    product_name: string;
    batch_no?: string | null;
    qty: number;
    loose_qty: number;
    units_per_pack: number;
    unit_price: number;
    taxable_amount: number;
    total_amount: number;
  }>;
}

interface ProductOption {
  id: number;
  name: string;
  hsn_sac_code?: string | null;
  gst_percent: number;
  mrp: number;
  sel_rate: number;
  units_per_pack: number;
}

interface CustomerOption {
  id: number;
  name: string;
  phone?: string | null;
  gstin?: string | null;
}

const INPUT_CLASS =
  "w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  confirmed: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  partially_fulfilled: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  fulfilled: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  cancelled: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  dispatched: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  delivered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

const statusLabel = (status: string) =>
  status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const emptyLine = (): OrderItem => ({
  product_id: null,
  product_name: "",
  qty: 1,
  loose_qty: 0,
  units_per_pack: 1,
  unit_price: 0,
  discount_percent: 0,
  gst_percent: 12,
});

export const SalesOrdersPage: React.FC = () => {
  const { hasPermission, isAllStores } = useAuth();
  const canEdit = hasPermission("sales_orders", "edit") && !isAllStores;

  const [tab, setTab] = useState<"orders" | "challans">("orders");
  const [orders, setOrders] = useState<SalesOrderRow[]>([]);
  const [challans, setChallans] = useState<ChallanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);

  const [detailOrder, setDetailOrder] = useState<SalesOrderRow | null>(null);
  const [detailChallan, setDetailChallan] = useState<ChallanRow | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    customer_id: "" as string,
    order_date: new Date().toISOString().slice(0, 10),
    expected_delivery_date: "",
    notes: "",
  });
  const [lines, setLines] = useState<OrderItem[]>([emptyLine()]);
  const [productSearch, setProductSearch] = useState("");
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [saving, setSaving] = useState(false);

  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchOrder, setDispatchOrder] = useState<SalesOrderRow | null>(null);
  const [dispatchMeta, setDispatchMeta] = useState({
    challan_date: new Date().toISOString().slice(0, 10),
    transporter_name: "",
    vehicle_no: "",
    notes: "",
  });
  const [dispatchQty, setDispatchQty] = useState<Record<number, { qty: string; loose_qty: string; batch_no: string }>>({});

  const [actionBusy, setActionBusy] = useState(false);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ orders: SalesOrderRow[] }>("/admin/sales-orders", {
        status: statusFilter,
        search: search.trim() || undefined,
        per_page: 100,
      });
      setOrders(res.orders || []);
    } catch (err: any) {
      alert(err.message || "Failed to load sales orders");
    } finally {
      setLoading(false);
    }
  };

  const loadChallans = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ challans: ChallanRow[] }>("/admin/delivery-challans", {
        status: statusFilter,
        search: search.trim() || undefined,
        per_page: 100,
      });
      setChallans(res.challans || []);
    } catch (err: any) {
      alert(err.message || "Failed to load delivery challans");
    } finally {
      setLoading(false);
    }
  };

  const reload = () => (tab === "orders" ? loadOrders() : loadChallans());

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusFilter]);

  useEffect(() => {
    api
      .get<{ data: CustomerOption[] }>("/admin/parties", { type: "customer", per_page: 500 })
      .then((res) => setCustomers(res.data || []))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    if (!editorOpen) return;
    const timer = setTimeout(() => {
      api
        .get<{ data: ProductOption[] }>("/admin/products", {
          search: productSearch.trim() || undefined,
          is_active: 1,
          per_page: 20,
        })
        .then((res) => setProductOptions(res.data || []))
        .catch(() => setProductOptions([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [productSearch, editorOpen]);

  const stats = useMemo(() => {
    const open = orders.filter((o) => ["draft", "confirmed", "partially_fulfilled"].includes(o.status));
    const openValue = open.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
    const pendingDispatch = challans.filter((c) => c.status === "dispatched").length;
    const fulfilled = orders.filter((o) => o.status === "fulfilled").length;
    return { open: open.length, openValue, pendingDispatch, fulfilled };
  }, [orders, challans]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      customer_id: "",
      order_date: new Date().toISOString().slice(0, 10),
      expected_delivery_date: "",
      notes: "",
    });
    setLines([emptyLine()]);
    setProductSearch("");
    setEditorOpen(true);
  };

  const openEdit = async (order: SalesOrderRow) => {
    try {
      const res = await api.get<{ order: SalesOrderRow }>(`/admin/sales-orders/${order.id}`);
      const full = res.order;
      setEditingId(full.id);
      setForm({
        customer_id: full.customer_id ? String(full.customer_id) : "",
        order_date: full.order_date,
        expected_delivery_date: full.expected_delivery_date || "",
        notes: full.notes || "",
      });
      setLines(
        (full.items || []).map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          hsn_code: item.hsn_code,
          qty: Number(item.qty),
          loose_qty: Number(item.loose_qty),
          units_per_pack: Number(item.units_per_pack) || 1,
          unit_price: Number(item.unit_price),
          discount_percent: Number(item.discount_percent),
          gst_percent: Number(item.gst_percent),
        }))
      );
      setEditorOpen(true);
    } catch (err: any) {
      alert(err.message || "Failed to load order");
    }
  };

  const addProductLine = (product: ProductOption) => {
    setLines((prev) => [
      ...prev,
      {
        product_id: product.id,
        product_name: product.name,
        hsn_code: product.hsn_sac_code,
        qty: 1,
        loose_qty: 0,
        units_per_pack: Number(product.units_per_pack) || 1,
        unit_price: Number(product.sel_rate) || Number(product.mrp) || 0,
        discount_percent: 0,
        gst_percent: Number(product.gst_percent) || 0,
      },
    ]);
    setProductSearch("");
  };

  const lineTotal = (line: OrderItem) => {
    const upp = Math.max(1, Number(line.units_per_pack) || 1);
    const units = Number(line.qty) * upp + Number(line.loose_qty || 0);
    const gross = (units / upp) * Number(line.unit_price || 0);
    return gross - gross * (Number(line.discount_percent || 0) / 100);
  };

  const draftTotal = useMemo(
    () => lines.reduce((sum, line) => sum + lineTotal(line), 0),
    [lines]
  );

  const saveOrder = async () => {
    const validLines = lines.filter((l) => l.product_id || l.product_name.trim());
    if (validLines.length === 0) {
      alert("Add at least one product line.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        expected_delivery_date: form.expected_delivery_date || null,
        items: validLines.map((l) => ({
          product_id: l.product_id,
          product_name: l.product_name,
          hsn_code: l.hsn_code,
          qty: Number(l.qty),
          loose_qty: Number(l.loose_qty || 0),
          units_per_pack: Number(l.units_per_pack) || 1,
          unit_price: Number(l.unit_price),
          discount_percent: Number(l.discount_percent || 0),
          gst_percent: Number(l.gst_percent || 0),
        })),
      };
      if (editingId) {
        await api.put(`/admin/sales-orders/${editingId}`, payload);
      } else {
        await api.post("/admin/sales-orders", payload);
      }
      setEditorOpen(false);
      await loadOrders();
    } catch (err: any) {
      alert(err.message || "Failed to save sales order");
    } finally {
      setSaving(false);
    }
  };

  const viewOrder = async (order: SalesOrderRow) => {
    try {
      const res = await api.get<{ order: SalesOrderRow }>(`/admin/sales-orders/${order.id}`);
      setDetailOrder(res.order);
    } catch (err: any) {
      alert(err.message || "Failed to load order");
    }
  };

  const viewChallan = async (challan: ChallanRow) => {
    try {
      const res = await api.get<{ challan: ChallanRow }>(`/admin/delivery-challans/${challan.id}`);
      setDetailChallan(res.challan);
    } catch (err: any) {
      alert(err.message || "Failed to load challan");
    }
  };

  const setOrderStatus = async (order: SalesOrderRow, status: string) => {
    let reason: string | undefined;
    if (status === "cancelled") {
      const entered = window.prompt("Cancellation reason (required):");
      if (entered === null) return;
      if (!entered.trim()) {
        alert("A cancellation reason is required.");
        return;
      }
      reason = entered.trim();
    }
    setActionBusy(true);
    try {
      await api.post(`/admin/sales-orders/${order.id}/status`, { status, reason });
      if (detailOrder?.id === order.id) await viewOrder(order);
      await loadOrders();
    } catch (err: any) {
      alert(err.message || "Failed to update order");
    } finally {
      setActionBusy(false);
    }
  };

  const deleteOrder = async (order: SalesOrderRow) => {
    if (!window.confirm(`Delete draft order ${order.order_number}?`)) return;
    try {
      await api.delete(`/admin/sales-orders/${order.id}`);
      await loadOrders();
    } catch (err: any) {
      alert(err.message || "Failed to delete order");
    }
  };

  const openDispatch = async (order: SalesOrderRow) => {
    try {
      const res = await api.get<{ order: SalesOrderRow }>(`/admin/sales-orders/${order.id}`);
      const full = res.order;
      setDispatchOrder(full);
      const initial: Record<number, { qty: string; loose_qty: string; batch_no: string }> = {};
      for (const item of full.items || []) {
        const upp = Math.max(1, Number(item.units_per_pack) || 1);
        const remaining = Number(item.remaining_base_units || 0);
        initial[item.id as number] = {
          qty: String(Math.floor(remaining / upp)),
          loose_qty: String(remaining % upp),
          batch_no: "",
        };
      }
      setDispatchQty(initial);
      setDispatchMeta({
        challan_date: new Date().toISOString().slice(0, 10),
        transporter_name: "",
        vehicle_no: "",
        notes: "",
      });
      setDispatchOpen(true);
    } catch (err: any) {
      alert(err.message || "Failed to load order");
    }
  };

  const submitDispatch = async () => {
    if (!dispatchOrder) return;
    const items = (dispatchOrder.items || [])
      .map((item) => {
        const entry = dispatchQty[item.id as number] || { qty: "0", loose_qty: "0", batch_no: "" };
        return {
          sales_order_item_id: item.id,
          qty: Number(entry.qty || 0),
          loose_qty: Number(entry.loose_qty || 0),
          batch_no: entry.batch_no || undefined,
        };
      })
      .filter((item) => item.qty > 0 || item.loose_qty > 0);

    if (items.length === 0) {
      alert("Enter a dispatch quantity for at least one line.");
      return;
    }

    setSaving(true);
    try {
      await api.post(`/admin/sales-orders/${dispatchOrder.id}/challans`, {
        ...dispatchMeta,
        items,
      });
      setDispatchOpen(false);
      setDetailOrder(null);
      await loadOrders();
      await loadChallans();
      setTab("challans");
    } catch (err: any) {
      alert(err.message || "Failed to create delivery challan");
    } finally {
      setSaving(false);
    }
  };

  const setChallanStatus = async (challan: ChallanRow, status: string) => {
    if (status === "cancelled" && !window.confirm(`Cancel challan ${challan.challan_number}? Fulfilled quantities will be reversed.`)) {
      return;
    }
    setActionBusy(true);
    try {
      await api.post(`/admin/delivery-challans/${challan.id}/status`, { status });
      if (detailChallan?.id === challan.id) await viewChallan(challan);
      await loadChallans();
    } catch (err: any) {
      alert(err.message || "Failed to update challan");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-brand-600" />
            Sales Orders & Dispatch
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Record customer orders, confirm them and track partial delivery challans until fulfilment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reload}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {canEdit && tab === "orders" && (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700"
            >
              <Plus className="w-4 h-4" />
              New Order
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Open Orders", value: stats.open.toString(), tone: "text-blue-600" },
          { label: "Open Order Value", value: formatINR(stats.openValue), tone: "text-slate-900 dark:text-white" },
          { label: "In Transit", value: stats.pendingDispatch.toString(), tone: "text-indigo-600" },
          { label: "Fulfilled", value: stats.fulfilled.toString(), tone: "text-emerald-600" },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">{card.label}</div>
            <div className={`mt-1 text-xl font-bold ${card.tone}`}>{card.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden">
          {(["orders", "challans"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-semibold ${
                tab === key
                  ? "bg-brand-600 text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {key === "orders" ? "Orders" : "Delivery Challans"}
            </button>
          ))}
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${INPUT_CLASS} max-w-[190px]`}>
          <option value="all">All statuses</option>
          {tab === "orders" ? (
            <>
              <option value="draft">Draft</option>
              <option value="confirmed">Confirmed</option>
              <option value="partially_fulfilled">Partially fulfilled</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="cancelled">Cancelled</option>
            </>
          ) : (
            <>
              <option value="dispatched">Dispatched</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </>
          )}
        </select>
        <form
          className="relative flex-1 min-w-[220px]"
          onSubmit={(e) => {
            e.preventDefault();
            reload();
          }}
        >
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === "orders" ? "Search order no, customer, phone" : "Search challan no, customer, vehicle"}
            className={`${INPUT_CLASS} pl-9`}
          />
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading...</div>
        ) : tab === "orders" ? (
          orders.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No sales orders found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Delivery</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {order.order_number}
                      <div className="text-[11px] text-slate-400 font-sans">{order.items_count} item(s)</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDate(order.order_date)}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{order.customer_name || "Walk-in"}</div>
                      {order.customer_phone && <div className="text-[11px] text-slate-500">{order.customer_phone}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {order.expected_delivery_date ? formatDate(order.expected_delivery_date) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[order.status] || STATUS_STYLES.draft}`}>
                        {statusLabel(order.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800 dark:text-slate-200">{formatINR(order.grand_total)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button title="View" onClick={() => viewOrder(order)} className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700">
                          <Search className="w-4 h-4 text-slate-500" />
                        </button>
                        {canEdit && order.status === "draft" && (
                          <>
                            <button title="Edit" onClick={() => openEdit(order)} className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700">
                              <Pencil className="w-4 h-4 text-slate-500" />
                            </button>
                            <button
                              title="Confirm"
                              disabled={actionBusy}
                              onClick={() => setOrderStatus(order, "confirmed")}
                              className="p-1.5 rounded hover:bg-emerald-100 dark:hover:bg-emerald-950"
                            >
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            </button>
                            <button title="Delete" onClick={() => deleteOrder(order)} className="p-1.5 rounded hover:bg-rose-100 dark:hover:bg-rose-950">
                              <Trash2 className="w-4 h-4 text-rose-600" />
                            </button>
                          </>
                        )}
                        {canEdit && ["confirmed", "partially_fulfilled"].includes(order.status) && (
                          <button
                            title="Dispatch"
                            onClick={() => openDispatch(order)}
                            className="p-1.5 rounded hover:bg-indigo-100 dark:hover:bg-indigo-950"
                          >
                            <Truck className="w-4 h-4 text-indigo-600" />
                          </button>
                        )}
                        {canEdit && ["draft", "confirmed", "partially_fulfilled"].includes(order.status) && (
                          <button
                            title="Cancel order"
                            disabled={actionBusy}
                            onClick={() => setOrderStatus(order, "cancelled")}
                            className="p-1.5 rounded hover:bg-rose-100 dark:hover:bg-rose-950"
                          >
                            <XCircle className="w-4 h-4 text-rose-500" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : challans.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No delivery challans found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Challan</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {challans.map((challan) => (
                <tr key={challan.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {challan.challan_number}
                    <div className="text-[11px] text-slate-400 font-sans">{challan.items_count} line(s)</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDate(challan.challan_date)}</td>
                  <td className="px-4 py-3 text-slate-800 dark:text-slate-200">{challan.customer_name || "Walk-in"}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{challan.vehicle_no || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[challan.status] || STATUS_STYLES.dispatched}`}>
                      {statusLabel(challan.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800 dark:text-slate-200">{formatINR(challan.grand_total)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button title="View" onClick={() => viewChallan(challan)} className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700">
                        <Search className="w-4 h-4 text-slate-500" />
                      </button>
                      {canEdit && challan.status === "dispatched" && (
                        <>
                          <button
                            title="Mark delivered"
                            disabled={actionBusy}
                            onClick={() => setChallanStatus(challan, "delivered")}
                            className="p-1.5 rounded hover:bg-emerald-100 dark:hover:bg-emerald-950"
                          >
                            <PackageCheck className="w-4 h-4 text-emerald-600" />
                          </button>
                          <button
                            title="Cancel challan"
                            disabled={actionBusy}
                            onClick={() => setChallanStatus(challan, "cancelled")}
                            className="p-1.5 rounded hover:bg-rose-100 dark:hover:bg-rose-950"
                          >
                            <XCircle className="w-4 h-4 text-rose-500" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / Edit order */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4">
          <div className="w-full max-w-4xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl my-6">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {editingId ? "Edit Sales Order" : "New Sales Order"}
              </h2>
              <button onClick={() => setEditorOpen(false)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Customer
                  <select
                    value={form.customer_id}
                    onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                    className={`${INPUT_CLASS} mt-1`}
                  >
                    <option value="">Walk-in / unnamed</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.phone ? ` — ${c.phone}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Order date
                  <input
                    type="date"
                    value={form.order_date}
                    onChange={(e) => setForm({ ...form, order_date: e.target.value })}
                    className={`${INPUT_CLASS} mt-1`}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Expected delivery
                  <input
                    type="date"
                    value={form.expected_delivery_date}
                    onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })}
                    className={`${INPUT_CLASS} mt-1`}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Notes
                  <input
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Delivery instructions"
                    className={`${INPUT_CLASS} mt-1`}
                  />
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Order Lines</span>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Search product to add"
                      className={`${INPUT_CLASS} pl-8 w-64`}
                    />
                    {productSearch.trim() && productOptions.length > 0 && (
                      <div className="absolute z-20 mt-1 w-72 max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
                        {productOptions.map((product) => (
                          <button
                            key={product.id}
                            onClick={() => addProductLine(product)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <div className="font-semibold text-slate-800 dark:text-slate-100">{product.name}</div>
                            <div className="text-[11px] text-slate-500">
                              MRP {formatINR(product.mrp)} · GST {product.gst_percent}% · Pack {product.units_per_pack}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  {lines.map((line, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                      <div className="col-span-4">
                        <label className="text-[11px] text-slate-500">Product</label>
                        <input
                          value={line.product_name}
                          onChange={(e) =>
                            setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, product_name: e.target.value } : l)))
                          }
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div className="col-span-1">
                        <label className="text-[11px] text-slate-500">Qty</label>
                        <input
                          type="number"
                          min="0"
                          value={line.qty}
                          onChange={(e) =>
                            setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, qty: Number(e.target.value) } : l)))
                          }
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div className="col-span-1">
                        <label className="text-[11px] text-slate-500">Loose</label>
                        <input
                          type="number"
                          min="0"
                          value={line.loose_qty}
                          onChange={(e) =>
                            setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, loose_qty: Number(e.target.value) } : l)))
                          }
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div className="col-span-1">
                        <label className="text-[11px] text-slate-500">Rate</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unit_price}
                          onChange={(e) =>
                            setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, unit_price: Number(e.target.value) } : l)))
                          }
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div className="col-span-1">
                        <label className="text-[11px] text-slate-500">Disc %</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={line.discount_percent}
                          onChange={(e) =>
                            setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, discount_percent: Number(e.target.value) } : l)))
                          }
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div className="col-span-1">
                        <label className="text-[11px] text-slate-500">GST %</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={line.gst_percent}
                          onChange={(e) =>
                            setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, gst_percent: Number(e.target.value) } : l)))
                          }
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[11px] text-slate-500">Amount</label>
                        <div className="px-3 py-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {formatINR(lineTotal(line))}
                        </div>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                          disabled={lines.length === 1}
                          className="p-2 rounded hover:bg-rose-100 dark:hover:bg-rose-950 disabled:opacity-30"
                        >
                          <Trash2 className="w-4 h-4 text-rose-600" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 pt-3">
                <div className="text-sm text-slate-500">
                  Estimated total (tax inclusive):{" "}
                  <span className="text-base font-bold text-slate-900 dark:text-white">{formatINR(draftTotal)}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditorOpen(false)}
                    className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveOrder}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? "Saving..." : "Save Order"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order detail */}
      {detailOrder && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4">
          <div className="w-full max-w-3xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl my-6">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white font-mono">{detailOrder.order_number}</h2>
                <div className="text-xs text-slate-500">
                  {formatDate(detailOrder.order_date)} · {detailOrder.customer_name || "Walk-in"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[detailOrder.status] || STATUS_STYLES.draft}`}>
                  {statusLabel(detailOrder.status)}
                </span>
                <button onClick={() => setDetailOrder(null)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2">Product</th>
                      <th className="py-2 text-right">Ordered</th>
                      <th className="py-2 text-right">Delivered</th>
                      <th className="py-2 text-right">Remaining</th>
                      <th className="py-2 text-right">Rate</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(detailOrder.items || []).map((item) => (
                      <tr key={item.id}>
                        <td className="py-2 font-semibold text-slate-800 dark:text-slate-200">{item.product_name}</td>
                        <td className="py-2 text-right">
                          {item.qty}
                          {Number(item.loose_qty) > 0 ? ` + ${item.loose_qty} loose` : ""}
                        </td>
                        <td className="py-2 text-right">{Number(item.fulfilled_base_units || 0)} base units</td>
                        <td className="py-2 text-right font-semibold">{Number(item.remaining_base_units || 0)} base units</td>
                        <td className="py-2 text-right">{formatINR(item.unit_price)}</td>
                        <td className="py-2 text-right font-semibold">{formatINR(item.total_amount || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {detailOrder.cancel_reason && (
                <div className="text-xs rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 p-3">
                  Cancelled: {detailOrder.cancel_reason}
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm border-t border-slate-200 dark:border-slate-700 pt-3">
                <div>
                  <div className="text-[11px] uppercase text-slate-500">Subtotal</div>
                  <div className="font-semibold">{formatINR(detailOrder.subtotal)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase text-slate-500">Tax (incl.)</div>
                  <div className="font-semibold">{formatINR(detailOrder.tax_total)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase text-slate-500">Grand Total</div>
                  <div className="font-bold text-slate-900 dark:text-white">{formatINR(detailOrder.grand_total)}</div>
                </div>
                <div className="flex items-end justify-end gap-2">
                  {canEdit && detailOrder.status === "draft" && (
                    <button
                      onClick={() => setOrderStatus(detailOrder, "confirmed")}
                      disabled={actionBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Confirm
                    </button>
                  )}
                  {canEdit && ["confirmed", "partially_fulfilled"].includes(detailOrder.status) && (
                    <button
                      onClick={() => openDispatch(detailOrder)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold"
                    >
                      <Truck className="w-3.5 h-3.5" /> Dispatch
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Challan detail */}
      {detailChallan && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4">
          <div className="w-full max-w-3xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl my-6">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white font-mono">{detailChallan.challan_number}</h2>
                <div className="text-xs text-slate-500">
                  {formatDate(detailChallan.challan_date)} · {detailChallan.customer_name || "Walk-in"}
                  {detailChallan.vehicle_no ? ` · ${detailChallan.vehicle_no}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[detailChallan.status] || STATUS_STYLES.dispatched}`}>
                  {statusLabel(detailChallan.status)}
                </span>
                <button onClick={() => setDetailChallan(null)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2">Product</th>
                    <th className="py-2">Batch</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Rate</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(detailChallan.items || []).map((item) => (
                    <tr key={item.id}>
                      <td className="py-2 font-semibold text-slate-800 dark:text-slate-200">{item.product_name}</td>
                      <td className="py-2 text-slate-600 dark:text-slate-300">{item.batch_no || "—"}</td>
                      <td className="py-2 text-right">
                        {item.qty}
                        {Number(item.loose_qty) > 0 ? ` + ${item.loose_qty} loose` : ""}
                      </td>
                      <td className="py-2 text-right">{formatINR(item.unit_price)}</td>
                      <td className="py-2 text-right font-semibold">{formatINR(item.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 pt-3">
                <div className="text-sm text-slate-500">
                  Grand total:{" "}
                  <span className="text-base font-bold text-slate-900 dark:text-white">{formatINR(detailChallan.grand_total)}</span>
                </div>
                {canEdit && detailChallan.status === "dispatched" && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setChallanStatus(detailChallan, "delivered")}
                      disabled={actionBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                    >
                      <PackageCheck className="w-3.5 h-3.5" /> Mark Delivered
                    </button>
                    <button
                      onClick={() => setChallanStatus(detailChallan, "cancelled")}
                      disabled={actionBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Cancel Challan
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dispatch modal */}
      {dispatchOpen && dispatchOrder && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl my-6">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <SendHorizonal className="w-5 h-5 text-indigo-600" />
                Dispatch {dispatchOrder.order_number}
              </h2>
              <button onClick={() => setDispatchOpen(false)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Challan date
                  <input
                    type="date"
                    value={dispatchMeta.challan_date}
                    onChange={(e) => setDispatchMeta({ ...dispatchMeta, challan_date: e.target.value })}
                    className={`${INPUT_CLASS} mt-1`}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Transporter
                  <input
                    value={dispatchMeta.transporter_name}
                    onChange={(e) => setDispatchMeta({ ...dispatchMeta, transporter_name: e.target.value })}
                    placeholder="Courier / transport"
                    className={`${INPUT_CLASS} mt-1`}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Vehicle no.
                  <input
                    value={dispatchMeta.vehicle_no}
                    onChange={(e) => setDispatchMeta({ ...dispatchMeta, vehicle_no: e.target.value })}
                    placeholder="KL-01-AB-1234"
                    className={`${INPUT_CLASS} mt-1`}
                  />
                </label>
              </div>

              <div className="space-y-2">
                {(dispatchOrder.items || []).map((item) => {
                  const entry = dispatchQty[item.id as number] || { qty: "", loose_qty: "", batch_no: "" };
                  const remaining = Number(item.remaining_base_units || 0);
                  if (remaining <= 0.0001) {
                    return (
                      <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{item.product_name}</span>
                        <span className="text-[11px] font-semibold text-emerald-600">Fully delivered</span>
                      </div>
                    );
                  }
                  return (
                    <div key={item.id} className="grid grid-cols-12 gap-2 items-end rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                      <div className="col-span-5">
                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{item.product_name}</div>
                        <div className="text-[11px] text-slate-500">
                          Remaining {remaining} base units (1 pack = {item.units_per_pack})
                        </div>
                      </div>
                      <div className="col-span-2">
                        <label className="text-[11px] text-slate-500">Packs</label>
                        <input
                          type="number"
                          min="0"
                          value={entry.qty}
                          onChange={(e) =>
                            setDispatchQty((prev) => ({
                              ...prev,
                              [item.id as number]: { ...entry, qty: e.target.value },
                            }))
                          }
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[11px] text-slate-500">Loose</label>
                        <input
                          type="number"
                          min="0"
                          value={entry.loose_qty}
                          onChange={(e) =>
                            setDispatchQty((prev) => ({
                              ...prev,
                              [item.id as number]: { ...entry, loose_qty: e.target.value },
                            }))
                          }
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div className="col-span-3">
                        <label className="text-[11px] text-slate-500">Batch</label>
                        <input
                          value={entry.batch_no}
                          onChange={(e) =>
                            setDispatchQty((prev) => ({
                              ...prev,
                              [item.id as number]: { ...entry, batch_no: e.target.value },
                            }))
                          }
                          placeholder="Optional"
                          className={INPUT_CLASS}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-700 pt-3">
                <button
                  onClick={() => setDispatchOpen(false)}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={submitDispatch}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  <Truck className="w-4 h-4" />
                  {saving ? "Creating..." : "Create Challan"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

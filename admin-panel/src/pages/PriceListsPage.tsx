import React, { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { formatINR, formatDate } from "../utils/formatters";
import {
  BadgeIndianRupee,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Users,
  Save,
  Search,
  X,
  CheckCircle2,
  Power,
} from "lucide-react";

interface PriceListRow {
  id: number;
  name: string;
  description?: string | null;
  is_active: boolean;
  valid_from?: string | null;
  valid_to?: string | null;
  priority: number;
  items_count: number;
  assigned_customers: number;
  created_at?: string;
}

interface PriceListItemRow {
  id?: number;
  product_id: number;
  product_name?: string;
  hsn_code?: string | null;
  gst_percent?: number | null;
  mrp?: number | null;
  base_rate?: number | null;
  rate: number;
  discount_percent: number;
  min_qty: number;
}

interface PriceListDetail extends PriceListRow {
  items: PriceListItemRow[];
}

interface ProductOption {
  id: number;
  name: string;
  barcode?: string | null;
  hsn_code?: string | null;
  gst_percent: number;
  mrp: number;
  sel_rate: number;
  current_stock: number;
  is_active: boolean;
}

interface CustomerOption {
  id: number;
  name: string;
  phone?: string | null;
  gstin?: string | null;
  price_list_id?: number | null;
}

const INPUT_CLASS =
  "w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500";

const emptyForm = {
  name: "",
  description: "",
  is_active: true,
  valid_from: "",
  valid_to: "",
  priority: "0",
};

export const PriceListsPage: React.FC = () => {
  const { hasPermission, isAllStores } = useAuth();
  const canEdit = hasPermission("pricing", "edit") && !isAllStores;

  const [lists, setLists] = useState<PriceListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create / edit attributes modal
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PriceListRow | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Pricing editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorList, setEditorList] = useState<PriceListDetail | null>(null);
  const [editorRows, setEditorRows] = useState<PriceListItemRow[]>([]);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [productPickerOpen, setProductPickerOpen] = useState(false);

  // Assignment modal
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignList, setAssignList] = useState<PriceListRow | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [selectedCustomers, setSelectedCustomers] = useState<Set<number>>(new Set());
  const [customerSearch, setCustomerSearch] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ lists: PriceListRow[] }>("/admin/price-lists");
      setLists(res.lists || []);
    } catch (err) {
      setError((err as Error).message || "Failed to load price lists");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  const stats = useMemo(
    () => ({
      total: lists.length,
      active: lists.filter((l) => l.is_active).length,
      customers: lists.reduce((sum, l) => sum + Number(l.assigned_customers || 0), 0),
      pricedProducts: lists.reduce((sum, l) => sum + Number(l.items_count || 0), 0),
    }),
    [lists]
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (list: PriceListRow) => {
    setEditing(list);
    setForm({
      name: list.name,
      description: list.description || "",
      is_active: list.is_active,
      valid_from: list.valid_from || "",
      valid_to: list.valid_to || "",
      priority: String(list.priority ?? 0),
    });
    setFormError(null);
    setFormOpen(true);
  };

  const saveForm = async () => {
    if (!form.name.trim()) {
      setFormError("Price list name is required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        is_active: form.is_active,
        valid_from: form.valid_from || null,
        valid_to: form.valid_to || null,
        priority: Number(form.priority) || 0,
      };
      if (editing) {
        await api.put(`/admin/price-lists/${editing.id}`, payload);
        setNotice(`Price list "${payload.name}" updated.`);
      } else {
        await api.post("/admin/price-lists", payload);
        setNotice(`Price list "${payload.name}" created.`);
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError((err as Error).message || "Could not save price list");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (list: PriceListRow) => {
    try {
      await api.put(`/admin/price-lists/${list.id}`, { is_active: !list.is_active });
      setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, is_active: !l.is_active } : l)));
      setNotice(`"${list.name}" ${list.is_active ? "deactivated" : "activated"}.`);
    } catch (err) {
      setError((err as Error).message || "Could not update price list");
    }
  };

  const removeList = async (list: PriceListRow) => {
    if (!window.confirm(`Delete price list "${list.name}"? Customer assignments will be cleared.`)) return;
    try {
      await api.delete(`/admin/price-lists/${list.id}`);
      setNotice(`Price list "${list.name}" deleted.`);
      await load();
    } catch (err) {
      setError((err as Error).message || "Could not delete price list");
    }
  };

  const openEditor = async (list: PriceListRow) => {
    setEditorOpen(true);
    setEditorLoading(true);
    setEditorError(null);
    setEditorList(null);
    setEditorRows([]);
    setProductPickerOpen(false);
    setProductSearch("");
    try {
      const res = await api.get<{ list: PriceListDetail }>(`/admin/price-lists/${list.id}`);
      setEditorList(res.list);
      setEditorRows(
        (res.list.items || []).map((item) => ({
          ...item,
          rate: Number(item.rate),
          discount_percent: Number(item.discount_percent),
          min_qty: Number(item.min_qty),
        }))
      );
    } catch (err) {
      setEditorError((err as Error).message || "Could not load price list");
    } finally {
      setEditorLoading(false);
    }
  };

  const searchProducts = async (term: string) => {
    setProductSearch(term);
    try {
      const res = await api.get<{ products: ProductOption[] }>("/admin/price-lists/products", {
        search: term || undefined,
        limit: 100,
      });
      setProductOptions(res.products || []);
      setProductPickerOpen(true);
    } catch {
      setProductOptions([]);
    }
  };

  const addProduct = (product: ProductOption) => {
    if (editorRows.some((r) => r.product_id === product.id)) {
      setProductPickerOpen(false);
      return;
    }
    setEditorRows((prev) => [
      ...prev,
      {
        product_id: product.id,
        product_name: product.name,
        hsn_code: product.hsn_code,
        gst_percent: product.gst_percent,
        mrp: product.mrp,
        base_rate: product.sel_rate,
        rate: Number(product.sel_rate) || Number(product.mrp) || 0,
        discount_percent: 0,
        min_qty: 1,
      },
    ]);
    setProductPickerOpen(false);
    setProductSearch("");
  };

  const updateRow = (productId: number, patch: Partial<PriceListItemRow>) => {
    setEditorRows((prev) => prev.map((r) => (r.product_id === productId ? { ...r, ...patch } : r)));
  };

  const removeRow = (productId: number) => {
    setEditorRows((prev) => prev.filter((r) => r.product_id !== productId));
  };

  const savePricing = async () => {
    if (!editorList) return;
    setSaving(true);
    setEditorError(null);
    try {
      await api.put(`/admin/price-lists/${editorList.id}/items`, {
        items: editorRows.map((r) => ({
          product_id: r.product_id,
          rate: Number(r.rate) || 0,
          discount_percent: Number(r.discount_percent) || 0,
          min_qty: Math.max(1, Number(r.min_qty) || 1),
        })),
      });
      setNotice(`Pricing saved for "${editorList.name}" (${editorRows.length} products).`);
      setEditorOpen(false);
      await load();
    } catch (err) {
      setEditorError((err as Error).message || "Could not save pricing");
    } finally {
      setSaving(false);
    }
  };

  const openAssign = async (list: PriceListRow) => {
    setAssignOpen(true);
    setAssignList(list);
    setAssignLoading(true);
    setCustomerSearch("");
    setError(null);
    try {
      const [detail, all] = await Promise.all([
        api.get<{ customers: CustomerOption[] }>(`/admin/price-lists/${list.id}`),
        api.get<{ customers: CustomerOption[] }>("/admin/price-lists/customers", { limit: 500 }),
      ]);
      setCustomers(all.customers || []);
      setSelectedCustomers(new Set((detail.customers || []).map((c) => c.id)));
    } catch (err) {
      setError((err as Error).message || "Could not load customers");
    } finally {
      setAssignLoading(false);
    }
  };

  const saveAssignments = async () => {
    if (!assignList) return;
    setSaving(true);
    try {
      await api.post(`/admin/price-lists/${assignList.id}/assign`, {
        customer_ids: Array.from(selectedCustomers),
      });
      setNotice(`Assignments updated for "${assignList.name}" (${selectedCustomers.size} customers).`);
      setAssignOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message || "Could not update assignments");
    } finally {
      setSaving(false);
    }
  };

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.phone || "").toLowerCase().includes(term) ||
        (c.gstin || "").toLowerCase().includes(term)
    );
  }, [customers, customerSearch]);

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BadgeIndianRupee className="w-5 h-5 text-brand-500" />
            Price Lists
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Customer-specific rates applied automatically at the POS counter.
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
          <button
            type="button"
            onClick={openCreate}
            disabled={!canEdit}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white"
          >
            <Plus className="w-4 h-4" />
            New Price List
          </button>
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
          Switch to a specific store to manage price lists.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Price lists", value: stats.total },
          { label: "Active lists", value: stats.active },
          { label: "Customers mapped", value: stats.customers },
          { label: "Priced products", value: stats.pricedProducts },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{s.label}</div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Price list</th>
              <th className="text-left px-4 py-3 font-semibold">Validity</th>
              <th className="text-right px-4 py-3 font-semibold">Priority</th>
              <th className="text-right px-4 py-3 font-semibold">Products</th>
              <th className="text-right px-4 py-3 font-semibold">Customers</th>
              <th className="text-center px-4 py-3 font-semibold">Status</th>
              <th className="text-right px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                  Loading price lists…
                </td>
              </tr>
            ) : lists.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                  No price lists yet. Create one to start mapping wholesale or institutional rates.
                </td>
              </tr>
            ) : (
              lists.map((list) => (
                <tr key={list.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900 dark:text-white">{list.name}</div>
                    {list.description && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">{list.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                    {list.valid_from || list.valid_to
                      ? `${list.valid_from ? formatDate(list.valid_from) : "—"} → ${list.valid_to ? formatDate(list.valid_to) : "—"}`
                      : "Always on"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{list.priority}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{list.items_count}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{list.assigned_customers}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        list.is_active
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {list.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditor(list)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white"
                      >
                        Pricing
                      </button>
                      <button
                        type="button"
                        onClick={() => openAssign(list)}
                        disabled={!canEdit}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                        title="Assign customers"
                      >
                        <Users className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(list)}
                        disabled={!canEdit}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                        title="Edit details"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActive(list)}
                        disabled={!canEdit}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                        title={list.is_active ? "Deactivate" : "Activate"}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeList(list)}
                        disabled={!canEdit}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
                        title="Delete price list"
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

      {/* Create / Edit attributes */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700">
              <h2 className="font-semibold text-slate-900 dark:text-white">
                {editing ? `Edit ${editing.name}` : "New price list"}
              </h2>
              <button onClick={() => setFormOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {formError && <div className="text-xs text-rose-600">{formError}</div>}
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                <span>Name</span>
                <input
                  className={INPUT_CLASS}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Wholesale, Institutional, Staff"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                <span>Description</span>
                <input
                  className={INPUT_CLASS}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional note shown to administrators"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                  <span>Valid from</span>
                  <input
                    type="date"
                    className={INPUT_CLASS}
                    value={form.valid_from}
                    onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                  <span>Valid to</span>
                  <input
                    type="date"
                    className={INPUT_CLASS}
                    value={form.valid_to}
                    onChange={(e) => setForm({ ...form, valid_to: e.target.value })}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3 items-end">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                  <span>Priority (higher wins ties)</span>
                  <input
                    type="number"
                    min={0}
                    className={INPUT_CLASS}
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 pb-2">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  />
                  Active
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setFormOpen(false)}
                className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={saveForm}
                disabled={saving}
                className="flex items-center gap-1 px-3 py-2 text-sm font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pricing editor */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-white">
                  Pricing · {editorList?.name || "Price list"}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Rates override the product selling rate for assigned customers.
                </p>
              </div>
              <button onClick={() => setEditorOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 space-y-2">
              {editorError && <div className="text-xs text-rose-600">{editorError}</div>}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    className={`${INPUT_CLASS} pl-8`}
                    placeholder="Search product by name, barcode or HSN…"
                    value={productSearch}
                    onChange={(e) => searchProducts(e.target.value)}
                    onFocus={() => productSearch && setProductPickerOpen(true)}
                  />
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">{editorRows.length} products</span>
              </div>
              {productPickerOpen && productOptions.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                  {productOptions.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addProduct(p)}
                      className="w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="font-medium text-slate-800 dark:text-slate-100">
                        {p.name}
                        {!p.is_active && <span className="ml-1 text-rose-500">(inactive)</span>}
                      </span>
                      <span className="font-mono text-slate-500 dark:text-slate-400">
                        MRP {formatINR(p.mrp)} · Sell {formatINR(p.sel_rate)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {editorLoading ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">Loading pricing…</div>
              ) : editorRows.length === 0 ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  No products priced yet. Search above to add the first product.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="text-left py-2">Product</th>
                      <th className="text-right py-2">Base rate</th>
                      <th className="text-right py-2 w-28">List rate</th>
                      <th className="text-right py-2 w-24">Disc %</th>
                      <th className="text-right py-2 w-20">Min qty</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {editorRows.map((row) => (
                      <tr key={row.product_id}>
                        <td className="py-2 pr-2">
                          <div className="font-semibold text-slate-800 dark:text-slate-100">{row.product_name}</div>
                          <div className="text-[10px] text-slate-400">
                            HSN {row.hsn_code || "—"} · GST {row.gst_percent ?? 0}%
                          </div>
                        </td>
                        <td className="py-2 text-right font-mono text-slate-500 dark:text-slate-400">
                          {row.base_rate != null ? formatINR(row.base_rate) : "—"}
                        </td>
                        <td className="py-2 px-1">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-right"
                            value={row.rate}
                            onChange={(e) => updateRow(row.product_id, { rate: Number(e.target.value) })}
                          />
                        </td>
                        <td className="py-2 px-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-right"
                            value={row.discount_percent}
                            onChange={(e) => updateRow(row.product_id, { discount_percent: Number(e.target.value) })}
                          />
                        </td>
                        <td className="py-2 px-1">
                          <input
                            type="number"
                            min={1}
                            className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-right"
                            value={row.min_qty}
                            onChange={(e) => updateRow(row.product_id, { min_qty: Number(e.target.value) })}
                          />
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => removeRow(row.product_id)}
                            className="text-rose-500 hover:text-rose-700"
                            title="Remove product"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-between items-center px-5 py-3 border-t border-slate-200 dark:border-slate-700">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                For qty ≥ min qty, the list rate applies in the POS cart.
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditorOpen(false)}
                  className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600"
                >
                  Cancel
                </button>
                <button
                  onClick={savePricing}
                  disabled={saving || !canEdit}
                  className="flex items-center gap-1 px-3 py-2 text-sm font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? "Saving…" : "Save pricing"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer assignment */}
      {assignOpen && assignList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-white">Assign customers · {assignList.name}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Selected customers will receive this list's rates at checkout.
                </p>
              </div>
              <button onClick={() => setAssignOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  className={`${INPUT_CLASS} pl-8`}
                  placeholder="Search customer by name, phone or GSTIN…"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {assignLoading ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">Loading customers…</div>
              ) : filteredCustomers.length === 0 ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">No customers found.</div>
              ) : (
                <div className="space-y-1">
                  {filteredCustomers.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={selectedCustomers.has(c.id)}
                          onChange={(e) => {
                            setSelectedCustomers((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(c.id);
                              else next.delete(c.id);
                              return next;
                            });
                          }}
                        />
                        <span className="font-medium text-slate-800 dark:text-slate-100">{c.name}</span>
                        <span className="text-slate-400">{c.phone || ""}</span>
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {c.gstin || ""}
                        {c.price_list_id && c.price_list_id !== assignList.id ? " · other list" : ""}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-between items-center px-5 py-3 border-t border-slate-200 dark:border-slate-700">
              <span className="text-xs text-slate-500 dark:text-slate-400">{selectedCustomers.size} selected</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setAssignOpen(false)}
                  className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600"
                >
                  Cancel
                </button>
                <button
                  onClick={saveAssignments}
                  disabled={saving || !canEdit}
                  className="flex items-center gap-1 px-3 py-2 text-sm font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? "Saving…" : "Save assignments"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

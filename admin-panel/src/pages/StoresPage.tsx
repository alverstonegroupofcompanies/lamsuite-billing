import React, { useEffect, useState } from "react";
import { Store } from "../types";
import { api, ApiError } from "../services/api";
import { formatDate } from "../utils/formatters";
import { useAuth } from "../context/AuthContext";
import { GST_STATE_OPTIONS, isStateCode, stateCodeFromGstin } from "../lib/gstStates";
import { ConfirmModal } from "../components/ConfirmModal";
import {
  Store as StoreIcon,
  Plus,
  Search,
  Edit2,
  Power,
  RotateCcw,
  CheckCircle2,
  XCircle,
  FileSpreadsheet,
  RefreshCw,
  X,
  Key,
  Copy,
  Check,
  AlertTriangle,
  AlertCircle,
  Package,
  ShoppingCart,
  Users,
  Receipt,
  Coins,
  Clock,
  CheckSquare,
  Square,
  Layers,
} from "lucide-react";

export const StoresPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Modals state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Partial<Store> | null>(null);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: "toggle_status" | "remote_reset";
    store: Store | null;
  }>({ isOpen: false, type: "toggle_status", store: null });

  // Granular Reset Modal State
  const [resetModalStore, setResetModalStore] = useState<Store | null>(null);
  const [resetOptions, setResetOptions] = useState({
    reset_invoices: true,
    reset_stock: true,
    reset_products: false,
    reset_purchases: true,
    reset_customers: true,
    reset_expenses: true,
    reset_held_bills: true,
  });
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [resetAlert, setResetAlert] = useState<{
    type: "success" | "error" | "info" | "warning";
    message: string;
  } | null>(null);
  const [isCopiedPhrase, setIsCopiedPhrase] = useState(false);

  const fetchStores = async () => {
    setIsLoading(true);
    try {
      const res = await api.get<{ data: Store[] }>("/admin/stores", {
        search,
        is_active: statusFilter,
      });
      setStores(res.data || []);
    } catch (err) {
      console.error("Failed to load stores:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStores();
  }, [search, statusFilter]);

  const handleSaveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStore) return;

    try {
      if (editingStore.id) {
        await api.put(`/admin/stores/${editingStore.id}`, editingStore);
      } else {
        await api.post("/admin/stores", editingStore);
      }
      setIsEditModalOpen(false);
      setEditingStore(null);
      await fetchStores();
    } catch (err: any) {
      alert(err?.message || "Failed to save store.");
    }
  };

  const handleConfirmAction = async (reason: string) => {
    const { type, store } = confirmModal;
    if (!store) return;

    try {
      if (type === "toggle_status") {
        await api.post(`/admin/stores/${store.id}/toggle-status`, { reason });
      }
      await fetchStores();
    } catch (err: any) {
      alert(err?.message || "Action failed.");
    }
  };

  const handleExecuteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalStore) return;

    const expectedPhrase = `RESET STORE ${resetModalStore.name.toUpperCase()}`;
    if (resetPhrase.trim() !== expectedPhrase) {
      setResetAlert({
        type: "error",
        message: `Confirmation phrase mismatch! You must type exactly: "${expectedPhrase}"`,
      });
      return;
    }

    if (!resetReason.trim() || resetReason.trim().length < 5) {
      setResetAlert({
        type: "error",
        message: "A mandatory justification reason (min 5 characters) is required for audit trail compliance.",
      });
      return;
    }

    const anySelected = Object.values(resetOptions).some(Boolean);
    if (!anySelected) {
      setResetAlert({
        type: "error",
        message: "No modules selected! Please select at least one data module to reset.",
      });
      return;
    }

    setIsResetting(true);
    setResetAlert(null);
    try {
      const res = await api.post<{ success: boolean; message: string; wiped_modules: any }>(
        `/admin/stores/${resetModalStore.id}/reset`,
        {
          confirmation_phrase: expectedPhrase,
          reason: resetReason.trim(),
          options: resetOptions,
        }
      );

      setResetAlert({
        type: "success",
        message: res.message || `Store "${resetModalStore.name}" selected data has been successfully reset!`,
      });
      await fetchStores();
      setTimeout(() => {
        setResetModalStore(null);
      }, 1600);
    } catch (err: any) {
      setResetAlert({
        type: "error",
        message: err?.message || "Failed to execute store data reset.",
      });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Store Network Management
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Configure retail branches, statutory GSTIN credentials, licenses, and remote killswitch.
          </p>
        </div>

        {hasPermission("stores", "create") && (
          <button
            onClick={() => {
              setEditingStore({
                name: "",
                // SET-01: no pre-filled code; typing after a pre-filled value is
                // how "STORE-04QA-PH" happened. The suggestion is a placeholder.
                code: "",
                state_code: "",
                timezone: "Asia/Kolkata",
                tax_mode: "inclusive",
                license_plan: "Professional Store",
                enabled_menu_items: ["pos", "bills", "purchases", "stock", "reports", "masters", "settings"],
              });
              setIsEditModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Add Store Branch</span>
          </button>
        )}
      </div>

      {/* Filter and Search Toolbar */}
      <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search branch name, code, GSTIN..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-700 dark:text-slate-300 focus:outline-hidden"
          >
            <option value="">All Status</option>
            <option value="true">Active Only</option>
            <option value="false">Disabled Only</option>
          </select>

          <button
            onClick={fetchStores}
            title="Reload stores"
            className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Stores Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Store Details</th>
                <th className="px-4 py-3">Code / GSTIN</th>
                <th className="px-4 py-3">Joining a till</th>
                <th className="px-4 py-3">Drug Licenses</th>
                <th className="px-4 py-3">Plan / Expiry</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Loading stores...
                  </td>
                </tr>
              ) : stores.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No stores found matching your criteria.
                  </td>
                </tr>
              ) : (
                stores.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900 dark:text-white">{s.name}</div>
                      <div className="text-[11px] text-slate-400 truncate max-w-xs">{s.address || "No address provided"}</div>
                    </td>
                    <td className="px-4 py-3 font-mono">
                      <div>{s.code}</div>
                      <div className="text-[10px] text-slate-400">{s.gstin || "No GSTIN registered"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xs">
                        Codes are issued per counter. Open{" "}
                        <span className="font-semibold text-slate-700 dark:text-slate-200">Counters</span>{" "}
                        to create one and hand over its activation code.
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {s.drug_license_numbers && s.drug_license_numbers.length > 0 ? (
                        <div className="space-y-0.5">
                          {s.drug_license_numbers.map((dl, i) => (
                            <span
                              key={i}
                              className="inline-block font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 mr-1"
                            >
                              {dl}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{s.license_plan}</div>
                      <div className="text-[10px] text-slate-400">Expires: {formatDate(s.license_expires_at)}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          s.is_active
                            ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400"
                            : "bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400"
                        }`}
                      >
                        {s.is_active ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        <span>{s.is_active ? "Active" : "Disabled"}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {hasPermission("stores", "edit") && (
                          <>
                            <button
                              onClick={() => {
                                setEditingStore(s);
                                setIsEditModalOpen(true);
                              }}
                              title="Edit store parameters"
                              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() =>
                                setConfirmModal({
                                  isOpen: true,
                                  type: "toggle_status",
                                  store: s,
                                })
                              }
                              title={s.is_active ? "Disable Store (Triggers store disabled screen on POS)" : "Enable Store"}
                              className={`p-1.5 rounded-lg transition-colors ${
                                s.is_active
                                  ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                                  : "text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                              }`}
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        {hasPermission("stores", "delete") && (
                          <button
                            onClick={() => {
                              setResetModalStore(s);
                              setResetPhrase("");
                              setResetReason("");
                              setResetAlert(null);
                              setIsCopiedPhrase(false);
                              setResetOptions({
                                reset_invoices: true,
                                reset_stock: true,
                                reset_products: false,
                                reset_purchases: true,
                                reset_customers: true,
                                reset_expenses: true,
                                reset_held_bills: true,
                              });
                            }}
                            title="Remote Reset (Granular data purge with module selection)"
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit / Create Store Modal */}
      {isEditModalOpen && editingStore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-xl w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                {editingStore.id ? `Edit Store: ${editingStore.name}` : "Create New Branch Store"}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveStore} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Store Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingStore.name || ""}
                    onChange={(e) => setEditingStore({ ...editingStore, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                <div>
                  <label htmlFor="store-code" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Store Code *
                  </label>
                  <input
                    id="store-code"
                    type="text"
                    required
                    maxLength={20}
                    value={editingStore.code || ""}
                    onChange={(e) =>
                      setEditingStore({
                        ...editingStore,
                        // Uppercase letters, digits and dashes — the same rule
                        // the server enforces (SET-01), so a typo cannot be typed in.
                        code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""),
                      })
                    }
                    placeholder={`STORE-0${stores.length + 1}`}
                    className="w-full px-3 py-2 rounded-xl font-mono border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:outline-hidden"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">Uppercase letters, digits and dashes; up to 20 characters.</p>
                </div>

                <div>
                  <label htmlFor="store-state-code" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    State Code (GST) *
                  </label>
                  <select
                    id="store-state-code"
                    required
                    value={isStateCode(editingStore.state_code) ? editingStore.state_code : ""}
                    onChange={(e) => setEditingStore({ ...editingStore, state_code: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="" disabled>
                      Select GST state
                    </option>
                    {GST_STATE_OPTIONS.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Store Timezone
                  </label>
                  <input
                    type="text"
                    value={editingStore.timezone ?? ""}
                    onChange={(e) => setEditingStore({ ...editingStore, timezone: e.target.value })}
                    placeholder="Asia/Kolkata"
                    className="w-full px-3 py-2 rounded-xl font-mono border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label htmlFor="store-gstin" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    GSTIN Number
                  </label>
                  <input
                    id="store-gstin"
                    type="text"
                    maxLength={15}
                    value={editingStore.gstin || ""}
                    onChange={(e) => setEditingStore({ ...editingStore, gstin: e.target.value.toUpperCase() })}
                    onBlur={() => {
                      // The GSTIN already declares the state; do not let the two disagree.
                      const code = stateCodeFromGstin(editingStore.gstin);
                      if (code && code !== editingStore.state_code) {
                        setEditingStore({ ...editingStore, state_code: code });
                      }
                    }}
                    placeholder="32AAAAA0000A1Z5"
                    className="w-full px-3 py-2 rounded-xl font-mono uppercase border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Store Type (Domain Preset) *
                  </label>
                  <select
                    value={editingStore.store_type || "pharmacy"}
                    onChange={(e) => {
                      const newType = e.target.value;
                      if (editingStore.store_type === "pharmacy" && newType !== "pharmacy") {
                        if (!window.confirm("Notice: Switching from Pharmacy to another business type will hide doctor, patient, prescription and Schedule H fields across POS, bills, and reports. Existing records will NOT be deleted. Do you want to proceed?")) {
                          return;
                        }
                      }
                      setEditingStore({ ...editingStore, store_type: newType });
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="pharmacy">Pharmacy & Chemists</option>
                    <option value="cosmetics">Cosmetics & Beauty</option>
                    <option value="kirana_general">General Store / Kirana / Supermarket</option>
                    <option value="clothing">Clothing & Footwear</option>
                    <option value="electronics">Electronics & Mobile Store</option>
                    <option value="stationery">Stationery & Books</option>
                    <option value="wholesale">Wholesale & Distributor</option>
                    <option value="restaurant">Restaurant, Cafe & Bakery</option>
                    <option value="other">General Retail / Other</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    GST Billing Type *
                  </label>
                  <select
                    value={editingStore.gst_type || "regular"}
                    onChange={(e) => setEditingStore({ ...editingStore, gst_type: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="regular">Regular Taxpayer (Tax Invoice)</option>
                    <option value="composition">Composition Scheme (Bill of Supply)</option>
                    <option value="no_tax">Unregistered / No Tax (Bill of Supply)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Tax Price Basis
                  </label>
                  <select
                    value={editingStore.tax_mode || "inclusive"}
                    onChange={(e) => setEditingStore({ ...editingStore, tax_mode: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="inclusive">Tax Inclusive (MRP / Retail)</option>
                    <option value="exclusive">Tax Exclusive (B2B / Wholesale)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    License Plan
                  </label>
                  <input
                    type="text"
                    value={editingStore.license_plan ?? ""}
                    onChange={(e) => setEditingStore({ ...editingStore, license_plan: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Physical Address
                  </label>
                  <textarea
                    rows={2}
                    value={editingStore.address || ""}
                    onChange={(e) => setEditingStore({ ...editingStore, address: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold shadow-sm"
                >
                  Save Store
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Granular Store Reset Modal with Module Selection & Proper Alerts */}
      {resetModalStore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-red-500/30 max-w-2xl w-full p-6 space-y-5 my-8 max-h-[92vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                    <span>Reset Store Data:</span>
                    <span className="text-red-600 dark:text-red-400 font-mono">{resetModalStore.name}</span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Store Code: <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{resetModalStore.code}</span> | Granular data purge & stock reset control
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setResetModalStore(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Alert Messages */}
            {resetAlert && (
              <div
                className={`p-3.5 rounded-xl text-xs flex items-center gap-2.5 ${
                  resetAlert.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                    : resetAlert.type === "error"
                    ? "bg-red-50 text-red-800 border border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800"
                    : "bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                }`}
              >
                {resetAlert.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
                )}
                <span className="font-medium">{resetAlert.message}</span>
              </div>
            )}

            {/* Critical Warning Alert */}
            <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-xs text-red-900 dark:text-red-200 space-y-1.5 shadow-2xs">
              <div className="flex items-center gap-2 font-bold text-red-700 dark:text-red-300 text-sm">
                <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                <span>CRITICAL SECURITY ACTION: Permanent Operational Data Purge</span>
              </div>
              <p className="leading-relaxed text-[11px] text-red-800/90 dark:text-red-300/90">
                Selected operational modules will be permanently wiped for this store across central cloud servers and all connected desktop POS workstations. Product catalog items, barcodes, categories and staff accounts are preserved unless their module is ticked below.
              </p>
            </div>

            {/* Conditional Stock Reset Alert */}
            {resetOptions.reset_stock && !resetOptions.reset_products && (
              <div className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5 shadow-2xs">
                <Package className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold text-amber-800 dark:text-amber-300">Inventory & Stock Reset Enabled:</span>
                  <p className="text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-300/90">
                    Batch stock-on-hand quantities will be reset to 0 and all negative/oversold deficits cleared. Product catalog items remain preserved with 0 stock.
                  </p>
                </div>
              </div>
            )}

            {/* Conditional Products Catalog Reset Alert */}
            {resetOptions.reset_products && (
              <div className="p-3.5 rounded-xl border border-rose-300 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-900 dark:text-rose-200 flex items-start gap-2.5 shadow-2xs">
                <Layers className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold text-rose-800 dark:text-rose-300">Product & Batch Catalog Wiping Enabled:</span>
                  <p className="text-[11px] leading-relaxed text-rose-800/90 dark:text-rose-300/90">
                    All product items, medicines, barcodes, and master batches for this store will be permanently deleted. If you only want to clear stock quantities while keeping the catalog items, uncheck this option.
                  </p>
                </div>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleExecuteReset} className="space-y-5">
              {/* Select/Deselect Header */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <span>Select Modules to Reset:</span>
                    <span className="text-[11px] font-normal text-slate-500 lowercase">
                      ({Object.values(resetOptions).filter(Boolean).length} of 7 selected)
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setResetOptions({
                          reset_invoices: true,
                          reset_stock: true,
                          reset_products: true,
                          reset_purchases: true,
                          reset_customers: true,
                          reset_expenses: true,
                          reset_held_bills: true,
                        })
                      }
                      className="text-[11px] px-2.5 py-1 font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setResetOptions({
                          reset_invoices: false,
                          reset_stock: false,
                          reset_products: false,
                          reset_purchases: false,
                          reset_customers: false,
                          reset_expenses: false,
                          reset_held_bills: false,
                        })
                      }
                      className="text-[11px] px-2.5 py-1 font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>

                {/* Modules Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* 1. Invoices */}
                  <div
                    onClick={() => setResetOptions((prev) => ({ ...prev, reset_invoices: !prev.reset_invoices }))}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-start gap-3 select-none ${
                      resetOptions.reset_invoices
                        ? "border-red-400 bg-red-50/70 dark:bg-red-950/20 dark:border-red-800/80"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 opacity-60"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0 text-red-600 dark:text-red-400">
                      {resetOptions.reset_invoices ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <Receipt className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span className="font-bold text-slate-800 dark:text-slate-200">Sales Invoices & Receipts</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                        Wipes all issued POS sales bills, cash/card/UPI payments, and sales returns.
                      </p>
                    </div>
                  </div>

                  {/* 2. Stock */}
                  <div
                    onClick={() => setResetOptions((prev) => ({ ...prev, reset_stock: !prev.reset_stock }))}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-start gap-3 select-none ${
                      resetOptions.reset_stock
                        ? "border-amber-400 bg-amber-50/70 dark:bg-amber-950/20 dark:border-amber-800/80"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 opacity-60"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400">
                      {resetOptions.reset_stock ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <Package className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span className="font-bold text-slate-800 dark:text-slate-200">Inventory & Stock Quantities</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                        Resets batch quantities to 0, clears negative/oversold deficits, and wipes stock ledger movements.
                      </p>
                    </div>
                  </div>

                  {/* 3. Products & Items Catalog */}
                  <div
                    onClick={() => setResetOptions((prev) => ({ ...prev, reset_products: !prev.reset_products }))}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-start gap-3 select-none ${
                      resetOptions.reset_products
                        ? "border-rose-400 bg-rose-50/70 dark:bg-rose-950/20 dark:border-rose-800/80"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 opacity-60"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400">
                      {resetOptions.reset_products ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                        <span className="font-bold text-slate-800 dark:text-slate-200">Products & Item Catalog</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                        Wipes all products, medicine master items, barcodes, and batches for this store.
                      </p>
                    </div>
                  </div>

                  {/* 3. Purchases */}
                  <div
                    onClick={() => setResetOptions((prev) => ({ ...prev, reset_purchases: !prev.reset_purchases }))}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-start gap-3 select-none ${
                      resetOptions.reset_purchases
                        ? "border-purple-400 bg-purple-50/70 dark:bg-purple-950/20 dark:border-purple-800/80"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 opacity-60"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0 text-purple-600 dark:text-purple-400">
                      {resetOptions.reset_purchases ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <ShoppingCart className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                        <span className="font-bold text-slate-800 dark:text-slate-200">Purchases & Supplier Invoices</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                        Wipes inward purchase documents, purchase line items, supplier returns, and purchase orders.
                      </p>
                    </div>
                  </div>

                  {/* 4. Customer Balances */}
                  <div
                    onClick={() => setResetOptions((prev) => ({ ...prev, reset_customers: !prev.reset_customers }))}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-start gap-3 select-none ${
                      resetOptions.reset_customers
                        ? "border-amber-400 bg-amber-50/70 dark:bg-amber-950/20 dark:border-amber-800/80"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 opacity-60"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400">
                      {resetOptions.reset_customers ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        <span className="font-bold text-slate-800 dark:text-slate-200">Parties, Customers & Suppliers</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                        Deletes customer, supplier, doctor and patient master records for this store, settles outstanding balances to ₹0.00 and clears all payment receipts.
                      </p>
                    </div>
                  </div>

                  {/* 5. Expenses */}
                  <div
                    onClick={() => setResetOptions((prev) => ({ ...prev, reset_expenses: !prev.reset_expenses }))}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-start gap-3 select-none ${
                      resetOptions.reset_expenses
                        ? "border-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/20 dark:border-indigo-800/80"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 opacity-60"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400">
                      {resetOptions.reset_expenses ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                        <span className="font-bold text-slate-800 dark:text-slate-200">Operational Expenses</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                        Wipes recorded store expenses, petty cash, and payment vouchers.
                      </p>
                    </div>
                  </div>

                  {/* 6. Held Bills */}
                  <div
                    onClick={() => setResetOptions((prev) => ({ ...prev, reset_held_bills: !prev.reset_held_bills }))}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-start gap-3 select-none ${
                      resetOptions.reset_held_bills
                        ? "border-rose-400 bg-rose-50/70 dark:bg-rose-950/20 dark:border-rose-800/80"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 opacity-60"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400">
                      {resetOptions.reset_held_bills ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                        <span className="font-bold text-slate-800 dark:text-slate-200">Held / Parked Counter Bills</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                        Wipes all parked counter bills and suspended draft carts.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Confirmation Phrase Guard */}
              <div className="space-y-1.5 bg-red-50 dark:bg-red-950/30 p-3.5 rounded-xl border border-red-200 dark:border-red-900/50">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-red-800 dark:text-red-300">
                    Type phrase to confirm:
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const phrase = `RESET STORE ${resetModalStore.name.toUpperCase()}`;
                      navigator.clipboard.writeText(phrase);
                      setIsCopiedPhrase(true);
                      setTimeout(() => setIsCopiedPhrase(false), 2000);
                    }}
                    className="text-[11px] text-red-600 hover:text-red-800 dark:text-red-400 font-mono flex items-center gap-1 cursor-pointer"
                  >
                    {isCopiedPhrase ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    <span>{isCopiedPhrase ? "Copied" : "Copy phrase"}</span>
                  </button>
                </div>

                <div className="font-mono text-xs font-bold bg-white dark:bg-black px-2.5 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 select-all">
                  RESET STORE {resetModalStore.name.toUpperCase()}
                </div>

                <input
                  type="text"
                  value={resetPhrase}
                  onChange={(e) => {
                    setResetPhrase(e.target.value);
                    setResetAlert(null);
                  }}
                  placeholder={`RESET STORE ${resetModalStore.name.toUpperCase()}`}
                  className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-red-300 dark:border-red-800 dark:bg-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-red-500"
                />
              </div>

              {/* Mandatory Reason */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center justify-between">
                  <span>Audit Trail Reason / Justification <span className="text-red-500">*</span></span>
                  <span className="text-[10px] text-slate-400">min 5 characters</span>
                </label>
                <textarea
                  value={resetReason}
                  onChange={(e) => {
                    setResetReason(e.target.value);
                    setResetAlert(null);
                  }}
                  rows={2}
                  required
                  placeholder="e.g. Test cycle reset before live production launch, stock physical recount reconciliation"
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500"
                />
              </div>

              {/* Footer Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setResetModalStore(null)}
                  disabled={isResetting}
                  className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isResetting ||
                    !Object.values(resetOptions).some(Boolean) ||
                    resetPhrase.trim() !== `RESET STORE ${resetModalStore.name.toUpperCase()}` ||
                    resetReason.trim().length < 5
                  }
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-red-600 hover:bg-red-500 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all cursor-pointer"
                >
                  {isResetting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Executing Reset...</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Execute Store Reset</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation & Killswitch Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={handleConfirmAction}
        title={`${confirmModal.store?.is_active ? "Disable" : "Enable"} Store: ${confirmModal.store?.name}`}
        message={
          confirmModal.store?.is_active
            ? "Disabling this store will force all connected desktop workstations to display 'Store disabled' within one sync cycle. Cashiers will be blocked from issuing new bills."
            : "Enabling this store will restore full billing access to all connected desktop workstations."
        }
        confirmText={confirmModal.store?.is_active ? "Disable Store Now" : "Enable Store Now"}
        danger={Boolean(confirmModal.store?.is_active)}
        requireReason={true}
      />
    </div>
  );
};

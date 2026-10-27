import React, { useEffect, useState } from "react";
import { Store } from "../types";
import { api, ApiError } from "../services/api";
import { formatDate } from "../utils/formatters";
import { useAuth } from "../context/AuthContext";
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
      } else if (type === "remote_reset") {
        const expectedPhrase = `RESET STORE ${store.name.toUpperCase()}`;
        await api.post(`/admin/stores/${store.id}/reset`, {
          confirmation_phrase: expectedPhrase,
          reason,
        });
      }
      await fetchStores();
    } catch (err: any) {
      alert(err?.message || "Action failed.");
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
                code: `STORE-0${stores.length + 1}`,
                state_code: "32",
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
                <th className="px-4 py-3">Store Activation Key</th>
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
                      <div className="flex items-center gap-1.5 font-mono text-[11px]">
                        <span className="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-700 dark:text-slate-200 font-semibold border border-slate-200 dark:border-slate-700">
                          {s.activation_key || `LAM-${s.code}-KEY`}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(s.activation_key || `LAM-${s.code}-KEY`);
                            alert(`Copied activation key: ${s.activation_key || `LAM-${s.code}-KEY`}`);
                          }}
                          title="Copy Activation Key to Clipboard"
                          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        {hasPermission("stores", "edit") && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (confirm(`Regenerate activation key for store "${s.name}"? Previous keys will be revoked.`)) {
                                try {
                                  const res = await api.post<{ success: boolean; activation_key: string; message: string }>(`/stores/${s.id}/regenerate-key`);
                                  alert(res.message + "\nNew Key: " + res.activation_key);
                                  fetchStores();
                                } catch (e: any) {
                                  alert("Failed to regenerate key: " + (e.message || "Unknown error"));
                                }
                              }
                            }}
                            title="Regenerate Activation Key (Invalidates previous keys)"
                            className="p-1 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        )}
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
                            onClick={() =>
                              setConfirmModal({
                                isOpen: true,
                                type: "remote_reset",
                                store: s,
                              })
                            }
                            title="Remote Reset (Wipes transactions with mandatory confirmation phrase)"
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
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Store Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingStore.code || ""}
                    onChange={(e) => setEditingStore({ ...editingStore, code: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl font-mono border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    State Code (GST) *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingStore.state_code || "32"}
                    onChange={(e) => setEditingStore({ ...editingStore, state_code: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    GSTIN Number
                  </label>
                  <input
                    type="text"
                    value={editingStore.gstin || ""}
                    onChange={(e) => setEditingStore({ ...editingStore, gstin: e.target.value })}
                    placeholder="32AAAAA0000A1Z5"
                    className="w-full px-3 py-2 rounded-xl font-mono uppercase border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    License Plan
                  </label>
                  <input
                    type="text"
                    value={editingStore.license_plan || "Professional"}
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

      {/* Confirmation & Killswitch Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={handleConfirmAction}
        title={
          confirmModal.type === "remote_reset"
            ? `Remote Reset Store: ${confirmModal.store?.name}`
            : `${confirmModal.store?.is_active ? "Disable" : "Enable"} Store: ${confirmModal.store?.name}`
        }
        message={
          confirmModal.type === "remote_reset"
            ? "CRITICAL DANGER: A remote reset will wipe all transaction history, sales receipts, and stock ledgers for this store. Master catalog items will be preserved. This action creates a tamper-evident audit record."
            : confirmModal.store?.is_active
            ? "Disabling this store will force all connected desktop workstations to display 'Store disabled' within one sync cycle. Cashiers will be blocked from issuing new bills."
            : "Enabling this store will restore full billing access to all connected desktop workstations."
        }
        confirmText={
          confirmModal.type === "remote_reset"
            ? "Execute Remote Reset"
            : confirmModal.store?.is_active
            ? "Disable Store Now"
            : "Enable Store Now"
        }
        danger={confirmModal.type === "remote_reset" || Boolean(confirmModal.store?.is_active)}
        requiredPhrase={
          confirmModal.type === "remote_reset" && confirmModal.store
            ? `RESET STORE ${confirmModal.store.name.toUpperCase()}`
            : undefined
        }
        requireReason={true}
      />
    </div>
  );
};

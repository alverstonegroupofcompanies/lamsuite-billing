import React, { useEffect, useState } from "react";
import { Product, Party, ProductBatch } from "../types";
import { api, ApiError } from "../services/api";
import { formatINR, formatIndianNumber } from "../utils/formatters";
import { useAuth } from "../context/AuthContext";
import { ConflictModal } from "../components/ConflictModal";
import {
  Database,
  Search,
  Plus,
  Edit2,
  Upload,
  Merge,
  Filter,
  Package,
  Users2,
  SlidersHorizontal,
  RefreshCw,
  X,
  AlertCircle,
  FileSpreadsheet,
} from "lucide-react";

export const MastersPage: React.FC = () => {
  const { activeStore, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<"products" | "parties" | "lookups">("products");

  // Products state
  const [products, setProducts] = useState<Product[]>([]);
  const [partyType, setPartyType] = useState<"customer" | "supplier" | "doctor" | "patient">("customer");
  const [parties, setParties] = useState<Party[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Product Edit / Create Modal
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);

  // Optimistic Locking conflict modal state
  const [conflictState, setConflictState] = useState<{
    isOpen: boolean;
    currentVersion?: number;
    clientVersion?: number;
  }>({ isOpen: false });

  // Bulk Edit Modal
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [bulkAction, setBulkAction] = useState<string>("set_gst");
  const [bulkValue, setBulkValue] = useState<string>("12");

  // Merge Modal
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [mergePrimaryId, setMergePrimaryId] = useState<number | "">("");
  const [mergeDuplicateId, setMergeDuplicateId] = useState<number | "">("");
  const [mergeReason, setMergeReason] = useState("");

  // Import Modal
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importPreview, setImportPreview] = useState<any>(null);

  const fetchCatalog = async () => {
    setIsLoading(true);
    try {
      if (activeTab === "products") {
        const res = await api.get<{ data: Product[] }>("/admin/products", { search });
        setProducts(res.data || []);
      } else if (activeTab === "parties") {
        const res = await api.get<{ data: Party[] }>("/admin/parties", { type: partyType, search });
        setParties(res.data || []);
      }
    } catch (err) {
      console.error("Failed to load catalog data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, [activeTab, partyType, search, activeStore]);

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct || !activeStore) return;

    try {
      if (editingProduct.id) {
        await api.put(`/admin/products/${editingProduct.id}`, editingProduct);
      } else {
        await api.post("/admin/products", {
          ...editingProduct,
          store_id: activeStore.id,
        });
      }
      setIsProductModalOpen(false);
      setEditingProduct(null);
      await fetchCatalog();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictState({
          isOpen: true,
          currentVersion: err.data?.current_version,
          clientVersion: err.data?.client_version,
        });
      } else {
        alert(err?.message || "Failed to save product.");
      }
    }
  };

  const handleBulkEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedProductIds.length === 0) {
      alert("Please select at least one item from the table.");
      return;
    }

    try {
      await api.post("/admin/products/bulk-edit", {
        product_ids: selectedProductIds,
        action: bulkAction,
        value: bulkValue,
      });
      alert(`Bulk edit applied to ${selectedProductIds.length} products.`);
      setIsBulkEditOpen(false);
      setSelectedProductIds([]);
      await fetchCatalog();
    } catch (err: any) {
      alert(err?.message || "Bulk edit failed.");
    }
  };

  const handleMergeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mergePrimaryId || !mergeDuplicateId) return;

    try {
      await api.post("/admin/masters/merge", {
        entity_type: activeTab === "products" ? "product" : "party",
        primary_id: Number(mergePrimaryId),
        duplicate_id: Number(mergeDuplicateId),
        reason: mergeReason,
      });
      alert("Records merged successfully.");
      setIsMergeModalOpen(false);
      await fetchCatalog();
    } catch (err: any) {
      alert(err?.message || "Merge operation failed.");
    }
  };

  const handleCsvInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value.trim();
    if (!text) return;
    const lines = text.split("\n");
    const parsed = lines.slice(1).map((line) => {
      const parts = line.split(",").map((s) => s.trim());
      return {
        name: parts[0] || "",
        barcode: parts[1] || "",
        hsn_sac_code: parts[2] || "30049099",
        mrp: Number(parts[3]) || 0,
        sel_rate: Number(parts[4]) || 0,
        gst_percent: Number(parts[5]) || 12,
        current_stock: Number(parts[6]) || 0,
      };
    });
    setImportRows(parsed);
  };

  const handleImportPreview = async () => {
    if (!activeStore || importRows.length === 0) return;
    try {
      const preview = await api.post("/admin/masters/import", {
        store_id: activeStore.id,
        type: "products",
        rows: importRows,
        preview_only: true,
      });
      setImportPreview(preview);
    } catch (err: any) {
      alert(err?.message || "Import preview failed.");
    }
  };

  const handleCommitImport = async () => {
    if (!activeStore || importRows.length === 0) return;
    try {
      const res = await api.post("/admin/masters/import", {
        store_id: activeStore.id,
        type: "products",
        rows: importRows,
        preview_only: false,
      });
      alert(`Successfully imported ${res.imported_count} products.`);
      setIsImportModalOpen(false);
      setImportRows([]);
      setImportPreview(null);
      await fetchCatalog();
    } catch (err: any) {
      alert(err?.message || "Import failed.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Master Data Repository
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Catalog SKUs, batches, statutory HSN taxes, customer/supplier ledgers, and duplicate merge.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {hasPermission("masters", "create") && (
            <>
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200 shadow-2xs hover:bg-slate-50"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import CSV</span>
              </button>

              <button
                onClick={() => setIsMergeModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200 shadow-2xs hover:bg-slate-50"
              >
                <Merge className="w-3.5 h-3.5 text-purple-500" />
                <span>Merge Duplicates</span>
              </button>

              {activeTab === "products" && selectedProductIds.length > 0 && (
                <button
                  onClick={() => setIsBulkEditOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl shadow-xs"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Bulk Edit ({selectedProductIds.length})</span>
                </button>
              )}

              <button
                onClick={() => {
                  setEditingProduct({
                    name: "",
                    hsn_sac_code: "30049099",
                    mrp: 0,
                    sel_rate: 0,
                    gst_percent: 12,
                    reorder_level: 20,
                    current_stock: 0,
                    units_per_pack: 1,
                  });
                  setIsProductModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Add Item</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Primary Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-4 text-xs font-semibold">
        <button
          onClick={() => setActiveTab("products")}
          className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-colors ${
            activeTab === "products"
              ? "border-brand-600 text-brand-600 dark:text-brand-400 font-bold"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <Package className="w-4 h-4" />
          <span>Products & SKU Batches</span>
        </button>

        <button
          onClick={() => setActiveTab("parties")}
          className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-colors ${
            activeTab === "parties"
              ? "border-brand-600 text-brand-600 dark:text-brand-400 font-bold"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <Users2 className="w-4 h-4" />
          <span>Parties (Customers & Suppliers)</span>
        </button>
      </div>

      {/* Sub Toolbar & Search */}
      <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${activeTab}...`}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {activeTab === "parties" && (
          <div className="flex items-center gap-1 overflow-x-auto text-xs w-full sm:w-auto">
            {(["customer", "supplier", "doctor", "patient"] as const).map((type) => (
              <button
                key={type}
                onClick={() => setPartyType(type)}
                className={`px-3 py-1 rounded-lg capitalize font-medium transition-colors ${
                  partyType === type
                    ? "bg-brand-600 text-white shadow-xs font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {type}s
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content Table */}
      {activeTab === "products" ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-3 py-3 w-10 text-center">
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        if (e.target.checked) setSelectedProductIds(products.map((p) => p.id));
                        else setSelectedProductIds([]);
                      }}
                      checked={selectedProductIds.length === products.length && products.length > 0}
                    />
                  </th>
                  <th className="px-4 py-3">Product Name & Barcode</th>
                  <th className="px-4 py-3">HSN & GST</th>
                  <th className="px-4 py-3 text-right">MRP</th>
                  <th className="px-4 py-3 text-right">Selling Rate</th>
                  <th className="px-4 py-3 text-center">Stock / Batches</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      Loading products...
                    </td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      No products found.
                    </td>
                  </tr>
                ) : (
                  products.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedProductIds.includes(p.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedProductIds([...selectedProductIds, p.id]);
                            else setSelectedProductIds(selectedProductIds.filter((id) => id !== p.id));
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900 dark:text-white">{p.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {p.barcode || "No barcode"} • {p.generic_name || "Standard Form"}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono">
                        <div>{p.hsn_sac_code}</div>
                        <div className="text-[10px] text-brand-600 font-semibold">{p.gst_percent}% GST</div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{formatINR(p.mrp)}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">
                        {formatINR(p.sel_rate)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`font-mono px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            p.current_stock <= p.reorder_level
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {formatIndianNumber(p.current_stock)} units
                        </span>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {p.batches?.length || 0} active batch(es)
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            setEditingProduct(p);
                            setIsProductModalOpen(true);
                          }}
                          className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40 rounded-lg"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Parties Table */
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Party Name</th>
                  <th className="px-4 py-3">Phone & GSTIN</th>
                  <th className="px-4 py-3">Address</th>
                  <th className="px-4 py-3 text-right">Credit Limit</th>
                  <th className="px-4 py-3 text-right">Current Ledger Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      Loading parties...
                    </td>
                  </tr>
                ) : parties.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      No {partyType} records found.
                    </td>
                  </tr>
                ) : (
                  parties.map((pt) => (
                    <tr key={pt.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                        {pt.name}
                        {pt.reg_no && <div className="text-[10px] text-slate-400 font-mono">Reg: {pt.reg_no}</div>}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        <div>{pt.phone || "No phone"}</div>
                        <div className="text-[10px] text-slate-400">{pt.gstin || "Unregistered"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 truncate max-w-xs">{pt.address || "—"}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatINR(pt.credit_limit)}</td>
                      <td
                        className={`px-4 py-3 text-right font-bold font-mono ${
                          pt.current_balance > 0
                            ? "text-red-500"
                            : pt.current_balance < 0
                            ? "text-emerald-500"
                            : "text-slate-400"
                        }`}
                      >
                        {formatINR(pt.current_balance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit / Create Product Modal */}
      {isProductModalOpen && editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                {editingProduct.id ? `Edit Item: ${editingProduct.name}` : "Create Catalog Product"}
              </h3>
              <button
                onClick={() => setIsProductModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Item Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingProduct.name || ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Barcode / EAN
                  </label>
                  <input
                    type="text"
                    value={editingProduct.barcode || ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, barcode: e.target.value })}
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    HSN / SAC Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingProduct.hsn_sac_code || "30049099"}
                    onChange={(e) => setEditingProduct({ ...editingProduct, hsn_sac_code: e.target.value })}
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    MRP (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={editingProduct.mrp ?? 0}
                    onChange={(e) => setEditingProduct({ ...editingProduct, mrp: Number(e.target.value) })}
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Selling Rate (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={editingProduct.sel_rate ?? 0}
                    onChange={(e) => setEditingProduct({ ...editingProduct, sel_rate: Number(e.target.value) })}
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    GST Percent (%) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={editingProduct.gst_percent ?? 12}
                    onChange={(e) => setEditingProduct({ ...editingProduct, gst_percent: Number(e.target.value) })}
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Reorder Stock Level
                  </label>
                  <input
                    type="number"
                    value={editingProduct.reorder_level ?? 20}
                    onChange={(e) => setEditingProduct({ ...editingProduct, reorder_level: Number(e.target.value) })}
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl shadow-sm"
                >
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {isBulkEditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Bulk Edit ({selectedProductIds.length} Products)
              </h3>
              <button
                onClick={() => setIsBulkEditOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleBulkEditSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Choose Modification Action
                </label>
                <select
                  value={bulkAction}
                  onChange={(e) => setBulkAction(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="set_gst">Set GST Rate (%)</option>
                  <option value="adjust_price_percent">Adjust Price by % (+/-)</option>
                  <option value="toggle_active">Set Active / Inactive</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  New Value
                </label>
                <input
                  type="text"
                  required
                  value={bulkValue}
                  onChange={(e) => setBulkValue(e.target.value)}
                  placeholder="e.g. 18 for GST or 5 for +5%"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsBulkEditOpen(false)}
                  className="px-3.5 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg shadow-sm"
                >
                  Apply Bulk Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Merge Duplicates Modal */}
      {isMergeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-purple-500/40 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 text-purple-600">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <Merge className="w-4 h-4" />
                <span>Merge Duplicate Master Records</span>
              </h3>
              <button
                onClick={() => setIsMergeModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleMergeSubmit} className="space-y-3 text-xs">
              <p className="text-slate-500 dark:text-slate-400">
                This will transfer all historical invoices, batches, and ledger entries from the duplicate record into the primary record, then archive the duplicate.
              </p>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Primary Record ID (Keep) *
                </label>
                <input
                  type="number"
                  required
                  value={mergePrimaryId}
                  onChange={(e) => setMergePrimaryId(Number(e.target.value))}
                  placeholder="Primary ID e.g. 1"
                  className="w-full px-3 py-2 rounded-xl font-mono border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Duplicate Record ID (Merge & Archive) *
                </label>
                <input
                  type="number"
                  required
                  value={mergeDuplicateId}
                  onChange={(e) => setMergeDuplicateId(Number(e.target.value))}
                  placeholder="Duplicate ID e.g. 4"
                  className="w-full px-3 py-2 font-mono border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Reason for Merge *
                </label>
                <input
                  type="text"
                  required
                  value={mergeReason}
                  onChange={(e) => setMergeReason(e.target.value)}
                  placeholder="e.g. Duplicate customer account created during offline rush"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsMergeModalOpen(false)}
                  className="px-3.5 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg shadow-sm"
                >
                  Execute Merge
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal with Preview */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-xl w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <Upload className="w-4 h-4 text-brand-600" />
                <span>Bulk CSV Item Import</span>
              </h3>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-500">
                Paste CSV content below. Header line: <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono">name,barcode,hsn,mrp,sel_rate,gst,stock</code>
              </p>
              <textarea
                rows={5}
                onChange={handleCsvInput}
                placeholder="name,barcode,hsn,mrp,sel_rate,gst,stock&#10;Cetirizine 10mg,890123,30049099,25.00,20.00,12,100"
                className="w-full p-3 font-mono text-xs rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />

              {importRows.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={handleImportPreview}
                    className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 font-semibold rounded-lg"
                  >
                    Validate & Preview ({importRows.length} rows)
                  </button>
                </div>
              )}

              {importPreview && (
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-2">
                  <div className="font-bold text-emerald-600">
                    Validated: {importPreview.valid_count} valid items. (Errors: {importPreview.error_count})
                  </div>
                  {importPreview.sample_preview?.length > 0 && (
                    <div className="font-mono text-[11px] text-slate-500 truncate">
                      Sample: {importPreview.sample_preview[0].name} (₹{importPreview.sample_preview[0].sel_rate})
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => setIsImportModalOpen(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCommitImport}
                  disabled={!importPreview || importPreview.valid_count === 0}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl shadow-sm disabled:opacity-50"
                >
                  Commit Import
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Optimistic Locking Conflict Warning Modal */}
      <ConflictModal
        isOpen={conflictState.isOpen}
        onClose={() => setConflictState({ isOpen: false })}
        onReload={() => {
          setConflictState({ isOpen: false });
          fetchCatalog();
        }}
        currentVersion={conflictState.currentVersion}
        clientVersion={conflictState.clientVersion}
      />
    </div>
  );
};

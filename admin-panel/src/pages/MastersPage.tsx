import React, { useEffect, useState, useMemo } from "react";
import { Product, Party, ProductBatch, MasterLookup } from "../types";
import { api, ApiError } from "../services/api";
import { formatINR, formatIndianNumber, formatDate } from "../utils/formatters";
import { useAuth } from "../context/AuthContext";
import { ConflictModal } from "../components/ConflictModal";
import { ConfirmModal } from "../components/ConfirmModal";
import {
  Package,
  Layers,
  Users2,
  Scale,
  Tag,
  Award,
  Building2,
  Percent,
  Receipt,
  Wallet,
  Landmark,
  Search,
  Plus,
  Edit2,
  Trash2,
  Upload,
  Merge,
  Filter,
  RefreshCw,
  X,
  AlertCircle,
  CheckCircle,
  FileSpreadsheet,
  SlidersHorizontal,
} from "lucide-react";

export type MasterTab =
  | "products"
  | "batches"
  | "parties"
  | "units"
  | "groups"
  | "brands"
  | "manufacturers"
  | "discounts"
  | "tax_rates"
  | "expense_heads"
  | "banks";

export const MastersPage: React.FC = () => {
  const { activeStore, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<MasterTab>("products");

  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Pharmacy check
  const isPharmacy = Boolean(activeStore && (activeStore.store_type || "pharmacy") === "pharmacy");
  const availablePartyTypes = (isPharmacy
    ? ["customer", "supplier", "doctor", "patient"]
    : ["customer", "supplier"]) as Array<"customer" | "supplier" | "doctor" | "patient">;

  // 1. Products state
  const [products, setProducts] = useState<Product[]>([]);
  const [productPage, setProductPage] = useState(1);
  const [productTotalPages, setProductTotalPages] = useState(1);
  const [productTotalCount, setProductTotalCount] = useState(0);
  const [productPerPage, setProductPerPage] = useState(50);
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [initialBatchData, setInitialBatchData] = useState<{ batch_no: string; expiry_date: string; stock_qty: number }>({
    batch_no: "B1",
    expiry_date: "",
    stock_qty: 0,
  });

  // 2. Batches state
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [batchPage, setBatchPage] = useState(1);
  const [batchTotalPages, setBatchTotalPages] = useState(1);
  const [batchTotalCount, setBatchTotalCount] = useState(0);
  const [batchExpiringOnly, setBatchExpiringOnly] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Partial<ProductBatch> | null>(null);

  // 3. Parties state
  const [partyType, setPartyType] = useState<"customer" | "supplier" | "doctor" | "patient">("customer");
  const [parties, setParties] = useState<Party[]>([]);
  const [partyPage, setPartyPage] = useState(1);
  const [partyTotalPages, setPartyTotalPages] = useState(1);
  const [partyTotalCount, setPartyTotalCount] = useState(0);
  const [isPartyModalOpen, setIsPartyModalOpen] = useState(false);
  const [editingParty, setEditingParty] = useState<Partial<Party> | null>(null);

  // 4. Lookups state
  const [lookups, setLookups] = useState<MasterLookup[]>([]);
  const [lookupPage, setLookupPage] = useState(1);
  const [lookupTotalPages, setLookupTotalPages] = useState(1);
  const [lookupTotalCount, setLookupTotalCount] = useState(0);
  const [isLookupModalOpen, setIsLookupModalOpen] = useState(false);
  const [editingLookup, setEditingLookup] = useState<Partial<MasterLookup> | null>(null);

  // Lookup options for Product form selects
  const [unitLookups, setUnitLookups] = useState<MasterLookup[]>([]);
  const [groupLookups, setGroupLookups] = useState<MasterLookup[]>([]);
  const [brandLookups, setBrandLookups] = useState<MasterLookup[]>([]);
  const [mfgLookups, setMfgLookups] = useState<MasterLookup[]>([]);

  // Ledger Modal State
  const [selectedLedgerParty, setSelectedLedgerParty] = useState<Party | null>(null);
  const [ledgerData, setLedgerData] = useState<any | null>(null);
  const [isLedgerLoading, setIsLedgerLoading] = useState(false);

  // Optimistic Locking conflict modal state
  const [conflictState, setConflictState] = useState<{
    isOpen: boolean;
    currentVersion?: number;
    clientVersion?: number;
  }>({ isOpen: false });

  // Delete Confirm Modal State
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    actionName: string;
    onConfirm: () => Promise<void>;
  }>({
    isOpen: false,
    title: "",
    message: "",
    actionName: "Delete",
    onConfirm: async () => {},
  });

  // Bulk Edit Modal
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
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

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const currentLookupType = useMemo(() => {
    switch (activeTab) {
      case "units":
        return "unit";
      case "groups":
        return "group";
      case "brands":
        return "brand";
      case "manufacturers":
        return "manufacturer";
      case "discounts":
        return "discount_schema";
      case "tax_rates":
        return "tax_rate";
      case "expense_heads":
        return "expense_head";
      case "banks":
        return "bank";
      default:
        return null;
    }
  }, [activeTab]);

  // Load auxiliary lookups for select dropdowns
  const fetchAuxiliaryLookups = async () => {
    try {
      const [uRes, gRes, bRes, mRes] = await Promise.all([
        api.get<any>("/admin/lookups", { type: "unit" }),
        api.get<any>("/admin/lookups", { type: "group" }),
        api.get<any>("/admin/lookups", { type: "brand" }),
        api.get<any>("/admin/lookups", { type: "manufacturer" }),
      ]);
      setUnitLookups(Array.isArray(uRes) ? uRes : uRes.data || []);
      setGroupLookups(Array.isArray(gRes) ? gRes : gRes.data || []);
      setBrandLookups(Array.isArray(bRes) ? bRes : bRes.data || []);
      setMfgLookups(Array.isArray(mRes) ? mRes : mRes.data || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchAuxiliaryLookups();
  }, [activeStore]);

  // Primary data loader
  const fetchData = async () => {
    setIsLoading(true);
    try {
      if (activeTab === "products") {
        const res = await api.get<{
          data: Product[];
          current_page: number;
          last_page: number;
          total: number;
        }>("/admin/products", {
          search,
          page: productPage,
          per_page: productPerPage,
        });
        setProducts(res.data || []);
        setProductPage(res.current_page || 1);
        setProductTotalPages(res.last_page || 1);
        setProductTotalCount(res.total || 0);
      } else if (activeTab === "batches") {
        const res = await api.get<{
          data: ProductBatch[];
          current_page: number;
          last_page: number;
          total: number;
        }>("/admin/batches", {
          search,
          expiring: batchExpiringOnly ? "true" : undefined,
          page: batchPage,
          per_page: 50,
        });
        setBatches(res.data || []);
        setBatchPage(res.current_page || 1);
        setBatchTotalPages(res.last_page || 1);
        setBatchTotalCount(res.total || 0);
      } else if (activeTab === "parties") {
        const res = await api.get<{
          data: Party[];
          current_page: number;
          last_page: number;
          total: number;
        }>("/admin/parties", {
          type: partyType,
          search,
          page: partyPage,
          per_page: 50,
        });
        setParties(res.data || []);
        setPartyPage(res.current_page || 1);
        setPartyTotalPages(res.last_page || 1);
        setPartyTotalCount(res.total || 0);
      } else if (currentLookupType) {
        const res = await api.get<any>("/admin/lookups", {
          type: currentLookupType,
          search,
          page: lookupPage,
          per_page: 50,
        });
        if (res.data && Array.isArray(res.data)) {
          setLookups(res.data);
          setLookupPage(res.current_page || 1);
          setLookupTotalPages(res.last_page || 1);
          setLookupTotalCount(res.total || res.data.length);
        } else if (Array.isArray(res)) {
          setLookups(res);
          setLookupPage(1);
          setLookupTotalPages(1);
          setLookupTotalCount(res.length);
        }
      }
    } catch (err) {
      console.error("Failed to load master data:", err);
      showToast("Error loading catalog data", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [
    activeTab,
    partyType,
    search,
    productPage,
    productPerPage,
    batchPage,
    batchExpiringOnly,
    partyPage,
    lookupPage,
    activeStore,
  ]);

  // Handle Tab Switch
  const handleTabChange = (tab: MasterTab) => {
    setActiveTab(tab);
    setSearch("");
    if (tab === "products") setProductPage(1);
    if (tab === "batches") setBatchPage(1);
    if (tab === "parties") setPartyPage(1);
    if (["units", "groups", "brands", "manufacturers", "discounts", "tax_rates", "expense_heads", "banks"].includes(tab)) {
      setLookupPage(1);
    }
  };

  // ----------------------------------------------------
  // Product CRUD
  // ----------------------------------------------------
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct || !activeStore) return;

    try {
      if (editingProduct.id) {
        await api.put(`/admin/products/${editingProduct.id}`, editingProduct);
        showToast(`Product "${editingProduct.name}" updated successfully.`);
      } else {
        await api.post("/admin/products", {
          ...editingProduct,
          store_id: activeStore.id,
          initial_batch: initialBatchData.batch_no && initialBatchData.expiry_date ? initialBatchData : undefined,
        });
        showToast(`Product "${editingProduct.name}" created successfully.`);
      }
      setIsProductModalOpen(false);
      setEditingProduct(null);
      await fetchData();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictState({
          isOpen: true,
          currentVersion: err.data?.current_version,
          clientVersion: err.data?.client_version,
        });
      } else {
        showToast(err?.message || "Failed to save product.", "error");
      }
    }
  };

  const confirmDeleteProduct = (product: Product) => {
    setDeleteConfirm({
      isOpen: true,
      title: `Delete Product: ${product.name}`,
      message: `Are you sure you want to delete "${product.name}"? If historical invoices reference this item, it will be safely deactivated to preserve statutory audit records.`,
      actionName: "Delete Product",
      onConfirm: async () => {
        try {
          const res = await api.delete(`/admin/products/${product.id}`);
          showToast(res.message || "Product processed successfully.");
          await fetchData();
        } catch (err: any) {
          showToast(err?.message || "Failed to delete product.", "error");
        }
      },
    });
  };

  // ----------------------------------------------------
  // Batch CRUD
  // ----------------------------------------------------
  const handleSaveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBatch || !activeStore) return;

    try {
      if (editingBatch.id) {
        await api.put(`/admin/batches/${editingBatch.id}`, editingBatch);
        showToast(`Batch "${editingBatch.batch_no}" updated successfully.`);
      } else {
        if (!editingBatch.product_id) {
          showToast("Please select a product for this batch", "error");
          return;
        }
        await api.post(`/admin/products/${editingBatch.product_id}/batches`, {
          ...editingBatch,
          store_id: activeStore.id,
        });
        showToast(`Batch "${editingBatch.batch_no}" created successfully.`);
      }
      setIsBatchModalOpen(false);
      setEditingBatch(null);
      await fetchData();
    } catch (err: any) {
      showToast(err?.message || "Failed to save batch.", "error");
    }
  };

  const confirmDeleteBatch = (batch: ProductBatch) => {
    setDeleteConfirm({
      isOpen: true,
      title: `Delete Batch: ${batch.batch_no}`,
      message: `Are you sure you want to delete batch "${batch.batch_no}" for ${batch.product?.name || "Product"}? Product current stock will be recalculated automatically.`,
      actionName: "Delete Batch",
      onConfirm: async () => {
        try {
          const res = await api.delete(`/admin/batches/${batch.id}`);
          showToast(res.message || "Batch deleted.");
          await fetchData();
        } catch (err: any) {
          showToast(err?.message || "Failed to delete batch.", "error");
        }
      },
    });
  };

  // ----------------------------------------------------
  // Party CRUD
  // ----------------------------------------------------
  const handleSaveParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingParty || !activeStore) return;

    try {
      if (editingParty.id) {
        await api.put(`/admin/parties/${editingParty.id}`, editingParty);
        showToast(`Party "${editingParty.name}" updated successfully.`);
      } else {
        await api.post("/admin/parties", {
          ...editingParty,
          type: editingParty.type || partyType,
          store_id: activeStore.id,
        });
        showToast(`Party "${editingParty.name}" created successfully.`);
      }
      setIsPartyModalOpen(false);
      setEditingParty(null);
      await fetchData();
    } catch (err: any) {
      showToast(err?.message || "Failed to save party.", "error");
    }
  };

  const confirmDeleteParty = (party: Party) => {
    setDeleteConfirm({
      isOpen: true,
      title: `Delete Party: ${party.name}`,
      message: `Are you sure you want to delete ${party.type} "${party.name}"? If there are past invoices or open ledger balances, it will be deactivated to safeguard financial integrity.`,
      actionName: "Delete Party",
      onConfirm: async () => {
        try {
          const res = await api.delete(`/admin/parties/${party.id}`);
          showToast(res.message || "Party record deleted.");
          await fetchData();
        } catch (err: any) {
          showToast(err?.message || "Failed to delete party.", "error");
        }
      },
    });
  };

  const openLedger = async (party: Party) => {
    setSelectedLedgerParty(party);
    setIsLedgerLoading(true);
    try {
      const endpoint =
        party.type === "supplier"
          ? `/admin/suppliers/${party.id}/ledger`
          : `/admin/customers/${party.id}/ledger`;
      const res = await api.get(endpoint);
      setLedgerData(res);
    } catch (err) {
      console.error("Failed to load party ledger:", err);
    } finally {
      setIsLedgerLoading(false);
    }
  };

  // ----------------------------------------------------
  // Lookup CRUD (Units, Groups, Brands, Mfg, Discounts, Tax, Expenses, Banks)
  // ----------------------------------------------------
  const handleSaveLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLookup || !currentLookupType) return;

    try {
      if (editingLookup.id) {
        await api.put(`/admin/lookups/${editingLookup.id}`, editingLookup);
        showToast(`Record updated successfully.`);
      } else {
        await api.post("/admin/lookups", {
          ...editingLookup,
          type: currentLookupType,
          store_id: activeStore?.id || null,
        });
        showToast(`Record created successfully.`);
      }
      setIsLookupModalOpen(false);
      setEditingLookup(null);
      await fetchData();
      fetchAuxiliaryLookups();
    } catch (err: any) {
      showToast(err?.message || "Failed to save record.", "error");
    }
  };

  const confirmDeleteLookup = (lookup: MasterLookup) => {
    setDeleteConfirm({
      isOpen: true,
      title: `Delete ${getTabLabel(activeTab).slice(0, -1)}: ${lookup.name}`,
      message: `Are you sure you want to delete "${lookup.name}"? This lookup entry will be permanently removed.`,
      actionName: "Delete Record",
      onConfirm: async () => {
        try {
          await api.delete(`/admin/lookups/${lookup.id}`);
          showToast("Record deleted successfully.");
          await fetchData();
          fetchAuxiliaryLookups();
        } catch (err: any) {
          showToast(err?.message || "Failed to delete lookup record.", "error");
        }
      },
    });
  };

  // ----------------------------------------------------
  // Bulk Edit & Merge & CSV
  // ----------------------------------------------------
  const handleBulkEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedProductIds.length === 0) {
      showToast("Please select at least one item from the table.", "error");
      return;
    }

    try {
      await api.post("/admin/products/bulk-edit", {
        product_ids: selectedProductIds,
        action: bulkAction,
        value: bulkValue,
      });
      showToast(`Bulk edit applied to ${selectedProductIds.length} products.`);
      setIsBulkEditOpen(false);
      setSelectedProductIds([]);
      await fetchData();
    } catch (err: any) {
      showToast(err?.message || "Bulk edit failed.", "error");
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
      showToast("Records merged successfully.");
      setIsMergeModalOpen(false);
      await fetchData();
    } catch (err: any) {
      showToast(err?.message || "Merge operation failed.", "error");
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
      showToast(err?.message || "Import preview failed.", "error");
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
      showToast(`Successfully imported ${res.imported_count} products.`);
      setIsImportModalOpen(false);
      setImportRows([]);
      setImportPreview(null);
      await fetchData();
    } catch (err: any) {
      showToast(err?.message || "Import failed.", "error");
    }
  };

  // Helper for "Add New" button
  const handleAddNew = () => {
    if (activeTab === "products") {
      setEditingProduct({
        name: "",
        barcode: "",
        hsn_sac_code: "30049099",
        mrp: 0,
        sel_rate: 0,
        ptr: 0,
        pts: 0,
        gst_percent: 12,
        units_per_pack: 1,
        reorder_level: 10,
        current_stock: 0,
        is_active: true,
      });
      setInitialBatchData({
        batch_no: "B1",
        expiry_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        stock_qty: 0,
      });
      setIsProductModalOpen(true);
    } else if (activeTab === "batches") {
      setEditingBatch({
        product_id: products[0]?.id || undefined,
        batch_no: "",
        expiry_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        stock_qty: 0,
        mrp: 0,
        purchase_rate: 0,
        selling_rate: 0,
      });
      setIsBatchModalOpen(true);
    } else if (activeTab === "parties") {
      setEditingParty({
        type: partyType,
        name: "",
        phone: "",
        email: "",
        gstin: "",
        address: "",
        state_code: "32",
        credit_limit: 5000,
        opening_balance: 0,
        is_active: true,
      });
      setIsPartyModalOpen(true);
    } else if (currentLookupType) {
      let defaultConfig: any = {};
      if (activeTab === "units") defaultConfig = { precision: 0 };
      if (activeTab === "discounts") defaultConfig = { rule_type: "percentage", discount_percent: 5, min_quantity: 1 };
      if (activeTab === "tax_rates") defaultConfig = { tax_percent: 12 };
      if (activeTab === "banks") defaultConfig = { account_type: "Current" };

      setEditingLookup({
        type: currentLookupType,
        name: "",
        code: "",
        description: "",
        config: defaultConfig,
        is_active: true,
      });
      setIsLookupModalOpen(true);
    }
  };

  const getTabLabel = (tab: MasterTab): string => {
    switch (tab) {
      case "products":
        return "Products";
      case "batches":
        return "Batches";
      case "parties":
        return "Parties";
      case "units":
        return "Units";
      case "groups":
        return "Categories";
      case "brands":
        return "Brands";
      case "manufacturers":
        return "Manufacturers";
      case "discounts":
        return "Discounts";
      case "tax_rates":
        return "Tax & HSN";
      case "expense_heads":
        return "Expense Heads";
      case "banks":
        return "Bank Accounts";
    }
  };

  return (
    <div className="space-y-5">
      {/* Toast Alert */}
      {notification && (
        <div
          className={`fixed right-6 top-16 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 shadow-xl text-xs font-semibold animate-in fade-in transition-all ${
            notification.type === "success"
              ? "bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-200"
              : "bg-red-50 border-red-300 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-200"
          }`}
        >
          {notification.type === "success" ? (
            <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Master Data Repository
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Comprehensive catalog configuration: SKUs, batches, parties, statutory taxes, UOM, and business lookups.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {hasPermission("masters", "create") && (
            <>
              {activeTab === "products" && (
                <>
                  <button
                    onClick={() => setIsImportModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200 shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-700/60"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Import CSV</span>
                  </button>

                  <button
                    onClick={() => setIsMergeModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-xl text-purple-700 dark:text-purple-300 shadow-2xs hover:bg-purple-50 dark:hover:bg-purple-950/40"
                  >
                    <Merge className="w-3.5 h-3.5" />
                    <span>Merge Duplicates</span>
                  </button>

                  {selectedProductIds.length > 0 && (
                    <button
                      onClick={() => setIsBulkEditOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800 text-xs font-bold rounded-xl text-purple-700 dark:text-purple-300 shadow-2xs"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>Bulk Edit ({selectedProductIds.length})</span>
                    </button>
                  )}
                </>
              )}

              {activeTab === "parties" && (
                <button
                  onClick={() => setIsMergeModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-xl text-purple-700 dark:text-purple-300 shadow-2xs hover:bg-purple-50 dark:hover:bg-purple-950/40"
                >
                  <Merge className="w-3.5 h-3.5" />
                  <span>Merge Parties</span>
                </button>
              )}

              <button
                onClick={handleAddNew}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl shadow-sm transition"
              >
                <Plus className="w-4 h-4" />
                <span>Add {getTabLabel(activeTab).slice(0, -1) || getTabLabel(activeTab)}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs Navigation Bar */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none text-xs font-semibold">
          {[
            { id: "products", label: "Products / SKUs", icon: Package },
            { id: "batches", label: "Batches Registry", icon: Layers },
            { id: "parties", label: "Parties & Ledgers", icon: Users2 },
            { id: "units", label: "Units of Measure", icon: Scale },
            { id: "groups", label: "Categories / Groups", icon: Tag },
            { id: "brands", label: "Brands", icon: Award },
            { id: "manufacturers", label: "Manufacturers", icon: Building2 },
            { id: "discounts", label: "Discount Schemas", icon: Percent },
            { id: "tax_rates", label: "Tax & HSN Slabs", icon: Receipt },
            { id: "expense_heads", label: "Expense Heads", icon: Wallet },
            { id: "banks", label: "Bank Accounts", icon: Landmark },
          ].map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id as MasterTab)}
                className={`whitespace-nowrap px-3 py-2 rounded-xl flex items-center gap-2 transition-all font-semibold ${
                  isSelected
                    ? "bg-brand-600 text-white shadow-sm font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub Toolbar & Search & Filters */}
      <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search in ${getTabLabel(activeTab)}...`}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-brand-500"
          />
        </div>

        {/* Dynamic Toolbar filters based on tab */}
        {activeTab === "parties" && (
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl self-start sm:self-auto overflow-x-auto">
            {availablePartyTypes.map((type) => (
              <button
                key={type}
                onClick={() => {
                  setPartyType(type);
                  setPartyPage(1);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition ${
                  partyType === type
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
                }`}
              >
                {type}s
              </button>
            ))}
          </div>
        )}

        {activeTab === "batches" && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={batchExpiringOnly}
                onChange={(e) => setBatchExpiringOnly(e.target.checked)}
                className="rounded text-brand-600"
              />
              <span>Expiring Soon (&lt; 90 days)</span>
            </label>
          </div>
        )}

        <button
          onClick={fetchData}
          className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
          title="Refresh table"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ---------------------------------------------------------------------------------- */}
      {/* 1. PRODUCTS TABLE                                                                  */}
      {/* ---------------------------------------------------------------------------------- */}
      {activeTab === "products" && (
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
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      Loading catalog products...
                    </td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
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
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            p.is_active
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          }`}
                        >
                          {p.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => {
                              setEditingProduct(p);
                              setIsProductModalOpen(true);
                            }}
                            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40 rounded-lg"
                            title="Edit Product"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {hasPermission("masters", "delete") && (
                            <button
                              onClick={() => confirmDeleteProduct(p)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg"
                              title="Delete Product"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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

          {/* Product Pagination Footer */}
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <span>
                Showing page <strong className="text-slate-800 dark:text-slate-200 font-semibold">{productPage}</strong> of{" "}
                <strong className="text-slate-800 dark:text-slate-200 font-semibold">{productTotalPages}</strong> ({productTotalCount.toLocaleString()} products)
              </span>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <div className="flex items-center gap-1.5">
                <span>Per page:</span>
                <select
                  value={productPerPage}
                  onChange={(e) => {
                    setProductPerPage(Number(e.target.value));
                    setProductPage(1);
                  }}
                  className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 font-medium"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setProductPage((p) => Math.max(1, p - 1))}
                disabled={productPage <= 1 || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50 dark:hover:bg-slate-700/60 transition shadow-2xs"
              >
                Previous
              </button>
              <button
                onClick={() => setProductPage((p) => Math.min(productTotalPages, p + 1))}
                disabled={productPage >= productTotalPages || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50 dark:hover:bg-slate-700/60 transition shadow-2xs"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------------------- */}
      {/* 2. BATCHES TABLE                                                                   */}
      {/* ---------------------------------------------------------------------------------- */}
      {activeTab === "batches" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Batch Number</th>
                  <th className="px-4 py-3">Product Name & Barcode</th>
                  <th className="px-4 py-3">Expiry Date</th>
                  <th className="px-4 py-3 text-right">Stock Qty</th>
                  <th className="px-4 py-3 text-right">MRP</th>
                  <th className="px-4 py-3 text-right">Selling Rate</th>
                  <th className="px-4 py-3">Location (Rack/Shelf)</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      Loading batches...
                    </td>
                  </tr>
                ) : batches.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      No batch records found.
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => {
                    const isExpired = new Date(b.expiry_date) < new Date();
                    const isNearExpiry = !isExpired && new Date(b.expiry_date) <= new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
                    return (
                      <tr key={b.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                          {b.batch_no}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 dark:text-white">{b.product?.name || `Product #${b.product_id}`}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{b.product?.barcode || "No barcode"}</div>
                        </td>
                        <td className="px-4 py-3 font-mono">
                          <div>{formatDate(b.expiry_date)}</div>
                          {isExpired ? (
                            <span className="text-[10px] text-red-600 font-bold">Expired</span>
                          ) : isNearExpiry ? (
                            <span className="text-[10px] text-amber-600 font-bold">Near Expiry</span>
                          ) : (
                            <span className="text-[10px] text-slate-400 font-sans">Good Shelf Life</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                          {formatIndianNumber(b.stock_qty)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{formatINR(b.mrp)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold">{formatINR(b.selling_rate)}</td>
                        <td className="px-4 py-3 text-slate-500 font-mono">
                          {b.rack_location || b.shelf_location ? `${b.rack_location || "—"} / ${b.shelf_location || "—"}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => {
                                setEditingBatch(b);
                                setIsBatchModalOpen(true);
                              }}
                              className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40 rounded-lg"
                              title="Edit Batch"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {hasPermission("masters", "delete") && (
                              <button
                                onClick={() => confirmDeleteBatch(b)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg"
                                title="Delete Batch"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Batch Pagination Footer */}
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between text-xs text-slate-500">
            <div>
              Showing page <strong>{batchPage}</strong> of <strong>{batchTotalPages}</strong> ({batchTotalCount.toLocaleString()} batches)
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setBatchPage((p) => Math.max(1, p - 1))}
                disabled={batchPage <= 1 || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 font-semibold"
              >
                Previous
              </button>
              <button
                onClick={() => setBatchPage((p) => Math.min(batchTotalPages, p + 1))}
                disabled={batchPage >= batchTotalPages || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 font-semibold"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------------------- */}
      {/* 3. PARTIES TABLE                                                                   */}
      {/* ---------------------------------------------------------------------------------- */}
      {activeTab === "parties" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Party Name</th>
                  <th className="px-4 py-3">Phone & GSTIN</th>
                  <th className="px-4 py-3">Address</th>
                  <th className="px-4 py-3 text-right">Credit Limit</th>
                  <th className="px-4 py-3 text-right">Ledger Balance</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      Loading {partyType} records...
                    </td>
                  </tr>
                ) : parties.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
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
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            pt.is_active
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          }`}
                        >
                          {pt.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {(pt.type === "customer" || pt.type === "supplier") && (
                            <button
                              onClick={() => openLedger(pt)}
                              className="px-2 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg transition mr-1"
                              title="View Ledger Statement"
                            >
                              Ledger
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setEditingParty(pt);
                              setIsPartyModalOpen(true);
                            }}
                            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40 rounded-lg"
                            title="Edit Party"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {hasPermission("masters", "delete") && (
                            <button
                              onClick={() => confirmDeleteParty(pt)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg"
                              title="Delete Party"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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

          {/* Party Pagination Footer */}
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between text-xs text-slate-500">
            <div>
              Showing page <strong>{partyPage}</strong> of <strong>{partyTotalPages}</strong> ({partyTotalCount.toLocaleString()} {partyType}s)
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPartyPage((p) => Math.max(1, p - 1))}
                disabled={partyPage <= 1 || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 font-semibold"
              >
                Previous
              </button>
              <button
                onClick={() => setPartyPage((p) => Math.min(partyTotalPages, p + 1))}
                disabled={partyPage >= partyTotalPages || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 font-semibold"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------------------- */}
      {/* 4. GENERIC LOOKUPS TABLE (Units, Groups, Brands, Mfg, Discounts, Tax, Expenses, Banks) */}
      {/* ---------------------------------------------------------------------------------- */}
      {currentLookupType && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Record Name</th>
                  <th className="px-4 py-3">Code / Identifier</th>
                  <th className="px-4 py-3">Configuration & Details</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      Loading {getTabLabel(activeTab)} records...
                    </td>
                  </tr>
                ) : lookups.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No {getTabLabel(activeTab)} records found.
                    </td>
                  </tr>
                ) : (
                  lookups.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                        {l.name}
                      </td>
                      <td className="px-4 py-3 font-mono font-medium text-slate-700 dark:text-slate-300">
                        {l.code || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                        {activeTab === "units" && `Precision: ${l.config?.precision ?? 0} decimal(s)`}
                        {activeTab === "discounts" && (
                          <span>
                            Type: <strong className="capitalize">{l.config?.rule_type || "percentage"}</strong> | {l.config?.discount_percent ?? 0}%
                            {l.config?.min_quantity ? ` (Min Qty: ${l.config.min_quantity})` : ""}
                          </span>
                        )}
                        {activeTab === "tax_rates" && `Tax Rate: ${l.config?.tax_percent ?? 12}%`}
                        {activeTab === "banks" && (
                          <span>
                            A/C: {l.config?.account_no || "—"} | IFSC: {l.config?.ifsc || "—"} | {l.config?.account_type || "Current"}
                          </span>
                        )}
                        {!["units", "discounts", "tax_rates", "banks"].includes(activeTab) && (
                          l.config ? JSON.stringify(l.config) : "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 truncate max-w-xs">{l.description || "—"}</td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            l.is_active
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          }`}
                        >
                          {l.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => {
                              setEditingLookup(l);
                              setIsLookupModalOpen(true);
                            }}
                            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40 rounded-lg"
                            title="Edit Record"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {hasPermission("masters", "delete") && (
                            <button
                              onClick={() => confirmDeleteLookup(l)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg"
                              title="Delete Record"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
      )}

      {/* ---------------------------------------------------------------------------------- */}
      {/* MODAL 1: PRODUCT EDIT / CREATE                                                     */}
      {/* ---------------------------------------------------------------------------------- */}
      {isProductModalOpen && editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                {editingProduct.id ? `Edit Product: ${editingProduct.name}` : "Create Catalog Product SKU"}
              </h3>
              <button
                onClick={() => setIsProductModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Product / Brand Item Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingProduct.name || ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                    placeholder="e.g. Dolo 650mg Strip of 15"
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
                    placeholder="8901234567890"
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
                    Generic / Formulation Name
                  </label>
                  <input
                    type="text"
                    value={editingProduct.generic_name || ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, generic_name: e.target.value })}
                    placeholder="Paracetamol 650mg"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Primary Unit
                  </label>
                  <select
                    value={editingProduct.unit_id || ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, unit_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Select Unit...</option>
                    {unitLookups.map((u) => (
                      <option key={u.id} value={u.name}>
                        {u.name} ({u.code || u.name})
                      </option>
                    ))}
                    <option value="Strip">Strip</option>
                    <option value="Box">Box</option>
                    <option value="Bottle">Bottle</option>
                    <option value="Tablet">Tablet</option>
                    <option value="Nos">Nos</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Category / Group
                  </label>
                  <select
                    value={editingProduct.category_id || ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, category_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Select Category...</option>
                    {groupLookups.map((g) => (
                      <option key={g.id} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Brand
                  </label>
                  <select
                    value={editingProduct.brand_id || ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, brand_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Select Brand...</option>
                    {brandLookups.map((b) => (
                      <option key={b.id} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
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
                    Purchase Rate / PTR (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingProduct.ptr ?? 0}
                    onChange={(e) => setEditingProduct({ ...editingProduct, ptr: Number(e.target.value) })}
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
                    Units Per Pack
                  </label>
                  <input
                    type="number"
                    value={editingProduct.units_per_pack ?? 1}
                    onChange={(e) => setEditingProduct({ ...editingProduct, units_per_pack: Number(e.target.value) })}
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

              {!editingProduct.id && (
                <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-2">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block">Initial SKU Batch (Optional)</span>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Batch No</label>
                      <input
                        type="text"
                        value={initialBatchData.batch_no}
                        onChange={(e) => setInitialBatchData({ ...initialBatchData, batch_no: e.target.value })}
                        className="w-full px-2 py-1 font-mono rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Expiry Date</label>
                      <input
                        type="date"
                        value={initialBatchData.expiry_date}
                        onChange={(e) => setInitialBatchData({ ...initialBatchData, expiry_date: e.target.value })}
                        className="w-full px-2 py-1 font-mono rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Stock Quantity</label>
                      <input
                        type="number"
                        value={initialBatchData.stock_qty}
                        onChange={(e) => setInitialBatchData({ ...initialBatchData, stock_qty: Number(e.target.value) })}
                        className="w-full px-2 py-1 font-mono rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-800"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="prod_active"
                  checked={editingProduct.is_active ?? true}
                  onChange={(e) => setEditingProduct({ ...editingProduct, is_active: e.target.checked })}
                  className="rounded text-brand-600"
                />
                <label htmlFor="prod_active" className="text-slate-700 dark:text-slate-300 font-medium">
                  Active in billing catalog
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl font-medium"
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

      {/* ---------------------------------------------------------------------------------- */}
      {/* MODAL 2: BATCH EDIT / CREATE                                                       */}
      {/* ---------------------------------------------------------------------------------- */}
      {isBatchModalOpen && editingBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                {editingBatch.id ? `Edit Batch: ${editingBatch.batch_no}` : "Add Product Batch"}
              </h3>
              <button
                onClick={() => setIsBatchModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBatch} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Target Product *
                </label>
                <select
                  required
                  disabled={Boolean(editingBatch.id)}
                  value={editingBatch.product_id || ""}
                  onChange={(e) => {
                    const pid = Number(e.target.value);
                    const prod = products.find((p) => p.id === pid);
                    setEditingBatch({
                      ...editingBatch,
                      product_id: pid,
                      mrp: prod?.mrp || editingBatch.mrp || 0,
                      selling_rate: prod?.sel_rate || editingBatch.selling_rate || 0,
                      purchase_rate: prod?.ptr || editingBatch.purchase_rate || 0,
                    });
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white disabled:opacity-60"
                >
                  <option value="">Select Product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.barcode || "No barcode"})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Batch Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingBatch.batch_no || ""}
                    onChange={(e) => setEditingBatch({ ...editingBatch, batch_no: e.target.value.toUpperCase() })}
                    placeholder="e.g. BAT-2026-X"
                    className="w-full px-3 py-2 font-mono uppercase rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Expiry Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={editingBatch.expiry_date ? editingBatch.expiry_date.slice(0, 10) : ""}
                    onChange={(e) => setEditingBatch({ ...editingBatch, expiry_date: e.target.value })}
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Stock Quantity *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={editingBatch.stock_qty ?? 0}
                    onChange={(e) => setEditingBatch({ ...editingBatch, stock_qty: Number(e.target.value) })}
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
                    value={editingBatch.mrp ?? 0}
                    onChange={(e) => setEditingBatch({ ...editingBatch, mrp: Number(e.target.value) })}
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
                    value={editingBatch.selling_rate ?? 0}
                    onChange={(e) => setEditingBatch({ ...editingBatch, selling_rate: Number(e.target.value) })}
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Purchase Rate (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingBatch.purchase_rate ?? 0}
                    onChange={(e) => setEditingBatch({ ...editingBatch, purchase_rate: Number(e.target.value) })}
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Rack Location
                  </label>
                  <input
                    type="text"
                    value={editingBatch.rack_location || ""}
                    onChange={(e) => setEditingBatch({ ...editingBatch, rack_location: e.target.value })}
                    placeholder="e.g. Rack A"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Shelf Location
                  </label>
                  <input
                    type="text"
                    value={editingBatch.shelf_location || ""}
                    onChange={(e) => setEditingBatch({ ...editingBatch, shelf_location: e.target.value })}
                    placeholder="e.g. Shelf 2"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsBatchModalOpen(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl shadow-sm"
                >
                  Save Batch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------------------- */}
      {/* MODAL 3: PARTY EDIT / CREATE                                                       */}
      {/* ---------------------------------------------------------------------------------- */}
      {isPartyModalOpen && editingParty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                {editingParty.id ? `Edit ${editingParty.type}: ${editingParty.name}` : `Create New ${partyType}`}
              </h3>
              <button
                onClick={() => setIsPartyModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveParty} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Party Type *
                  </label>
                  <select
                    disabled={Boolean(editingParty.id)}
                    value={editingParty.type || partyType}
                    onChange={(e) => setEditingParty({ ...editingParty, type: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white capitalize"
                  >
                    {availablePartyTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingParty.name || ""}
                    onChange={(e) => setEditingParty({ ...editingParty, name: e.target.value })}
                    placeholder="Party / Business Name"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Mobile Phone
                  </label>
                  <input
                    type="text"
                    value={editingParty.phone || ""}
                    onChange={(e) => setEditingParty({ ...editingParty, phone: e.target.value })}
                    placeholder="10-digit mobile"
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    GSTIN
                  </label>
                  <input
                    type="text"
                    value={editingParty.gstin || ""}
                    onChange={(e) => setEditingParty({ ...editingParty, gstin: e.target.value.toUpperCase() })}
                    placeholder="15-digit GSTIN"
                    className="w-full px-3 py-2 font-mono uppercase rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Billing / Shipping Address
                  </label>
                  <input
                    type="text"
                    value={editingParty.address || ""}
                    onChange={(e) => setEditingParty({ ...editingParty, address: e.target.value })}
                    placeholder="Address, City, PIN"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Credit Limit (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingParty.credit_limit ?? 0}
                    onChange={(e) => setEditingParty({ ...editingParty, credit_limit: Number(e.target.value) })}
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                {!editingParty.id && (
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Opening Balance (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingParty.opening_balance ?? 0}
                      onChange={(e) => setEditingParty({ ...editingParty, opening_balance: Number(e.target.value) })}
                      className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                )}

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Registration No / MRN
                  </label>
                  <input
                    type="text"
                    value={editingParty.reg_no || ""}
                    onChange={(e) => setEditingParty({ ...editingParty, reg_no: e.target.value })}
                    placeholder="Doctor Reg / Patient MRN"
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="party_active"
                  checked={editingParty.is_active ?? true}
                  onChange={(e) => setEditingParty({ ...editingParty, is_active: e.target.checked })}
                  className="rounded text-brand-600"
                />
                <label htmlFor="party_active" className="text-slate-700 dark:text-slate-300 font-medium">
                  Active party
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsPartyModalOpen(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl shadow-sm"
                >
                  Save Party
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------------------- */}
      {/* MODAL 4: LOOKUP EDIT / CREATE (Tailored for all 8 lookup types)                      */}
      {/* ---------------------------------------------------------------------------------- */}
      {isLookupModalOpen && editingLookup && currentLookupType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                {editingLookup.id ? `Edit ${getTabLabel(activeTab).slice(0, -1)}` : `Create ${getTabLabel(activeTab).slice(0, -1)}`}
              </h3>
              <button
                onClick={() => setIsLookupModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveLookup} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Name / Label *
                </label>
                <input
                  type="text"
                  required
                  value={editingLookup.name || ""}
                  onChange={(e) => setEditingLookup({ ...editingLookup, name: e.target.value })}
                  placeholder={`e.g. ${
                    activeTab === "units"
                      ? "Strip"
                      : activeTab === "groups"
                      ? "Antibiotics"
                      : activeTab === "brands"
                      ? "Cipla"
                      : activeTab === "discounts"
                      ? "Bulk Wholesale 5%"
                      : activeTab === "tax_rates"
                      ? "Pharma Standard 12%"
                      : activeTab === "expense_heads"
                      ? "Shop Electricity"
                      : "HDFC Current Account"
                  }`}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {activeTab === "units"
                    ? "Symbol (e.g. STP)"
                    : activeTab === "tax_rates"
                    ? "HSN / SAC Code (e.g. 3004)"
                    : activeTab === "banks"
                    ? "Bank IFSC Code"
                    : "Code / Short Name"}
                </label>
                <input
                  type="text"
                  value={editingLookup.code || ""}
                  onChange={(e) => setEditingLookup({ ...editingLookup, code: e.target.value.toUpperCase() })}
                  placeholder="Code"
                  className="w-full px-3 py-2 font-mono uppercase rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {/* Type-specific Fields */}
              {activeTab === "units" && (
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Decimal Precision (0-4)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="4"
                    value={editingLookup.config?.precision ?? 0}
                    onChange={(e) =>
                      setEditingLookup({
                        ...editingLookup,
                        config: { ...editingLookup.config, precision: Number(e.target.value) },
                      })
                    }
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              )}

              {activeTab === "discounts" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Rule Type
                    </label>
                    <select
                      value={editingLookup.config?.rule_type || "percentage"}
                      onChange={(e) =>
                        setEditingLookup({
                          ...editingLookup,
                          config: { ...editingLookup.config, rule_type: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white capitalize"
                    >
                      <option value="percentage">Percentage (%)</option>
                      <option value="buy_x_get_y">Buy X Get Y Free</option>
                      <option value="customer_type">Customer Type</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Discount %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingLookup.config?.discount_percent ?? 5}
                      onChange={(e) =>
                        setEditingLookup({
                          ...editingLookup,
                          config: { ...editingLookup.config, discount_percent: Number(e.target.value) },
                        })
                      }
                      className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Minimum Quantity
                    </label>
                    <input
                      type="number"
                      value={editingLookup.config?.min_quantity ?? 1}
                      onChange={(e) =>
                        setEditingLookup({
                          ...editingLookup,
                          config: { ...editingLookup.config, min_quantity: Number(e.target.value) },
                        })
                      }
                      className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>
              )}

              {activeTab === "tax_rates" && (
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    GST Tax Percent (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={editingLookup.config?.tax_percent ?? 12}
                    onChange={(e) =>
                      setEditingLookup({
                        ...editingLookup,
                        config: { ...editingLookup.config, tax_percent: Number(e.target.value) },
                      })
                    }
                    className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              )}

              {activeTab === "banks" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Account Number
                    </label>
                    <input
                      type="text"
                      value={editingLookup.config?.account_no || ""}
                      onChange={(e) =>
                        setEditingLookup({
                          ...editingLookup,
                          config: { ...editingLookup.config, account_no: e.target.value },
                        })
                      }
                      placeholder="e.g. 50200012345678"
                      className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Branch Name
                    </label>
                    <input
                      type="text"
                      value={editingLookup.config?.branch || ""}
                      onChange={(e) =>
                        setEditingLookup({
                          ...editingLookup,
                          config: { ...editingLookup.config, branch: e.target.value },
                        })
                      }
                      placeholder="e.g. Main Branch"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Account Type
                    </label>
                    <select
                      value={editingLookup.config?.account_type || "Current"}
                      onChange={(e) =>
                        setEditingLookup({
                          ...editingLookup,
                          config: { ...editingLookup.config, account_type: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="Current">Current</option>
                      <option value="Savings">Savings</option>
                      <option value="OD">Overdraft (OD)</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Description / Notes
                </label>
                <textarea
                  rows={2}
                  value={editingLookup.description || ""}
                  onChange={(e) => setEditingLookup({ ...editingLookup, description: e.target.value })}
                  placeholder="Optional description"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="lookup_active"
                  checked={editingLookup.is_active ?? true}
                  onChange={(e) => setEditingLookup({ ...editingLookup, is_active: e.target.checked })}
                  className="rounded text-brand-600"
                />
                <label htmlFor="lookup_active" className="text-slate-700 dark:text-slate-300 font-medium">
                  Active in system lookups
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsLookupModalOpen(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl shadow-sm"
                >
                  Save Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------------------- */}
      {/* BULK EDIT MODAL                                                                    */}
      {/* ---------------------------------------------------------------------------------- */}
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

      {/* ---------------------------------------------------------------------------------- */}
      {/* MERGE DUPLICATES MODAL                                                             */}
      {/* ---------------------------------------------------------------------------------- */}
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

      {/* ---------------------------------------------------------------------------------- */}
      {/* CSV IMPORT MODAL                                                                   */}
      {/* ---------------------------------------------------------------------------------- */}
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

      {/* ---------------------------------------------------------------------------------- */}
      {/* PARTY LEDGER STATEMENT MODAL                                                       */}
      {/* ---------------------------------------------------------------------------------- */}
      {selectedLedgerParty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-3xl w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  {selectedLedgerParty.name} — Ledger Statement
                </h3>
                <p className="text-xs text-slate-400 capitalize">
                  {selectedLedgerParty.type} | Phone: {selectedLedgerParty.phone || "—"} | GSTIN: {selectedLedgerParty.gstin || "Unregistered"}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedLedgerParty(null);
                  setLedgerData(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Opening Balance</span>
                <div className="text-sm font-bold font-mono">
                  {formatINR(ledgerData?.opening_balance ?? selectedLedgerParty.opening_balance)}
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Current Outstanding Balance</span>
                <div className="text-sm font-bold font-mono text-brand-600 dark:text-brand-400">
                  {formatINR(ledgerData?.current_balance ?? selectedLedgerParty.current_balance)}
                </div>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
              <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold sticky top-0 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Document Type</th>
                    <th className="px-3 py-2">Doc Number</th>
                    <th className="px-3 py-2 text-right">Debit (₹)</th>
                    <th className="px-3 py-2 text-right">Credit (₹)</th>
                    <th className="px-3 py-2 text-right">Balance (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                  {isLedgerLoading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400 font-sans">
                        Loading ledger transactions...
                      </td>
                    </tr>
                  ) : !ledgerData?.transactions?.length ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400 font-sans">
                        No transactions found for this party.
                      </td>
                    </tr>
                  ) : (
                    ledgerData.transactions.map((tx: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2 text-[11px] font-sans">{tx.doc_date}</td>
                        <td className="px-3 py-2 font-sans font-medium">{tx.type}</td>
                        <td className="px-3 py-2 font-bold text-slate-900 dark:text-white">{tx.doc_number}</td>
                        <td className="px-3 py-2 text-right text-red-600">{tx.debit > 0 ? formatINR(tx.debit) : "—"}</td>
                        <td className="px-3 py-2 text-right text-emerald-600">{tx.credit > 0 ? formatINR(tx.credit) : "—"}</td>
                        <td className="px-3 py-2 text-right font-bold">{formatINR(tx.running_balance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => {
                  setSelectedLedgerParty(null);
                  setLedgerData(null);
                }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-300"
              >
                Close Statement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------------------- */}
      {/* DELETE CONFIRMATION MODAL                                                          */}
      {/* ---------------------------------------------------------------------------------- */}
      <ConfirmModal
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={() => {
          deleteConfirm.onConfirm();
        }}
        title={deleteConfirm.title}
        message={deleteConfirm.message}
        confirmText={deleteConfirm.actionName}
        requireReason={false}
        danger={true}
      />

      {/* ---------------------------------------------------------------------------------- */}
      {/* CONFLICT MODAL                                                                     */}
      {/* ---------------------------------------------------------------------------------- */}
      <ConflictModal
        isOpen={conflictState.isOpen}
        onClose={() => setConflictState({ isOpen: false })}
        onReload={() => {
          setConflictState({ isOpen: false });
          fetchData();
        }}
        currentVersion={conflictState.currentVersion}
        clientVersion={conflictState.clientVersion}
      />
    </div>
  );
};

import React, { useState, useEffect } from "react";
import {
  Database,
  Plus,
  Search,
  Package,
  Users,
  Percent,
  CheckCircle,
  AlertCircle,
  X,
  Edit2,
  Trash2,
  Tag,
  ShieldCheck,
  Building2,
  Layers,
  Upload,
  Download,
} from "lucide-react";
import { productsStore, type ProductItem, type ProductBatch } from "../lib/masters/productsStore";
import { useModalEscape } from "../lib/ui/modalEscapeManager";
import {
  partiesStore,
  type Customer,
  type Supplier,
  type Doctor,
  type Patient,
  type PartyMaster,
  isValidGstin,
  isValidIndianPhone,
  normalizeIndianPhone,
} from "../lib/masters/partiesStore";
import { discountSchemaEngine, type DiscountRule } from "../lib/masters/discountSchemaEngine";
import { sqliteStorage } from "../lib/db/sqliteStorage";
import { ImportWizardModal } from "../lib/data-exchange/ui/ImportWizardModal";
import { ExportDialogModal } from "../lib/data-exchange/ui/ExportDialogModal";

export const MastersPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"products" | "batches" | "parties" | "discounts">("products");
  const [searchQuery, setSearchQuery] = useState("");
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [importEntityId, setImportEntityId] = useState<string | null>(null);
  const [exportEntityId, setExportEntityId] = useState<string | null>(null);

  // Products state
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  useModalEscape(isProductModalOpen, () => setIsProductModalOpen(false));
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);

  // Batches state
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [selectedProductIdForBatches, setSelectedProductIdForBatches] = useState<string>("");
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  useModalEscape(isBatchModalOpen, () => setIsBatchModalOpen(false));
  const [editingBatch, setEditingBatch] = useState<ProductBatch | null>(null);

  // Parties state
  const [partyTypeFilter, setPartyTypeFilter] = useState<"all" | "customer" | "supplier" | "doctor" | "patient">("all");
  const [parties, setParties] = useState<PartyMaster[]>([]);
  const [isPartyModalOpen, setIsPartyModalOpen] = useState(false);
  useModalEscape(isPartyModalOpen, () => setIsPartyModalOpen(false));
  const [editingParty, setEditingParty] = useState<PartyMaster | null>(null);

  // Discount rules state
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>([]);
  const [isDiscountModalOpen, setIsDiscountModalOpen] = useState(false);
  useModalEscape(isDiscountModalOpen, () => setIsDiscountModalOpen(false));

  // Product Form state
  const [prodForm, setProdForm] = useState<Partial<ProductItem>>({
    name: "",
    barcode: "",
    hsn_sac_code: "30049099",
    mrp: 0,
    sel_rate: 0,
    ptr: 0,
    pts: 0,
    gst_percent: 12,
    units_per_pack: 1,
    generic_name: "",
    rack_location: "",
    shelf_location: "",
    reorder_level: 10,
    current_stock: 0,
    is_active: true,
  });

  // Batch Form state
  const [batchForm, setBatchForm] = useState<Partial<ProductBatch>>({
    product_id: "",
    batch_no: "",
    expiry_date: "",
    stock_qty: 0,
    mrp: 0,
    purchase_rate: 0,
    selling_rate: 0,
    rack_location: "",
    shelf_location: "",
  });

  // Party Form state
  const [partyForm, setPartyForm] = useState<Partial<PartyMaster>>({
    type: "customer",
    name: "",
    phone: "",
    gstin: "",
    address: "",
    credit_limit: 5000,
    credit_period_days: 30,
    is_active: true,
  });

  // Discount Form state
  const [discForm, setDiscForm] = useState<Partial<DiscountRule>>({
    rule_id: "",
    name: "",
    rule_type: "percentage",
    discount_percent: 5,
    min_quantity: 1,
    is_active: true,
  });

  const showNotification = (message: string, type: "success" | "error" = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const loadData = async () => {
    try {
      const prods = await sqliteStorage.findAll<ProductItem>("products");
      setProducts(prods);

      const allBatches = await sqliteStorage.findAll<ProductBatch>("product_batches");
      setBatches(allBatches);

      const allParties = await partiesStore.getAllParties();
      setParties(allParties);

      const rules = discountSchemaEngine.getAllRules();
      setDiscountRules(rules);
    } catch (err) {
      console.error("Error loading master data:", err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filtered lists
  const filteredProducts = products.filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.barcode.includes(q) ||
      (p.generic_name && p.generic_name.toLowerCase().includes(q)) ||
      (p.hsn_sac_code && p.hsn_sac_code.includes(q))
    );
  });

  const filteredBatches = batches.filter((b) => {
    if (selectedProductIdForBatches && b.product_id !== selectedProductIdForBatches) return false;
    if (!searchQuery) return true;
    return b.batch_no.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const filteredParties = parties.filter((p) => {
    if (partyTypeFilter !== "all" && p.type !== partyTypeFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.phone && p.phone.includes(q)) ||
      (p.gstin && p.gstin.toLowerCase().includes(q))
    );
  });

  // Save Product
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodForm.name || !prodForm.barcode) {
      showNotification("Product name and Barcode are required", "error");
      return;
    }

    const item: ProductItem = {
      id: editingProduct ? editingProduct.id : `prod_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      name: prodForm.name,
      print_name: prodForm.print_name || prodForm.name,
      barcode: prodForm.barcode.trim(),
      secondary_barcodes: prodForm.secondary_barcodes || [],
      hsn_sac_code: prodForm.hsn_sac_code || "30049099",
      mrp: Number(prodForm.mrp) || 0,
      sel_rate: Number(prodForm.sel_rate) || 0,
      ptr: Number(prodForm.ptr) || 0,
      pts: Number(prodForm.pts) || 0,
      gst_percent: Number(prodForm.gst_percent) || 0,
      units_per_pack: Number(prodForm.units_per_pack) || 1,
      generic_name: prodForm.generic_name || "",
      rack_location: prodForm.rack_location || "",
      shelf_location: prodForm.shelf_location || "",
      reorder_level: Number(prodForm.reorder_level) || 0,
      current_stock: Number(prodForm.current_stock) || 0,
      is_active: prodForm.is_active ?? true,
    };

    await productsStore.upsertProduct(item, true);
    showNotification(`Product "${item.name}" saved successfully`);
    setIsProductModalOpen(false);
    setEditingProduct(null);
    loadData();
  };

  // Save Batch
  const handleSaveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchForm.product_id || !batchForm.batch_no || !batchForm.expiry_date) {
      showNotification("Product, Batch Number, and Expiry Date (YYYY-MM) are required", "error");
      return;
    }

    const batch: ProductBatch = {
      id: editingBatch ? editingBatch.id : `batch_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      product_id: batchForm.product_id,
      batch_no: batchForm.batch_no.trim().toUpperCase(),
      expiry_date: batchForm.expiry_date,
      stock_qty: Number(batchForm.stock_qty) || 0,
      mrp: Number(batchForm.mrp) || 0,
      purchase_rate: Number(batchForm.purchase_rate) || 0,
      selling_rate: Number(batchForm.selling_rate) || 0,
      rack_location: batchForm.rack_location || "",
      shelf_location: batchForm.shelf_location || "",
    };

    await productsStore.upsertBatch(batch, true);
    showNotification(`Batch "${batch.batch_no}" saved successfully`);
    setIsBatchModalOpen(false);
    setEditingBatch(null);
    loadData();
  };

  // Save Party
  const handleSaveParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyForm.name) {
      showNotification("Party Name is required", "error");
      return;
    }

    if (partyForm.phone && !isValidIndianPhone(partyForm.phone)) {
      showNotification("Invalid Indian 10-digit mobile phone number", "error");
      return;
    }

    if (partyForm.gstin && !isValidGstin(partyForm.gstin)) {
      showNotification("Invalid 15-character GSTIN format", "error");
      return;
    }

    const party: PartyMaster = {
      id: editingParty ? editingParty.id : `party_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      type: partyForm.type || "customer",
      name: partyForm.name.trim(),
      phone: partyForm.phone ? normalizeIndianPhone(partyForm.phone) : "",
      gstin: partyForm.gstin ? partyForm.gstin.trim().toUpperCase() : undefined,
      address: partyForm.address || "",
      outstanding_balance: Number(partyForm.outstanding_balance) || 0,
      credit_limit: Number(partyForm.credit_limit) || 0,
      credit_period_days: Number(partyForm.credit_period_days) || 0,
      medical_reg_no: partyForm.medical_reg_no || "",
      clinic_name: partyForm.clinic_name || "",
      age: partyForm.age,
      gender: partyForm.gender,
      is_active: partyForm.is_active ?? true,
    };

    await partiesStore.upsertParty(party);
    showNotification(`Party "${party.name}" saved successfully`);
    setIsPartyModalOpen(false);
    setEditingParty(null);
    loadData();
  };

  // Save Discount Rule
  const handleSaveDiscountRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!discForm.name || !discForm.rule_type) {
      showNotification("Rule Name is required", "error");
      return;
    }

    const rule: DiscountRule = {
      rule_id: `disc_${Date.now()}`,
      name: discForm.name,
      rule_type: discForm.rule_type as "percentage" | "buy_x_get_y" | "customer_type",
      discount_percent: Number(discForm.discount_percent) || 0,
      min_quantity: Number(discForm.min_quantity) || 1,
      free_quantity: Number(discForm.free_quantity) || 0,
      is_active: discForm.is_active ?? true,
    };

    discountSchemaEngine.registerRule(rule);
    showNotification(`Discount schema "${rule.name}" added`);
    setIsDiscountModalOpen(false);
    loadData();
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toast Alert */}
      {notification && (
        <div
          className={`fixed right-6 top-16 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 shadow-lg text-sm transition-all ${
            notification.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {notification.type === "success" ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}

      {/* Header bar */}
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">Master Data Management</h1>
            <p className="text-xs text-slate-500">Products, barcodes, batches, parties, and discount schemas</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const entity =
                  activeTab === "products"
                    ? "items"
                    : activeTab === "batches"
                    ? "batches"
                    : activeTab === "parties"
                    ? "customers"
                    : "discount_schemas";
                setImportEntityId(entity);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition-colors shadow-2xs cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Import Wizard (Excel/CSV)</span>
            </button>
            <button
              onClick={() => {
                const entity =
                  activeTab === "products"
                    ? "items"
                    : activeTab === "batches"
                    ? "batches"
                    : activeTab === "parties"
                    ? "customers"
                    : "discount_schemas";
                setExportEntityId(entity);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" />
              <span>Export</span>
            </button>
          </div>

          {/* Tab Switcher */}
          <div className="flex rounded-lg bg-slate-100 p-1 border border-slate-200">
          <button
            onClick={() => { setActiveTab("products"); setSearchQuery(""); }}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "products" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Package className="h-3.5 w-3.5" />
            <span>Products ({products.length})</span>
          </button>
          <button
            onClick={() => { setActiveTab("batches"); setSearchQuery(""); }}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "batches" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Batches ({batches.length})</span>
          </button>
          <button
            onClick={() => { setActiveTab("parties"); setSearchQuery(""); }}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "parties" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Parties ({parties.length})</span>
          </button>
          <button
            onClick={() => { setActiveTab("discounts"); setSearchQuery(""); }}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "discounts" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Percent className="h-3.5 w-3.5" />
            <span>Discounts ({discountRules.length})</span>
          </button>
        </div>
        </div>
      </div>

      {/* Sub-header Controls */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder={`Search ${activeTab}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-800 placeholder-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {activeTab === "batches" && (
            <select
              value={selectedProductIdForBatches}
              onChange={(e) => setSelectedProductIdForBatches(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">All Products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          {activeTab === "parties" && (
            <div className="flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
              {(["all", "customer", "supplier", "doctor", "patient"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setPartyTypeFilter(t)}
                  className={`rounded px-2.5 py-1 capitalize ${
                    partyTypeFilter === t ? "bg-indigo-600 text-white font-medium" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Action Button */}
        <div className="flex items-center gap-2">
          {activeTab === "products" && (
            <>
              <button
                onClick={() => setImportEntityId("items")}
                className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5 text-indigo-600" />
                <span>Import Products</span>
              </button>
              <button
                onClick={() => {
                  setEditingProduct(null);
                  setProdForm({
                    name: "",
                    barcode: String(Math.floor(100000000000 + Math.random() * 900000000000)),
                    hsn_sac_code: "30049099",
                    mrp: 0,
                    sel_rate: 0,
                    ptr: 0,
                    pts: 0,
                    gst_percent: 12,
                    units_per_pack: 1,
                    generic_name: "",
                    rack_location: "R1",
                    shelf_location: "S1",
                    reorder_level: 10,
                    current_stock: 0,
                    is_active: true,
                  });
                  setIsProductModalOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Add Product</span>
              </button>
            </>
          )}
          {activeTab === "batches" && (
            <>
              <button
                onClick={() => setImportEntityId("batches")}
                className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5 text-indigo-600" />
                <span>Import Batches</span>
              </button>
              <button
                onClick={() => {
                  setEditingBatch(null);
                  setBatchForm({
                    product_id: products[0]?.id || "",
                    batch_no: `B${Math.floor(1000 + Math.random() * 9000)}`,
                    expiry_date: "2027-12",
                    stock_qty: 100,
                    mrp: 120,
                    purchase_rate: 80,
                    selling_rate: 110,
                    rack_location: "R1",
                    shelf_location: "S1",
                  });
                  setIsBatchModalOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Add Batch</span>
              </button>
            </>
          )}
          {activeTab === "parties" && (
            <>
              <button
                onClick={() =>
                  setImportEntityId(
                    partyTypeFilter === "supplier"
                      ? "suppliers"
                      : partyTypeFilter === "doctor"
                      ? "doctors"
                      : partyTypeFilter === "patient"
                      ? "patients"
                      : "customers"
                  )
                }
                className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5 text-indigo-600" />
                <span>Import Parties</span>
              </button>
              <button
                onClick={() => {
                  setEditingParty(null);
                  setPartyForm({
                    type: partyTypeFilter === "all" ? "customer" : partyTypeFilter,
                    name: "",
                    phone: "",
                    gstin: "",
                    address: "",
                    credit_limit: 5000,
                    credit_period_days: 30,
                    is_active: true,
                  });
                  setIsPartyModalOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Add Party</span>
              </button>
            </>
          )}
          {activeTab === "discounts" && (
            <button
              onClick={() => {
                setDiscForm({
                  name: "Bulk Tablet 10% Off",
                  rule_type: "percentage",
                  discount_percent: 10,
                  min_quantity: 5,
                  is_active: true,
                });
                setIsDiscountModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Add Schema</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Tables */}
      <div className="flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        {activeTab === "products" && (
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="sticky top-0 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3">Barcode</th>
                <th className="px-4 py-3">HSN Code</th>
                <th className="px-4 py-3 text-right">MRP (₹)</th>
                <th className="px-4 py-3 text-right">Sel Rate (₹)</th>
                <th className="px-4 py-3 text-right">GST %</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    No products found. Click "Add Product" to create your first item.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      <div>{p.name}</div>
                      {p.generic_name && (
                        <div className="text-[10px] text-slate-400 italic">{p.generic_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-500">{p.barcode}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-500">{p.hsn_sac_code || "—"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-700">₹{p.mrp.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-indigo-600">₹{p.sel_rate.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{p.gst_percent}%</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {p.rack_location ? `${p.rack_location} / ${p.shelf_location || ""}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          p.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {p.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => {
                          setEditingProduct(p);
                          setProdForm({ ...p });
                          setIsProductModalOpen(true);
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                        title="Edit Product"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {activeTab === "batches" && (
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="sticky top-0 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Batch No</th>
                <th className="px-4 py-3">Expiry Date</th>
                <th className="px-4 py-3 text-right">Stock Qty</th>
                <th className="px-4 py-3 text-right">Cost Rate (₹)</th>
                <th className="px-4 py-3 text-right">Selling Rate (₹)</th>
                <th className="px-4 py-3 text-right">MRP (₹)</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {filteredBatches.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No batches found.
                  </td>
                </tr>
              ) : (
                filteredBatches.map((b) => {
                  const product = products.find((p) => p.id === b.product_id);
                  const isExpiringSoon = b.expiry_date.localeCompare("2026-12") <= 0;
                  return (
                    <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-slate-800">
                        {product ? product.name : b.product_id}
                      </td>
                      <td className="px-4 py-2.5 font-mono font-bold text-slate-700">{b.batch_no}</td>
                      <td className="px-4 py-2.5 font-mono">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${
                            isExpiringSoon ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {b.expiry_date}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-slate-800">{b.stock_qty}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">
                        {b.purchase_rate ? `₹${b.purchase_rate.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-indigo-600">
                        {b.selling_rate ? `₹${b.selling_rate.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-700">
                        {b.mrp ? `₹${b.mrp.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => {
                            setEditingBatch(b);
                            setBatchForm({ ...b });
                            setIsBatchModalOpen(true);
                          }}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}

        {activeTab === "parties" && (
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="sticky top-0 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Party Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">GSTIN / Reg No</th>
                <th className="px-4 py-3 text-right">Outstanding (₹)</th>
                <th className="px-4 py-3 text-right">Credit Limit (₹)</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {filteredParties.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No parties found.
                  </td>
                </tr>
              ) : (
                filteredParties.map((pty) => (
                  <tr key={pty.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      <div>{pty.name}</div>
                      {pty.address && <div className="text-[10px] text-slate-400 truncate max-w-xs">{pty.address}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-block rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-indigo-700">
                        {pty.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">{pty.phone || "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-500">
                      {pty.gstin || pty.medical_reg_no || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-rose-600">
                      {pty.outstanding_balance ? `₹${pty.outstanding_balance.toFixed(2)}` : "₹0.00"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {pty.credit_limit ? `₹${pty.credit_limit.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          pty.is_active !== false ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {pty.is_active !== false ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => {
                          setEditingParty(pty);
                          setPartyForm({ ...pty });
                          setIsPartyModalOpen(true);
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {activeTab === "discounts" && (
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="sticky top-0 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Rule Name</th>
                <th className="px-4 py-3">Rule Type</th>
                <th className="px-4 py-3 text-right">Discount %</th>
                <th className="px-4 py-3 text-right">Min Qty</th>
                <th className="px-4 py-3 text-right">Free Qty</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {discountRules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    No discount schemas active. Click "Add Schema" to configure automated discounts.
                  </td>
                </tr>
              ) : (
                discountRules.map((rule) => (
                  <tr key={rule.rule_id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{rule.name}</td>
                    <td className="px-4 py-2.5 capitalize">{rule.rule_type.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-emerald-600">{rule.discount_percent}%</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{rule.min_quantity || "1"}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{rule.free_quantity || "—"}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        {rule.is_active ? "Active" : "Disabled"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Product Modal */}
      {isProductModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-bold text-slate-800">
                {editingProduct ? "Edit Product" : "Add New Product"}
              </h2>
              <button
                onClick={() => setIsProductModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Product Name *</label>
                  <input
                    type="text"
                    required
                    value={prodForm.name || ""}
                    onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                    placeholder="e.g. Paracetamol 650mg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Barcode *</label>
                  <input
                    type="text"
                    required
                    value={prodForm.barcode || ""}
                    onChange={(e) => setProdForm({ ...prodForm, barcode: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-indigo-500 focus:outline-none"
                    placeholder="8901234567890"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">HSN / SAC Code</label>
                  <input
                    type="text"
                    value={prodForm.hsn_sac_code || ""}
                    onChange={(e) => setProdForm({ ...prodForm, hsn_sac_code: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-indigo-500 focus:outline-none"
                    placeholder="30049099"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">GST Rate (%)</label>
                  <select
                    value={prodForm.gst_percent ?? 12}
                    onChange={(e) => setProdForm({ ...prodForm, gst_percent: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                  >
                    <option value={0}>0% (Exempt)</option>
                    <option value={5}>5%</option>
                    <option value={12}>12%</option>
                    <option value={18}>18%</option>
                    <option value={28}>28%</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Units Per Pack</label>
                  <input
                    type="number"
                    min="1"
                    value={prodForm.units_per_pack || 1}
                    onChange={(e) => setProdForm({ ...prodForm, units_per_pack: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">MRP (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={prodForm.mrp || ""}
                    onChange={(e) => setProdForm({ ...prodForm, mrp: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-medium focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Selling Rate (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={prodForm.sel_rate || ""}
                    onChange={(e) => setProdForm({ ...prodForm, sel_rate: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-medium text-indigo-600 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">PTR (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={prodForm.ptr || ""}
                    onChange={(e) => setProdForm({ ...prodForm, ptr: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">PTS (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={prodForm.pts || ""}
                    onChange={(e) => setProdForm({ ...prodForm, pts: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Generic Composition</label>
                  <input
                    type="text"
                    value={prodForm.generic_name || ""}
                    onChange={(e) => setProdForm({ ...prodForm, generic_name: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                    placeholder="e.g. Paracetamol IP"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Rack / Shelf</label>
                  <div className="flex gap-2 mt-1">
                    <input
                      type="text"
                      placeholder="Rack"
                      value={prodForm.rack_location || ""}
                      onChange={(e) => setProdForm({ ...prodForm, rack_location: e.target.value })}
                      className="w-1/2 rounded border border-slate-300 p-2 text-xs"
                    />
                    <input
                      type="text"
                      placeholder="Shelf"
                      value={prodForm.shelf_location || ""}
                      onChange={(e) => setProdForm({ ...prodForm, shelf_location: e.target.value })}
                      className="w-1/2 rounded border border-slate-300 p-2 text-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Reorder Level</label>
                  <input
                    type="number"
                    value={prodForm.reorder_level || 10}
                    onChange={(e) => setProdForm({ ...prodForm, reorder_level: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="rounded px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch Modal */}
      {isBatchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-bold text-slate-800">
                {editingBatch ? "Edit Batch" : "Add Product Batch"}
              </h2>
              <button
                onClick={() => setIsBatchModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBatch} className="mt-4 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">Product *</label>
                <select
                  required
                  value={batchForm.product_id || ""}
                  onChange={(e) => setBatchForm({ ...batchForm, product_id: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">Select Product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.barcode})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Batch No *</label>
                  <input
                    type="text"
                    required
                    value={batchForm.batch_no || ""}
                    onChange={(e) => setBatchForm({ ...batchForm, batch_no: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono font-bold uppercase focus:border-indigo-500 focus:outline-none"
                    placeholder="BATCH-123"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Expiry Date (YYYY-MM) *</label>
                  <input
                    type="text"
                    required
                    pattern="^\d{4}-(0[1-9]|1[0-2])$"
                    value={batchForm.expiry_date || ""}
                    onChange={(e) => setBatchForm({ ...batchForm, expiry_date: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-indigo-500 focus:outline-none"
                    placeholder="2027-12"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Initial Stock Qty</label>
                  <input
                    type="number"
                    min="0"
                    value={batchForm.stock_qty || 0}
                    onChange={(e) => setBatchForm({ ...batchForm, stock_qty: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-bold focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Purchase Rate (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={batchForm.purchase_rate || 0}
                    onChange={(e) => setBatchForm({ ...batchForm, purchase_rate: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Selling Rate (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={batchForm.selling_rate || 0}
                    onChange={(e) => setBatchForm({ ...batchForm, selling_rate: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-bold text-indigo-600 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsBatchModalOpen(false)}
                  className="rounded px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Save Batch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Party Modal */}
      {isPartyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-bold text-slate-800">
                {editingParty ? "Edit Party" : "Add Master Party"}
              </h2>
              <button
                onClick={() => setIsPartyModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveParty} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Party Type *</label>
                  <select
                    value={partyForm.type || "customer"}
                    onChange={(e) => setPartyForm({ ...partyForm, type: e.target.value as any })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="customer">Customer</option>
                    <option value="supplier">Supplier</option>
                    <option value="doctor">Doctor</option>
                    <option value="patient">Patient</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Name *</label>
                  <input
                    type="text"
                    required
                    value={partyForm.name || ""}
                    onChange={(e) => setPartyForm({ ...partyForm, name: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-medium focus:border-indigo-500 focus:outline-none"
                    placeholder="Party Name"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Mobile Phone (10 digits)</label>
                  <input
                    type="text"
                    value={partyForm.phone || ""}
                    onChange={(e) => setPartyForm({ ...partyForm, phone: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-indigo-500 focus:outline-none"
                    placeholder="9876543210"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">GSTIN (15 characters)</label>
                  <input
                    type="text"
                    value={partyForm.gstin || ""}
                    onChange={(e) => setPartyForm({ ...partyForm, gstin: e.target.value.toUpperCase() })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono uppercase focus:border-indigo-500 focus:outline-none"
                    placeholder="32AAAAA0000A1Z5"
                  />
                </div>
              </div>

              {partyForm.type === "doctor" && (
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Medical Reg No</label>
                  <input
                    type="text"
                    value={partyForm.medical_reg_no || ""}
                    onChange={(e) => setPartyForm({ ...partyForm, medical_reg_no: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-indigo-500 focus:outline-none"
                    placeholder="KMC-98765"
                  />
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">Address / City</label>
                <textarea
                  rows={2}
                  value={partyForm.address || ""}
                  onChange={(e) => setPartyForm({ ...partyForm, address: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                  placeholder="Street address, City, PIN"
                />
              </div>

              {partyForm.type === "customer" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600">Credit Limit (₹)</label>
                    <input
                      type="number"
                      value={partyForm.credit_limit || 0}
                      onChange={(e) => setPartyForm({ ...partyForm, credit_limit: Number(e.target.value) })}
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600">Opening Balance (₹)</label>
                    <input
                      type="number"
                      value={partyForm.outstanding_balance || 0}
                      onChange={(e) => setPartyForm({ ...partyForm, outstanding_balance: Number(e.target.value) })}
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsPartyModalOpen(false)}
                  className="rounded px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Save Party
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Discount Modal */}
      {isDiscountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-bold text-slate-800">Add Discount Schema</h2>
              <button
                onClick={() => setIsDiscountModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveDiscountRule} className="mt-4 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">Rule Name *</label>
                <input
                  type="text"
                  required
                  value={discForm.name || ""}
                  onChange={(e) => setDiscForm({ ...discForm, name: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                  placeholder="e.g. Festival 5% Off"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">Rule Type</label>
                <select
                  value={discForm.rule_type || "percentage"}
                  onChange={(e) => setDiscForm({ ...discForm, rule_type: e.target.value as any })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                >
                  <option value="percentage">Percentage Discount</option>
                  <option value="buy_x_get_y">Buy X Get Y Free</option>
                  <option value="customer_type">Customer Type Tier</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Discount %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={discForm.discount_percent || 0}
                    onChange={(e) => setDiscForm({ ...discForm, discount_percent: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-bold text-emerald-600 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Min Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={discForm.min_quantity || 1}
                    onChange={(e) => setDiscForm({ ...discForm, min_quantity: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsDiscountModalOpen(false)}
                  className="rounded px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Save Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {importEntityId && (
        <ImportWizardModal
          isOpen={Boolean(importEntityId)}
          initialEntityId={importEntityId}
          onClose={() => setImportEntityId(null)}
          onSuccess={() => {
            setImportEntityId(null);
            loadData();
            showNotification("Master data imported successfully!");
          }}
        />
      )}

      {exportEntityId && (
        <ExportDialogModal
          isOpen={Boolean(exportEntityId)}
          initialEntityId={exportEntityId}
          onClose={() => setExportEntityId(null)}
        />
      )}
    </div>
  );
};

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
  Scale,
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
import { unitsStore, type UnitMaster } from "../lib/masters/unitsStore";
import { sqliteStorage } from "../lib/db/sqliteStorage";
import { ImportWizardModal } from "../lib/data-exchange/ui/ImportWizardModal";
import { ExportDialogModal } from "../lib/data-exchange/ui/ExportDialogModal";
import { UnitAutocompleteInput } from "../components/UnitAutocompleteInput";

export const MastersPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"products" | "batches" | "parties" | "discounts" | "units">("products");
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

  // Units state
  const [units, setUnits] = useState<UnitMaster[]>([]);
  const [isUnitModalOpen, setIsUnitModalOpen] = useState(false);
  useModalEscape(isUnitModalOpen, () => setIsUnitModalOpen(false));
  const [editingUnit, setEditingUnit] = useState<UnitMaster | null>(null);
  const [unitForm, setUnitForm] = useState<Partial<UnitMaster>>({
    name: "",
    symbol: "",
    precision: 0,
    is_active: true,
  });

  // Product Form state
  const [prodForm, setProdForm] = useState<Partial<ProductItem>>({
    name: "",
    barcode: "",
    hsn_sac_code: "30049099",
    unit_name: "Strip",
    sub_unit_name: "Tabs",
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

      const allUnits = await unitsStore.getAllUnits(true);
      setUnits(allUnits);
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
      (p.name?.toLowerCase().includes(q) ?? false) ||
      (p.barcode?.toLowerCase().includes(q) ?? false) ||
      (p.secondary_barcodes?.some((b) => b?.toLowerCase().includes(q)) ?? false) ||
      (p.generic_name?.toLowerCase().includes(q) ?? false) ||
      (p.hsn_sac_code?.toLowerCase().includes(q) ?? false)
    );
  });

  const filteredBatches = batches.filter((b) => {
    if (selectedProductIdForBatches && b.product_id !== selectedProductIdForBatches) return false;
    if (!searchQuery) return true;
    return b.batch_no?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false;
  });

  const filteredParties = parties.filter((p) => {
    if (partyTypeFilter !== "all" && p.type !== partyTypeFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (p.name?.toLowerCase().includes(q) ?? false) ||
      (p.phone?.toLowerCase().includes(q) ?? false) ||
      (p.gstin?.toLowerCase().includes(q) ?? false)
    );
  });

  const filteredUnits = units.filter((u) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (u.name?.toLowerCase().includes(q) ?? false) ||
      (u.symbol?.toLowerCase().includes(q) ?? false)
    );
  });

  // Save Product
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodForm.name || !prodForm.barcode) {
      showNotification("Product name and Barcode are required", "error");
      return;
    }

    if (prodForm.unit_name?.trim()) {
      await unitsStore.ensureUnitExists(prodForm.unit_name.trim());
    }
    if (prodForm.sub_unit_name?.trim()) {
      await unitsStore.ensureUnitExists(prodForm.sub_unit_name.trim());
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
      unit_name: prodForm.unit_name?.trim() || undefined,
      sub_unit_name: prodForm.sub_unit_name?.trim() || undefined,
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

  // Save Unit
  const handleSaveUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = unitForm.name?.trim();
    if (!name) {
      showNotification("Unit name is required", "error");
      return;
    }

    try {
      const symbol = (unitForm.symbol?.trim() || name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4)).toUpperCase();
      await unitsStore.upsertUnit({
        id: editingUnit ? editingUnit.id : undefined,
        name,
        symbol,
        precision: Math.max(0, Number(unitForm.precision) || 0),
        is_active: unitForm.is_active ?? true,
      });

      showNotification(editingUnit ? `Unit "${name}" updated successfully` : `Unit "${name}" created successfully`);
      setIsUnitModalOpen(false);
      setEditingUnit(null);
      await loadData();
    } catch (err: any) {
      showNotification(err.message || "Failed to save unit", "error");
    }
  };

  // Delete Unit
  const handleDeleteUnit = async (unit: UnitMaster) => {
    if (confirm(`Are you sure you want to delete unit "${unit.name}" (${unit.symbol})?`)) {
      try {
        await unitsStore.deleteUnit(unit.id);
        showNotification(`Unit "${unit.name}" deleted successfully`);
        await loadData();
      } catch (err: any) {
        showNotification("Failed to delete unit", "error");
      }
    }
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
      <div className="flex items-center justify-between rounded-card border border-border-main bg-surface p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-btn bg-accent-soft text-accent">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-[26px] font-bold text-text-main tracking-tight">Master Data Management</h1>
            <p className="text-xs text-text-muted mt-0.5">Products, barcodes, batches, parties, and discount schemas</p>
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
              className="flex items-center gap-1.5 rounded-btn border border-accent/20 bg-accent-soft px-3.5 py-2 text-xs font-semibold text-accent hover:bg-accent-soft/80 transition-colors shadow-xs cursor-pointer"
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
                    : activeTab === "units"
                    ? "units"
                    : "discount_schemas";
                setExportEntityId(entity);
              }}
              className="flex items-center gap-1.5 rounded-btn border border-border-main bg-surface px-3.5 py-2 text-xs font-medium text-text-main hover:bg-canvas transition-colors shadow-xs cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-text-muted" />
              <span>Export</span>
            </button>
          </div>

          {/* Tab Switcher */}
          <div className="flex rounded-btn bg-canvas p-1 border border-border-main">
          <button
            onClick={() => { setActiveTab("products"); setSearchQuery(""); }}
            className={`flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === "products" ? "bg-surface text-accent shadow-xs border border-border-main/50" : "text-text-muted hover:text-text-main"
            }`}
          >
            <Package className="h-3.5 w-3.5" />
            <span>Products ({products.length})</span>
          </button>
          <button
            onClick={() => { setActiveTab("batches"); setSearchQuery(""); }}
            className={`flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === "batches" ? "bg-surface text-accent shadow-xs border border-border-main/50" : "text-text-muted hover:text-text-main"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Batches ({batches.length})</span>
          </button>
          <button
            onClick={() => { setActiveTab("parties"); setSearchQuery(""); }}
            className={`flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === "parties" ? "bg-surface text-accent shadow-xs border border-border-main/50" : "text-text-muted hover:text-text-main"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Parties ({parties.length})</span>
          </button>
          <button
            onClick={() => { setActiveTab("discounts"); setSearchQuery(""); }}
            className={`flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === "discounts" ? "bg-surface text-accent shadow-xs border border-border-main/50" : "text-text-muted hover:text-text-main"
            }`}
          >
            <Percent className="h-3.5 w-3.5" />
            <span>Discounts ({discountRules.length})</span>
          </button>
          <button
            onClick={() => { setActiveTab("units"); setSearchQuery(""); }}
            className={`flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === "units" ? "bg-surface text-accent shadow-xs border border-border-main/50" : "text-text-muted hover:text-text-main"
            }`}
          >
            <Scale className="h-3.5 w-3.5" />
            <span>Units ({units.length})</span>
          </button>
        </div>
        </div>
      </div>

      {/* Sub-header Controls */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <input
              type="text"
              placeholder={`Search ${activeTab}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-input border border-border-main bg-surface py-2 pl-9 pr-3 text-xs text-text-main placeholder-text-muted shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {activeTab === "batches" && (
            <select
              value={selectedProductIdForBatches}
              onChange={(e) => setSelectedProductIdForBatches(e.target.value)}
              className="rounded-input border border-border-main bg-surface px-3 py-2 text-xs text-text-main shadow-2xs focus:border-accent focus:outline-none"
            >
              <option value="">All Products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          {activeTab === "parties" && (
            <div className="flex rounded-btn border border-border-main bg-canvas p-0.5 text-xs">
              {(["all", "customer", "supplier", "doctor", "patient"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setPartyTypeFilter(t)}
                  className={`rounded-btn px-2.5 py-1 capitalize transition-colors font-semibold ${
                    partyTypeFilter === t ? "bg-surface text-accent shadow-xs border border-border-main/50" : "text-text-muted hover:text-text-main"
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
                className="flex items-center gap-1.5 rounded-btn border border-border-main bg-surface px-3 py-2 text-xs font-semibold text-text-main shadow-xs hover:bg-canvas cursor-pointer transition-colors"
              >
                <Upload className="h-3.5 w-3.5 text-accent" />
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
                className="flex items-center gap-1.5 rounded-btn bg-accent px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent/90 cursor-pointer transition-colors"
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
                className="flex items-center gap-1.5 rounded-btn border border-border-main bg-surface px-3 py-2 text-xs font-semibold text-text-main shadow-xs hover:bg-canvas cursor-pointer transition-colors"
              >
                <Upload className="h-3.5 w-3.5 text-accent" />
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
                className="flex items-center gap-1.5 rounded-btn bg-accent px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent/90 cursor-pointer transition-colors"
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
                className="flex items-center gap-1.5 rounded-btn border border-border-main bg-surface px-3 py-2 text-xs font-semibold text-text-main shadow-xs hover:bg-canvas cursor-pointer transition-colors"
              >
                <Upload className="h-3.5 w-3.5 text-accent" />
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
                className="flex items-center gap-1.5 rounded-btn bg-accent px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent/90 cursor-pointer transition-colors"
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
              className="flex items-center gap-1.5 rounded-btn bg-accent px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent/90 cursor-pointer transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Add Schema</span>
            </button>
          )}
          {activeTab === "units" && (
            <>
              <button
                onClick={() => setImportEntityId("units")}
                className="flex items-center gap-1.5 rounded-btn border border-border-main bg-surface px-3 py-2 text-xs font-semibold text-text-main shadow-xs hover:bg-canvas cursor-pointer transition-colors"
              >
                <Upload className="h-3.5 w-3.5 text-accent" />
                <span>Import Units</span>
              </button>
              <button
                onClick={() => {
                  setEditingUnit(null);
                  setUnitForm({
                    name: "",
                    symbol: "",
                    precision: 0,
                    is_active: true,
                  });
                  setIsUnitModalOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-btn bg-accent px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent/90 cursor-pointer transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>Add Unit</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content Tables */}
      <div className="flex-1 overflow-auto rounded-card border border-border-main bg-surface shadow-xs">
        {activeTab === "products" && (
          <table className="w-full text-left text-xs text-text-muted">
            <thead className="sticky top-0 bg-canvas text-[11px] font-semibold uppercase tracking-wider text-text-muted border-b border-border-main">
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
            <tbody className="divide-y divide-border-main/50 font-sans">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-text-muted">
                    No products found. Click "Add Product" to create your first item.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => (
                  <tr key={p.id} className="hover:bg-canvas/50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-text-main">
                      <div>{p.name}</div>
                      {p.generic_name && (
                        <div className="text-[10px] text-text-muted italic">{p.generic_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-text-muted">{p.barcode || "—"}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-text-muted">{p.hsn_sac_code || "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums font-medium text-text-main">₹{(p.mrp ?? 0).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-accent">₹{(p.sel_rate ?? 0).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-text-muted">{p.gst_percent ?? 0}%</td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {p.rack_location ? `${p.rack_location} / ${p.shelf_location || ""}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          p.is_active ? "bg-accent-soft text-accent" : "bg-canvas text-text-muted"
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
                        className="rounded-btn p-1 text-text-muted hover:bg-canvas hover:text-accent transition-colors"
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
          <table className="w-full text-left text-xs text-text-muted">
            <thead className="sticky top-0 bg-canvas text-[11px] font-semibold uppercase tracking-wider text-text-muted border-b border-border-main">
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
            <tbody className="divide-y divide-border-main/50 font-sans">
              {filteredBatches.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-text-muted">
                    No batches found.
                  </td>
                </tr>
              ) : (
                filteredBatches.map((b) => {
                  const product = products.find((p) => p.id === b.product_id);
                  const isExpiringSoon = b.expiry_date.localeCompare("2026-12") <= 0;
                  return (
                    <tr key={b.id} className="hover:bg-canvas/50 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-text-main">
                        {product ? product.name : b.product_id}
                      </td>
                      <td className="px-4 py-2.5 font-mono font-bold text-text-main">{b.batch_no}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            isExpiringSoon ? "bg-amber-100 text-amber-800" : "bg-canvas text-text-muted"
                          }`}
                        >
                          {b.expiry_date}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums font-bold text-text-main">{b.stock_qty}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-text-muted">
                        {b.purchase_rate ? `₹${b.purchase_rate.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums font-medium text-accent">
                        {b.selling_rate ? `₹${b.selling_rate.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-text-main">
                        {b.mrp ? `₹${b.mrp.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => {
                            setEditingBatch(b);
                            setBatchForm({ ...b });
                            setIsBatchModalOpen(true);
                          }}
                          className="rounded-btn p-1 text-text-muted hover:bg-canvas hover:text-accent transition-colors"
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
          <table className="w-full text-left text-xs text-text-muted">
            <thead className="sticky top-0 bg-canvas text-[11px] font-semibold uppercase tracking-wider text-text-muted border-b border-border-main">
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
            <tbody className="divide-y divide-border-main/50 font-sans">
              {filteredParties.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-text-muted">
                    No parties found.
                  </td>
                </tr>
              ) : (
                filteredParties.map((pty) => (
                  <tr key={pty.id} className="hover:bg-canvas/50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-text-main">
                      <div>{pty.name}</div>
                      {pty.address && <div className="text-[10px] text-text-muted truncate max-w-xs">{pty.address}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-block rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase text-accent">
                        {pty.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-text-muted">{pty.phone || "—"}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-text-muted">
                      {pty.gstin || pty.medical_reg_no || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-danger">
                      {pty.outstanding_balance ? `₹${pty.outstanding_balance.toFixed(2)}` : "₹0.00"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-text-muted">
                      {pty.credit_limit ? `₹${pty.credit_limit.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          pty.is_active !== false ? "bg-accent-soft text-accent" : "bg-canvas text-text-muted"
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
                        className="rounded-btn p-1 text-text-muted hover:bg-canvas hover:text-accent transition-colors"
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
          <table className="w-full text-left text-xs text-text-muted">
            <thead className="sticky top-0 bg-canvas text-[11px] font-semibold uppercase tracking-wider text-text-muted border-b border-border-main">
              <tr>
                <th className="px-4 py-3">Rule Name</th>
                <th className="px-4 py-3">Rule Type</th>
                <th className="px-4 py-3 text-right">Discount %</th>
                <th className="px-4 py-3 text-right">Min Qty</th>
                <th className="px-4 py-3 text-right">Free Qty</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-main/50 font-sans">
              {discountRules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-text-muted">
                    No discount schemas active. Click "Add Schema" to configure automated discounts.
                  </td>
                </tr>
              ) : (
                discountRules.map((rule) => (
                  <tr key={rule.rule_id} className="hover:bg-canvas/50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-text-main">{rule.name}</td>
                    <td className="px-4 py-2.5 capitalize text-text-muted">{rule.rule_type.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums font-bold text-accent">{rule.discount_percent}%</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-text-muted">{rule.min_quantity || "1"}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-text-muted">{rule.free_quantity || "—"}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-flex rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
                        {rule.is_active ? "Active" : "Disabled"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {activeTab === "units" && (
          <table className="w-full text-left text-xs text-text-muted">
            <thead className="sticky top-0 bg-canvas text-[11px] font-semibold uppercase tracking-wider text-text-muted border-b border-border-main">
              <tr>
                <th className="px-4 py-3">Unit Name</th>
                <th className="px-4 py-3">GST UQC / Symbol</th>
                <th className="px-4 py-3">Decimal Precision</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-main/50 font-sans">
              {filteredUnits.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-text-muted">
                    No units of measure found. Click "Add Unit" to create a new unit.
                  </td>
                </tr>
              ) : (
                filteredUnits.map((u) => (
                  <tr key={u.id} className="hover:bg-canvas/50 transition-colors">
                    <td className="px-4 py-2.5 font-semibold text-text-main">
                      <div className="flex items-center gap-2">
                        <div className="rounded-btn bg-accent-soft/70 p-1 text-accent">
                          <Scale className="h-3.5 w-3.5" />
                        </div>
                        <span>{u.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono font-bold text-accent">
                      <span className="rounded bg-accent-soft px-2 py-0.5 text-[11px]">
                        {u.symbol}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-text-main font-mono">
                      {!u.precision || u.precision === 0 ? (
                        <span className="text-text-muted">0 (Discrete / Count)</span>
                      ) : (
                        <span>{u.precision} decimal{(u.precision || 0) > 1 ? "s" : ""}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          u.is_active ? "bg-accent-soft text-accent" : "bg-canvas text-text-muted"
                        }`}
                      >
                        {u.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => {
                            setEditingUnit(u);
                            setUnitForm({
                              name: u.name,
                              symbol: u.symbol,
                              precision: u.precision ?? 0,
                              is_active: u.is_active,
                            });
                            setIsUnitModalOpen(true);
                          }}
                          className="rounded-btn p-1 text-text-muted hover:bg-canvas hover:text-accent cursor-pointer transition-colors"
                          title="Edit Unit"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteUnit(u)}
                          className="rounded-btn p-1 text-text-muted hover:bg-canvas hover:text-red-500 cursor-pointer transition-colors"
                          title="Delete Unit"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-card bg-surface p-6 shadow-2xl border border-border-main max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border-main pb-3">
              <h2 className="text-base font-bold text-text-main">
                {editingProduct ? "Edit Product" : "Add New Product"}
              </h2>
              <button
                onClick={() => setIsProductModalOpen(false)}
                className="text-text-muted hover:text-text-main transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Product Name *</label>
                  <input
                    type="text"
                    required
                    value={prodForm.name || ""}
                    onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="e.g. Paracetamol 650mg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Barcode *</label>
                  <input
                    type="text"
                    required
                    value={prodForm.barcode || ""}
                    onChange={(e) => setProdForm({ ...prodForm, barcode: e.target.value })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="8901234567890"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">HSN / SAC Code</label>
                  <input
                    type="text"
                    value={prodForm.hsn_sac_code || ""}
                    onChange={(e) => setProdForm({ ...prodForm, hsn_sac_code: e.target.value })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="30049099"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">GST Rate (%)</label>
                  <select
                    value={prodForm.gst_percent ?? 12}
                    onChange={(e) => setProdForm({ ...prodForm, gst_percent: Number(e.target.value) })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs text-text-main shadow-2xs focus:border-accent focus:outline-none"
                  >
                    <option value={0}>0% (Exempt)</option>
                    <option value={5}>5%</option>
                    <option value={12}>12%</option>
                    <option value={18}>18%</option>
                    <option value={28}>28%</option>
                  </select>
                </div>
              </div>

              {/* Packaging Ratio & Units */}
              <div className="rounded-card border border-border-main bg-canvas/40 p-3.5">
                <div className="text-[11px] font-bold text-text-main uppercase tracking-wider mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Scale className="h-3.5 w-3.5 text-accent" />
                    <span>Packaging Ratio & Unit of Measure</span>
                  </div>
                  <span className="text-[10px] text-text-muted font-normal lowercase">
                    (Auto-creates units in Master if new)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <span className="text-[10px] text-text-muted font-semibold block mb-0.5">1 Parent Unit (Pack / Box)</span>
                    <UnitAutocompleteInput
                      value={prodForm.unit_name || ""}
                      onChange={(val) => setProdForm({ ...prodForm, unit_name: val })}
                      units={units}
                      placeholder="e.g. Strip, Box, Bottle"
                      className="w-full rounded-input border border-border-main bg-surface p-2 text-xs font-semibold text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <span className="text-sm font-black text-text-muted mt-4">=</span>
                  <div className="w-24">
                    <span className="text-[10px] text-accent font-bold block mb-0.5">Contains Qty</span>
                    <input
                      type="number"
                      min="1"
                      value={prodForm.units_per_pack || 1}
                      onChange={(e) => setProdForm({ ...prodForm, units_per_pack: Math.max(1, Number(e.target.value) || 1) })}
                      className="w-full rounded-input border border-accent bg-surface p-2 text-xs font-mono font-bold text-accent text-center shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="flex-1">
                    <span className="text-[10px] text-text-muted font-semibold block mb-0.5">Base Unit (Loose / Sub-unit)</span>
                    <UnitAutocompleteInput
                      value={prodForm.sub_unit_name || ""}
                      onChange={(val) => setProdForm({ ...prodForm, sub_unit_name: val })}
                      units={units}
                      placeholder="e.g. Tabs, Piece, ml, g"
                      className="w-full rounded-input border border-border-main bg-surface p-2 text-xs font-semibold text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">MRP (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={prodForm.mrp || ""}
                    onChange={(e) => setProdForm({ ...prodForm, mrp: Number(e.target.value) })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums font-medium text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Selling Rate (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={prodForm.sel_rate || ""}
                    onChange={(e) => setProdForm({ ...prodForm, sel_rate: Number(e.target.value) })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums font-semibold text-accent shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">PTR (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={prodForm.ptr || ""}
                    onChange={(e) => setProdForm({ ...prodForm, ptr: Number(e.target.value) })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums text-text-muted shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">PTS (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={prodForm.pts || ""}
                    onChange={(e) => setProdForm({ ...prodForm, pts: Number(e.target.value) })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums text-text-muted shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Generic Composition</label>
                  <input
                    type="text"
                    value={prodForm.generic_name || ""}
                    onChange={(e) => setProdForm({ ...prodForm, generic_name: e.target.value })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="e.g. Paracetamol IP"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Rack / Shelf</label>
                  <div className="flex gap-2 mt-1">
                    <input
                      type="text"
                      placeholder="Rack"
                      value={prodForm.rack_location || ""}
                      onChange={(e) => setProdForm({ ...prodForm, rack_location: e.target.value })}
                      className="w-1/2 rounded-input border border-border-main bg-surface p-2 text-xs text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <input
                      type="text"
                      placeholder="Shelf"
                      value={prodForm.shelf_location || ""}
                      onChange={(e) => setProdForm({ ...prodForm, shelf_location: e.target.value })}
                      className="w-1/2 rounded-input border border-border-main bg-surface p-2 text-xs text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Reorder Level</label>
                  <input
                    type="number"
                    value={prodForm.reorder_level || 10}
                    onChange={(e) => setProdForm({ ...prodForm, reorder_level: Number(e.target.value) })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-border-main">
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="rounded-btn px-4 py-2 text-xs font-semibold text-text-muted hover:bg-canvas transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-btn bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent/90 shadow-xs cursor-pointer transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-card bg-surface p-6 shadow-2xl border border-border-main">
            <div className="flex items-center justify-between border-b border-border-main pb-3">
              <h2 className="text-base font-bold text-text-main">
                {editingBatch ? "Edit Batch" : "Add Product Batch"}
              </h2>
              <button
                onClick={() => setIsBatchModalOpen(false)}
                className="text-text-muted hover:text-text-main transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBatch} className="mt-4 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Product *</label>
                <select
                  required
                  value={batchForm.product_id || ""}
                  onChange={(e) => setBatchForm({ ...batchForm, product_id: e.target.value })}
                  className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs text-text-main shadow-2xs focus:border-accent focus:outline-none"
                >
                  <option value="">Select Product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.barcode || "No barcode"})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Batch No *</label>
                  <input
                    type="text"
                    required
                    value={batchForm.batch_no || ""}
                    onChange={(e) => setBatchForm({ ...batchForm, batch_no: e.target.value })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums font-bold uppercase text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="BATCH-123"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Expiry Date (YYYY-MM) *</label>
                  <input
                    type="text"
                    required
                    pattern="^\d{4}-(0[1-9]|1[0-2])$"
                    value={batchForm.expiry_date || ""}
                    onChange={(e) => setBatchForm({ ...batchForm, expiry_date: e.target.value })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="2027-12"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Initial Stock Qty</label>
                  <input
                    type="number"
                    min="0"
                    value={batchForm.stock_qty || 0}
                    onChange={(e) => setBatchForm({ ...batchForm, stock_qty: Number(e.target.value) })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums font-bold text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Purchase Rate (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={batchForm.purchase_rate || 0}
                    onChange={(e) => setBatchForm({ ...batchForm, purchase_rate: Number(e.target.value) })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums text-text-muted shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Selling Rate (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={batchForm.selling_rate || 0}
                    onChange={(e) => setBatchForm({ ...batchForm, selling_rate: Number(e.target.value) })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums font-bold text-accent shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-border-main">
                <button
                  type="button"
                  onClick={() => setIsBatchModalOpen(false)}
                  className="rounded-btn px-4 py-2 text-xs font-semibold text-text-muted hover:bg-canvas transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-btn bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent/90 shadow-xs cursor-pointer transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-card bg-surface p-6 shadow-2xl border border-border-main">
            <div className="flex items-center justify-between border-b border-border-main pb-3">
              <h2 className="text-base font-bold text-text-main">
                {editingParty ? "Edit Party" : "Add Master Party"}
              </h2>
              <button
                onClick={() => setIsPartyModalOpen(false)}
                className="text-text-muted hover:text-text-main transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveParty} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Party Type *</label>
                  <select
                    value={partyForm.type || "customer"}
                    onChange={(e) => setPartyForm({ ...partyForm, type: e.target.value as any })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs text-text-main shadow-2xs focus:border-accent focus:outline-none"
                  >
                    <option value="customer">Customer</option>
                    <option value="supplier">Supplier</option>
                    <option value="doctor">Doctor</option>
                    <option value="patient">Patient</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Name *</label>
                  <input
                    type="text"
                    required
                    value={partyForm.name || ""}
                    onChange={(e) => setPartyForm({ ...partyForm, name: e.target.value })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-medium text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="Party Name"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Mobile Phone (10 digits)</label>
                  <input
                    type="text"
                    value={partyForm.phone || ""}
                    onChange={(e) => setPartyForm({ ...partyForm, phone: e.target.value })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="9876543210"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">GSTIN (15 characters)</label>
                  <input
                    type="text"
                    value={partyForm.gstin || ""}
                    onChange={(e) => setPartyForm({ ...partyForm, gstin: e.target.value.toUpperCase() })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums uppercase text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="32AAAAA0000A1Z5"
                  />
                </div>
              </div>

              {partyForm.type === "doctor" && (
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Medical Reg No</label>
                  <input
                    type="text"
                    value={partyForm.medical_reg_no || ""}
                    onChange={(e) => setPartyForm({ ...partyForm, medical_reg_no: e.target.value })}
                    className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="KMC-98765"
                  />
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Address / City</label>
                <textarea
                  rows={2}
                  value={partyForm.address || ""}
                  onChange={(e) => setPartyForm({ ...partyForm, address: e.target.value })}
                  className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  placeholder="Street address, City, PIN"
                />
              </div>

              {partyForm.type === "customer" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Credit Limit (₹)</label>
                    <input
                      type="number"
                      value={partyForm.credit_limit || 0}
                      onChange={(e) => setPartyForm({ ...partyForm, credit_limit: Number(e.target.value) })}
                      className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Opening Balance (₹)</label>
                    <input
                      type="number"
                      value={partyForm.outstanding_balance || 0}
                      onChange={(e) => setPartyForm({ ...partyForm, outstanding_balance: Number(e.target.value) })}
                      className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-border-main">
                <button
                  type="button"
                  onClick={() => setIsPartyModalOpen(false)}
                  className="rounded-btn px-4 py-2 text-xs font-semibold text-text-muted hover:bg-canvas transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-btn bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent/90 shadow-xs cursor-pointer transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-2xl border border-border-main">
            <div className="flex items-center justify-between border-b border-border-main pb-3">
              <h2 className="text-base font-bold text-text-main">Add Discount Schema</h2>
              <button
                onClick={() => setIsDiscountModalOpen(false)}
                className="text-text-muted hover:text-text-main transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveDiscountRule} className="mt-4 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Rule Name *</label>
                <input
                  type="text"
                  required
                  value={discForm.name || ""}
                  onChange={(e) => setDiscForm({ ...discForm, name: e.target.value })}
                  className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  placeholder="e.g. Festival 5% Off"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Rule Type</label>
                <select
                  value={discForm.rule_type || "percentage"}
                  onChange={(e) => setDiscForm({ ...discForm, rule_type: e.target.value as any })}
                  className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs text-text-main shadow-2xs focus:border-accent focus:outline-none"
                >
                  <option value="percentage">Percentage Discount</option>
                  <option value="buy_x_get_y">Buy X Get Y Free</option>
                  <option value="customer_type">Customer Type Tier</option>
                </select>
              </div>

              {discForm.rule_type === "percentage" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Discount %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={discForm.discount_percent ?? 0}
                      onChange={(e) => setDiscForm({ ...discForm, discount_percent: Number(e.target.value) })}
                      className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums font-bold text-accent shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Min Quantity</label>
                    <input
                      type="number"
                      min="1"
                      value={discForm.min_quantity ?? 1}
                      onChange={(e) => setDiscForm({ ...discForm, min_quantity: Number(e.target.value) })}
                      className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
              )}

              {discForm.rule_type === "buy_x_get_y" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Buy Qty (X) *</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={discForm.min_quantity ?? 1}
                      onChange={(e) => setDiscForm({ ...discForm, min_quantity: Number(e.target.value) })}
                      className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums font-bold text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      placeholder="e.g. 3"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Get Free Qty (Y) *</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={discForm.free_quantity ?? 1}
                      onChange={(e) => setDiscForm({ ...discForm, free_quantity: Number(e.target.value) })}
                      className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums font-bold text-accent shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      placeholder="e.g. 1"
                    />
                  </div>
                </div>
              )}

              {discForm.rule_type === "customer_type" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Tier Discount %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={discForm.discount_percent ?? 0}
                      onChange={(e) => setDiscForm({ ...discForm, discount_percent: Number(e.target.value) })}
                      className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono tabular-nums font-bold text-accent shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      placeholder="e.g. 10"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-border-main">
                <button
                  type="button"
                  onClick={() => setIsDiscountModalOpen(false)}
                  className="rounded-btn px-4 py-2 text-xs font-semibold text-text-muted hover:bg-canvas transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-btn bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent/90 shadow-xs cursor-pointer transition-colors"
                >
                  Save Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unit Modal */}
      {isUnitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-2xl border border-border-main">
            <div className="flex items-center justify-between border-b border-border-main pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-btn bg-accent-soft p-1.5 text-accent">
                  <Scale className="h-4 w-4" />
                </div>
                <h2 className="text-base font-bold text-text-main">
                  {editingUnit ? "Edit Unit of Measure" : "Add New Unit of Measure"}
                </h2>
              </div>
              <button
                onClick={() => setIsUnitModalOpen(false)}
                className="text-text-muted hover:text-text-main transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUnit} className="mt-4 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Unit Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Strip, Box, Tablet, Litre"
                  value={unitForm.name || ""}
                  onChange={(e) => {
                    const name = e.target.value;
                    const autoSymbol =
                      !editingUnit &&
                      (!unitForm.symbol ||
                        unitForm.symbol === unitForm.name?.slice(0, 4).toUpperCase())
                        ? name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase()
                        : unitForm.symbol;
                    setUnitForm({ ...unitForm, name, symbol: autoSymbol });
                  }}
                  className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs text-text-main shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  UQC / Symbol Code (Statutory GST) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. STP, BOX, TAB, LTR, KGS, PCS"
                  value={unitForm.symbol || ""}
                  onChange={(e) =>
                    setUnitForm({ ...unitForm, symbol: e.target.value.toUpperCase() })
                  }
                  className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs font-mono font-bold text-accent uppercase shadow-2xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Decimal Precision
                </label>
                <select
                  value={unitForm.precision ?? 0}
                  onChange={(e) =>
                    setUnitForm({ ...unitForm, precision: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded-input border border-border-main bg-surface p-2 text-xs text-text-main shadow-2xs focus:border-accent focus:outline-none"
                >
                  <option value={0}>0 - Discrete / Whole units (e.g. Strip, Box, Tab)</option>
                  <option value={1}>1 decimal place (0.1)</option>
                  <option value={2}>2 decimal places (0.01 - e.g. Litre, Metre)</option>
                  <option value={3}>3 decimal places (0.001 - e.g. Kilogram, Gram)</option>
                  <option value={4}>4 decimal places</option>
                </select>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="unit_active"
                  checked={unitForm.is_active ?? true}
                  onChange={(e) =>
                    setUnitForm({ ...unitForm, is_active: e.target.checked })
                  }
                  className="rounded border-border-main text-accent focus:ring-accent h-4 w-4"
                />
                <label
                  htmlFor="unit_active"
                  className="text-xs font-medium text-text-main cursor-pointer"
                >
                  Is Active for Inventory and Billing
                </label>
              </div>

              <div className="flex justify-end gap-2 border-t border-border-main pt-4">
                <button
                  type="button"
                  onClick={() => setIsUnitModalOpen(false)}
                  className="rounded-btn border border-border-main px-4 py-2 text-xs font-semibold text-text-muted hover:bg-canvas cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-btn bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent/90 cursor-pointer"
                >
                  {editingUnit ? "Update Unit" : "Save Unit"}
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

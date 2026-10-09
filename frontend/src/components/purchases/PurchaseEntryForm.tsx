import React, { useState, useEffect, useRef } from "react";
import {
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  FileSpreadsheet,
  ScanText,
  Save,
  FileClock,
  Building2,
  Calendar,
  X,
  Search,
  Sparkles,
  ArrowDownRight,
  Printer,
  Barcode,
} from "lucide-react";
import {
  purchaseService,
  type PurchaseLineItemInput,
  type PurchaseDocumentInput,
} from "../../lib/purchases/purchaseService";
import { purchaseImportService } from "../../lib/purchases/purchaseImportService";
import { supplierLedgerService, type SupplierMaster } from "../../lib/purchases/supplierLedgerService";
import { purchaseDraftService, type PurchaseDraftItem } from "../../lib/purchases/purchaseDraftService";
import { productsStore, type ProductItem } from "../../lib/masters/productsStore";
import { sqliteStorage } from "../../lib/db/sqliteStorage";
import { SupplierQuickAddModal } from "./SupplierQuickAddModal";
import { PurchaseDraftsModal } from "./PurchaseDraftsModal";
import { BarcodePrintModal } from "./BarcodePrintModal";
import { PrintPreviewModal } from "../PrintPreviewModal";

interface PurchaseEntryFormProps {
  onClose: () => void;
  onSuccess: () => void;
  initialPoData?: {
    po_id: string;
    supplier_id: string;
    supplier_name: string;
    lines: PurchaseLineItemInput[];
  };
}

export const PurchaseEntryForm: React.FC<PurchaseEntryFormProps> = ({
  onClose,
  onSuccess,
  initialPoData,
}) => {
  // Supplier State
  const [suppliers, setSuppliers] = useState<SupplierMaster[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState(initialPoData?.supplier_id || "");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState("Kerala");
  const [isInterstate, setIsInterstate] = useState(false);
  const [isRcm, setIsRcm] = useState(false);
  const [itcEligibility, setItcEligibility] = useState<"eligible" | "ineligible" | "blocked">("eligible");
  const [notes, setNotes] = useState("");

  // Grid Lines State
  const [lines, setLines] = useState<PurchaseLineItemInput[]>(
    initialPoData?.lines && initialPoData.lines.length > 0
      ? initialPoData.lines
      : [
          {
            product_id: "",
            product_name: "",
            hsn_code: "",
            batch_no: "",
            expiry_date: "",
            pack_qty: 1,
            loose_qty: 0,
            free_qty: 0,
            units_per_pack: 1,
            purchase_rate: 0,
            discount_percent: 0,
            discount_amount: 0,
            mrp: 0,
            selling_rate: 0,
            gst_percent: 12,
          },
        ]
  );

  // Physical Vendor Invoice Totals Check
  const [vendorSubtotal, setVendorSubtotal] = useState<number | "">("");
  const [vendorTax, setVendorTax] = useState<number | "">("");
  const [vendorGrandTotal, setVendorGrandTotal] = useState<number | "">("");

  // Product Autocomplete / Search Popover
  const [allProducts, setAllProducts] = useState<ProductItem[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null);
  const [productSearchQuery, setProductSearchQuery] = useState("");

  // Duplicate Invoice Warning
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // Modals & Tools
  const [isQuickAddSupplierOpen, setIsQuickAddSupplierOpen] = useState(false);
  const [isDraftsModalOpen, setIsDraftsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"csv" | "ocr">("csv");

  // Post Success Modal
  const [savedPurchaseData, setSavedPurchaseData] = useState<{ id: string; number: string; lines: PurchaseLineItemInput[] } | null>(null);
  const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false);

  // Feedback notifications
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadMasters();
  }, []);

  const loadMasters = async () => {
    const sups = await supplierLedgerService.getAllSuppliers();
    setSuppliers(sups);
    const prods = await sqliteStorage.findAll<ProductItem>("products");
    setAllProducts(prods.filter((p) => p.is_active !== false));
  };

  // Check duplicate invoice when supplier or invoice no changes
  useEffect(() => {
    const checkDup = async () => {
      if (selectedSupplierId && supplierInvoiceNo.trim()) {
        const dup = await purchaseService.checkDuplicateInvoice(selectedSupplierId, supplierInvoiceNo);
        if (dup) {
          setDuplicateWarning(`Invoice #${supplierInvoiceNo} was already recorded as ${dup.purchase_number} on ${dup.purchase_date}!`);
        } else {
          setDuplicateWarning(null);
        }
      } else {
        setDuplicateWarning(null);
      }
    };
    checkDup();
  }, [selectedSupplierId, supplierInvoiceNo]);

  // Adjust due date when supplier credit period changes
  const handleSupplierChange = (supId: string) => {
    setSelectedSupplierId(supId);
    const sup = suppliers.find((s) => s.id === supId);
    if (sup) {
      if (sup.place_of_supply && !sup.place_of_supply.includes("Kerala")) {
        setIsInterstate(true);
      } else {
        setIsInterstate(false);
      }
      if (sup.credit_period_days) {
        const d = new Date(purchaseDate);
        d.setDate(d.getDate() + sup.credit_period_days);
        setDueDate(d.toISOString().slice(0, 10));
      }
    }
  };

  // Grid Manipulation
  const addLine = () => {
    setLines([
      ...lines,
      {
        product_id: "",
        product_name: "",
        hsn_code: "",
        batch_no: "",
        expiry_date: "",
        pack_qty: 1,
        loose_qty: 0,
        free_qty: 0,
        units_per_pack: 1,
        purchase_rate: 0,
        discount_percent: 0,
        discount_amount: 0,
        mrp: 0,
        selling_rate: 0,
        gst_percent: 12,
      },
    ]);
  };

  const updateLine = (idx: number, updates: Partial<PurchaseLineItemInput>) => {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], ...updates };
    setLines(updated);
  };

  const removeLine = (idx: number) => {
    if (lines.length === 1) {
      setLines([
        {
          product_id: "",
          product_name: "",
          batch_no: "",
          expiry_date: "",
          pack_qty: 1,
          units_per_pack: 1,
          purchase_rate: 0,
          gst_percent: 12,
        },
      ]);
    } else {
      setLines(lines.filter((_, i) => i !== idx));
    }
  };

  // Product Selection
  const handleSelectProduct = (idx: number, product: ProductItem) => {
    updateLine(idx, {
      product_id: product.id,
      product_name: product.name,
      hsn_code: product.hsn_sac_code || "",
      units_per_pack: product.units_per_pack || 1,
      purchase_rate: product.ptr || 0,
      mrp: product.mrp || 0,
      selling_rate: product.sel_rate || (product.mrp ? Math.round((product.mrp / (product.units_per_pack || 1)) * 100) / 100 : 0),
      gst_percent: product.gst_percent || 12,
    });
    setActiveSearchIndex(null);
    setProductSearchQuery("");
  };

  // Totals Calculations
  const computeDocumentTotals = () => {
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;
    let totalLinesAmount = 0;

    for (const l of lines) {
      const calc = purchaseService.calculateLineTotals(l, isInterstate);
      subtotal += calc.gross_amount;
      discountTotal += calc.discount_amount;
      taxTotal += calc.total_tax;
      cgstTotal += calc.cgst_amount;
      sgstTotal += calc.sgst_amount;
      igstTotal += calc.igst_amount;
      totalLinesAmount += calc.total_amount;
    }

    const roundOff = Math.round(totalLinesAmount) - totalLinesAmount;
    const grandTotal = totalLinesAmount + roundOff;

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      discountTotal: Math.round(discountTotal * 100) / 100,
      taxTotal: Math.round(taxTotal * 100) / 100,
      cgstTotal: Math.round(cgstTotal * 100) / 100,
      sgstTotal: Math.round(sgstTotal * 100) / 100,
      igstTotal: Math.round(igstTotal * 100) / 100,
      roundOff: Math.round(roundOff * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
    };
  };

  const totals = computeDocumentTotals();
  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);

  // Save Draft
  const handleSaveDraft = async () => {
    try {
      const docInput: PurchaseDocumentInput = {
        supplier_id: selectedSupplierId,
        supplier_name: selectedSupplier?.name || "",
        supplier_invoice_no: supplierInvoiceNo,
        purchase_date: purchaseDate,
        due_date: dueDate,
        place_of_supply: placeOfSupply,
        is_interstate: isInterstate,
        is_rcm: isRcm,
        itc_eligibility: itcEligibility,
        lines: lines.filter((l) => l.product_name.trim().length > 0),
        notes,
      };

      await purchaseDraftService.saveDraft({ document: docInput });
      alert("Draft saved successfully! Press F4 to view drafts.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save draft");
    }
  };

  const handleLoadDraft = (draft: PurchaseDraftItem) => {
    if (draft.payload) {
      if (draft.payload.supplier_id) setSelectedSupplierId(draft.payload.supplier_id);
      if (draft.payload.supplier_invoice_no) setSupplierInvoiceNo(draft.payload.supplier_invoice_no);
      if (draft.payload.purchase_date) setPurchaseDate(draft.payload.purchase_date);
      if (draft.payload.due_date) setDueDate(draft.payload.due_date);
      if (draft.payload.is_interstate !== undefined) setIsInterstate(Boolean(draft.payload.is_interstate));
      if (draft.payload.lines && draft.payload.lines.length > 0) {
        setLines(draft.payload.lines);
      }
      if (draft.payload.notes) setNotes(draft.payload.notes);
    }
  };

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        // Activate search on last line if not active
        setActiveSearchIndex(lines.length - 1);
      } else if (e.key === "F3") {
        e.preventDefault();
        const supSelect = document.getElementById("supplier-select-field");
        supSelect?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        setIsDraftsModalOpen(true);
      } else if (e.key === "F9" || (e.altKey && e.key.toLowerCase() === "s")) {
        e.preventDefault();
        handleSavePurchase();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lines, selectedSupplierId, supplierInvoiceNo, purchaseDate, isInterstate]);

  // Main Save / Post Action
  const handleSavePurchase = async () => {
    setErrorMsg(null);
    if (!selectedSupplierId || !selectedSupplier) {
      setErrorMsg("Please select or add a supplier (F3)");
      return;
    }
    if (!supplierInvoiceNo.trim()) {
      setErrorMsg("Please enter the supplier's physical invoice number");
      return;
    }

    const validLines = lines.filter((l) => l.product_name.trim().length > 0 && l.batch_no.trim().length > 0);
    if (validLines.length === 0) {
      setErrorMsg("Please enter at least one valid item with product name and batch number");
      return;
    }

    // Validate batch expiry
    for (const l of validLines) {
      if (!l.expiry_date || l.expiry_date.trim().length < 4) {
        setErrorMsg(`Please specify a valid expiry date (YYYY-MM-DD or YYYY-MM) for ${l.product_name}`);
        return;
      }
    }

    try {
      setIsSaving(true);
      const purchaseInput: PurchaseDocumentInput = {
        supplier_id: selectedSupplierId,
        supplier_name: selectedSupplier.name,
        supplier_gstin: selectedSupplier.gstin,
        supplier_invoice_no: supplierInvoiceNo.trim(),
        purchase_date: purchaseDate,
        due_date: dueDate || undefined,
        place_of_supply: placeOfSupply,
        is_interstate: isInterstate,
        is_rcm: isRcm,
        itc_eligibility: itcEligibility,
        lines: validLines.map((l) => ({
          ...l,
          product_id: l.product_id || `prod_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
        })),
        notes: notes.trim() || undefined,
        po_id: initialPoData?.po_id,
      };

      const result = await purchaseService.recordInwardPurchaseBill(purchaseInput);
      if (result.success) {
        setSavedPurchaseData({
          id: result.purchaseId,
          number: result.purchaseNumber,
          lines: validLines,
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error saving purchase bill");
    } finally {
      setIsSaving(false);
    }
  };

  // Visual CSV / OCR Parser
  const handleParseImport = () => {
    if (!importText.trim()) return;

    if (importMode === "csv") {
      const parsed = purchaseImportService.parseDelimitedTable(importText);
      const importedLines: PurchaseLineItemInput[] = parsed.records.map((r, i) => ({
        product_id: `prod_imp_${Date.now()}_${i}`,
        product_name: r.item_name || r.product_name || r.name || "Imported Item",
        hsn_code: r.hsn || r.hsn_code || "",
        batch_no: r.batch_no || r.batch || `BAT-${i + 1}`,
        expiry_date: r.expiry_date || r.expiry || "2027-12-31",
        pack_qty: Number(r.pack_qty || r.qty || r.quantity || 1),
        loose_qty: Number(r.loose_qty || 0),
        free_qty: Number(r.free_qty || 0),
        units_per_pack: Number(r.units_per_pack || 1),
        purchase_rate: Number(r.purchase_rate || r.rate || r.ptr || 0),
        discount_percent: Number(r.discount_percent || r.discount || 0),
        discount_amount: Number(r.discount_amount || 0),
        mrp: Number(r.mrp || 0),
        selling_rate: Number(r.selling_rate || r.sel_rate || 0),
        gst_percent: Number(r.gst_percent || r.gst || 12),
      }));

      setLines([...lines.filter((l) => l.product_name.trim().length > 0), ...importedLines]);
      setIsImportModalOpen(false);
    } else {
      const ocr = purchaseImportService.extractInvoiceFromOcrText(importText);
      if (ocr.invoice_number) setSupplierInvoiceNo(ocr.invoice_number);
      if (ocr.invoice_date) setPurchaseDate(ocr.invoice_date);

      const ocrLines: PurchaseLineItemInput[] = ocr.lines.map((l, i) => ({
        product_id: `prod_ocr_${Date.now()}_${i}`,
        product_name: l.product_name,
        hsn_code: l.hsn || "",
        batch_no: l.batch_no || `OCR-B${i + 1}`,
        expiry_date: l.expiry_date || "2027-12-31",
        pack_qty: l.qty,
        loose_qty: 0,
        free_qty: l.free_qty || 0,
        units_per_pack: 1,
        purchase_rate: l.purchase_rate,
        gst_percent: l.gst_percent || 12,
      }));

      setLines([...lines.filter((l) => l.product_name.trim().length > 0), ...ocrLines]);
      setIsImportModalOpen(false);
    }
  };

  const filteredSearchProducts = allProducts
    .filter(
      (p) =>
        p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
        p.barcode?.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
        p.generic_name?.toLowerCase().includes(productSearchQuery.toLowerCase())
    )
    .slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50 overflow-hidden font-sans">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs"
            title="Back to Purchases (Esc)"
          >
            <X className="h-4 w-4 text-slate-500" />
            <span>Close (Esc)</span>
          </button>
          <div className="h-6 w-px bg-slate-200" />
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-blue-50 p-2 text-blue-600 border border-blue-100">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-800">New Inward Purchase Entry</h2>
                <span className="rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                  F9 / Alt+S to Post
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                F2 Product Search | F3 Supplier Select | F4 Drafts | Enter / Tab Next Cell
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setIsDraftsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 shadow-xs hover:bg-slate-50"
          >
            <FileClock className="h-3.5 w-3.5 text-amber-500" />
            <span>Drafts (F4)</span>
          </button>

          <button
            onClick={handleSaveDraft}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 shadow-xs hover:bg-slate-50"
          >
            <Save className="h-3.5 w-3.5 text-blue-600" />
            <span>Save Draft</span>
          </button>

          <button
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 shadow-xs hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            <span>Import CSV/OCR</span>
          </button>
        </div>
      </div>

      {/* Duplicate Warning Banner */}
      {duplicateWarning && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-800 shadow-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>{duplicateWarning}</span>
        </div>
      )}

      {/* Error Alert */}
      {errorMsg && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700 shadow-xs">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Container */}
      <div className="flex-1 flex flex-col overflow-hidden p-4 space-y-3">
        {/* Header Configuration Panel */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6 items-end text-xs">
            {/* Supplier Selector */}
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-slate-700 flex items-center gap-1">
                  <span>Supplier * (F3)</span>
                </label>
                <button
                  type="button"
                  onClick={() => setIsQuickAddSupplierOpen(true)}
                  className="text-[11px] font-bold text-blue-600 hover:underline flex items-center gap-0.5"
                >
                  <Plus className="h-3 w-3" /> Add Supplier
                </button>
              </div>
              <select
                id="supplier-select-field"
                value={selectedSupplierId}
                onChange={(e) => handleSupplierChange(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-medium text-slate-900 focus:border-blue-600 focus:outline-none bg-white"
              >
                <option value="">-- Select Supplier --</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.gstin ? `(${s.gstin.slice(0, 4)}...)` : ""} - Bal: ₹
                    {Number(s.outstanding_balance || 0).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            {/* Supplier Physical Invoice Number */}
            <div>
              <label className="font-bold text-slate-700 block mb-1">Vendor Inv No *</label>
              <input
                type="text"
                value={supplierInvoiceNo}
                onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                placeholder="e.g. INV-8899"
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs font-semibold focus:border-blue-600 focus:outline-none"
              />
            </div>

            {/* Invoice Date */}
            <div>
              <label className="font-bold text-slate-700 block mb-1">Invoice Date</label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-blue-600 focus:outline-none"
              />
            </div>

            {/* Due Date */}
            <div>
              <label className="font-bold text-slate-700 block mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-blue-600 focus:outline-none"
              />
            </div>

            {/* Tax & GST Type */}
            <div>
              <label className="font-bold text-slate-700 block mb-1">Tax Mode</label>
              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isInterstate}
                    onChange={(e) => setIsInterstate(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span className="font-semibold text-purple-700">IGST</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isRcm}
                    onChange={(e) => setIsRcm(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span className="font-semibold text-slate-700">RCM</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Inward Grid Table */}
        <div className="flex-1 rounded-xl border border-slate-300 bg-white shadow-sm flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700 font-bold border-b border-slate-300 shadow-xs">
                <tr>
                  <th className="px-2 py-2.5 w-8 text-center">#</th>
                  <th className="px-2 py-2.5 min-w-[200px]">Product / Item Description (F2)</th>
                  <th className="px-2 py-2.5 w-24">HSN</th>
                  <th className="px-2 py-2.5 w-28">Batch No *</th>
                  <th className="px-2 py-2.5 w-24">Expiry (M/Y)</th>
                  <th className="px-2 py-2.5 w-16 text-center">Packs</th>
                  <th className="px-2 py-2.5 w-16 text-center">Loose</th>
                  <th className="px-2 py-2.5 w-16 text-center">Free</th>
                  <th className="px-2 py-2.5 w-14 text-center">U/P</th>
                  <th className="px-2 py-2.5 w-20 text-right">Rate (₹)</th>
                  <th className="px-2 py-2.5 w-16 text-center">Disc %</th>
                  <th className="px-2 py-2.5 w-16 text-center">GST %</th>
                  <th className="px-2 py-2.5 w-24 text-right">Line Total (₹)</th>
                  <th className="px-2 py-2.5 w-20 text-right">MRP (₹)</th>
                  <th className="px-2 py-2.5 w-20 text-right">Selling (₹)</th>
                  <th className="px-2 py-2.5 w-16 text-center">Margin</th>
                  <th className="px-2 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {lines.map((line, idx) => {
                  const calc = purchaseService.calculateLineTotals(line, isInterstate);
                  const isMarginNegative = calc.margin_percent < 0;
                  const isMarginLow = calc.margin_percent >= 0 && calc.margin_percent < 10;

                  return (
                    <tr key={idx} className="hover:bg-blue-50/40">
                      <td className="px-2 py-1.5 text-center text-slate-400 font-medium">{idx + 1}</td>

                      {/* Product Name & Search */}
                      <td className="px-2 py-1.5 relative">
                        <input
                          type="text"
                          value={line.product_name}
                          onFocus={() => {
                            setActiveSearchIndex(idx);
                            setProductSearchQuery(line.product_name);
                          }}
                          onChange={(e) => {
                            updateLine(idx, { product_name: e.target.value });
                            setProductSearchQuery(e.target.value);
                            setActiveSearchIndex(idx);
                          }}
                          placeholder="Type or scan product (F2)..."
                          className="w-full rounded border border-slate-300 px-2 py-1 font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
                        />

                        {/* Search Dropdown */}
                        {activeSearchIndex === idx && (
                          <div className="absolute left-2 top-10 z-30 w-80 rounded-lg border border-slate-300 bg-white p-2 shadow-2xl">
                            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-1.5">
                              <span className="text-[11px] font-bold text-slate-700">Select Existing Master Item</span>
                              <button
                                onClick={() => setActiveSearchIndex(null)}
                                className="text-slate-400 hover:text-slate-600 text-xs"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="max-h-48 overflow-y-auto space-y-1">
                              {filteredSearchProducts.length === 0 ? (
                                <div className="p-2 text-[11px] text-slate-400 text-center">
                                  No matching items found. (Will create new product on save)
                                </div>
                              ) : (
                                filteredSearchProducts.map((p) => (
                                  <div
                                    key={p.id}
                                    onClick={() => handleSelectProduct(idx, p)}
                                    className="rounded p-1.5 hover:bg-blue-50 cursor-pointer text-left"
                                  >
                                    <div className="font-bold text-slate-800">{p.name}</div>
                                    <div className="text-[10px] text-slate-500 flex justify-between">
                                      <span>MRP: ₹{p.mrp?.toFixed(2)} | PTR: ₹{p.ptr?.toFixed(2) || 0}</span>
                                      <span>Stock: {p.current_stock || 0}</span>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* HSN */}
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={line.hsn_code || ""}
                          onChange={(e) => updateLine(idx, { hsn_code: e.target.value })}
                          placeholder="HSN"
                          className="w-full rounded border border-slate-200 px-1.5 py-1 text-center font-mono"
                        />
                      </td>

                      {/* Batch No */}
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={line.batch_no}
                          onChange={(e) => updateLine(idx, { batch_no: e.target.value.toUpperCase() })}
                          placeholder="Batch #"
                          className="w-full rounded border border-slate-300 px-1.5 py-1 font-mono font-bold uppercase focus:border-blue-600 focus:outline-none"
                        />
                      </td>

                      {/* Expiry */}
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={line.expiry_date}
                          onChange={(e) => updateLine(idx, { expiry_date: e.target.value })}
                          placeholder="YYYY-MM"
                          className="w-full rounded border border-slate-300 px-1.5 py-1 font-mono text-center focus:border-blue-600 focus:outline-none"
                        />
                      </td>

                      {/* Packs */}
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="number"
                          min="0"
                          value={line.pack_qty}
                          onChange={(e) => updateLine(idx, { pack_qty: Number(e.target.value) || 0 })}
                          className="w-14 rounded border border-slate-300 px-1 py-1 text-center font-bold focus:border-blue-600 focus:outline-none"
                        />
                      </td>

                      {/* Loose */}
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="number"
                          min="0"
                          value={line.loose_qty || 0}
                          onChange={(e) => updateLine(idx, { loose_qty: Number(e.target.value) || 0 })}
                          className="w-12 rounded border border-slate-200 px-1 py-1 text-center"
                        />
                      </td>

                      {/* Free Qty */}
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="number"
                          min="0"
                          value={line.free_qty || 0}
                          onChange={(e) => updateLine(idx, { free_qty: Number(e.target.value) || 0 })}
                          className="w-12 rounded border border-slate-200 px-1 py-1 text-center text-emerald-700 font-semibold"
                        />
                      </td>

                      {/* Units per Pack */}
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="number"
                          min="1"
                          value={line.units_per_pack || 1}
                          onChange={(e) => updateLine(idx, { units_per_pack: Math.max(1, Number(e.target.value) || 1) })}
                          className="w-10 rounded border border-slate-200 px-1 py-1 text-center text-slate-500"
                        />
                      </td>

                      {/* Purchase Rate */}
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.purchase_rate}
                          onChange={(e) => updateLine(idx, { purchase_rate: Number(e.target.value) || 0 })}
                          className="w-18 rounded border border-slate-300 px-1.5 py-1 text-right font-bold focus:border-blue-600 focus:outline-none"
                        />
                      </td>

                      {/* Trade Disc % */}
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          value={line.discount_percent || 0}
                          onChange={(e) => updateLine(idx, { discount_percent: Number(e.target.value) || 0 })}
                          className="w-12 rounded border border-slate-200 px-1 py-1 text-center"
                        />
                      </td>

                      {/* GST % */}
                      <td className="px-2 py-1.5 text-center">
                        <select
                          value={line.gst_percent}
                          onChange={(e) => updateLine(idx, { gst_percent: Number(e.target.value) || 0 })}
                          className="rounded border border-slate-200 px-1 py-1 text-center font-medium bg-white"
                        >
                          <option value={0}>0%</option>
                          <option value={5}>5%</option>
                          <option value={12}>12%</option>
                          <option value={18}>18%</option>
                          <option value={28}>28%</option>
                        </select>
                      </td>

                      {/* Line Total */}
                      <td className="px-2 py-1.5 text-right font-bold text-slate-900">
                        ₹{calc.total_amount.toFixed(2)}
                      </td>

                      {/* MRP */}
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.mrp || 0}
                          onChange={(e) => updateLine(idx, { mrp: Number(e.target.value) || 0 })}
                          className="w-16 rounded border border-slate-200 px-1 py-1 text-right text-slate-700"
                        />
                      </td>

                      {/* Selling Rate */}
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.selling_rate || 0}
                          onChange={(e) => updateLine(idx, { selling_rate: Number(e.target.value) || 0 })}
                          className="w-16 rounded border border-slate-300 px-1 py-1 text-right font-semibold text-emerald-800"
                        />
                      </td>

                      {/* Margin % */}
                      <td className="px-2 py-1.5 text-center">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            isMarginNegative
                              ? "bg-red-100 text-red-700"
                              : isMarginLow
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {calc.margin_percent.toFixed(0)}%
                        </span>
                      </td>

                      {/* Delete */}
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => removeLine(idx)}
                          className="p-1 text-slate-300 hover:text-red-600 rounded"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Add Line Button Bar */}
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 flex items-center justify-between">
            <button
              onClick={addLine}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5 text-blue-600" />
              <span>Add Line Item</span>
            </button>

            <span className="text-[11px] text-slate-500 font-medium">
              {lines.length} Line items ({lines.reduce((a, l) => a + (l.pack_qty || 0), 0)} packs)
            </span>
          </div>
        </div>

        {/* Bottom Reconciliation Bar & Posting Controls */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-md flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
          {/* Vendor Physical Invoice Reconciliation Check */}
          <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <span className="font-bold text-slate-700">Vendor Inv Check:</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                placeholder="Physical Total (₹)"
                value={vendorGrandTotal}
                onChange={(e) => setVendorGrandTotal(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-32 rounded border border-slate-300 px-2 py-1 text-xs font-bold focus:border-blue-600 focus:outline-none"
              />
              {vendorGrandTotal !== "" && (
                <span
                  className={`rounded px-2 py-0.5 font-bold text-[11px] ${
                    Math.abs(Number(vendorGrandTotal) - totals.grandTotal) < 0.05
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {Math.abs(Number(vendorGrandTotal) - totals.grandTotal) < 0.05
                    ? "✓ Matched"
                    : `Diff: ₹ ${(Number(vendorGrandTotal) - totals.grandTotal).toFixed(2)}`}
                </span>
              )}
            </div>
          </div>

          {/* Totals Summary */}
          <div className="flex items-center gap-5 text-slate-600 font-medium">
            <div>
              <span>Taxable: </span>
              <span className="font-bold text-slate-900">₹ {totals.subtotal.toFixed(2)}</span>
            </div>
            {totals.discountTotal > 0 && (
              <div>
                <span>Disc: </span>
                <span className="font-bold text-emerald-600">-₹ {totals.discountTotal.toFixed(2)}</span>
              </div>
            )}
            <div>
              <span>Tax: </span>
              <span className="font-bold text-slate-900">₹ {totals.taxTotal.toFixed(2)}</span>
            </div>
            <div>
              <span>Round Off: </span>
              <span className="font-semibold text-slate-700">₹ {totals.roundOff.toFixed(2)}</span>
            </div>
            <div className="border-l border-slate-300 pl-4">
              <span className="text-slate-500">Net Payable: </span>
              <span className="text-base font-black text-blue-700">₹ {totals.grandTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSavePurchase}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 font-black text-white shadow-md hover:bg-blue-700 disabled:opacity-50"
            >
              <CheckCircle className="h-4 w-4" />
              <span>Post Inward Bill (F9)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Supplier Quick Add Modal */}
      {isQuickAddSupplierOpen && (
        <SupplierQuickAddModal
          isOpen={isQuickAddSupplierOpen}
          onClose={() => setIsQuickAddSupplierOpen(false)}
          onSupplierCreated={(s) => {
            setSuppliers([...suppliers, s]);
            handleSupplierChange(s.id);
          }}
        />
      )}

      {/* Purchase Drafts Modal */}
      {isDraftsModalOpen && (
        <PurchaseDraftsModal
          isOpen={isDraftsModalOpen}
          onClose={() => setIsDraftsModalOpen(false)}
          onSelectDraft={handleLoadDraft}
        />
      )}

      {/* CSV / OCR Importer Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50">
              <h3 className="text-sm font-bold text-slate-800">Import Supplier Items</h3>
              <button onClick={() => setIsImportModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex gap-2 border-b border-slate-200 pb-2">
                <button
                  onClick={() => setImportMode("csv")}
                  className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold ${
                    importMode === "csv" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>CSV / TSV Spreadsheet</span>
                </button>
                <button
                  onClick={() => setImportMode("ocr")}
                  className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold ${
                    importMode === "ocr" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  <ScanText className="h-3.5 w-3.5" />
                  <span>OCR Invoice Scanner</span>
                </button>
              </div>
              <textarea
                rows={8}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={
                  importMode === "csv"
                    ? "product_name,batch_no,expiry_date,qty,purchase_rate,gst_percent,mrp,selling_rate\nParacetamol 500mg,PB-101,2027-12-31,10,20,5,30,28"
                    : "TAX INVOICE: SUP-9988\nSupplier: Apex Pharma\nDate: 2026-10-01\nAmoxicillin 500mg BATCH: B-101 EXP: 2027-10-31 10 strips @ 100.00"
                }
                className="w-full rounded-lg border border-slate-300 p-2.5 font-mono text-xs focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 flex justify-end gap-2">
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="rounded border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleParseImport}
                className="rounded bg-blue-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
              >
                Load Items into Grid
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post Success & Barcode Trigger Modal */}
      {savedPurchaseData && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle className="h-8 w-8" />
            </div>

            <div>
              <h3 className="text-base font-black text-slate-900">Purchase Inward Bill Posted!</h3>
              <p className="text-xs text-slate-500 mt-1 font-mono font-semibold text-blue-600">
                {savedPurchaseData.number}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Batch stock credited, supplier ledger updated, and sync event queued.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => setIsBarcodeModalOpen(true)}
                className="flex items-center justify-center gap-2 rounded-xl bg-purple-600 py-2.5 text-xs font-bold text-white shadow-md hover:bg-purple-700"
              >
                <Barcode className="h-4 w-4" />
                <span>Print Barcode Labels for Received Items</span>
              </button>

              <button
                onClick={() => {
                  setSavedPurchaseData(null);
                  onSuccess();
                  onClose();
                }}
                className="rounded-xl border border-slate-300 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                Done / Back to Purchases
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Print Modal for freshly received items */}
      {isBarcodeModalOpen && savedPurchaseData && (
        <BarcodePrintModal
          isOpen={isBarcodeModalOpen}
          onClose={() => {
            setIsBarcodeModalOpen(false);
            setSavedPurchaseData(null);
            onSuccess();
            onClose();
          }}
          items={savedPurchaseData.lines.map((l) => ({
            product_id: l.product_id,
            product_name: l.product_name,
            batch_no: l.batch_no,
            expiry_date: l.expiry_date,
            total_units: (l.pack_qty || 1) * (l.units_per_pack || 1) + (l.loose_qty || 0) + (l.free_qty || 0),
            mrp: l.mrp,
            selling_rate: l.selling_rate,
          }))}
        />
      )}
    </div>
  );
};

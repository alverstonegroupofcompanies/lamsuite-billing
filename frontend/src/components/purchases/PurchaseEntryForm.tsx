import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Truck,
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
  Sliders,
  FileText,
  PauseCircle,
  PlayCircle,
  CreditCard,
  Printer,
  Barcode,
  ArrowUpRight,
  ArrowDownRight,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  purchaseService,
  type PurchaseLineItemInput,
  type PurchaseDocumentInput,
  type PurchaseDocumentRecord,
} from "../../lib/purchases/purchaseService";
import { supplierLedgerService, type SupplierMaster } from "../../lib/purchases/supplierLedgerService";
import { purchaseDraftService, type PurchaseDraftItem } from "../../lib/purchases/purchaseDraftService";
import { productsStore, type ProductItem, type ProductBatch } from "../../lib/masters/productsStore";
import { companySettingsService, type ColumnSetting, type HeaderFieldSetting } from "../../lib/settings/companySettingsService";
import { parseQuantityPrefix } from "../../pages/PosBillingPage";
import { parseQuantityEntry, parseExpiryInput, calculateLineMargin } from "../../lib/purchases/purchaseEntryUtils";
import { SupplierCombobox } from "./SupplierCombobox";
import { PurchaseGridRow } from "./PurchaseGridRow";
import { PurchaseShortcutHintBar, type PurchaseFocusContext } from "./PurchaseShortcutHintBar";
import { PurchasePostSummaryModal, type PostValidationCheckSummary } from "./PurchasePostSummaryModal";
import { PurchasePostSuccessModal } from "./PurchasePostSuccessModal";
import { BillingColumnsModal } from "../BillingColumnsModal";
import { KeyboardShortcutsModal } from "../KeyboardShortcutsModal";
import { ProductQuickAddModal } from "./ProductQuickAddModal";
import { PurchaseDraftsModal } from "./PurchaseDraftsModal";
import { BarcodePrintModal } from "./BarcodePrintModal";
import { PrintPreviewModal } from "../PrintPreviewModal";
import { ConversionModal } from "../ConversionModal";
import { BillDiscountModal } from "../BillDiscountModal";
import { RoundOffModal } from "../RoundOffModal";
import { SupplierPaymentModal } from "./SupplierPaymentModal";
import { useModalEscape } from "../../lib/ui/modalEscapeManager";
import { purchaseImportService } from "../../lib/purchases/purchaseImportService";

interface PurchaseEntryFormProps {
  onClose: () => void;
  onSuccess: () => void;
  initialPoData?: {
    po_id: string;
    supplier_id: string;
    supplier_name: string;
    lines: PurchaseLineItemInput[];
  } | null;
  editPurchaseId?: string | null;
}

export const PurchaseEntryForm: React.FC<PurchaseEntryFormProps> = ({
  onClose,
  onSuccess,
  initialPoData,
  editPurchaseId,
}) => {
  useModalEscape(true, () => {
    if (isEditingCell) {
      cancelCellEdit();
      return;
    }
    if (focusContext === "grid") {
      setSelectedRowIndex(null);
      setFocusContext("entry_row");
      entryProductInputRef.current?.focus();
      return;
    }
    if (confirm("Close purchase bill entry? Any unsaved line items will be lost.")) {
      onClose();
    }
  });

  // Settings & Columns
  const [appSettings, setAppSettings] = useState(() => companySettingsService.getSettings());
  const [purchaseColumns, setPurchaseColumns] = useState<ColumnSetting[]>(() => companySettingsService.getPurchaseColumns());
  const [purchaseHeaders, setPurchaseHeaders] = useState<HeaderFieldSetting[]>(() => companySettingsService.getPurchaseHeaderFields());
  const [isColumnsModalOpen, setIsColumnsModalOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);

  // Bill Document Identification
  const [entryNumber, setEntryNumber] = useState("Loading...");
  const [editingDoc, setEditingDoc] = useState<PurchaseDocumentRecord | null>(null);

  // Supplier & Header Meta
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierMaster | null>(null);
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchaseType, setPurchaseType] = useState<"cash" | "credit">("credit");
  const [dueDate, setDueDate] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState("32-Kerala");
  const [isInterstate, setIsInterstate] = useState(false);
  const [poGrnLink, setPoGrnLink] = useState(initialPoData?.po_id || "");
  const [remarks, setRemarks] = useState("");

  // Grid Lines & Draft Inline Entry Row
  const [lines, setLines] = useState<PurchaseLineItemInput[]>(initialPoData?.lines || []);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [selectedCellCol, setSelectedCellCol] = useState<string>("qty");
  const [isEditingCell, setIsEditingCell] = useState(false);
  const cellEditBackupRef = useRef<PurchaseLineItemInput | null>(null);
  const [focusContext, setFocusContext] = useState<PurchaseFocusContext>("entry_row");
  const [undoDeleteBuffer, setUndoDeleteBuffer] = useState<{ line: PurchaseLineItemInput; index: number } | null>(null);

  const EDITABLE_PURCHASE_COLS = useMemo(
    () => [
      "product_name",
      "batch_no",
      "expiry_date",
      "qty",
      "free_qty",
      "mrp",
      "purchase_rate",
      "discount",
      "gst",
      "selling_rate",
    ],
    []
  );

  const getNavigableCols = useCallback(() => {
    return purchaseColumns
      .filter((c) => c.visible !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((c) => c.id)
      .filter((id) => EDITABLE_PURCHASE_COLS.includes(id));
  }, [purchaseColumns, EDITABLE_PURCHASE_COLS]);

  const startCellEdit = (rowIndex: number, colId: string) => {
    if (!lines[rowIndex]) return;
    if (colId === "product_name") {
      setSelectedLineForConversion(lines[rowIndex]);
      setIsConversionModalOpen(true);
      return;
    }
    cellEditBackupRef.current = { ...lines[rowIndex] };
    setSelectedRowIndex(rowIndex);
    setSelectedCellCol(colId);
    setIsEditingCell(true);
    setFocusContext("cell_edit");
  };

  const saveCellEdit = () => {
    setIsEditingCell(false);
    setFocusContext("grid");
    cellEditBackupRef.current = null;
  };

  const cancelCellEdit = () => {
    if (cellEditBackupRef.current && selectedRowIndex !== null) {
      const backup = cellEditBackupRef.current;
      setLines((prev) => {
        const next = [...prev];
        next[selectedRowIndex] = backup;
        return next;
      });
    }
    setIsEditingCell(false);
    setFocusContext("grid");
    cellEditBackupRef.current = null;
  };

  const updateCommittedLineField = (rowIndex: number, field: keyof PurchaseLineItemInput, value: any) => {
    setLines((prev) => {
      const next = [...prev];
      if (next[rowIndex]) {
        next[rowIndex] = { ...next[rowIndex], [field]: value };
      }
      return next;
    });
  };

  // Permanent Entry Row (Draft line state)
  const [entryDraftProduct, setEntryDraftProduct] = useState<ProductItem | null>(null);
  const [draftLine, setDraftLine] = useState<PurchaseLineItemInput | null>(null);

  // Autocomplete / Search Popover for Entry Row
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProductItem[]>([]);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const entryProductInputRef = useRef<HTMLInputElement | null>(null);

  // Header input refs for keyboard flow
  const supplierInputRef = useRef<HTMLInputElement | null>(null);
  const billNoInputRef = useRef<HTMLInputElement | null>(null);
  const billDateInputRef = useRef<HTMLInputElement | null>(null);
  const purchaseTypeSelectRef = useRef<HTMLSelectElement | null>(null);

  // Totals & Physical Invoice Verification
  const [supplierInvoiceTotal, setSupplierInvoiceTotal] = useState<number | "">("");
  const [freightCharges, setFreightCharges] = useState<number>(0);
  const [manualRoundOff, setManualRoundOff] = useState<number | null>(null);
  const [billDiscountAmount, setBillDiscountAmount] = useState<number>(0);

  // Cache for last purchase rates to show hints and warnings
  const [lastPurchaseMap, setLastPurchaseMap] = useState<Record<string, any>>({});
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // Modals & Action Dialogs
  const [isProductQuickAddOpen, setIsProductQuickAddOpen] = useState(false);
  const [isDraftsModalOpen, setIsDraftsModalOpen] = useState(false);
  const [isRoundOffModalOpen, setIsRoundOffModalOpen] = useState(false);
  const [isBillDiscountModalOpen, setIsBillDiscountModalOpen] = useState(false);
  const [isConversionModalOpen, setIsConversionModalOpen] = useState(false);
  const [selectedLineForConversion, setSelectedLineForConversion] = useState<PurchaseLineItemInput | null>(null);
  const [isPostSummaryModalOpen, setIsPostSummaryModalOpen] = useState(false);
  const [postValidationSummary, setPostValidationSummary] = useState<PostValidationCheckSummary | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [postSuccessData, setPostSuccessData] = useState<{ id: string; number: string; total: number; supplierName: string } | null>(null);
  const [isBarcodePrintModalOpen, setIsBarcodePrintModalOpen] = useState(false);
  const [isPrintPreviewModalOpen, setIsPrintPreviewModalOpen] = useState(false);
  const [isSupplierPaymentModalOpen, setIsSupplierPaymentModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Initial Load: Document Number & Masters
  useEffect(() => {
    loadInitialData();
  }, [editPurchaseId]);

  const showNotification = (message: string, type: "success" | "error" | "info" = "info") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const loadInitialData = async () => {
    try {
      if (editPurchaseId) {
        const existing = await purchaseService.getPurchaseBillById(editPurchaseId);
        if (existing) {
          setEditingDoc(existing.document);
          setEntryNumber(existing.document.purchase_number);
          setSupplierInvoiceNo(existing.document.supplier_invoice_no);
          setPurchaseDate(existing.document.purchase_date);
          setDueDate(existing.document.due_date || "");
          setPlaceOfSupply(existing.document.place_of_supply || "32-Kerala");
          setIsInterstate(Boolean(existing.document.is_interstate));
          setRemarks(existing.document.notes || "");
          setManualRoundOff(existing.document.round_off);

          // Find supplier
          const sups = await supplierLedgerService.getAllSuppliers();
          const sup = sups.find((s) => s.id === existing.document.supplier_id) || null;
          setSelectedSupplier(sup);

          // Lines
          const mappedLines: PurchaseLineItemInput[] = existing.items.map((it) => ({
            product_id: it.product_id,
            product_name: it.product_name,
            hsn_code: it.hsn_code,
            batch_no: it.batch_no,
            expiry_date: it.expiry_date,
            pack_qty: it.pack_qty,
            loose_qty: it.loose_qty,
            free_qty: it.free_qty,
            units_per_pack: it.units_per_pack,
            purchase_rate: it.purchase_rate,
            discount_percent: it.discount_percent,
            discount_amount: it.discount_amount,
            mrp: it.mrp,
            selling_rate: it.selling_rate,
            gst_percent: it.gst_percent,
          }));
          setLines(mappedLines);
          return;
        }
      }

      // If converting from PO
      if (initialPoData) {
        if (initialPoData.supplier_id) {
          const sups = await supplierLedgerService.getAllSuppliers();
          const sup = sups.find((s) => s.id === initialPoData.supplier_id) || null;
          if (sup) handleSupplierSelection(sup, false);
        }
        setLines(initialPoData.lines || []);
      }

      // Generate next purchase number
      const nextNum = await purchaseService.generateNextPurchaseNumber();
      setEntryNumber(nextNum);
    } catch {
      setEntryNumber("PB-NEW");
    }
  };

  // Check duplicate vendor invoice when supplier or bill no changes
  useEffect(() => {
    const checkDup = async () => {
      if (selectedSupplier && supplierInvoiceNo.trim()) {
        const dup = await purchaseService.checkDuplicateInvoice(
          selectedSupplier.id,
          supplierInvoiceNo.trim(),
          editPurchaseId || undefined
        );
        if (dup) {
          setDuplicateWarning(
            `Invoice #${supplierInvoiceNo} was already recorded as ${dup.purchase_number} on ${dup.purchase_date}!`
          );
        } else {
          setDuplicateWarning(null);
        }
      } else {
        setDuplicateWarning(null);
      }
    };
    checkDup();
  }, [selectedSupplier, supplierInvoiceNo, editPurchaseId]);

  // Handle supplier change with auto-tax and credit days calculation
  const handleSupplierSelection = (sup: SupplierMaster | null, autoAdvance = true) => {
    setSelectedSupplier(sup);
    if (!sup) return;

    // Detect state & interstate from GSTIN or place of supply
    const homeState = (appSettings.state_code || "32").trim();
    const gstinState = sup.gstin && sup.gstin.length >= 2 ? sup.gstin.slice(0, 2) : "";
    const placeState = sup.place_of_supply && sup.place_of_supply.slice(0, 2).match(/^\d{2}$/)
      ? sup.place_of_supply.slice(0, 2)
      : "";
    const supState = gstinState || placeState || homeState;

    const isInter = supState !== "" && supState !== homeState;
    setIsInterstate(isInter);
    setPlaceOfSupply(sup.place_of_supply || `${supState}-State`);

    // Calculate due date from credit period
    if (sup.credit_period_days) {
      const d = new Date(purchaseDate);
      d.setDate(d.getDate() + sup.credit_period_days);
      setDueDate(d.toISOString().slice(0, 10));
    }

    if (autoAdvance) {
      billNoInputRef.current?.focus();
      billNoInputRef.current?.select();
    }
  };

  // Search position updates
  const updateDropdownPosition = useCallback(() => {
    if (entryProductInputRef.current) {
      const rect = entryProductInputRef.current.getBoundingClientRect();
      const minDropdownWidth = Math.max(rect.width, 480);
      let left = rect.left;
      if (left + minDropdownWidth > window.innerWidth - 16) {
        left = Math.max(16, window.innerWidth - minDropdownWidth - 16);
      }
      setDropdownPosition({
        top: rect.bottom + 4,
        left,
        width: minDropdownWidth,
      });
    }
  }, []);

  // Update draftLine when entryDraftProduct changes
  useEffect(() => {
    if (!entryDraftProduct) {
      setDraftLine(null);
      return;
    }

    // Check if we have last purchase details cached
    const cached = lastPurchaseMap[entryDraftProduct.id];

    const initialRate = cached?.rate || entryDraftProduct.ptr || 0;
    const initialMrp = cached?.mrp || entryDraftProduct.mrp || 0;
    const initialUnitsPerPack = cached?.units_per_pack || entryDraftProduct.units_per_pack || 1;
    const initialSellRate = cached?.selling_rate || entryDraftProduct.sel_rate || (initialMrp ? initialMrp / initialUnitsPerPack : 0);
    const initialDiscount = cached?.discount_percent || 0;
    const initialGst = cached?.gst_percent ?? entryDraftProduct.gst_percent ?? 12;

    const newDraft: PurchaseLineItemInput = {
      product_id: entryDraftProduct.id,
      product_name: entryDraftProduct.name,
      hsn_code: entryDraftProduct.hsn_sac_code || "",
      batch_no: "",
      expiry_date: "",
      pack_qty: 1,
      loose_qty: 0,
      free_qty: 0,
      units_per_pack: initialUnitsPerPack,
      purchase_rate: initialRate,
      discount_percent: initialDiscount,
      discount_amount: 0,
      mrp: initialMrp,
      selling_rate: initialSellRate,
      gst_percent: initialGst,
    };

    setDraftLine(newDraft);

    // Fetch latest purchase details if not yet in cache
    if (!cached) {
      purchaseService.getLastPurchaseForItem(entryDraftProduct.id, selectedSupplier?.id).then((last) => {
        if (last) {
          setLastPurchaseMap((prev) => ({ ...prev, [entryDraftProduct.id]: last }));
          setDraftLine((prev) =>
            prev
              ? {
                  ...prev,
                  purchase_rate: prev.purchase_rate || last.rate,
                  mrp: prev.mrp || last.mrp || 0,
                  units_per_pack: last.units_per_pack || prev.units_per_pack,
                  selling_rate: prev.selling_rate || last.selling_rate || 0,
                  discount_percent: prev.discount_percent || last.discount_percent || 0,
                }
              : null
          );
        }
      });
    }
  }, [entryDraftProduct]);

  // Compute Totals (including draftLine immediately)
  const computedTotals = useMemo(() => {
    let subtotal = 0;
    let discountTotal = billDiscountAmount;
    let taxTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;
    let totalLinesAmount = 0;
    let totalUnits = 0;

    // All committed lines
    for (const l of lines) {
      const calc = purchaseService.calculateLineTotals(l, isInterstate);
      subtotal += calc.gross_amount;
      discountTotal += calc.discount_amount;
      taxTotal += calc.total_tax;
      cgstTotal += calc.cgst_amount;
      sgstTotal += calc.sgst_amount;
      igstTotal += calc.igst_amount;
      totalLinesAmount += calc.total_amount;
      totalUnits += calc.total_stock_units;
    }

    // Immediately include draftLine in totals if product is selected
    if (draftLine && draftLine.product_name) {
      const draftCalc = purchaseService.calculateLineTotals(draftLine, isInterstate);
      subtotal += draftCalc.gross_amount;
      discountTotal += draftCalc.discount_amount;
      taxTotal += draftCalc.total_tax;
      cgstTotal += draftCalc.cgst_amount;
      sgstTotal += draftCalc.sgst_amount;
      igstTotal += draftCalc.igst_amount;
      totalLinesAmount += draftCalc.total_amount;
      totalUnits += draftCalc.total_stock_units;
    }

    const netBeforeRound = totalLinesAmount + freightCharges - billDiscountAmount;
    const roundOff = manualRoundOff !== null ? manualRoundOff : Math.round(netBeforeRound) - netBeforeRound;
    const grandTotal = Math.max(0, netBeforeRound + roundOff);

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      discountTotal: Math.round(discountTotal * 100) / 100,
      taxTotal: Math.round(taxTotal * 100) / 100,
      cgstTotal: Math.round(cgstTotal * 100) / 100,
      sgstTotal: Math.round(sgstTotal * 100) / 100,
      igstTotal: Math.round(igstTotal * 100) / 100,
      freightCharges: Math.round(freightCharges * 100) / 100,
      roundOff: Math.round(roundOff * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
      itemCount: lines.length + (draftLine && draftLine.product_name ? 1 : 0),
      totalUnits,
    };
  }, [lines, draftLine, isInterstate, freightCharges, manualRoundOff, billDiscountAmount]);

  // Live difference with physical Supplier Invoice Total
  const invoiceDiff = useMemo(() => {
    if (supplierInvoiceTotal === "" || isNaN(Number(supplierInvoiceTotal))) {
      return null;
    }
    const entered = Number(supplierInvoiceTotal);
    const diff = Math.round((entered - computedTotals.grandTotal) * 100) / 100;
    return {
      entered,
      diff,
      isMatch: Math.abs(diff) < 0.05,
      isOver: diff > 0.05,
      isShort: diff < -0.05,
    };
  }, [supplierInvoiceTotal, computedTotals.grandTotal]);

  // Commit Entry Row into lines
  const commitEntryRow = () => {
    if (!draftLine || !draftLine.product_name) {
      entryProductInputRef.current?.focus();
      return;
    }

    if (!draftLine.batch_no.trim()) {
      showNotification("Please specify batch number", "error");
      return;
    }

    if (!draftLine.expiry_date.trim()) {
      showNotification("Please specify expiry date (MM/YY)", "error");
      return;
    }

    const exp = parseExpiryInput(draftLine.expiry_date);
    if (!exp.isValid) {
      showNotification("Invalid expiry date format (use MM/YY)", "error");
      return;
    }

    if (exp.isExpired) {
      showNotification("Cannot inward expired batch!", "error");
      return;
    }

    // Add draftLine to committed lines
    const finalLine: PurchaseLineItemInput = {
      ...draftLine,
      expiry_date: exp.isoDate,
    };

    setLines((prev) => [...prev, finalLine]);

    // Reset draft and return focus to product search
    setEntryDraftProduct(null);
    setDraftLine(null);
    setSearchQuery("");
    setSearchResults([]);

    setTimeout(() => {
      entryProductInputRef.current?.focus();
    }, 40);
  };

  // Clear draft line / reset entry row
  const clearDraftLine = () => {
    setEntryDraftProduct(null);
    setDraftLine(null);
    setSearchQuery("");
    setSearchResults([]);
    setTimeout(() => {
      entryProductInputRef.current?.focus();
    }, 40);
  };

  // Remove committed line with Undo buffer (Ctrl+Z)
  const removeCommittedLine = (index: number) => {
    const target = lines[index];
    if (!target) return;
    setUndoDeleteBuffer({ line: target, index });
    setLines((prev) => prev.filter((_, i) => i !== index));
    showNotification(`Deleted ${target.product_name}. Press Ctrl+Z to undo.`);
  };

  // Undo line deletion
  const undoLineDelete = () => {
    if (!undoDeleteBuffer) return;
    const updated = [...lines];
    updated.splice(undoDeleteBuffer.index, 0, undoDeleteBuffer.line);
    setLines(updated);
    setSelectedRowIndex(undoDeleteBuffer.index);
    const navCols = getNavigableCols();
    setSelectedCellCol(navCols.includes("qty") ? "qty" : navCols[0] || "product_name");
    setFocusContext("grid");
    const restoredName = undoDeleteBuffer.line.product_name;
    setUndoDeleteBuffer(null);
    showNotification(`Restored ${restoredName}`);
  };

  // Product Search & Barcode input handler
  const handleProductSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (searchResults.length > 0) {
        setSelectedSearchIndex((prev) => (prev + 1 >= searchResults.length ? 0 : prev + 1));
      } else if (lines.length > 0) {
        setSelectedRowIndex(0);
        const navCols = getNavigableCols();
        setSelectedCellCol(navCols.includes("qty") ? "qty" : navCols[0] || "product_name");
        setFocusContext("grid");
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (searchResults.length > 0) {
        setSelectedSearchIndex((prev) => (prev - 1 < 0 ? searchResults.length - 1 : prev - 1));
      } else if (lines.length > 0) {
        setSelectedRowIndex(lines.length - 1);
        const navCols = getNavigableCols();
        setSelectedCellCol(navCols.includes("qty") ? "qty" : navCols[0] || "product_name");
        setFocusContext("grid");
      } else {
        supplierInputRef.current?.focus();
        setFocusContext("header");
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = searchQuery.trim();
      if (!trimmed) {
        // If entry row is already filled with a product, advance to batch
        if (draftLine) {
          commitEntryRow();
        }
        return;
      }

      const { qty, query } = parseQuantityPrefix(trimmed);

      // If dropdown has highlighted item
      if (searchResults.length > 0 && selectedSearchIndex < searchResults.length) {
        const prod = searchResults[selectedSearchIndex];
        selectProductForEntry(prod, qty);
        return;
      }

      // Barcode lookup or exact match
      const barcodeMatch = await productsStore.findProductByBarcode(query);
      if (barcodeMatch) {
        selectProductForEntry(barcodeMatch, qty);
      } else {
        const matches = await productsStore.searchProducts(query);
        if (matches.length > 0) {
          selectProductForEntry(matches[0], qty);
        } else {
          // Prompt inline product add (Ctrl+N)
          setIsProductQuickAddOpen(true);
        }
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (searchQuery) {
        setSearchQuery("");
        setSearchResults([]);
      } else if (draftLine) {
        clearDraftLine();
      }
    }
  };

  const selectProductForEntry = (product: ProductItem, prefixQty = 1) => {
    setEntryDraftProduct(product);
    setSearchQuery("");
    setSearchResults([]);
    setFocusContext("entry_row");
  };

  // Global Keyboard Navigation Listener
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // ? : Keyboard shortcuts cheatsheet modal
      if (e.key === "?" && !isCmdOrCtrl) {
        const activeTag = (document.activeElement?.tagName || "").toLowerCase();
        if (activeTag !== "input" && activeTag !== "textarea") {
          e.preventDefault();
          setIsShortcutsModalOpen(true);
          return;
        }
      }

      // F1 or / : Jump focus to entry row product cell
      if (e.key === "F1" || (e.key === "/" && (document.activeElement?.tagName || "").toLowerCase() !== "input")) {
        e.preventDefault();
        entryProductInputRef.current?.focus();
        entryProductInputRef.current?.select();
        setFocusContext("entry_row");
        return;
      }

      // --- Grid Line & Cell Traversal Mode ---
      if (focusContext === "grid" && !isEditingCell) {
        // ArrowUp: move to previous line
        if (e.key === "ArrowUp") {
          e.preventDefault();
          if (selectedRowIndex !== null && selectedRowIndex > 0) {
            setSelectedRowIndex(selectedRowIndex - 1);
          }
          return;
        }

        // ArrowDown: move to next line, or return to entry row from last line
        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (selectedRowIndex !== null) {
            if (selectedRowIndex >= lines.length - 1) {
              // Return to entry row at bottom!
              setSelectedRowIndex(null);
              setFocusContext("entry_row");
              setTimeout(() => {
                entryProductInputRef.current?.focus();
                entryProductInputRef.current?.select();
              }, 20);
            } else {
              setSelectedRowIndex(selectedRowIndex + 1);
            }
          }
          return;
        }

        // ArrowLeft: move to previous cell in row
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const navCols = getNavigableCols();
          const curIdx = navCols.indexOf(selectedCellCol);
          if (curIdx > 0) {
            setSelectedCellCol(navCols[curIdx - 1]);
          }
          return;
        }

        // ArrowRight: move to next cell in row
        if (e.key === "ArrowRight") {
          e.preventDefault();
          const navCols = getNavigableCols();
          const curIdx = navCols.indexOf(selectedCellCol);
          if (curIdx >= 0 && curIdx < navCols.length - 1) {
            setSelectedCellCol(navCols[curIdx + 1]);
          }
          return;
        }

        // Enter: start inline editing for selected cell
        if (e.key === "Enter") {
          e.preventDefault();
          if (selectedRowIndex !== null && lines[selectedRowIndex]) {
            startCellEdit(selectedRowIndex, selectedCellCol);
          }
          return;
        }

        // Delete or Backspace: remove line with undo buffer
        if (e.key === "Delete" || (e.key === "Backspace" && (document.activeElement?.tagName || "").toLowerCase() !== "input")) {
          e.preventDefault();
          if (selectedRowIndex !== null) {
            const idxToRemove = selectedRowIndex;
            removeCommittedLine(idxToRemove);
            if (lines.length <= 1) {
              setSelectedRowIndex(null);
              setFocusContext("entry_row");
              setTimeout(() => entryProductInputRef.current?.focus(), 20);
            } else {
              setSelectedRowIndex(Math.min(idxToRemove, lines.length - 2));
            }
          }
          return;
        }

        // Esc: exit grid line selection and return to entry row
        if (e.key === "Escape") {
          e.preventDefault();
          setSelectedRowIndex(null);
          setFocusContext("entry_row");
          setTimeout(() => entryProductInputRef.current?.focus(), 20);
          return;
        }
      }

      // Alt+S : Focus Supplier
      if (e.altKey && key === "s") {
        e.preventDefault();
        supplierInputRef.current?.focus();
        setFocusContext("header");
        return;
      }

      // Alt+B : Focus Supplier Bill Number
      if (e.altKey && key === "b") {
        e.preventDefault();
        billNoInputRef.current?.focus();
        billNoInputRef.current?.select();
        setFocusContext("header");
        return;
      }

      // Alt+D : Focus Bill Date
      if (e.altKey && key === "d") {
        e.preventDefault();
        billDateInputRef.current?.focus();
        setFocusContext("header");
        return;
      }

      // Alt+T : Focus Purchase Type (Cash/Credit)
      if (e.altKey && key === "t") {
        e.preventDefault();
        purchaseTypeSelectRef.current?.focus();
        setFocusContext("header");
        return;
      }

      // Alt+F : Focus Freight charges
      if (e.altKey && key === "f") {
        e.preventDefault();
        const freightEl = document.getElementById("freight-input-field");
        freightEl?.focus();
        return;
      }

      // Alt+I : Focus Supplier Invoice Total
      if (e.altKey && key === "i") {
        e.preventDefault();
        const invTotalEl = document.getElementById("supplier-invoice-total-input");
        invTotalEl?.focus();
        return;
      }

      // Alt+R : Open Round-off Modal
      if (e.altKey && key === "r") {
        e.preventDefault();
        setIsRoundOffModalOpen(true);
        return;
      }

      // Ctrl+F2 : Overall Bill Discount Modal
      if (isCmdOrCtrl && e.key === "F2") {
        e.preventDefault();
        setIsBillDiscountModalOpen(true);
        return;
      }

      // Ctrl+Shift+C : Configure Columns
      if (isCmdOrCtrl && e.shiftKey && key === "c") {
        e.preventDefault();
        setIsColumnsModalOpen(true);
        return;
      }

      // Ctrl+N : Quick Add New Product inline
      if (isCmdOrCtrl && !e.shiftKey && key === "n") {
        e.preventDefault();
        setIsProductQuickAddOpen(true);
        return;
      }

      // Ctrl+Shift+N : Start New Bill
      if (isCmdOrCtrl && e.shiftKey && key === "n") {
        e.preventDefault();
        resetToNewBill();
        return;
      }

      // Ctrl+Z : Undo Line Delete
      if (isCmdOrCtrl && key === "z" && undoDeleteBuffer) {
        e.preventDefault();
        undoLineDelete();
        return;
      }

      // F6 : Find Past Bills
      if (e.key === "F6") {
        e.preventDefault();
        onClose();
        return;
      }

      // F8 : Save as Draft
      if (e.key === "F8") {
        e.preventDefault();
        handleSaveDraft();
        return;
      }

      // F9 : Recall Draft
      if (e.key === "F9") {
        e.preventDefault();
        setIsDraftsModalOpen(true);
        return;
      }

      // F12 : Open Post Validation & Summary
      if (e.key === "F12" && !e.shiftKey) {
        e.preventDefault();
        openPostSummary();
        return;
      }

      // Shift+F12 : Post & Print Labels
      if (e.key === "F12" && e.shiftKey) {
        e.preventDefault();
        openPostSummary(true);
        return;
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    lines,
    draftLine,
    selectedSupplier,
    supplierInvoiceNo,
    undoDeleteBuffer,
    freightCharges,
    manualRoundOff,
    focusContext,
    isEditingCell,
    selectedRowIndex,
    selectedCellCol,
    getNavigableCols,
  ]);

  // Open Post Summary Modal and run verification checks
  const openPostSummary = (autoPrintLabels = false) => {
    if (!selectedSupplier) {
      showNotification("Please select a supplier (Alt+S)", "error");
      supplierInputRef.current?.focus();
      return;
    }

    if (!supplierInvoiceNo.trim()) {
      showNotification("Please enter supplier bill number (Alt+B)", "error");
      billNoInputRef.current?.focus();
      return;
    }

    const allLinesToPost = [...lines];
    if (draftLine && draftLine.product_name) {
      if (draftLine.batch_no && draftLine.expiry_date) {
        allLinesToPost.push(draftLine);
      }
    }

    if (allLinesToPost.length === 0) {
      showNotification("Cannot post empty purchase bill. Add at least one item [F1].", "error");
      entryProductInputRef.current?.focus();
      return;
    }

    // Run verification checks
    const expiredBatches: { product_name: string; batch_no: string; expiry_date: string }[] = [];
    const nearExpiryBatches: { product_name: string; batch_no: string; expiry_date: string }[] = [];
    const negativeMarginItems: { product_name: string; margin: number; purchase_rate: number; selling_rate: number }[] = [];
    const missingHsnGstItems: { product_name: string }[] = [];

    for (const l of allLinesToPost) {
      const exp = parseExpiryInput(l.expiry_date);
      if (exp.isExpired) {
        expiredBatches.push({ product_name: l.product_name, batch_no: l.batch_no, expiry_date: l.expiry_date });
      } else if (exp.isNearExpiry) {
        nearExpiryBatches.push({ product_name: l.product_name, batch_no: l.batch_no, expiry_date: l.expiry_date });
      }

      const margin = calculateLineMargin(l.purchase_rate, l.selling_rate || 0, l.units_per_pack || 1);
      if (margin.isNegative) {
        negativeMarginItems.push({
          product_name: l.product_name,
          margin: margin.marginPercent,
          purchase_rate: l.purchase_rate,
          selling_rate: l.selling_rate || 0,
        });
      }

      if (!l.hsn_code || l.hsn_code.trim().length === 0) {
        missingHsnGstItems.push({ product_name: l.product_name });
      }
    }

    const hasBlockers = expiredBatches.length > 0;
    const diff = supplierInvoiceTotal !== "" ? Number(supplierInvoiceTotal) - computedTotals.grandTotal : 0;

    setPostValidationSummary({
      supplierName: selectedSupplier.name,
      supplierInvoiceNo: supplierInvoiceNo.trim(),
      purchaseDate,
      itemCount: allLinesToPost.length,
      totalUnits: computedTotals.totalUnits,
      netPayable: computedTotals.grandTotal,
      supplierInvoiceTotal: supplierInvoiceTotal !== "" ? Number(supplierInvoiceTotal) : undefined,
      difference: diff,
      duplicateWarning: duplicateWarning || undefined,
      expiredBatches,
      nearExpiryBatches,
      negativeMarginItems,
      missingHsnGstItems,
      hasBlockers,
    });

    setIsPostSummaryModalOpen(true);
  };

  // Perform Final Post Transaction
  const handleConfirmPost = async () => {
    if (!selectedSupplier) return;

    try {
      setIsPosting(true);

      const allLinesToPost = [...lines];
      if (draftLine && draftLine.product_name && draftLine.batch_no && draftLine.expiry_date) {
        allLinesToPost.push(draftLine);
      }

      const docInput: PurchaseDocumentInput = {
        purchase_number: entryNumber.startsWith("PB-") ? entryNumber : undefined,
        supplier_id: selectedSupplier.id,
        supplier_name: selectedSupplier.name,
        supplier_gstin: selectedSupplier.gstin,
        supplier_invoice_no: supplierInvoiceNo.trim(),
        purchase_date: purchaseDate,
        due_date: dueDate || undefined,
        place_of_supply: placeOfSupply,
        is_interstate: isInterstate,
        lines: allLinesToPost,
        round_off: computedTotals.roundOff,
        notes: remarks.trim() || undefined,
        po_id: poGrnLink || undefined,
      };

      let result;
      if (editingDoc) {
        result = await purchaseService.updatePurchaseBill(editingDoc.id, docInput, "Revised via Purchase Inward Screen");
      } else {
        result = await purchaseService.recordInwardPurchaseBill(docInput);
      }

      if (result.success) {
        setIsPostSummaryModalOpen(false);
        setPostSuccessData({
          id: result.purchaseId,
          number: result.purchaseNumber,
          total: computedTotals.grandTotal,
          supplierName: selectedSupplier.name,
        });
      }
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Failed to post purchase bill", "error");
    } finally {
      setIsPosting(false);
    }
  };

  // Save Draft
  const handleSaveDraft = async () => {
    if (!selectedSupplier && lines.length === 0) {
      showNotification("Nothing to save in draft", "error");
      return;
    }

    try {
      const docInput: PurchaseDocumentInput = {
        supplier_id: selectedSupplier?.id || "",
        supplier_name: selectedSupplier?.name || "Untitled Supplier",
        supplier_invoice_no: supplierInvoiceNo,
        purchase_date: purchaseDate,
        due_date: dueDate,
        place_of_supply: placeOfSupply,
        is_interstate: isInterstate,
        lines,
        notes: remarks,
      };

      await purchaseDraftService.saveDraft({ document: docInput });
      showNotification("Draft held successfully! Press F9 to recall.");
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Failed to save draft", "error");
    }
  };

  // Load Draft
  const handleRecallDraft = (draft: PurchaseDraftItem) => {
    if (draft.payload) {
      if (draft.payload.supplier_invoice_no) setSupplierInvoiceNo(draft.payload.supplier_invoice_no);
      if (draft.payload.purchase_date) setPurchaseDate(draft.payload.purchase_date);
      if (draft.payload.due_date) setDueDate(draft.payload.due_date);
      if (draft.payload.lines && draft.payload.lines.length > 0) {
        setLines(draft.payload.lines);
      }
      if (draft.payload.notes) setRemarks(draft.payload.notes);
      showNotification(`Recalled draft for ${draft.payload.supplier_name}`);
    }
    setIsDraftsModalOpen(false);
  };

  // Reset to New Bill
  const resetToNewBill = () => {
    setEditingDoc(null);
    setSelectedSupplier(null);
    setSupplierInvoiceNo("");
    setLines([]);
    setDraftLine(null);
    setEntryDraftProduct(null);
    setSearchQuery("");
    setSearchResults([]);
    setSupplierInvoiceTotal("");
    setFreightCharges(0);
    setManualRoundOff(null);
    setBillDiscountAmount(0);
    setPostSuccessData(null);
    purchaseService.generateNextPurchaseNumber().then((n) => setEntryNumber(n));
    setTimeout(() => {
      supplierInputRef.current?.focus();
    }, 40);
  };

  const visibleColumns = purchaseColumns
    .filter((c) => c.visible !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[var(--color-canvas)] text-[var(--color-text)] font-sans select-none overflow-hidden animate-in fade-in duration-100">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-[9999] flex items-center gap-2 rounded-[10px] p-3 text-xs font-semibold shadow-modal border ${
            notification.type === "success"
              ? "bg-[var(--color-surface)] text-[var(--color-success-text)] border-[var(--color-success-border)]"
              : notification.type === "error"
              ? "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] border-[var(--color-danger-border)]"
              : "bg-[var(--color-surface)] text-[var(--color-accent)] border-[var(--color-border)]"
          }`}
        >
          {notification.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Editing Mode Banner */}
      {editingDoc && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="font-bold">Editing Inward Bill: {editingDoc.purchase_number}</span>
            <span className="opacity-80">
              (Original Total: ₹{editingDoc.grand_total.toFixed(2)} • Billed on {editingDoc.purchase_date})
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-amber-700 dark:text-amber-300 font-medium hidden sm:inline">
              Changes will atomically reverse previous stock &amp; ledger effects upon Save (F12)
            </span>
            <button
              onClick={() => {
                setEditingDoc(null);
                resetToNewBill();
              }}
              className="rounded bg-amber-200 dark:bg-amber-900 px-2.5 py-0.5 text-xs font-bold text-amber-950 dark:text-amber-100 hover:opacity-90 cursor-pointer"
            >
              Cancel Editing
            </button>
          </div>
        </div>
      )}

      {/* Top Header Strip: Supplier & Bill Meta (POS layout language) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* Entry Number */}
          <div className="shrink-0">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block">
              Inward Entry No
            </span>
            <p className="text-xs font-bold font-mono text-[var(--color-accent)]">{entryNumber}</p>
          </div>

          <div className="h-6 w-px bg-[var(--color-border)] hidden sm:block" />

          {/* Supplier Combobox with type-ahead & quick add */}
          <div className="w-64 sm:w-72">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-0.5">
              Supplier * (Alt+S)
            </span>
            <SupplierCombobox
              value={selectedSupplier?.name || ""}
              selectedSupplier={selectedSupplier}
              inputRef={supplierInputRef}
              onChange={handleSupplierSelection}
              onEnterAdvance={() => {
                billNoInputRef.current?.focus();
                billNoInputRef.current?.select();
              }}
            />
          </div>

          {/* Supplier Physical Invoice Number */}
          <div className="w-32">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-0.5">
              Vendor Bill No * (Alt+B)
            </span>
            <input
              ref={billNoInputRef}
              type="text"
              value={supplierInvoiceNo}
              onChange={(e) => setSupplierInvoiceNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  billDateInputRef.current?.focus();
                }
              }}
              placeholder="INV-001"
              className="w-full font-mono font-semibold text-xs rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </div>

          {/* Bill Date */}
          <div className="w-28">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-0.5">
              Bill Date (Alt+D)
            </span>
            <input
              ref={billDateInputRef}
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  purchaseTypeSelectRef.current?.focus();
                }
              }}
              className="w-full font-mono text-xs rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </div>

          {/* Purchase Type (Cash/Credit) */}
          <div className="w-28">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-0.5">
              Type (Alt+T)
            </span>
            <select
              ref={purchaseTypeSelectRef}
              value={purchaseType}
              onChange={(e) => setPurchaseType(e.target.value as "cash" | "credit")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  entryProductInputRef.current?.focus();
                  setFocusContext("entry_row");
                }
              }}
              className="w-full text-xs font-semibold rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
            >
              <option value="credit">Credit</option>
              <option value="cash">Cash</option>
            </select>
          </div>

          {/* Place of Supply / GST Badge */}
          <div className="hidden lg:block">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-0.5">
              GST Tax Mode
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-[8px] text-[11px] font-bold border ${
                isInterstate
                  ? "bg-[var(--color-warning-bg)]/40 text-[var(--color-warning-text)] border-[var(--color-warning-border)]"
                  : "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent-soft)]"
              }`}
            >
              {isInterstate ? "IGST (Inter-state)" : "CGST + SGST (Intra-state)"}
            </span>
          </div>

          {/* Remarks */}
          <div className="w-32 hidden xl:block">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-0.5">
              Remarks
            </span>
            <input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Inward Notes"
              className="w-full text-xs rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </div>
        </div>

        {/* Header Action Buttons in POS Style */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsColumnsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text)] shadow-2xs transition-colors cursor-pointer"
            title="Configure Inward Columns & Layout Presets (Ctrl+Shift+C)"
          >
            <Sliders className="h-3.5 w-3.5 text-[var(--color-accent)]" />
            <span className="hidden sm:inline">Columns (Ctrl+Shift+C)</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-surface-subtle)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
            title="Find Past Inward Bills / Purchase Register (F6)"
          >
            <FileText className="h-3.5 w-3.5 text-[var(--color-accent)]" />
            <span className="hidden md:inline">Find Bill (F6)</span>
          </button>

          <button
            type="button"
            onClick={handleSaveDraft}
            className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-warning-text)] hover:opacity-90 cursor-pointer"
            title="Save as Inward Draft (F8)"
          >
            <PauseCircle className="h-3.5 w-3.5" />
            <span>Hold (F8)</span>
          </button>

          <button
            type="button"
            onClick={() => setIsDraftsModalOpen(true)}
            className="relative flex items-center gap-1.5 rounded-[10px] bg-[var(--color-accent-soft)] border border-[var(--color-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:opacity-90 cursor-pointer"
            title="Recall Saved Drafts (F9)"
          >
            <PlayCircle className="h-3.5 w-3.5" />
            <span>Recall (F9)</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] border border-[var(--color-border)] p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Grid Workspace */}
      <div className="flex flex-1 flex-col overflow-hidden bg-[var(--color-surface)]">
        <div className="flex-1 overflow-auto">
          <table role="grid" aria-label="Purchase Inward Items" className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--color-surface-subtle)] border-b border-[var(--color-border)] text-[var(--color-text-muted)] z-10">
              <tr>
                {visibleColumns.map((col) => {
                  let alignClass = "text-left";
                  if (["idx", "qty", "free_qty", "discount", "gst", "actions", "margin", "hsn", "scheme"].includes(col.id)) {
                    alignClass = "text-center";
                  } else if (["mrp", "ptr", "pts", "ptss", "purchase_rate", "selling_rate", "taxable_value", "tax", "total", "discount_amount"].includes(col.id)) {
                    alignClass = "text-right";
                  }
                  return (
                    <th
                      key={col.id}
                      style={col.width ? { width: `${col.width}px` } : undefined}
                      className={`px-2.5 py-2 ${alignClass} text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]`}
                    >
                      {col.id === "gst" && isInterstate ? "IGST %" : col.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {lines.length === 0 && !draftLine ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="py-12 text-center text-[var(--color-text-muted)]">
                    <Barcode className="mx-auto h-7 w-7 text-[var(--color-text-faint)] mb-1.5" />
                    <p className="font-semibold text-xs text-[var(--color-text)]">Inward bill items list is empty</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Scan product barcode or type product name in the row below [F1]
                    </p>
                  </td>
                </tr>
              ) : (
                lines.map((line, idx) => (
                  <PurchaseGridRow
                    key={`${line.product_id}_${line.batch_no}_${idx}`}
                    idx={idx}
                    line={line}
                    isSelected={selectedRowIndex === idx && (focusContext === "grid" || focusContext === "cell_edit")}
                    selectedCellCol={selectedCellCol}
                    isEditingCell={isEditingCell && selectedRowIndex === idx}
                    visibleCols={visibleColumns}
                    isInterstate={isInterstate}
                    lastPurchaseDetails={lastPurchaseMap[line.product_id]}
                    onSelectRow={() => {
                      setSelectedRowIndex(idx);
                      setFocusContext("grid");
                    }}
                    onCellClick={(colId) => {
                      setSelectedRowIndex(idx);
                      setSelectedCellCol(colId);
                      setFocusContext("grid");
                    }}
                    onCellDoubleClick={(colId) => {
                      startCellEdit(idx, colId);
                    }}
                    onCellEditSave={saveCellEdit}
                    onCellEditCancel={cancelCellEdit}
                    onFieldChange={(field, val) => updateCommittedLineField(idx, field, val)}
                    onRemoveLine={() => removeCommittedLine(idx)}
                    onEditConversion={() => {
                      setSelectedLineForConversion(line);
                      setIsConversionModalOpen(true);
                    }}
                  />
                ))
              )}
            </tbody>

            {/* Permanent '+' Inline Entry Row at Bottom (Identical to POS design) */}
            <tfoot className="sticky bottom-0 bg-[var(--color-surface)] z-10 border-t-2 border-[var(--color-accent)]/40 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
              <PurchaseGridRow
                idx={lines.length}
                line={draftLine}
                isDraft={true}
                isSelected={selectedRowIndex === null && focusContext === "entry_row"}
                visibleCols={visibleColumns}
                isInterstate={isInterstate}
                lastPurchaseDetails={draftLine ? lastPurchaseMap[draftLine.product_id] : null}
                searchQuery={searchQuery}
                onSearchChange={(val) => {
                  setSearchQuery(val);
                  updateDropdownPosition();
                  if (val.trim()) {
                    const { query } = parseQuantityPrefix(val);
                    productsStore.searchProducts(query).then((res) => {
                      setSearchResults(res);
                      setSelectedSearchIndex(0);
                      updateDropdownPosition();
                    });
                  } else {
                    setSearchResults([]);
                  }
                }}
                onSearchFocus={() => {
                  setFocusContext("entry_row");
                  setSelectedRowIndex(null);
                  updateDropdownPosition();
                }}
                onSearchBlur={(e) => {
                  const related = e.relatedTarget as Node | null;
                  if (dropdownRef.current && related && dropdownRef.current.contains(related)) {
                    return;
                  }
                  setTimeout(() => setSearchResults([]), 180);
                }}
                onSearchKeyDown={handleProductSearchKeyDown}
                searchInputRef={entryProductInputRef}
                isDropdownOpen={searchResults.length > 0}
                onFieldChange={(field, val) => {
                  if (draftLine) {
                    setDraftLine({ ...draftLine, [field]: val });
                  }
                }}
                onCommitDraft={commitEntryRow}
                onClearDraft={clearDraftLine}
                onEditConversion={() => {
                  if (draftLine) {
                    setSelectedLineForConversion(draftLine);
                    setIsConversionModalOpen(true);
                  }
                }}
              />
            </tfoot>
          </table>
        </div>

        {/* Product Autocomplete Dropdown in React Portal */}
        {searchResults.length > 0 &&
          dropdownPosition &&
          createPortal(
            <div
              ref={dropdownRef}
              style={{
                position: "fixed",
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
                width: `${dropdownPosition.width}px`,
                zIndex: 9999,
              }}
              className="max-h-72 overflow-y-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-dropdown divide-y divide-[var(--color-border-subtle)] text-xs animate-in fade-in duration-75"
            >
              {searchResults.map((prod, index) => {
                const isSelected = index === selectedSearchIndex;
                const cached = lastPurchaseMap[prod.id];
                return (
                  <div
                    key={prod.id}
                    onMouseEnter={() => setSelectedSearchIndex(index)}
                    onClick={() => selectProductForEntry(prod)}
                    className={`flex cursor-pointer items-center justify-between px-4 py-2.5 transition-colors ${
                      isSelected
                        ? "bg-[var(--color-accent-soft)] text-[var(--color-text)] border-l-4 border-l-[var(--color-accent)] pl-3"
                        : "hover:bg-[var(--color-surface-hover)] text-[var(--color-text)]"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`font-semibold ${isSelected ? "text-[var(--color-accent)] font-bold" : "text-[var(--color-text)]"}`}>
                          {prod.name}
                        </p>
                        {prod.generic_name && (
                          <span className="rounded-[4px] bg-[var(--color-surface-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] font-normal border border-[var(--color-border)]">
                            {prod.generic_name}
                          </span>
                        )}
                        {(prod.units_per_pack || 1) > 1 && (
                          <span className="rounded-[4px] bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-accent)] font-medium">
                            Pack of {prod.units_per_pack} {prod.sub_unit_name || "pcs"}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 font-mono">
                        Barcode: <span>{prod.barcode || "—"}</span> | HSN: {prod.hsn_sac_code || "—"} | GST: {prod.gst_percent}%
                      </p>
                    </div>

                    <div className="text-right shrink-0 ml-4 font-mono">
                      <p className="font-bold text-[var(--color-text)] text-sm tabular-nums">
                        PTR: ₹ {(prod.ptr || prod.sel_rate * 0.7).toFixed(2)}
                      </p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        MRP: ₹{(prod.mrp || 0).toFixed(2)}
                      </p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        Current Stock: {prod.current_stock || 0}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>,
            document.body
          )}

        {/* Bottom Totals Bar (Matching POS footer + Supplier Total Verification) */}
        <div className="flex flex-wrap items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 gap-3">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-xs text-[var(--color-text-muted)]">
            {/* Items & Units */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Items: </span>
              <span className="font-bold font-mono text-[var(--color-text)]">{computedTotals.itemCount}</span>
              <span className="text-[10px] text-[var(--color-text-muted)] font-mono">({computedTotals.totalUnits} units)</span>
            </div>

            {/* Subtotal */}
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Subtotal: </span>
              <span className="font-bold font-mono text-[var(--color-text)]">₹ {computedTotals.subtotal.toFixed(2)}</span>
            </div>

            {/* Line Discount */}
            {computedTotals.discountTotal > 0 && (
              <div className="text-[var(--color-warning-text)]">
                <span className="text-[11px] font-bold uppercase tracking-wider">Disc: </span>
                <span className="font-bold font-mono">-₹ {computedTotals.discountTotal.toFixed(2)}</span>
              </div>
            )}

            {/* Tax */}
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                {isInterstate ? "IGST Tax: " : "GST Tax: "}
              </span>
              <span className="font-bold font-mono text-[var(--color-text)]">₹ {computedTotals.taxTotal.toFixed(2)}</span>
            </div>

            {/* Freight & Other Charges */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Freight (Alt+F): </span>
              <input
                id="freight-input-field"
                type="number"
                step="0.01"
                value={freightCharges || ""}
                onChange={(e) => setFreightCharges(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="w-16 font-mono text-xs rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-right text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>

            {/* Round-off */}
            <div>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setIsRoundOffModalOpen(true)}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] font-semibold text-[11px] border transition-colors cursor-pointer ${
                  manualRoundOff !== null
                    ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent-soft)] font-bold shadow-2xs"
                    : "bg-[var(--color-surface-subtle)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
                }`}
                title="Adjust Round-Off / Net Payable (Alt+R)"
              >
                <span className="font-mono">
                  Round: {computedTotals.roundOff >= 0 ? `+₹${computedTotals.roundOff.toFixed(2)}` : `-₹${Math.abs(computedTotals.roundOff).toFixed(2)}`}
                </span>
                <span className="text-[9px] font-mono text-[var(--color-text-muted)]">Alt+R</span>
              </button>
            </div>
          </div>

          {/* Right Section: Physical Supplier Invoice Total with Match/Over/Short Indicator & Net Payable */}
          <div className="flex items-center gap-4 sm:gap-6">
            {/* Supplier Invoice Total Verification */}
            <div className="flex items-center gap-2">
              <div className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                    Vendor Inv Total (Alt+I)
                  </span>
                  {invoiceDiff && (
                    <span
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[9px] font-bold font-mono ${
                        invoiceDiff.isMatch
                          ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)]"
                          : invoiceDiff.isOver
                          ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
                          : "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] border border-[var(--color-danger-border)]"
                      }`}
                    >
                      {invoiceDiff.isMatch ? "✓ Match" : invoiceDiff.isOver ? `+₹${invoiceDiff.diff.toFixed(2)} Over` : `-₹${Math.abs(invoiceDiff.diff).toFixed(2)} Short`}
                    </span>
                  )}
                </div>
                <div className="relative mt-0.5">
                  <input
                    id="supplier-invoice-total-input"
                    type="number"
                    step="0.01"
                    value={supplierInvoiceTotal}
                    onChange={(e) => setSupplierInvoiceTotal(e.target.value === "" ? "" : parseFloat(e.target.value) || 0)}
                    placeholder="Physical Bill Total"
                    className="w-28 text-right font-mono font-bold text-xs rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Net Payable */}
            <div
              className="text-right cursor-pointer group"
              onClick={() => setIsRoundOffModalOpen(true)}
              title="Click to adjust round-off / net payable (Alt+R)"
            >
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider group-hover:text-[var(--color-accent)] transition-colors">
                Net Payable
              </span>
              <p className="text-[32px] sm:text-[36px] font-bold font-mono leading-none tracking-tight text-[var(--color-accent)] tabular-nums">
                ₹ {computedTotals.grandTotal.toFixed(2)}
              </p>
            </div>

            {/* Post Action Button (F12) */}
            <button
              type="button"
              onClick={() => openPostSummary()}
              disabled={lines.length === 0 && !draftLine}
              className="flex items-center gap-2 rounded-[10px] bg-[var(--color-accent)] px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-all cursor-pointer h-[44px]"
            >
              <Truck className="h-4 w-4" />
              <span>Post Purchase (F12)</span>
            </button>
          </div>
        </div>

        {/* Bottom Contextual Hint Strip & Shortcuts trigger (?) */}
        <PurchaseShortcutHintBar
          context={focusContext}
          onOpenShortcutsModal={() => setIsShortcutsModalOpen(true)}
          onFocusEntryRow={() => {
            entryProductInputRef.current?.focus();
            setFocusContext("entry_row");
          }}
          onPost={() => openPostSummary()}
          onHold={handleSaveDraft}
          onRecall={() => setIsDraftsModalOpen(true)}
          onNewBill={resetToNewBill}
          onColumnsConfig={() => setIsColumnsModalOpen(true)}
        />
      </div>

      {/* Columns & Presets Configuration Modal */}
      <BillingColumnsModal
        isOpen={isColumnsModalOpen}
        onClose={() => setIsColumnsModalOpen(false)}
        target="purchase"
        onLayoutChange={(cols, headers) => {
          setPurchaseColumns(cols);
          setPurchaseHeaders(headers);
        }}
      />

      {/* Keyboard Shortcuts Reference Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      {/* Quick Add Product Inline Modal (Ctrl+N) */}
      <ProductQuickAddModal
        isOpen={isProductQuickAddOpen}
        onClose={() => setIsProductQuickAddOpen(false)}
        initialName={searchQuery}
        onProductCreated={(newProd) => {
          selectProductForEntry(newProd);
          showNotification(`Created product: ${newProd.name}`, "success");
        }}
      />

      {/* Hold & Recall Drafts Modal (F9) */}
      <PurchaseDraftsModal
        isOpen={isDraftsModalOpen}
        onClose={() => setIsDraftsModalOpen(false)}
        onSelectDraft={handleRecallDraft}
      />

      {/* Round-Off Modal (Alt+R) */}
      <RoundOffModal
        isOpen={isRoundOffModalOpen}
        onClose={() => setIsRoundOffModalOpen(false)}
        netBeforeRound={computedTotals.grandTotal - computedTotals.roundOff}
        currentRoundOff={computedTotals.roundOff}
        isManual={manualRoundOff !== null}
        onApplyRoundOff={(adj: number | null) => {
          setManualRoundOff(adj);
          setIsRoundOffModalOpen(false);
        }}
      />

      {/* Bill Discount Modal (Ctrl+F2) */}
      <BillDiscountModal
        isOpen={isBillDiscountModalOpen}
        onClose={() => setIsBillDiscountModalOpen(false)}
        taxableSubtotal={computedTotals.subtotal}
        totalTax={computedTotals.taxTotal}
        currentDiscount={{ type: "amount", value: billDiscountAmount }}
        onApplyDiscount={(type: "percent" | "amount", value: number) => {
          const amt = type === "percent" ? (computedTotals.subtotal * value) / 100 : value;
          setBillDiscountAmount(amt);
          setIsBillDiscountModalOpen(false);
        }}
      />

      {/* Packaging & Unit Conversion Modal (F4) */}
      {selectedLineForConversion && (
        <ConversionModal
          isOpen={isConversionModalOpen}
          onClose={() => {
            setIsConversionModalOpen(false);
            setSelectedLineForConversion(null);
          }}
          line={
            {
              id: selectedLineForConversion.product_id,
              product: {
                id: selectedLineForConversion.product_id,
                name: selectedLineForConversion.product_name,
                units_per_pack: selectedLineForConversion.units_per_pack || 1,
                unit_name: "STRIP",
                sub_unit_name: "TABLET",
              } as any,
              qty: selectedLineForConversion.pack_qty,
              loose_qty: selectedLineForConversion.loose_qty,
              unit_price: selectedLineForConversion.purchase_rate,
            } as any
          }
          onSave={(lineId: string, unitsPerPack: number) => {
            if (draftLine && draftLine.product_id === lineId) {
              setDraftLine({ ...draftLine, units_per_pack: unitsPerPack });
            }
            setLines((prev) =>
              prev.map((l) =>
                l.product_id === lineId ? { ...l, units_per_pack: unitsPerPack } : l
              )
            );
            setIsConversionModalOpen(false);
            setSelectedLineForConversion(null);
          }}
        />
      )}

      {/* Post Purchase Summary & Verification Modal (F12) */}
      {postValidationSummary && (
        <PurchasePostSummaryModal
          isOpen={isPostSummaryModalOpen}
          onClose={() => setIsPostSummaryModalOpen(false)}
          onConfirmPost={handleConfirmPost}
          checks={postValidationSummary}
          isPosting={isPosting}
        />
      )}

      {/* Post Success Action Choices Modal */}
      {postSuccessData && (
        <PurchasePostSuccessModal
          isOpen={Boolean(postSuccessData)}
          onClose={() => {
            setPostSuccessData(null);
            onSuccess();
          }}
          purchaseNumber={postSuccessData.number}
          purchaseId={postSuccessData.id}
          grandTotal={postSuccessData.total}
          itemCount={lines.length}
          supplierName={postSuccessData.supplierName}
          onPrintLabels={() => setIsBarcodePrintModalOpen(true)}
          onPrintVoucher={() => setIsPrintPreviewModalOpen(true)}
          onPaySupplier={() => setIsSupplierPaymentModalOpen(true)}
          onNewBill={resetToNewBill}
        />
      )}

      {/* Barcode & Shelf Label Print Modal */}
      {postSuccessData && isBarcodePrintModalOpen && (
        <BarcodePrintModal
          isOpen={isBarcodePrintModalOpen}
          onClose={() => setIsBarcodePrintModalOpen(false)}
          items={lines.map((l) => ({
            product_id: l.product_id,
            product_name: l.product_name,
            batch_no: l.batch_no,
            expiry_date: l.expiry_date,
            total_units: (l.pack_qty ?? 1) * (l.units_per_pack || 1) + (l.loose_qty || 0),
            mrp: l.mrp,
            selling_rate: l.selling_rate,
          }))}
        />
      )}

      {/* Print Preview Modal for Inward Voucher */}
      {postSuccessData && isPrintPreviewModalOpen && (
        <PrintPreviewModal
          isOpen={isPrintPreviewModalOpen}
          onClose={() => setIsPrintPreviewModalOpen(false)}
          docType="purchase_bill"
          title={`Purchase Inward Voucher - ${postSuccessData.number}`}
          data={{
            document: {
              purchase_number: postSuccessData.number,
              supplier_name: postSuccessData.supplierName,
              supplier_invoice_no: supplierInvoiceNo,
              purchase_date: purchaseDate,
              grand_total: postSuccessData.total,
              subtotal: computedTotals.subtotal,
              tax_total: computedTotals.taxTotal,
              round_off: computedTotals.roundOff,
              payment_mode: purchaseType === "cash" ? "Cash" : "Credit",
            },
            items: lines,
          }}
        />
      )}

      {/* Supplier Payment / Split Settlement Modal */}
      {postSuccessData && selectedSupplier && isSupplierPaymentModalOpen && (
        <SupplierPaymentModal
          isOpen={isSupplierPaymentModalOpen}
          onClose={() => setIsSupplierPaymentModalOpen(false)}
          defaultSupplierId={selectedSupplier.id}
          onPaymentRecorded={() => {
            setIsSupplierPaymentModalOpen(false);
            showNotification("Supplier payment recorded!");
          }}
        />
      )}
    </div>
  );
};

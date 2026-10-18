import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Barcode,
  Search,
  Trash2,
  PauseCircle,
  PlayCircle,
  CreditCard,
  Printer,
  Plus,
  Minus,
  CheckCircle,
  AlertCircle,
  X,
  UserCheck,
  MessageCircle,
  Mail,
  Download,
  FileText,
  Sliders,
  History,
  Check,
  FolderOpen,
  ExternalLink,
} from "lucide-react";
import { posCartService, type PosCartLine } from "../lib/billing/posCartService";
import {
  productsStore,
  isBatchExpired,
  isBatchSelectable,
  type ProductItem,
  type ProductBatch,
} from "../lib/masters/productsStore";
import { billingTenderService, type PaymentTenderLine } from "../lib/billing/billingTenderService";
import {
  printingEngine,
  generateWhatsAppShareUrl,
  generateEmailShareUrl,
  type InvoicePrintData,
} from "../lib/printing/printingEngine";
import { isTauri } from "../lib/ipc/ipcBridge";
import { companySettingsService, DEFAULT_COLUMNS, type ColumnSetting, type HeaderFieldSetting } from "../lib/settings/companySettingsService";
import type { InvoiceTotals } from "../lib/billing/billingCalculations";
import {
  invoiceManagementService,
  type InvoiceRecord,
  type InvoiceItemRecord,
  type InvoiceDiffResult,
} from "../lib/billing/invoiceManagementService";
import { PrintPreviewModal } from "../components/PrintPreviewModal";
import { CustomerCombobox } from "../components/CustomerCombobox";
import { SmartQtyInput } from "../components/SmartQtyInput";
import { BillingColumnsModal } from "../components/BillingColumnsModal";
import { ConversionModal } from "../components/ConversionModal";
import { PosShortcutHintBar, type PosFocusContext } from "../components/PosShortcutHintBar";
import { QuickLineEditModal } from "../components/QuickLineEditModal";
import { QuickProductBatchEditModal } from "../components/QuickProductBatchEditModal";
import { KeyboardShortcutsModal } from "../components/KeyboardShortcutsModal";
import { BillDiscountModal } from "../components/BillDiscountModal";
import { RoundOffModal } from "../components/RoundOffModal";
import { calculateDerivedLooseRate, formatQuantityDisplay } from "../lib/billing/unitConversion";
import { partiesStore, type Customer, normalizeIndianPhone } from "../lib/masters/partiesStore";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

export const PosBillingPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editInvoiceParam = searchParams.get("edit");

  // Cart & Invoice State
  const [lines, setLines] = useState<PosCartLine[]>([]);
  const [totals, setTotals] = useState<InvoiceTotals>(posCartService.getTotals());
  const [customerName, setCustomerName] = useState("Walk-in Customer");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerGstin, setCustomerGstin] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [doctorName, setDoctorName] = useState("");
  const [patientName, setPatientName] = useState("");
  const [billNotes, setBillNotes] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState(`INV-${Date.now().toString().slice(-6)}`);

  // Keyboard-first Grid & Focus State
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [focusContext, setFocusContext] = useState<PosFocusContext>("search");
  const [undoDeleteBuffer, setUndoDeleteBuffer] = useState<{ line: PosCartLine; index: number } | null>(null);
  const [quickEditModal, setQuickEditModal] = useState<{
    isOpen: boolean;
    type: "discount" | "rate";
    line: PosCartLine | null;
  }>({
    isOpen: false,
    type: "discount",
    line: null,
  });
  const [isBillDiscountModalOpen, setIsBillDiscountModalOpen] = useState(false);
  const [isRoundOffModalOpen, setIsRoundOffModalOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [ariaAnnouncement, setAriaAnnouncement] = useState("");

  // Editing Past Invoice State
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRecord | null>(null);
  const [originalInvoiceItems, setOriginalInvoiceItems] = useState<InvoiceItemRecord[]>([]);
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
  const [editDiff, setEditDiff] = useState<InvoiceDiffResult | null>(null);
  const [editReason, setEditReason] = useState("");

  // Search & Auto-complete
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProductItem[]>([]);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [selectedProductForBatch, setSelectedProductForBatch] = useState<ProductItem | null>(null);
  const [productBatches, setProductBatches] = useState<ProductBatch[]>([]);
  const [selectedBatchIndex, setSelectedBatchIndex] = useState(0);

  // Billing Layout & Columns Modal
  const [posColumns, setPosColumns] = useState<ColumnSetting[]>(() => companySettingsService.getBillingColumns());
  const [posHeaders, setPosHeaders] = useState<HeaderFieldSetting[]>(() => companySettingsService.getHeaderFields());
  const [isColumnsModalOpen, setIsColumnsModalOpen] = useState(false);
  const [selectedLineForConversion, setSelectedLineForConversion] = useState<PosCartLine | null>(null);
  const [selectedLineForProductBatchEdit, setSelectedLineForProductBatchEdit] = useState<PosCartLine | null>(null);

  // Modals & Popups
  const [isTenderModalOpen, setIsTenderModalOpen] = useState(false);
  const [isRecallModalOpen, setIsRecallModalOpen] = useState(false);
  const [heldBillsCount, setHeldBillsCount] = useState(billingTenderService.listHeldBills().length);
  interface NotificationAction {
    label: string;
    icon?: "open" | "folder";
    onClick: () => void;
  }
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "error" | "info" | "warning";
    actions?: NotificationAction[];
  } | null>(null);

  // Tender form state
  const [tenders, setTenders] = useState<PaymentTenderLine[]>([{ mode: "Cash", amount: 0 }]);
  const [receivedCash, setReceivedCash] = useState<number>(0);
  const [printFormat, setPrintFormat] = useState<"thermal" | "a4" | "pdf">("thermal");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const isFinalizingRef = useRef(false);

  // Print Preview Modal State
  const [previewModalState, setPreviewModalState] = useState<{
    isOpen: boolean;
    data: InvoicePrintData | null;
    initialFormat?: "a4" | "half_a4" | "thermal_80mm" | "thermal_58mm";
    title?: string;
  }>({
    isOpen: false,
    data: null,
  });

  // References for focus control
  const searchInputRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const customerPhoneInputRef = useRef<HTMLInputElement>(null);
  const doctorInputRef = useRef<HTMLInputElement>(null);
  const patientInputRef = useRef<HTMLInputElement>(null);
  const tenderCashInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const batchListRef = useRef<HTMLDivElement>(null);
  const lastKeyTimeRef = useRef<number>(0);
  const scanBufferRef = useRef<string>("");

  // Load invoice if 'edit' query param is provided
  useEffect(() => {
    if (!editInvoiceParam) {
      return;
    }

    const loadForEdit = async () => {
      const details = await invoiceManagementService.getInvoiceWithDetails(editInvoiceParam);
      if (!details) {
        showNotification(`Invoice ${editInvoiceParam} not found`, "error");
        setSearchParams({});
        return;
      }

      const lock = invoiceManagementService.checkInvoiceLockStatus(details.invoice);
      if (lock.isLocked) {
        showNotification(lock.lockReason || "Invoice is locked from editing", "error");
        setSearchParams({});
        return;
      }

      setEditingInvoice(details.invoice);
      setOriginalInvoiceItems(details.items);
      setInvoiceNumber(details.invoice.invoice_number);
      setCustomerName(details.invoice.customer_name || "Walk-in Customer");
      setCustomerPhone(details.invoice.customer_phone || "");
      setCustomerGstin(details.invoice.customer_gstin || "");

      if (details.invoice.customer_id) {
        const cust = await partiesStore.getCustomerById(details.invoice.customer_id);
        setSelectedCustomer(cust);
      } else {
        setSelectedCustomer(null);
      }

      // Populate cart lines with previous invoice items
      posCartService.clearCart();
      for (const it of details.items) {
        const batches: ProductBatch[] = await productsStore.getBatchesForProduct(it.product_id, false);
        const batch: ProductBatch = batches.find((b: ProductBatch) => b.batch_no === it.batch_no) || {
          id: `batch_${it.product_id}_${it.batch_no}`,
          product_id: it.product_id,
          batch_no: it.batch_no,
          expiry_date: it.expiry_date,
          stock_qty: 100,
          mrp: it.mrp || it.unit_price,
          selling_rate: it.unit_price,
        };

        const prodItem: ProductItem = {
          id: it.product_id,
          name: it.product_name,
          barcode: "",
          mrp: it.mrp || it.unit_price,
          sel_rate: it.unit_price,
          gst_percent: it.gst_percent,
          hsn_sac_code: it.hsn_code,
          units_per_pack: it.units_per_pack || 1,
          is_active: true,
        };

        posCartService.addProductToCart(prodItem, batch, it.qty, it.loose_qty);
      }
      refreshCartState();
      showNotification(`Editing ${details.invoice.invoice_number}`);
    };

    loadForEdit();
  }, [editInvoiceParam]);

  const cancelEditingMode = () => {
    setEditingInvoice(null);
    setOriginalInvoiceItems([]);
    setSearchParams({});
    posCartService.clearCart();
    refreshCartState();
    setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
    setCustomerName("Walk-in Customer");
    setCustomerPhone("");
    setCustomerGstin("");
    setSelectedCustomer(null);
    posCartService.setCustomer("", "Walk-in Customer", "", "", "");
    setEditReason("");
    showNotification("Edit cancelled. Started new bill.");
  };

  const refreshCartState = () => {
    setLines(posCartService.getLines());
    setTotals(posCartService.getTotals());
    setHeldBillsCount(billingTenderService.listHeldBills().length);
  };

  const handleSaveLineConversion = async (
    lineId: string,
    unitsPerPack: number,
    packName: string,
    looseName: string,
    persistMaster: boolean
  ) => {
    await posCartService.updateLineConversion(lineId, unitsPerPack, packName, looseName, persistMaster);
    refreshCartState();
    showNotification(
      persistMaster
        ? `Updated conversion: 1 ${packName} = ${unitsPerPack} ${looseName} (Saved to Master)`
        : `Updated conversion: 1 ${packName} = ${unitsPerPack} ${looseName} (This Bill)`,
      "success"
    );
  };

  const handleSaveProductBatchEdit = async (
    lineId: string,
    productUpdates: Partial<ProductItem>,
    batchUpdates: Partial<ProductBatch>,
    persistToMaster: boolean
  ) => {
    await posCartService.updateLineProductAndBatch(
      lineId,
      productUpdates,
      batchUpdates,
      persistToMaster
    );
    refreshCartState();
    showNotification(
      persistToMaster
        ? `Updated "${productUpdates.name || "Product"}" (Batch ${batchUpdates.batch_no || ""}) & saved to master database.`
        : `Updated "${productUpdates.name || "Product"}" for this bill.`,
      "success"
    );
  };

  const closeBatchModal = () => {
    setSelectedProductForBatch(null);
    setSelectedBatchIndex(0);
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  };

  useModalEscape(Boolean(selectedProductForBatch), closeBatchModal);
  useModalEscape(isTenderModalOpen, () => setIsTenderModalOpen(false));
  useModalEscape(isRecallModalOpen, () => setIsRecallModalOpen(false));
  useModalEscape(isDiffModalOpen, () => setIsDiffModalOpen(false));

  const updateDropdownPosition = () => {
    if (searchInputRef.current) {
      const rect = searchInputRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  };

  const handleFocusSearch = () => {
    setSelectedRowIndex(null);
    setFocusContext("search");
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  };

  const handleSelectRow = (idx: number) => {
    if (idx >= 0 && idx < lines.length) {
      setSelectedRowIndex(idx);
      setFocusContext("grid");
      searchInputRef.current?.blur();
      setTimeout(() => {
        const line = lines[idx];
        if (line) {
          const rowEl = document.getElementById(`cart-row-${line.id}`);
          rowEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }, 20);
    }
  };

  const handleQtyEnterAdvance = (currentIdx: number) => {
    if (currentIdx < lines.length - 1) {
      const nextIdx = currentIdx + 1;
      handleSelectRow(nextIdx);
      setFocusContext("cell_edit");
      setTimeout(() => {
        const nextLine = lines[nextIdx];
        if (nextLine) {
          const el = (document.getElementById(`qty-input-${nextLine.id}-pack`) ||
            document.getElementById(`qty-input-${nextLine.id}`)) as HTMLInputElement | null;
          if (el) {
            el.focus();
            el.select();
          }
        }
      }, 30);
    } else {
      handleFocusSearch();
    }
  };

  const activeHintContext: PosFocusContext = useMemo(() => {
    if (
      isTenderModalOpen ||
      isRecallModalOpen ||
      isDiffModalOpen ||
      isColumnsModalOpen ||
      selectedProductForBatch ||
      isShortcutsModalOpen ||
      quickEditModal.isOpen ||
      selectedLineForConversion
    ) {
      return "modal";
    }
    if (focusContext === "cell_edit") {
      return "cell_edit";
    }
    if (focusContext === "grid" && selectedRowIndex !== null && selectedRowIndex >= 0 && selectedRowIndex < lines.length) {
      return "grid";
    }
    return "search";
  }, [
    isTenderModalOpen,
    isRecallModalOpen,
    isDiffModalOpen,
    isColumnsModalOpen,
    selectedProductForBatch,
    isShortcutsModalOpen,
    quickEditModal.isOpen,
    selectedLineForConversion,
    focusContext,
    selectedRowIndex,
    lines.length,
  ]);

  const handleDeleteSelectedLine = (indexToDelete?: number) => {
    const targetIdx = indexToDelete !== undefined ? indexToDelete : selectedRowIndex;
    if (targetIdx === null || targetIdx === undefined || targetIdx < 0 || targetIdx >= lines.length) return;

    const targetLine = lines[targetIdx];
    const { removedLine, index } = posCartService.removeLine(targetLine.id);
    if (removedLine) {
      setUndoDeleteBuffer({ line: removedLine, index });
      refreshCartState();
      const nextIdx = lines.length > 1 ? Math.min(targetIdx, lines.length - 2) : null;
      setSelectedRowIndex(nextIdx);
      if (nextIdx === null) {
        handleFocusSearch();
      }
      setAriaAnnouncement(`Removed ${targetLine.product.name} from bill. Press Ctrl+Z to undo.`);
      showNotification(
        `Deleted ${targetLine.product.name}`,
        "info",
        [{ label: "Undo (Ctrl+Z)", onClick: handleUndoDelete }]
      );
    }
  };

  const handleUndoDelete = () => {
    if (!undoDeleteBuffer) return;
    posCartService.restoreLine(undoDeleteBuffer.line, undoDeleteBuffer.index);
    refreshCartState();
    setSelectedRowIndex(undoDeleteBuffer.index);
    setFocusContext("grid");
    setAriaAnnouncement(`Restored ${undoDeleteBuffer.line.product.name} to bill.`);
    showNotification(`Restored ${undoDeleteBuffer.line.product.name}`, "success");
    setUndoDeleteBuffer(null);
  };

  const handleMoveLine = (direction: "up" | "down") => {
    if (selectedRowIndex === null || selectedRowIndex < 0) return;
    const targetIdx = direction === "up" ? selectedRowIndex - 1 : selectedRowIndex + 1;
    if (targetIdx < 0 || targetIdx >= lines.length) return;
    posCartService.moveLine(selectedRowIndex, targetIdx);
    refreshCartState();
    setSelectedRowIndex(targetIdx);
  };

  const handleOpenBatchForSelectedLine = () => {
    if (selectedRowIndex === null || !lines[selectedRowIndex]) return;
    const line = lines[selectedRowIndex];
    selectProductAndAddToCart(line.product);
  };

  const handleToggleUnitRateForSelectedLine = () => {
    if (selectedRowIndex === null || !lines[selectedRowIndex]) return;
    const line = lines[selectedRowIndex];
    if (line.product.units_per_pack <= 1) return;
    const nextBasis = line.rate_basis === "loose_rate" ? "sel_rate" : "loose_rate";
    const newPrice = nextBasis === "loose_rate"
      ? calculateDerivedLooseRate(line.product.sel_rate, line.product.units_per_pack, line.product.loose_selling_rate)
      : (line.selectedBatch.selling_rate || line.product.sel_rate);
    posCartService.updateLinePrice(line.id, newPrice, nextBasis);
    refreshCartState();
    showNotification(`Switched ${line.product.name} to ${nextBasis === "loose_rate" ? "Unit Rate" : "Pack Rate"}`);
  };

  const handleQuickDiscount = (line?: PosCartLine) => {
    const target = line || (selectedRowIndex !== null ? lines[selectedRowIndex] : null);
    if (!target) return;
    setQuickEditModal({ isOpen: true, type: "discount", line: target });
  };

  const handleQuickRate = (line?: PosCartLine) => {
    const target = line || (selectedRowIndex !== null ? lines[selectedRowIndex] : null);
    if (!target) return;
    setQuickEditModal({ isOpen: true, type: "rate", line: target });
  };

  const handleApplyBillDiscount = (type: "percent" | "amount", value: number) => {
    posCartService.setBillDiscount(type, value);
    refreshCartState();
    if (value > 0) {
      showNotification(`Bill discount applied: ${type === "percent" ? `${value}%` : `₹${value}`}`, "success");
    } else {
      showNotification("Bill discount cleared", "info");
    }
  };

  const handleApplyManualRoundOff = (manualAmount: number | null) => {
    posCartService.setManualRoundOff(manualAmount);
    refreshCartState();
    if (manualAmount !== null) {
      showNotification(
        `Round-off adjusted to ${manualAmount >= 0 ? `+₹${manualAmount.toFixed(2)}` : `-₹${Math.abs(manualAmount).toFixed(2)}`}`,
        "success"
      );
    } else {
      showNotification("Reverted to automatic statutory round-off", "info");
    }
  };

  // Focus search input on initial mount only
  useEffect(() => {
    searchInputRef.current?.focus();
    refreshCartState();
  }, []);

  // Global POS Hotkeys Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      const keyLower = e.key.toLowerCase();
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      // 1. Hardware Barcode Scanner Fast-Keystroke Interceptor (< 45ms per keystroke)
      const now = Date.now();
      const interval = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === "Enter" && scanBufferRef.current.length >= 3 && interval < 60) {
        const scanned = scanBufferRef.current;
        scanBufferRef.current = "";
        e.preventDefault();
        e.stopPropagation();
        productsStore.findProductByBarcode(scanned).then(async (matched) => {
          if (matched) {
            await selectProductAndAddToCart(matched);
            setSearchQuery("");
            setSearchResults([]);
          } else {
            setSearchQuery(scanned);
            searchInputRef.current?.focus();
          }
        });
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (interval < 45) {
          scanBufferRef.current += e.key;
        } else {
          scanBufferRef.current = e.key;
        }
      } else if (e.key !== "Shift" && e.key !== "Control" && e.key !== "Alt" && e.key !== "Meta") {
        scanBufferRef.current = "";
      }

      // If batch modal is open, let batch modal listeners handle navigation
      if (selectedProductForBatch) {
        if (e.key === "Escape" || e.key === "F1") {
          e.preventDefault();
          closeBatchModal();
        }
        return;
      }

      // If quick edit modal is open
      if (quickEditModal.isOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setQuickEditModal({ isOpen: false, type: "discount", line: null });
        }
        return;
      }

      // If bill discount modal is open
      if (isBillDiscountModalOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setIsBillDiscountModalOpen(false);
        }
        return;
      }

      // If round off modal is open
      if (isRoundOffModalOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setIsRoundOffModalOpen(false);
        }
        return;
      }

      // If shortcuts modal is open
      if (isShortcutsModalOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setIsShortcutsModalOpen(false);
        }
        return;
      }

      // If product & batch edit modal is open
      if (selectedLineForProductBatchEdit) {
        if (e.key === "Escape") {
          e.preventDefault();
          setSelectedLineForProductBatchEdit(null);
        }
        return;
      }

      // If diff modal is open, handle diff modal hotkeys (F12, Enter, Escape)
      if (isDiffModalOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (!isFinalizingRef.current) {
            setIsDiffModalOpen(false);
            searchInputRef.current?.focus();
          }
          return;
        }
        if (e.key === "F12" || e.key === "Enter") {
          e.preventDefault();
          handleSaveEditedInvoice();
          return;
        }
        return;
      }

      // If tender modal is open, handle settlement mode keys (1-5, C, U, D, R, S, T, F12, Enter, Escape)
      if (isTenderModalOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (!isFinalizingRef.current) {
            setIsTenderModalOpen(false);
            setFocusContext("search");
            searchInputRef.current?.focus();
          }
          return;
        }
        if (e.key === "F12" || (isCmdOrCtrl && e.key === "Enter")) {
          e.preventDefault();
          handleFinalizeAndPrint();
          return;
        }

        const activeTag = (document.activeElement?.tagName || "").toLowerCase();
        const isTypingField = activeTag === "input" || activeTag === "textarea";

        if (!isTypingField || (e.ctrlKey || e.altKey || e.metaKey)) {
          if (e.key === "1" || keyLower === "c" || code === "KeyC") {
            e.preventDefault();
            setTenders([{ mode: "Cash", amount: totals.grand_total }]);
          } else if (e.key === "2" || keyLower === "u" || code === "KeyU") {
            e.preventDefault();
            setTenders([{ mode: "UPI", amount: totals.grand_total }]);
          } else if (e.key === "3" || keyLower === "d" || code === "KeyD") {
            e.preventDefault();
            setTenders([{ mode: "Card", amount: totals.grand_total }]);
          } else if (e.key === "4" || keyLower === "r" || code === "KeyR") {
            e.preventDefault();
            setTenders([{ mode: "Credit", amount: totals.grand_total }]);
          } else if (e.key === "5" || keyLower === "s" || code === "KeyS") {
            e.preventDefault();
            setTenders([
              { mode: "Cash", amount: Math.round(totals.grand_total / 2) },
              { mode: "UPI", amount: totals.grand_total - Math.round(totals.grand_total / 2) },
            ]);
          } else if (keyLower === "t" || code === "KeyT") {
            e.preventDefault();
            setPrintFormat((prev) => (prev === "thermal" ? "a4" : prev === "a4" ? "pdf" : "thermal"));
          }
        }
        return;
      }

      // Check if user is currently inside an input/textarea
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");

      // --- Bill-Level Global Hotkeys ---

      // F1 or Alt+1: Focus Search/Barcode
      if ((e.key === "F1" && !e.ctrlKey && !e.altKey && !e.shiftKey) || (e.altKey && (e.key === "1" || code === "Digit1" || code === "Numpad1"))) {
        e.preventDefault();
        handleFocusSearch();
        return;
      }

      // Alt+C: Focus Customer Combobox (supports Mac Option key character mapping)
      if (e.altKey && (keyLower === "c" || code === "KeyC")) {
        e.preventDefault();
        customerInputRef.current?.focus();
        return;
      }

      // Alt+M: Focus Customer Mobile
      if (e.altKey && (keyLower === "m" || code === "KeyM")) {
        e.preventDefault();
        customerPhoneInputRef.current?.focus();
        return;
      }

      // Alt+D: Focus Doctor Details
      if (e.altKey && !e.shiftKey && (keyLower === "d" || code === "KeyD")) {
        e.preventDefault();
        doctorInputRef.current?.focus();
        return;
      }

      // Alt+P: Focus Patient Details
      if (e.altKey && !e.shiftKey && (keyLower === "p" || code === "KeyP")) {
        e.preventDefault();
        patientInputRef.current?.focus();
        return;
      }

      // F6: Find / Manage Past Bills
      if (e.key === "F6") {
        e.preventDefault();
        navigate("/bills");
        return;
      }

      // F8 or Alt+H or Alt+8: Hold Current Bill
      if (e.key === "F8" || (e.altKey && (keyLower === "h" || code === "KeyH" || e.key === "8" || code === "Digit8"))) {
        e.preventDefault();
        handleHoldBill();
        return;
      }

      // F9 or Alt+J or Alt+9: Recall Held Bill
      if (e.key === "F9" || (e.altKey && (keyLower === "j" || code === "KeyJ" || e.key === "9" || code === "Digit9"))) {
        e.preventDefault();
        setIsRecallModalOpen(true);
        return;
      }

      // F12 or Ctrl+Enter or Cmd+Enter or Alt+Enter: Open Checkout / Settlement
      if (e.key === "F12" || (isCmdOrCtrl && e.key === "Enter") || (e.altKey && e.key === "Enter")) {
        e.preventDefault();
        openTenderModal();
        return;
      }

      // Ctrl+F2 / Cmd+F2 / Shift+F2 / Ctrl+Shift+D / Cmd+Shift+D / Alt+Shift+D / Alt+O: Open Overall Bill Discount Modal
      if (
        (isCmdOrCtrl && e.key === "F2") ||
        (e.shiftKey && e.key === "F2") ||
        (isCmdOrCtrl && e.shiftKey && (keyLower === "d" || code === "KeyD")) ||
        (e.altKey && e.shiftKey && (keyLower === "d" || code === "KeyD")) ||
        (e.altKey && (keyLower === "o" || code === "KeyO"))
      ) {
        e.preventDefault();
        setIsBillDiscountModalOpen(true);
        return;
      }

      // Alt+R / Ctrl+Shift+R / Cmd+Shift+R / Ctrl+Alt+R: Open Round-Off / Net Payable Modal
      if (
        (e.altKey && (keyLower === "r" || code === "KeyR")) ||
        (isCmdOrCtrl && e.shiftKey && (keyLower === "r" || code === "KeyR")) ||
        (isCmdOrCtrl && e.altKey && (keyLower === "r" || code === "KeyR"))
      ) {
        e.preventDefault();
        setIsRoundOffModalOpen(true);
        return;
      }

      // Ctrl+Shift+C / Cmd+Shift+C: Open Columns Configuration Modal
      if (isCmdOrCtrl && e.shiftKey && (keyLower === "c" || code === "KeyC")) {
        e.preventDefault();
        setIsColumnsModalOpen((prev) => !prev);
        return;
      }

      // Ctrl+N / Cmd+N: Start New Bill
      if (isCmdOrCtrl && (keyLower === "n" || code === "KeyN")) {
        e.preventDefault();
        cancelEditingMode();
        return;
      }

      // Ctrl+Backspace / Cmd+Backspace: Clear Current Bill with Confirmation
      if (isCmdOrCtrl && e.key === "Backspace") {
        e.preventDefault();
        if (lines.length > 0) {
          const ok = window.confirm("Are you sure you want to clear all items in this bill?");
          if (ok) {
            posCartService.clearCart();
            refreshCartState();
            showNotification("Bill cleared", "info");
            handleFocusSearch();
          }
        }
        return;
      }

      // Ctrl+Z / Cmd+Z: Undo Delete Line
      if (isCmdOrCtrl && (keyLower === "z" || code === "KeyZ")) {
        if (undoDeleteBuffer) {
          e.preventDefault();
          handleUndoDelete();
          return;
        }
      }

      // ?: Open Keyboard Shortcuts Cheatsheet
      if (e.key === "?" && !isInputFocused) {
        e.preventDefault();
        setIsShortcutsModalOpen(true);
        return;
      }

      // --- Grid Row-Level Actions ---

      // When search input is active:
      if (activeEl === searchInputRef.current) {
        if (e.key === "ArrowDown" && searchResults.length === 0 && lines.length > 0) {
          e.preventDefault();
          handleSelectRow(0);
          return;
        }
        if (isCmdOrCtrl && e.key === "ArrowDown" && lines.length > 0) {
          e.preventDefault();
          handleSelectRow(0);
          return;
        }
      }

      // If no row is selected and not in an input, ArrowDown selects row 0
      if (selectedRowIndex === null && lines.length > 0 && !isInputFocused) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          handleSelectRow(0);
          return;
        }
      }

      // Global Item-level shortcuts (F2 for item discount, F3 for item rate)
      const isItemDiscountKey =
        (e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.shiftKey) ||
        (e.altKey && (e.key === "2" || code === "Digit2" || code === "Numpad2")) ||
        (isCmdOrCtrl && e.shiftKey && (keyLower === "i" || code === "KeyI"));

      const isItemRateKey =
        (e.key === "F3" && !e.ctrlKey && !e.metaKey && !e.shiftKey) ||
        (e.altKey && (e.key === "3" || code === "Digit3" || code === "Numpad3")) ||
        (isCmdOrCtrl && e.shiftKey && (keyLower === "p" || code === "KeyP"));

      if (isItemDiscountKey && lines.length > 0) {
        e.preventDefault();
        const targetIdx = selectedRowIndex !== null && selectedRowIndex >= 0 && selectedRowIndex < lines.length
          ? selectedRowIndex
          : 0;
        handleSelectRow(targetIdx);
        handleQuickDiscount(lines[targetIdx]);
        return;
      }

      if (isItemRateKey && lines.length > 0) {
        e.preventDefault();
        const targetIdx = selectedRowIndex !== null && selectedRowIndex >= 0 && selectedRowIndex < lines.length
          ? selectedRowIndex
          : 0;
        handleSelectRow(targetIdx);
        handleQuickRate(lines[targetIdx]);
        return;
      }

      const isItemProductBatchEditKey =
        (e.key === "F4" && !e.ctrlKey && !e.metaKey && !e.shiftKey) ||
        (isCmdOrCtrl && (keyLower === "m" || code === "KeyM"));

      if (isItemProductBatchEditKey && lines.length > 0) {
        e.preventDefault();
        const targetIdx = selectedRowIndex !== null && selectedRowIndex >= 0 && selectedRowIndex < lines.length
          ? selectedRowIndex
          : 0;
        handleSelectRow(targetIdx);
        setSelectedLineForProductBatchEdit(lines[targetIdx]);
        return;
      }

      // When a row is selected in the grid:
      if (selectedRowIndex !== null && selectedRowIndex >= 0 && selectedRowIndex < lines.length) {
        // Alt+ArrowUp / Alt+ArrowDown: Reorder Lines
        if (e.altKey && (e.key === "ArrowUp" || code === "ArrowUp")) {
          e.preventDefault();
          handleMoveLine("up");
          return;
        }
        if (e.altKey && (e.key === "ArrowDown" || code === "ArrowDown")) {
          e.preventDefault();
          handleMoveLine("down");
          return;
        }

        // Ctrl+ArrowDown / Cmd+ArrowDown: Jump to next row's Qty field
        if (isCmdOrCtrl && e.key === "ArrowDown") {
          e.preventDefault();
          const nextIdx = Math.min(lines.length - 1, selectedRowIndex + 1);
          handleSelectRow(nextIdx);
          const nextLine = lines[nextIdx];
          const el = (document.getElementById(`qty-input-${nextLine.id}-pack`) ||
            document.getElementById(`qty-input-${nextLine.id}`)) as HTMLInputElement | null;
          el?.focus();
          el?.select();
          setFocusContext("cell_edit");
          return;
        }

        // Ctrl+ArrowUp / Cmd+ArrowUp: Jump to prev row's Qty field (or search if row 0)
        if (isCmdOrCtrl && e.key === "ArrowUp") {
          e.preventDefault();
          if (selectedRowIndex === 0) {
            handleFocusSearch();
          } else {
            const prevIdx = selectedRowIndex - 1;
            handleSelectRow(prevIdx);
            const prevLine = lines[prevIdx];
            const el = (document.getElementById(`qty-input-${prevLine.id}-pack`) ||
              document.getElementById(`qty-input-${prevLine.id}`)) as HTMLInputElement | null;
            el?.focus();
            el?.select();
            setFocusContext("cell_edit");
          }
          return;
        }

        // Delete or Ctrl+D / Cmd+D: Delete Line
        if ((isCmdOrCtrl && (keyLower === "d" || code === "KeyD")) || (e.key === "Delete" && !isInputFocused)) {
          e.preventDefault();
          handleDeleteSelectedLine();
          return;
        }

        // Ctrl+B / Cmd+B: Change Batch
        if (isCmdOrCtrl && (keyLower === "b" || code === "KeyB")) {
          e.preventDefault();
          handleOpenBatchForSelectedLine();
          return;
        }

        // Ctrl+U / Cmd+U: Toggle Unit Rate / Pack Rate
        if (isCmdOrCtrl && (keyLower === "u" || code === "KeyU")) {
          e.preventDefault();
          handleToggleUnitRateForSelectedLine();
          return;
        }

        // Ctrl+E / Cmd+E: Edit Unit Conversion
        if (isCmdOrCtrl && (keyLower === "e" || code === "KeyE")) {
          e.preventDefault();
          setSelectedLineForConversion(lines[selectedRowIndex]);
          return;
        }

        // If not typing in an input: ArrowUp / ArrowDown moves between rows
        if (!isInputFocused) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            handleSelectRow(Math.min(lines.length - 1, selectedRowIndex + 1));
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            if (selectedRowIndex === 0) {
              handleFocusSearch();
            } else {
              handleSelectRow(selectedRowIndex - 1);
            }
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const activeLine = lines[selectedRowIndex];
            const el = (document.getElementById(`qty-input-${activeLine.id}-pack`) ||
              document.getElementById(`qty-input-${activeLine.id}`)) as HTMLInputElement | null;
            el?.focus();
            el?.select();
            setFocusContext("cell_edit");
            return;
          }
        }
      } else if (lines.length > 0 && isCmdOrCtrl && (keyLower === "d" || code === "KeyD")) {
        // If user presses Ctrl+D with items in cart but no specific row selected, delete the last line
        e.preventDefault();
        handleDeleteSelectedLine(lines.length - 1);
        return;
      }

      // Escape: Close dropdowns / cancel edit safely without exiting fullscreen
      if (e.key === "Escape") {
        if (searchResults.length > 0) {
          e.preventDefault();
          setSearchResults([]);
          return;
        }
        if (selectedRowIndex !== null) {
          e.preventDefault();
          handleFocusSearch();
          return;
        }
      }
    };

    const handleOpenColumnsModal = () => setIsColumnsModalOpen(true);
    const handleApplyPresetEvent = (e: any) => {
      if (e.detail?.presetId) {
        companySettingsService.applyBillingPreset(e.detail.presetId).then((res) => {
          setPosColumns([...res.columns]);
          setPosHeaders([...res.headerFields]);
          showNotification(`Switched preset to ${e.detail.presetId.toUpperCase()}`);
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("open-billing-columns-modal", handleOpenColumnsModal);
    window.addEventListener("apply-billing-preset", handleApplyPresetEvent);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("open-billing-columns-modal", handleOpenColumnsModal);
      window.removeEventListener("apply-billing-preset", handleApplyPresetEvent);
    };
  }, [
    isTenderModalOpen,
    isRecallModalOpen,
    isDiffModalOpen,
    isColumnsModalOpen,
    selectedProductForBatch,
    searchResults.length,
    lines,
    selectedRowIndex,
    undoDeleteBuffer,
    isShortcutsModalOpen,
    isBillDiscountModalOpen,
    isRoundOffModalOpen,
    quickEditModal.isOpen,
    focusContext,
    editingInvoice,
    originalInvoiceItems,
    totals.grand_total,
  ]);

  const handleCustomerPhoneChange = async (newPhone: string) => {
    setCustomerPhone(newPhone);
    const clean = normalizeIndianPhone(newPhone);
    if (clean.length === 10) {
      const match = await partiesStore.findCustomerByPhone(clean);
      if (match) {
        setSelectedCustomer(match);
        setCustomerName(match.name);
        setCustomerGstin(match.gstin || "");
        posCartService.setCustomer(match.id, match.name, match.gstin || "", match.place_of_supply || "", match.phone);
        showNotification(`Matched customer: ${match.name}`);
      }
    }
  };

  // When batch modal opens: focus inside the modal and highlight earliest expiry (row 0)
  useEffect(() => {
    if (selectedProductForBatch) {
      setSelectedBatchIndex(0);
      const timer = setTimeout(() => {
        batchListRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [selectedProductForBatch]);

  // Keep highlighted batch row scrolled into view within the modal list
  useEffect(() => {
    if (selectedProductForBatch && batchListRef.current) {
      const activeEl = batchListRef.current.children[selectedBatchIndex] as HTMLElement | undefined;
      activeEl?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedBatchIndex, selectedProductForBatch]);

  // Batch modal keyboard navigation: Up/Down arrow wrap around, Enter selects, Esc closes
  useEffect(() => {
    if (!selectedProductForBatch) return;

    const handleBatchKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        if (productBatches.length > 0) {
          setSelectedBatchIndex((prev) => (prev + 1) % productBatches.length);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (productBatches.length > 0) {
          setSelectedBatchIndex((prev) => (prev - 1 + productBatches.length) % productBatches.length);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const highlightedBatch = productBatches[selectedBatchIndex];
        if (highlightedBatch) {
          addBatchToCart(highlightedBatch);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeBatchModal();
      }
    };

    window.addEventListener("keydown", handleBatchKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleBatchKeyDown, true);
    };
  }, [selectedProductForBatch, productBatches, selectedBatchIndex]);

  // Search products when query changes
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      const results = await productsStore.searchProducts(query);
      setSearchResults(results);
      setSelectedSearchIndex(0);
      updateDropdownPosition();
    }, 150);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Keep dropdown positioned properly during window resize/scroll and handle outside click
  useEffect(() => {
    const handleScrollOrResize = () => {
      if (searchResults.length > 0) {
        updateDropdownPosition();
      }
    };

    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("scroll", handleScrollOrResize, true);

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        searchInputRef.current &&
        !searchInputRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setSearchResults([]);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [searchResults.length]);

  // Auto-scroll selected search result item into view
  useEffect(() => {
    if (searchResults.length > 0 && dropdownRef.current) {
      const activeEl = dropdownRef.current.children[selectedSearchIndex] as HTMLElement | undefined;
      activeEl?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedSearchIndex, searchResults]);

  const showNotification = (
    message: string,
    type: "success" | "error" | "info" | "warning" = "success",
    actions?: NotificationAction[]
  ) => {
    setNotification({ message, type, actions });
    setTimeout(() => setNotification(null), actions && actions.length > 0 ? 8000 : 3000);
  };

  const handleBarcodeOrEnter = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (searchResults.length > 0) {
        setSelectedSearchIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : prev));
      } else if (lines.length > 0) {
        handleSelectRow(0);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (searchResults.length > 0) {
        setSelectedSearchIndex((prev) => (prev > 0 ? prev - 1 : 0));
      }
      return;
    }

    if (e.key === "Escape") {
      if (searchResults.length > 0) {
        e.preventDefault();
        setSearchResults([]);
        return;
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const code = searchQuery.trim();
      if (!code) return;

      // 1. First check if input matches exact barcode
      const productByBarcode = await productsStore.findProductByBarcode(code);
      if (productByBarcode) {
        await selectProductAndAddToCart(productByBarcode);
        setSearchQuery("");
        setSearchResults([]);
        return;
      }

      // 2. Otherwise pick selected or first matching search result if available
      if (searchResults.length > 0) {
        const itemToSelect = searchResults[selectedSearchIndex] || searchResults[0];
        await selectProductAndAddToCart(itemToSelect);
        setSearchQuery("");
        setSearchResults([]);
      }
    }
  };

  const selectProductAndAddToCart = async (product: ProductItem) => {
    // Retrieve all batches in FEFO order (including out-of-stock batches)
    const batches = await productsStore.getBatchesForProduct(product.id, false);
    const appSettings = companySettingsService.getSettings();
    const allowSellingOutOfStock = appSettings.inventory?.allowSellingOutOfStock || "always";

    if (batches.length === 0) {
      if (allowSellingOutOfStock === "never") {
        showNotification(`No stock batches available for ${product.name} (Selling out-of-stock is disabled)`, "error");
        return;
      }

      // Ad-hoc batch on the fly
      const adhocBatch: ProductBatch = {
        id: `batch_adhoc_${product.id}_${Date.now()}`,
        product_id: product.id,
        batch_no: "NO_BATCH",
        expiry_date: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        stock_qty: 0,
        mrp: product.mrp,
        selling_rate: product.sel_rate,
        purchase_rate: product.sel_rate * 0.7,
      };

      const res = posCartService.addProductToCart(product, adhocBatch, 1, 0, { isAdhocBatch: true });
      refreshCartState();
      setSearchQuery("");
      setSearchResults([]);
      if (res.line) {
        const newLines = posCartService.getLines();
        const newIdx = newLines.findIndex((l) => l.id === res.line!.id);
        const targetIdx = newIdx >= 0 ? newIdx : newLines.length - 1;
        setSelectedRowIndex(targetIdx);
        setFocusContext("cell_edit");
        searchInputRef.current?.blur();
        setTimeout(() => {
          const el = (document.getElementById(`qty-input-${res.line!.id}-pack`) ||
            document.getElementById(`qty-input-${res.line!.id}`)) as HTMLInputElement | null;
          if (el) {
            el.focus();
            el.select();
          }
        }, 50);
      }
      setAriaAnnouncement(`Added ${product.name}, Quantity 1. Total: ₹${posCartService.getTotals().grand_total.toFixed(2)}`);
      if (appSettings.inventory?.warnOnNegativeStock ?? true) {
        showNotification(`${product.name} added without existing batch (Stock 0)`, "info");
      }
      return;
    }

    const unexpiredBatches = batches.filter((b) => !isBatchExpired(b.expiry_date));

    if (batches.length === 1 && unexpiredBatches.length === 1) {
      const b = batches[0];
      const isOutOfStock = (b.stock_qty || 0) <= 0;

      if (isOutOfStock && allowSellingOutOfStock === "never") {
        showNotification(`Batch ${b.batch_no} is out of stock`, "error");
        return;
      }

      if (isOutOfStock && allowSellingOutOfStock === "ask") {
        const confirmed = window.confirm(`Batch ${b.batch_no} is out of stock (0 available). Add anyway?`);
        if (!confirmed) return;
      }

      const res = posCartService.addProductToCart(product, b, 1, 0);
      refreshCartState();
      setSearchQuery("");
      setSearchResults([]);
      if (res.line) {
        const newLines = posCartService.getLines();
        const newIdx = newLines.findIndex((l) => l.id === res.line!.id);
        const targetIdx = newIdx >= 0 ? newIdx : newLines.length - 1;
        setSelectedRowIndex(targetIdx);
        setFocusContext("cell_edit");
        searchInputRef.current?.blur();
        setTimeout(() => {
          const el = (document.getElementById(`qty-input-${res.line!.id}-pack`) ||
            document.getElementById(`qty-input-${res.line!.id}`)) as HTMLInputElement | null;
          if (el) {
            el.focus();
            el.select();
          }
        }, 50);
      }
      setAriaAnnouncement(`Added ${product.name}, Quantity 1. Total: ₹${posCartService.getTotals().grand_total.toFixed(2)}`);
    } else {
      // Multiple batches or expired batch: display batch picker modal
      setSelectedProductForBatch(product);
      setProductBatches(batches);
      setSelectedBatchIndex(0);
    }
  };

  const addBatchToCart = (batch: ProductBatch) => {
    if (!selectedProductForBatch) return;
    const appSettings = companySettingsService.getSettings();
    const allowSellingOutOfStock = appSettings.inventory?.allowSellingOutOfStock || "always";
    const allowExpiredBatchSale = appSettings.inventory?.allowExpiredBatchSale || "warn_confirm";

    const isExpired = isBatchExpired(batch.expiry_date);
    const isOutOfStock = (batch.stock_qty || 0) <= 0;

    if (isExpired) {
      if (allowExpiredBatchSale === "block") {
        showNotification(
          `Batch ${batch.batch_no} is expired (${batch.expiry_date}) and cannot be billed`,
          "error"
        );
        return;
      }
      const confirmed = window.confirm(
        `COMPLIANCE WARNING: Batch ${batch.batch_no} is expired (${batch.expiry_date}). Do you explicitly confirm adding this expired batch?`
      );
      if (!confirmed) return;
    }

    if (isOutOfStock) {
      if (allowSellingOutOfStock === "never") {
        showNotification(`Batch ${batch.batch_no} is out of stock`, "error");
        return;
      }
      if (allowSellingOutOfStock === "ask") {
        const confirmed = window.confirm(
          `Batch ${batch.batch_no} has 0 stock. Do you want to sell beyond available stock?`
        );
        if (!confirmed) return;
      }
    }

    const res = posCartService.addProductToCart(selectedProductForBatch, batch, 1, 0);
    refreshCartState();
    setSelectedProductForBatch(null);
    setSelectedBatchIndex(0);
    setSearchQuery("");
    setSearchResults([]);
    if (res.line) {
      const newLines = posCartService.getLines();
      const newIdx = newLines.findIndex((l) => l.id === res.line!.id);
      const targetIdx = newIdx >= 0 ? newIdx : newLines.length - 1;
      setSelectedRowIndex(targetIdx);
      setFocusContext("cell_edit");
      searchInputRef.current?.blur();
      setTimeout(() => {
        const el = (document.getElementById(`qty-input-${res.line!.id}-pack`) ||
          document.getElementById(`qty-input-${res.line!.id}`)) as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select();
        }
      }, 50);
    }
    setAriaAnnouncement(`Added ${selectedProductForBatch.name}, Quantity 1. Total: ₹${posCartService.getTotals().grand_total.toFixed(2)}`);
  };

  const updateQuantity = (lineId: string, delta: number) => {
    const line = lines.find((l) => l.id === lineId);
    if (!line) return;
    const newQty = Math.max(1, line.qty + delta);
    posCartService.updateLineQuantity(lineId, newQty, line.loose_qty);
    refreshCartState();
  };

  const removeLine = (lineId: string) => {
    posCartService.removeLine(lineId);
    refreshCartState();
  };

  const handleHoldBill = () => {
    const currentLines = posCartService.getLines();
    if (currentLines.length === 0) {
      showNotification("Cart is empty. Nothing to hold.", "error");
      return;
    }

    const holdRef = billingTenderService.holdBill(
      {
        lines: currentLines,
        customerPhone,
        customerGstin,
        selectedCustomer,
      },
      currentLines.length,
      totals.grand_total,
      customerName
    );

    posCartService.clearCart();
    refreshCartState();
    showNotification(`Bill held successfully (${holdRef})`);
  };

  const handleRecallBill = (holdId: string) => {
    const recalled = billingTenderService.recallBill(holdId);
    if (!recalled) {
      showNotification("Failed to recall held bill", "error");
      return;
    }

    posCartService.clearCart();
    const payloadLines = (recalled.cart_payload.lines as PosCartLine[]) || [];
    for (const line of payloadLines) {
      posCartService.addProductToCart(line.product, line.selectedBatch, line.qty, line.loose_qty);
    }

    const payload = recalled.cart_payload || {};
    const recalledName = recalled.customer_name || "Walk-in Customer";
    const recalledPhone = (payload.customerPhone as string) || "";
    const recalledGstin = (payload.customerGstin as string) || "";
    const recalledCustomer = (payload.selectedCustomer as Customer) || null;

    setCustomerName(recalledName);
    setCustomerPhone(recalledPhone);
    setCustomerGstin(recalledGstin);
    setSelectedCustomer(recalledCustomer);

    posCartService.setCustomer(
      recalledCustomer?.id || "",
      recalledName,
      recalledGstin,
      recalledCustomer?.place_of_supply || "",
      recalledPhone
    );

    setIsRecallModalOpen(false);
    refreshCartState();
    showNotification(`Recalled bill for ${recalledName}`);
  };

  const openTenderModal = () => {
    // Validate empty cart before opening modal
    const currentLines = posCartService.getLines().length > 0 ? posCartService.getLines() : lines;
    if (currentLines.length === 0) {
      showNotification("Cannot open checkout: Cart is empty. Please add products first.", "error");
      return;
    }

    // If editing past invoice, compute diff and open diff confirmation modal
    if (editingInvoice) {
      const diff = invoiceManagementService.computeDiff(originalInvoiceItems, currentLines);
      setEditDiff(diff);
      setIsDiffModalOpen(true);
      return;
    }

    const t = posCartService.getTotals();
    setTenders([{ mode: "Cash", amount: t.grand_total }]);
    setReceivedCash(t.grand_total);
    setIsTenderModalOpen(true);
    setTimeout(() => tenderCashInputRef.current?.focus(), 100);
  };

  const handleSaveEditedInvoice = async () => {
    if (!editingInvoice) return;
    if (isFinalizingRef.current) return;
    isFinalizingRef.current = true;
    setIsFinalizing(true);

    try {
      const cartSnapshot = posCartService.getLines().length > 0 ? posCartService.getLines() : lines;
      if (cartSnapshot.length === 0) {
        showNotification("Cannot save invoice with 0 items. Please cancel the bill instead.", "error");
        return;
      }

      const primaryPaymentMode = tenders[0]?.mode || editingInvoice.payment_mode || "Cash";
      const res = await invoiceManagementService.saveInvoiceEdit(editingInvoice.id, {
        lines: cartSnapshot,
        customerName,
        customerPhone,
        customerGstin,
        paymentMode: primaryPaymentMode,
        reason: editReason || "Invoice revised from POS screen",
        operatorUser: "Counter 01",
      });

      if (res.success) {
        // Trigger revised print
        const printData = preparePrintData(cartSnapshot);
        printData.invoice_number = `${editingInvoice.invoice_number} (Revised)`;

        const appSettings = companySettingsService.getSettings();
        const previewMode = appSettings.printing.previewMode || "always";
        const isThermal = printFormat === "thermal";
        const shouldDirectPrint = previewMode === "never" || (previewMode === "skip_thermal" && isThermal);

        let savedPdfPath: string | undefined;

        if (shouldDirectPrint) {
          if (printFormat === "thermal") {
            await printingEngine.printThermalReceipt(printData);
          } else if (printFormat === "a4") {
            await printingEngine.printA4TaxInvoice(printData);
          } else if (printFormat === "pdf") {
            const exportRes = await printingEngine.exportToPdf(printData);
            if (exportRes.cancelled) return;
            if (!exportRes.success) {
              showNotification(exportRes.error || "Failed to save revised PDF bill", "error");
              return;
            }
            savedPdfPath = exportRes.file_path;
          }
        } else {
          setPreviewModalState({
            isOpen: true,
            data: printData,
            initialFormat: printFormat === "a4" ? "a4" : "thermal_80mm",
            title: `Revised Invoice Preview - #${editingInvoice.invoice_number}`,
          });
        }

        posCartService.clearCart();
        refreshCartState();
        setIsDiffModalOpen(false);
        setEditingInvoice(null);
        setOriginalInvoiceItems([]);
        setSearchParams({});
        setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
        setCustomerName("Walk-in Customer");
        setCustomerPhone("");
        setCustomerGstin("");
        setSelectedCustomer(null);
        posCartService.setCustomer("", "Walk-in Customer", "", "", "");
        setEditReason("");
        showNotification(
          savedPdfPath
            ? `Saved to: ${savedPdfPath}`
            : `Invoice ${editingInvoice.invoice_number} revised successfully!`,
          "success",
          savedPdfPath
            ? [
                {
                  label: "Open file",
                  icon: "open",
                  onClick: () => printingEngine.openFile(savedPdfPath!),
                },
                {
                  label: "Show in folder",
                  icon: "folder",
                  onClick: () => printingEngine.revealFile(savedPdfPath!),
                },
              ]
            : undefined
        );
        setTimeout(() => {
          searchInputRef.current?.focus();
        }, 50);
      }
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Error saving revision", "error");
    } finally {
      isFinalizingRef.current = false;
      setIsFinalizing(false);
    }
  };

  const calculatedBalanceChange = useMemo(() => {
    const cashTender = tenders.find((t) => t.mode === "Cash");
    if (cashTender && receivedCash > cashTender.amount) {
      return Math.round((receivedCash - cashTender.amount) * 100) / 100;
    }
    return 0;
  }, [tenders, receivedCash]);

  const preparePrintData = (linesSource?: PosCartLine[], totalsSource?: InvoiceTotals): InvoicePrintData => {
    const activeLines = linesSource || (posCartService.getLines().length > 0 ? posCartService.getLines() : lines);
    const activeTotals = totalsSource || (posCartService.getLines().length > 0 ? posCartService.getTotals() : totals);

    const settings = companySettingsService.getSettings();

    return {
      invoice_number: invoiceNumber,
      invoice_date: new Date().toISOString().slice(0, 10),
      store_name: settings.display_name || settings.store_name || "LamStone Pharmacy & Retail",
      store_address: settings.address || "Main Road, Palakkad, Kerala - 678001",
      store_phone: settings.phone || "9876543210",
      store_email: settings.email || undefined,
      store_gstin: settings.gstin || "32ABCDE1234F1Z5",
      drug_license_numbers: settings.drug_license_numbers && settings.drug_license_numbers.length > 0 ? settings.drug_license_numbers : ["20B/KL-PKD-1029", "21B/KL-PKD-1030"],
      fssai_no: settings.fssai_no || undefined,
      place_of_supply: settings.state_code ? `${settings.state_code}-Kerala` : "32-Kerala",
      customer_name: customerName || "Walk-in Customer",
      customer_phone: customerPhone || "",
      customer_gstin: customerGstin || undefined,
      doctor_name: doctorName || undefined,
      patient_name: patientName || undefined,
      payment_mode: tenders[0]?.mode || "Cash",
      payment_status: "Paid",
      lines: activeLines.map((l) => ({
        description: l.product.name,
        hsn_code: (l.product as any).hsn_code || "300490",
        batch_no: l.selectedBatch.batch_no,
        expiry_date: l.selectedBatch.expiry_date,
        qty: l.qty,
        loose_qty: l.loose_qty,
        rate: l.unit_price,
        ptr: l.product.ptr,
        pts: l.product.pts,
        gst_percent: l.product.gst_percent,
        amount: l.calculated.total_amount,
      })),
      subtotal: activeTotals.taxable_subtotal,
      tax_total: activeTotals.total_tax,
      round_off: activeTotals.round_off,
      grand_total: activeTotals.grand_total,
      upi_vpa: (settings.printing as any)?.upi_vpa || "pharmacy@upi",
      terms_and_conditions: settings.printing?.termsAndConditions,
      jurisdiction_note: settings.printing?.jurisdictionNote,
      footer_note: settings.printing?.footerNote,
    };
  };

  const handleShareWhatsApp = () => {
    if (!customerPhone.trim()) {
      showNotification("Please enter customer mobile number to share via WhatsApp", "error");
      return;
    }
    const data = preparePrintData();
    const url = generateWhatsAppShareUrl(customerPhone, data);
    if (isTauri()) {
      import("@tauri-apps/api/shell").then(({ open }) => open(url)).catch(() => window.open(url, "_blank"));
    } else {
      window.open(url, "_blank");
    }
    showNotification("WhatsApp invoice link opened!");
  };

  const handleShareEmail = () => {
    const data = preparePrintData();
    const url = generateEmailShareUrl("customer@example.com", data);
    if (isTauri()) {
      import("@tauri-apps/api/shell").then(({ open }) => open(url)).catch(() => window.open(url, "_blank"));
    } else {
      window.open(url, "_blank");
    }
    showNotification("Email invoice client opened!");
  };

  const handleFinalizeAndPrint = async () => {
    // 1. Idempotency guard: ignore repeat triggers while a save is in progress
    if (isFinalizingRef.current) {
      return;
    }
    isFinalizingRef.current = true;
    setIsFinalizing(true);

    try {
      // 2. Snapshot cart state at start of finalize
      const cartSnapshot = posCartService.getLines().length > 0 ? posCartService.getLines() : lines;
      const totalsSnapshot = posCartService.getLines().length > 0 ? posCartService.getTotals() : totals;

      if (cartSnapshot.length === 0) {
        showNotification("Cannot finalize: Cart is empty", "error");
        return;
      }

      // Sync customer details to cart service
      posCartService.setCustomer(
        selectedCustomer?.id || "",
        customerName || "Walk-in Customer",
        customerGstin || "",
        selectedCustomer?.place_of_supply || "32-Kerala",
        customerPhone || ""
      );

      // 3. Prepare snapshot of print data BEFORE saving or clearing
      const printData = preparePrintData(cartSnapshot, totalsSnapshot);
      const primaryPaymentMode = tenders[0]?.mode || "Cash";

      // 4. Save invoice without auto-clearing the cart yet
      const res = await posCartService.finalizeInvoice(invoiceNumber, primaryPaymentMode, {
        autoClear: false,
        linesSnapshot: cartSnapshot,
        totalsSnapshot,
      });

      if (res.success) {
        // 5. Check if we should open Print Preview or print directly
        const appSettings = companySettingsService.getSettings();
        const previewMode = appSettings.printing.previewMode || "always";
        const isThermal = printFormat === "thermal";
        const shouldDirectPrint = previewMode === "never" || (previewMode === "skip_thermal" && isThermal);

        let savedPdfPath: string | undefined;

        if (shouldDirectPrint) {
          if (printFormat === "thermal") {
            await printingEngine.printThermalReceipt(printData);
          } else if (printFormat === "a4") {
            await printingEngine.printA4TaxInvoice(printData);
          } else if (printFormat === "pdf") {
            const exportRes = await printingEngine.exportToPdf(printData);
            if (exportRes.cancelled) return;
            if (!exportRes.success) {
              showNotification(exportRes.error || "Failed to save PDF file", "error");
              return;
            }
            savedPdfPath = exportRes.file_path;
          }
        } else {
          // Open Print Preview Modal with snapshot
          setPreviewModalState({
            isOpen: true,
            data: printData,
            initialFormat: printFormat === "a4" ? "a4" : "thermal_80mm",
            title: `Tax Invoice Preview - #${invoiceNumber}`,
          });
        }

        // 6. Clear cart ONLY after save has succeeded
        posCartService.clearCart();
        refreshCartState();
        setIsTenderModalOpen(false);
        showNotification(
          savedPdfPath
            ? `Saved to: ${savedPdfPath}`
            : `Invoice ${invoiceNumber} billed successfully!`,
          "success",
          savedPdfPath
            ? [
                {
                  label: "Open file",
                  icon: "open",
                  onClick: () => printingEngine.openFile(savedPdfPath!),
                },
                {
                  label: "Show in folder",
                  icon: "folder",
                  onClick: () => printingEngine.revealFile(savedPdfPath!),
                },
              ]
            : undefined
        );
        setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
        setCustomerName("Walk-in Customer");
        setCustomerPhone("");
        setCustomerGstin("");
        setSelectedCustomer(null);
        posCartService.setCustomer("", "Walk-in Customer", "", "", "");
        setTimeout(() => {
          searchInputRef.current?.focus();
        }, 50);
      }
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Error saving invoice", "error");
    } finally {
      isFinalizingRef.current = false;
      setIsFinalizing(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 font-sans">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 flex flex-col gap-2 rounded-xl p-3.5 text-xs font-semibold shadow-2xl transition-all max-w-lg border ${
            notification.type === "success"
              ? "bg-slate-900 text-slate-100 border-emerald-500/50"
              : notification.type === "info"
              ? "bg-blue-900 text-white border-blue-600"
              : notification.type === "warning"
              ? "bg-amber-900 text-white border-amber-600"
              : "bg-red-800 text-white border-red-600"
          }`}
        >
          <div className="flex items-start gap-2.5">
            {notification.type === "success" ? (
              <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : notification.type === "info" ? (
              <AlertCircle className="h-4 w-4 text-blue-300 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-200 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 overflow-hidden">
              <p className="font-medium break-all leading-relaxed">{notification.message}</p>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-slate-400 hover:text-white p-0.5 cursor-pointer ml-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {notification.actions && notification.actions.length > 0 && (
            <div className="flex items-center gap-2 pt-2 border-t border-slate-700/60 mt-0.5">
              {notification.actions.map((act, i) => (
                <button
                  key={i}
                  onClick={act.onClick}
                  className="flex items-center gap-1.5 rounded-md bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] font-bold text-emerald-400 border border-slate-700 shadow-xs cursor-pointer transition-colors"
                >
                  {act.icon === "folder" ? (
                    <FolderOpen className="h-3 w-3" />
                  ) : (
                    <ExternalLink className="h-3 w-3" />
                  )}
                  <span>{act.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Header Strip: Customer & Bill Meta */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-4">
          {posHeaders.find((h) => h.id === "invoice_no")?.visible !== false && (
            <div>
              <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Invoice No</span>
              <p className="text-xs font-bold font-mono text-[var(--color-accent)]">{invoiceNumber}</p>
            </div>
          )}

          {posHeaders.find((h) => h.id === "customer_name")?.visible !== false && (
            <>
              <div className="h-6 w-px bg-[var(--color-border)] hidden sm:block" />
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-[var(--color-text-muted)]" />
                <CustomerCombobox
                  value={customerName}
                  phone={customerPhone}
                  gstin={customerGstin}
                  selectedCustomer={selectedCustomer}
                  inputRef={customerInputRef}
                  onChange={(sel) => {
                    setCustomerName(sel.name);
                    if (sel.phone !== undefined) setCustomerPhone(sel.phone);
                    if (sel.gstin !== undefined) setCustomerGstin(sel.gstin);
                    setSelectedCustomer(sel.customer || null);

                    const companySettings = companySettingsService.getSettings();
                    const homeState = (companySettings.state_code || "32").trim();
                    const custGstin = sel.gstin || sel.customer?.gstin || "";
                    const custStateFromGstin = custGstin.length >= 2 ? custGstin.slice(0, 2) : "";
                    const custPlaceOfSupply = sel.customer?.place_of_supply || "";
                    const custStateCode = custStateFromGstin || (custPlaceOfSupply.slice(0, 2).match(/^\d{2}$/) ? custPlaceOfSupply.slice(0, 2) : homeState);
                    const isInterState = custStateCode !== "" && custStateCode !== homeState;

                    posCartService.setIsInterState(isInterState);
                    posCartService.setCustomer(
                      sel.customer?.id || "",
                      sel.name,
                      sel.gstin || "",
                      sel.customer?.place_of_supply || "",
                      sel.phone || ""
                    );
                    refreshCartState();
                  }}
                  onQuickAddSuccess={(cust) => {
                    showNotification(`Added new customer: ${cust.name}`);
                  }}
                />
              </div>
            </>
          )}

          {posHeaders.find((h) => h.id === "customer_phone")?.visible !== false && (
            <input
              type="text"
              value={customerPhone}
              onChange={(e) => handleCustomerPhoneChange(e.target.value)}
              placeholder="Mobile (+91)"
              className="w-28 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-mono font-medium text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          )}

          {posHeaders.find((h) => h.id === "customer_gstin")?.visible && (
            <input
              type="text"
              value={customerGstin}
              onChange={(e) => setCustomerGstin(e.target.value)}
              placeholder="GSTIN"
              className="w-32 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-mono text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none uppercase"
            />
          )}

          {posHeaders.find((h) => h.id === "doctor")?.visible && (
            <input
              type="text"
              value={doctorName}
              onChange={(e) => {
                setDoctorName(e.target.value);
                posCartService.setPrescriptionMeta({ doctor_name: e.target.value });
              }}
              placeholder="Dr. Name"
              className="w-28 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          )}

          {posHeaders.find((h) => h.id === "patient")?.visible && (
            <input
              type="text"
              value={patientName}
              onChange={(e) => {
                setPatientName(e.target.value);
                posCartService.setPrescriptionMeta({ patient_name: e.target.value });
              }}
              placeholder="Patient Name"
              className="w-28 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          )}

          {posHeaders.find((h) => h.id === "notes")?.visible && (
            <input
              type="text"
              value={billNotes}
              onChange={(e) => setBillNotes(e.target.value)}
              placeholder="Bill Remarks"
              className="w-32 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          )}
        </div>

        {/* Action Shortcuts: Hold, Recall, Find Bill, Columns config */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsColumnsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text)] shadow-2xs transition-colors cursor-pointer"
            title="Configure POS Columns & Presets (Ctrl+Shift+C)"
          >
            <Sliders className="h-3.5 w-3.5 text-[var(--color-accent)]" />
            <span className="hidden sm:inline">Columns (Ctrl+Shift+C)</span>
          </button>

          <button
            onClick={() => navigate("/bills")}
            className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-surface-subtle)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
            title="Recall / Find Past Bills (F6)"
          >
            <FileText className="h-3.5 w-3.5 text-[var(--color-accent)]" />
            <span className="hidden md:inline">Find Bill (F6)</span>
          </button>

          <button
            onClick={handleHoldBill}
            className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-warning-text)] hover:opacity-90 cursor-pointer"
          >
            <PauseCircle className="h-3.5 w-3.5" />
            <span>Hold (F8)</span>
          </button>

          <button
            onClick={() => setIsRecallModalOpen(true)}
            className="relative flex items-center gap-1.5 rounded-[10px] bg-[var(--color-accent-soft)] border border-[var(--color-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:opacity-90 cursor-pointer"
          >
            <PlayCircle className="h-3.5 w-3.5" />
            <span>Recall (F9)</span>
            {heldBillsCount > 0 && (
              <span className="ml-1 rounded-full bg-[var(--color-accent)] px-1.5 py-0.2 text-[10px] font-bold font-mono text-white">
                {heldBillsCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Editing Mode Banner */}
      {editingInvoice && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 shadow-sm text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="font-bold text-amber-950">
              Editing Invoice: {editingInvoice.invoice_number}
            </span>
            <span className="text-amber-800">
              (Original Total: ₹{editingInvoice.grand_total.toFixed(2)} • Billed on {editingInvoice.invoice_date})
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] text-amber-700 font-medium hidden sm:inline">
              Changes will reverse original stock and update ledger atomically on Save (F12)
            </span>
            <button
              onClick={cancelEditingMode}
              className="rounded bg-amber-200 px-3 py-1 text-xs font-bold text-amber-950 hover:bg-amber-300 transition-colors shadow-xs"
            >
              Cancel Editing
            </button>
          </div>
        </div>
      )}

      {/* Main Billing Workspace: Search & High-Speed Items Grid */}
      <div className="flex flex-1 flex-col rounded-card border border-border-main bg-surface shadow-2xs overflow-hidden">
        {/* Product / Barcode Search Bar */}
        <div className="relative border-b border-border-main p-3 bg-canvas">
          <div className="relative flex items-center">
            <Search className="absolute left-3.5 h-4 w-4 text-[var(--color-text-faint)]" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleBarcodeOrEnter}
              onFocus={() => {
                setFocusContext("search");
                setSelectedRowIndex(null);
                if (searchQuery.trim().length > 0 && searchResults.length === 0) {
                  productsStore.searchProducts(searchQuery.trim()).then((res) => {
                    setSearchResults(res);
                    setSelectedSearchIndex(0);
                    updateDropdownPosition();
                  });
                } else if (searchResults.length > 0) {
                  updateDropdownPosition();
                }
              }}
              onBlur={(e) => {
                const related = e.relatedTarget as Node | null;
                if (dropdownRef.current && related && dropdownRef.current.contains(related)) {
                  return;
                }
                setTimeout(() => {
                  setSearchResults([]);
                }, 180);
              }}
              placeholder="Scan barcode or type medicine / product name (Press Enter)... [F1]"
              className="w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] pl-10 pr-24 py-2 text-xs font-medium text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none shadow-2xs transition-colors"
            />
            <div className="absolute right-3 flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
              <Barcode className="h-4 w-4 text-[var(--color-text-faint)]" />
              <span>Scanner Ready</span>
            </div>
          </div>

          {/* Search Dropdown Results rendered in React Portal */}
          {searchResults.length > 0 && dropdownPosition && createPortal(
            <div
              ref={dropdownRef}
              style={{
                position: "fixed",
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
                width: `${dropdownPosition.width}px`,
                zIndex: 9999,
              }}
              className="max-h-72 overflow-y-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-dropdown divide-y divide-[var(--color-border-subtle)]"
            >
              {searchResults.map((prod, index) => {
                const isSelected = index === selectedSearchIndex;
                return (
                  <div
                    key={prod.id}
                    onMouseEnter={() => setSelectedSearchIndex(index)}
                    onClick={() => {
                      selectProductAndAddToCart(prod);
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    className={`flex cursor-pointer items-center justify-between px-4 py-2.5 text-xs transition-colors ${
                      isSelected
                        ? "bg-[var(--color-accent-soft)] text-[var(--color-text)] border-l-4 border-l-[var(--color-accent)] pl-3"
                        : "hover:bg-[var(--color-surface-hover)] text-[var(--color-text)]"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className={`font-semibold ${isSelected ? "text-[var(--color-accent)] font-bold" : "text-[var(--color-text)]"}`}>
                          {prod.name}
                        </p>
                        {prod.generic_name && (
                          <span className="rounded-[4px] bg-[var(--color-surface-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] font-normal border border-[var(--color-border)]">
                            {prod.generic_name}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 font-mono">
                        Barcode: <span>{prod.barcode}</span>{" "}
                        {prod.hsn_sac_code ? `| HSN: ${prod.hsn_sac_code}` : ""} | GST: {prod.gst_percent}%
                      </p>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="font-bold text-[var(--color-text)] text-sm font-mono tabular-nums">₹ {(prod.sel_rate || prod.mrp).toFixed(2)}</p>
                      <p
                        className={`text-[10px] font-mono font-medium ${
                          (prod.current_stock || 0) > 0 ? "text-[var(--color-success-text)]" : "text-[var(--color-danger-text)] font-bold"
                        }`}
                      >
                        Stock: {prod.current_stock || 0}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>,
            document.body
          )}
        </div>

        {/* Dynamic POS Grid Table */}
        {(() => {
          const visibleCols: ColumnSetting[] = (posColumns && posColumns.length > 0 ? posColumns : DEFAULT_COLUMNS)
            .filter((c: ColumnSetting) => c.visible !== false)
            .sort((a: ColumnSetting, b: ColumnSetting) => (a.order || 0) - (b.order || 0));

          return (
            <div className="flex-1 overflow-auto">
              <table role="grid" aria-label="POS Billing Items" className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[var(--color-surface-subtle)] border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                  <tr>
                    {visibleCols.map((col: ColumnSetting) => {
                      let alignClass = "text-left";
                      if (["idx", "qty", "gst", "discount", "hsn", "free_qty", "actions"].includes(col.id)) {
                        alignClass = "text-center";
                      } else if (["mrp", "rate", "current_stock", "total"].includes(col.id)) {
                        alignClass = "text-right";
                      }
                      return (
                        <th
                          key={col.id}
                          style={col.width ? { width: `${col.width}px` } : undefined}
                          className={`px-3 py-2.5 ${alignClass} text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]`}
                        >
                          {col.id === "gst" && (totals.igst_total > 0 || posCartService.getIsInterState())
                            ? "IGST %"
                            : col.label}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={visibleCols.length} className="py-16 text-center text-[var(--color-text-muted)]">
                        <Barcode className="mx-auto h-8 w-8 text-[var(--color-text-faint)] mb-2" />
                        <p className="font-semibold text-sm text-[var(--color-text)]">Billing cart is empty</p>
                        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">Scan a barcode or type a product name to begin billing</p>
                      </td>
                    </tr>
                  ) : (
                    lines.map((line, idx) => {
                      const isRowSelected = selectedRowIndex === idx;
                      const isWarningRow = (line.selectedBatch.stock_qty || 0) <= 0;
                      return (
                        <tr
                          key={line.id}
                          id={`cart-row-${line.id}`}
                          role="row"
                          aria-selected={isRowSelected}
                          onClick={() => handleSelectRow(idx)}
                          className={`transition-all cursor-pointer ${
                            isRowSelected
                              ? "bg-[var(--color-accent-soft)] ring-2 ring-inset ring-[var(--color-accent)] font-semibold shadow-2xs"
                              : isWarningRow
                              ? "bg-[var(--color-warning-bg)]/40 hover:bg-[var(--color-warning-bg)]/70 text-[var(--color-text)]"
                              : "hover:bg-[var(--color-surface-hover)] text-[var(--color-text)]"
                          }`}
                        >
                        {visibleCols.map((col: ColumnSetting) => {
                          switch (col.id) {
                            case "idx":
                              return (
                                <td key="idx" className="px-3 py-2 text-center text-text-muted font-mono text-[11px]">
                                  {idx + 1}
                                </td>
                              );

                            case "product_name":
                              return (
                                <td key="product_name" className="px-3 py-2 font-semibold text-text-main">
                                  <div className="flex flex-col">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-bold">{line.product.name}</span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedLineForConversion(line);
                                        }}
                                        className={`inline-flex items-center gap-1 rounded-[6px] border px-1.5 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${
                                          line.product.units_per_pack > 1
                                            ? "border-accent-soft bg-accent-soft text-accent hover:opacity-90"
                                            : "border-border-main bg-canvas text-text-muted hover:bg-surface"
                                        }`}
                                        title="Click or press Ctrl+E to adjust packaging & unit conversion"
                                      >
                                        <span>
                                          {line.product.units_per_pack > 1
                                            ? `1 ${line.product.unit_name || "pack"} = ${line.product.units_per_pack} ${line.product.sub_unit_name || "pcs"}`
                                            : (line.product.unit_name || "pc")}
                                        </span>
                                        <span className="text-[9px] text-text-muted">✏️</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedRowIndex(idx);
                                          setSelectedLineForProductBatchEdit(line);
                                        }}
                                        className="inline-flex items-center gap-1 rounded-[6px] border border-border-main bg-canvas hover:bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-muted hover:text-accent transition-colors cursor-pointer"
                                        title="Click or press F4 to edit product, batch, expiry & rate"
                                      >
                                        <span>Edit F4</span>
                                      </button>
                                      {line.isAdhocBatch && (
                                        <span className="rounded-btn bg-accent-soft text-accent border border-accent/20 px-1.5 py-0.2 text-[10px] font-bold">
                                          Ad-hoc
                                        </span>
                                      )}
                                      {(line.product.schedule_type === "H" || line.product.schedule_type === "H1" || line.product.schedule_type === "X") && (
                                        <span
                                          className={`rounded-btn px-1.5 py-0.2 text-[10px] font-black border ${
                                            doctorName.trim()
                                              ? "bg-accent-soft text-accent border-accent/30"
                                              : "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] border-[var(--color-danger-border)] animate-pulse"
                                          }`}
                                          title={
                                            doctorName.trim()
                                              ? `Prescription drug (Schedule ${line.product.schedule_type}) - Doctor recorded`
                                              : `Schedule ${line.product.schedule_type}: Doctor details required by law!`
                                          }
                                        >
                                          Rx Sch-{line.product.schedule_type} {!doctorName.trim() ? "⚠️" : ""}
                                        </span>
                                      )}
                                    </div>
                                    {(line.product.generic_name || line.product.strength) && (
                                      <div
                                        className="text-[11px] font-normal text-text-muted truncate max-w-[280px]"
                                        title={`${line.product.generic_name || ""} ${line.product.strength || ""}`.trim()}
                                      >
                                        {[line.product.generic_name, line.product.strength].filter(Boolean).join(" • ")}
                                      </div>
                                    )}
                                    {line.isNegativeStock && (
                                      <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-[var(--color-warning-text)]">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-warning-text)] animate-pulse" />
                                        {(line.availableStockSnapshot ?? 0) <= 0
                                          ? "Stock 0 (Selling beyond available)"
                                          : `Short by ${line.shortageQty || Math.max(1, line.qty - (line.availableStockSnapshot ?? 0))}`}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              );

                            case "batch_no":
                              return (
                                <td
                                  key="batch_no"
                                  className="px-3 py-2 font-mono text-[11px] text-text-muted"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedRowIndex(idx);
                                    setSelectedLineForProductBatchEdit(line);
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="hover:underline hover:text-accent font-semibold flex items-center gap-1 cursor-pointer"
                                    title="Click or press F4 to edit product & batch details"
                                  >
                                    <span>{line.selectedBatch.batch_no}</span>
                                    <span className="text-[9px] text-text-muted opacity-70">✏️</span>
                                  </button>
                                </td>
                              );

                            case "expiry_date":
                              return (
                                <td
                                  key="expiry_date"
                                  className="px-3 py-2 font-mono text-[11px] text-text-muted"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedRowIndex(idx);
                                    setSelectedLineForProductBatchEdit(line);
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="hover:underline hover:text-accent font-semibold flex items-center gap-1 cursor-pointer"
                                    title="Click or press F4 to edit product & batch details"
                                  >
                                    <span>{line.selectedBatch.expiry_date}</span>
                                    <span className="text-[9px] text-text-muted opacity-70">✏️</span>
                                  </button>
                                </td>
                              );

                            case "qty":
                              return (
                                <td key="qty" className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                  <SmartQtyInput
                                    inputId={`qty-input-${line.id}`}
                                    packs={line.qty}
                                    loose={line.loose_qty || 0}
                                    unitsPerPack={line.product.units_per_pack || 1}
                                    packName={line.product.unit_name || (line.product.units_per_pack > 1 ? "pack" : "pc")}
                                    looseName={line.product.sub_unit_name || (line.product.units_per_pack > 1 ? "pc" : "unit")}
                                    allowLoose={line.product.allow_loose_sale ?? ((line.product.units_per_pack || 1) > 1)}
                                    onFocusInput={() => {
                                      setSelectedRowIndex(idx);
                                      setFocusContext("cell_edit");
                                    }}
                                    onEnter={() => {
                                      handleQtyEnterAdvance(idx);
                                    }}
                                    onChange={(newPacks, newLoose) => {
                                      posCartService.updateLineQuantity(line.id, newPacks, newLoose);
                                      refreshCartState();
                                    }}
                                  />
                                </td>
                              );

                            case "mrp":
                              return (
                                <td key="mrp" className="px-3 py-2 text-right font-mono text-text-muted">
                                  ₹ {line.product.mrp.toFixed(2)}
                                </td>
                              );

                            case "rate":
                              return (
                                <td key="rate" className="px-3 py-2 text-right">
                                  <div className="flex flex-col items-end">
                                    <span className="font-mono font-medium text-text-main">
                                      ₹ {line.unit_price.toFixed(2)}
                                      <span className="text-[10px] text-text-muted ml-0.5 font-normal">
                                        /{line.rate_basis === "loose_rate"
                                          ? (line.product.sub_unit_name || "pc")
                                          : (line.product.unit_name || (line.product.units_per_pack > 1 ? "pack" : "pc"))}
                                      </span>
                                    </span>
                                    {line.product.units_per_pack > 1 && (
                                      <button
                                        type="button"
                                        tabIndex={-1}
                                        onClick={() => {
                                          const nextBasis = line.rate_basis === "loose_rate" ? "sel_rate" : "loose_rate";
                                          const newPrice = nextBasis === "loose_rate"
                                            ? calculateDerivedLooseRate(line.product.sel_rate, line.product.units_per_pack, line.product.loose_selling_rate)
                                            : (line.selectedBatch.selling_rate || line.product.sel_rate);
                                          posCartService.updateLinePrice(line.id, newPrice, nextBasis);
                                          refreshCartState();
                                        }}
                                        className="text-[9px] text-accent hover:underline mt-0.5 cursor-pointer font-medium"
                                      >
                                        {line.rate_basis === "loose_rate" ? "switch to pack rate" : "switch to unit rate"}
                                      </button>
                                    )}
                                  </div>
                                </td>
                              );

                            case "discount":
                              return (
                                <td
                                  key="discount"
                                  className="px-3 py-2 text-center"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedRowIndex(idx);
                                    handleQuickDiscount(line);
                                  }}
                                >
                                  <button
                                    type="button"
                                    tabIndex={-1}
                                    className={`group inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-xs font-mono font-semibold cursor-pointer transition-colors ${
                                      line.discount_percent > 0 || line.discount_amount > 0
                                        ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] hover:opacity-90 border border-[var(--color-warning-border)]"
                                        : "text-text-muted hover:bg-canvas hover:text-text-main"
                                    }`}
                                    title="Click or press F2 to edit item discount"
                                  >
                                    <span>
                                      {line.discount_percent > 0
                                        ? `${line.discount_percent}%`
                                        : line.discount_amount > 0
                                        ? `₹${line.discount_amount.toFixed(2)}`
                                        : "-"}
                                    </span>
                                  </button>
                                </td>
                              );

                            case "gst":
                              return (
                                <td key="gst" className="px-3 py-2 text-center font-mono text-text-muted">
                                  {line.product.gst_percent}%
                                </td>
                              );

                            case "hsn":
                              return (
                                <td key="hsn" className="px-3 py-2 text-center font-mono text-[11px] text-text-muted">
                                  {line.product.hsn_sac_code || "-"}
                                </td>
                              );

                            case "free_qty":
                              return (
                                <td key="free_qty" className="px-3 py-2 text-center font-mono text-text-muted">
                                  -
                                </td>
                              );

                            case "rack_shelf":
                              return (
                                <td key="rack_shelf" className="px-3 py-2 text-center text-text-muted">
                                  {line.selectedBatch.rack_location || line.product.rack_location || "-"}
                                </td>
                              );

                            case "current_stock":
                              return (
                                <td key="current_stock" className="px-3 py-2 text-right font-mono font-semibold text-text-main">
                                  {line.selectedBatch.stock_qty ?? line.product.current_stock ?? 0}
                                </td>
                              );

                            case "total":
                              return (
                                <td key="total" className="px-3 py-2 text-right font-bold font-mono text-text-main">
                                  ₹ {line.calculated.total_amount.toFixed(2)}
                                </td>
                              );

                            case "actions":
                              return (
                                <td key="actions" className="px-3 py-2 text-center">
                                  <button
                                    onClick={() => removeLine(line.id)}
                                    className="rounded-[6px] p-1 text-text-muted hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-danger-text)] cursor-pointer transition-colors"
                                    title="Delete line"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              );

                            default:
                              return null;
                          }
                        })}
                      </tr>
                    );
                  })
                )}
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* Bottom Totals & Settlement Bar */}
        <div className="flex flex-wrap items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 gap-3">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-xs text-[var(--color-text-muted)]">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Items: </span>
              <span className="font-bold font-mono text-[var(--color-text)]">{lines.length}</span>
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Subtotal: </span>
              <span className="font-bold font-mono text-[var(--color-text)]">₹ {totals.taxable_subtotal.toFixed(2)}</span>
            </div>
            {totals.line_discount_total > 0 && (
              <div className="text-[var(--color-warning-text)]">
                <span className="text-[11px] font-bold uppercase tracking-wider">Line Disc: </span>
                <span className="font-bold font-mono">-₹ {totals.line_discount_total.toFixed(2)}</span>
              </div>
            )}
            <div>
              {totals.bill_discount_amount > 0 ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setIsBillDiscountModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-[var(--color-warning-bg)] hover:opacity-90 text-[var(--color-warning-text)] font-bold border border-[var(--color-warning-border)] shadow-2xs transition-colors cursor-pointer"
                  title="Edit Overall Bill Discount (Ctrl+F2)"
                >
                  <span className="font-mono">Bill Disc: -₹{totals.bill_discount_amount.toFixed(2)}</span>
                  <span className="text-[10px] text-[var(--color-warning-text)] font-mono opacity-80">Ctrl+F2</span>
                </button>
              ) : (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setIsBillDiscountModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] font-semibold text-[11px] border border-[var(--color-border)] transition-colors cursor-pointer"
                  title="Add Overall Bill Discount (Ctrl+F2)"
                >
                  <span>+ Bill Disc</span>
                  <span className="text-[10px] font-mono text-[var(--color-text-muted)]">Ctrl+F2</span>
                </button>
              )}
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                {totals.igst_total > 0 || posCartService.getIsInterState() ? "IGST Tax: " : "GST Tax: "}
              </span>
              <span className="font-bold font-mono text-[var(--color-text)]">₹ {totals.total_tax.toFixed(2)}</span>
            </div>
            <div>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setIsRoundOffModalOpen(true)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] font-semibold text-[11px] border transition-colors cursor-pointer ${
                  posCartService.getManualRoundOff() !== null
                    ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent-soft)] font-bold shadow-2xs"
                    : "bg-[var(--color-surface-subtle)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
                }`}
                title="Adjust Round-Off / Net Payable (Alt+R)"
              >
                <span className="font-mono">
                  Round-off: {totals.round_off >= 0 ? `+₹${totals.round_off.toFixed(2)}` : `-₹${Math.abs(totals.round_off).toFixed(2)}`}
                </span>
                <span className="text-[10px] font-mono text-[var(--color-text-muted)]">Alt+R</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div
              className="text-right cursor-pointer group"
              onClick={() => setIsRoundOffModalOpen(true)}
              title="Click to adjust round-off / net payable (Alt+R)"
            >
              <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider group-hover:text-[var(--color-accent)] transition-colors">
                Net Payable
              </span>
              <p className="text-[38px] lg:text-[44px] font-bold font-mono leading-none tracking-tight text-[var(--color-accent)] tabular-nums">
                ₹ {totals.grand_total.toFixed(2)}
              </p>
            </div>

            <button
              onClick={openTenderModal}
              disabled={lines.length === 0}
              className="flex items-center gap-2 rounded-[10px] bg-[var(--color-accent)] px-6 py-3 text-sm font-bold text-white shadow-xs hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-all cursor-pointer h-[48px]"
            >
              <CreditCard className="h-4 w-4" />
              <span>Checkout & Pay (F12)</span>
            </button>
          </div>
        </div>

        {/* Contextual Keyboard Shortcut Hint Bar */}
        <PosShortcutHintBar
          context={activeHintContext}
          onOpenShortcutsModal={() => setIsShortcutsModalOpen(true)}
          onFocusSearch={handleFocusSearch}
          onCheckout={openTenderModal}
          onHold={handleHoldBill}
          onRecall={() => setIsRecallModalOpen(true)}
          onNewBill={cancelEditingMode}
          onColumnsConfig={() => setIsColumnsModalOpen(true)}
        />
      </div>

      {/* Batch Selection Modal (FEFO Order with keyboard navigation & ARIA listbox) */}
      {selectedProductForBatch && (() => {
        const appSettings = companySettingsService.getSettings();
        const allowSellingOutOfStock = appSettings.inventory?.allowSellingOutOfStock || "always";
        const allowExpiredBatchSale = appSettings.inventory?.allowExpiredBatchSale || "warn_confirm";

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-modal-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 select-none font-sans animate-in fade-in duration-100"
          >
            <div className="w-full max-w-lg rounded-card bg-surface shadow-modal overflow-hidden border border-border-main">
              <div className="flex items-center justify-between border-b border-border-main px-4 py-3 bg-canvas">
                <div>
                  <h3 id="batch-modal-title" className="text-xs font-bold text-text-main">
                    Select Batch (FEFO Order): {selectedProductForBatch.name}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Use ↑/↓ arrows to navigate, Enter to select, Esc to cancel
                  </p>
                </div>
                <button
                  onClick={closeBatchModal}
                  className="text-slate-400 hover:text-slate-600 rounded p-1 transition-colors"
                  aria-label="Close batch selection"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div
                ref={batchListRef}
                role="listbox"
                id="batch-listbox"
                tabIndex={0}
                aria-label="Select Batch (FEFO Order)"
                aria-activedescendant={
                  productBatches.length > 0 ? `batch-option-${selectedBatchIndex}` : undefined
                }
                className="max-h-64 overflow-y-auto divide-y divide-slate-100 outline-none focus:ring-1 focus:ring-blue-500/20"
              >
                {productBatches.map((b, idx) => {
                  const isSelected = idx === selectedBatchIndex;
                  const selectable = isBatchSelectable(
                    b,
                    undefined,
                    allowSellingOutOfStock !== "never",
                    allowExpiredBatchSale !== "block"
                  );
                  const isExpired = isBatchExpired(b.expiry_date);
                  const isOutOfStock = (b.stock_qty || 0) <= 0;

                  return (
                    <div
                      key={b.id}
                      id={`batch-option-${idx}`}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={!selectable}
                      onMouseEnter={() => setSelectedBatchIndex(idx)}
                      onClick={() => {
                        if (selectable) {
                          addBatchToCart(b);
                        } else {
                          showNotification(
                            isExpired
                              ? "This batch has expired and cannot be billed"
                              : "This batch is out of stock",
                            "error"
                          );
                        }
                      }}
                      className={`flex items-center justify-between px-4 py-2.5 text-xs transition-colors ${
                        !selectable
                          ? isSelected
                            ? "bg-slate-100/90 text-slate-500 border-l-4 border-l-slate-400 pl-3 cursor-not-allowed"
                            : "bg-slate-50/50 text-slate-400 cursor-not-allowed opacity-60"
                          : isSelected
                          ? "bg-blue-50/90 text-blue-950 border-l-4 border-l-blue-600 pl-3 ring-1 ring-blue-500/20 font-medium cursor-pointer"
                          : "hover:bg-slate-50 text-slate-800 cursor-pointer"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-800">{b.batch_no}</span>
                          {idx === 0 && selectable && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.2 text-[10px] font-semibold text-blue-800">
                              FEFO Recommendation
                            </span>
                          )}
                          {isExpired && (
                            <span className="rounded bg-rose-100 px-1.5 py-0.2 text-[10px] font-bold text-rose-700">
                              Expired
                            </span>
                          )}
                          {isOutOfStock && !isExpired && (
                            <span className="rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold px-1.5 py-0.2 text-[10px]">
                              Out of Stock
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] mt-0.5">
                          <span className={isExpired ? "text-rose-600 font-semibold" : "text-slate-500"}>
                            Exp: {b.expiry_date}
                          </span>
                          {b.rack_location && (
                            <span className="text-slate-400">Rack: {b.rack_location}</span>
                          )}
                          {b.shelf_location && (
                            <span className="text-slate-400">Shelf: {b.shelf_location}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <p className="font-bold text-slate-900">
                          ₹ {(b.selling_rate || b.mrp || selectedProductForBatch.sel_rate).toFixed(2)}
                        </p>
                        <span
                          className={`inline-block mt-0.5 rounded px-2 py-0.5 text-[10px] font-semibold ${
                            isExpired
                              ? "bg-rose-50 text-rose-600"
                              : isOutOfStock
                              ? "bg-amber-50 text-amber-700 font-bold border border-amber-200"
                              : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {b.stock_qty} in stock
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-slate-200 px-4 py-2.5 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  Navigate with <kbd className="font-mono bg-white px-1 py-0.5 rounded border border-slate-300 text-slate-700">↑</kbd> <kbd className="font-mono bg-white px-1 py-0.5 rounded border border-slate-300 text-slate-700">↓</kbd>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedProductForBatch) return;
                      const adhocBatch: ProductBatch = {
                        id: `batch_adhoc_${selectedProductForBatch.id}_${Date.now()}`,
                        product_id: selectedProductForBatch.id,
                        batch_no: "NO_BATCH",
                        expiry_date: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
                        stock_qty: 0,
                        mrp: selectedProductForBatch.mrp,
                        selling_rate: selectedProductForBatch.sel_rate,
                        purchase_rate: selectedProductForBatch.sel_rate * 0.7,
                      };
                      posCartService.addProductToCart(selectedProductForBatch, adhocBatch, 1, 0, { isAdhocBatch: true });
                      refreshCartState();
                      closeBatchModal();
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    className="rounded border border-purple-300 bg-purple-50 px-2.5 py-1 text-purple-700 hover:bg-purple-100 text-xs font-semibold"
                  >
                    + Ad-hoc Batch
                  </button>
                  <button
                    type="button"
                    onClick={closeBatchModal}
                    className="rounded px-2.5 py-1 text-slate-600 hover:bg-slate-200 text-xs"
                  >
                    Cancel (Esc)
                  </button>
                  <button
                    type="button"
                    disabled={
                      productBatches.length === 0 ||
                      !isBatchSelectable(
                        productBatches[selectedBatchIndex],
                        undefined,
                        allowSellingOutOfStock !== "never",
                        allowExpiredBatchSale !== "block"
                      )
                    }
                    onClick={() => {
                      const b = productBatches[selectedBatchIndex];
                      if (
                        b &&
                        isBatchSelectable(
                          b,
                          undefined,
                          allowSellingOutOfStock !== "never",
                          allowExpiredBatchSale !== "block"
                        )
                      ) {
                        addBatchToCart(b);
                      }
                    }}
                    className="rounded bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs transition-colors shadow-xs"
                  >
                    Select Batch (Enter)
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tender / Settlement Modal (F12) */}
      {isTenderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 select-none font-sans animate-in fade-in duration-100">
          <div className="w-full max-w-md rounded-card bg-surface shadow-modal overflow-hidden border border-border-main">
            <div className="flex items-center justify-between border-b border-border-main px-5 py-3.5 bg-canvas">
              <div>
                <h3 className="text-sm font-bold text-text-main">Bill Settlement</h3>
                <p className="text-[11px] text-text-muted font-mono">Invoice: {invoiceNumber}</p>
              </div>
              <button
                onClick={() => setIsTenderModalOpen(false)}
                className="text-text-muted hover:text-text-main p-1 rounded-btn hover:bg-surface transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-lg bg-blue-50 p-3 text-center">
                <span className="text-xs font-semibold text-blue-600">Total Amount Due</span>
                <p className="text-2xl font-black text-blue-800">₹ {totals.grand_total.toFixed(2)}</p>
              </div>

              {/* Payment Mode Selector */}
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1.5">Payment Tender Mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["Cash", "UPI", "Card", "Credit"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      disabled={isFinalizing}
                      onClick={() => setTenders([{ mode, amount: totals.grand_total }])}
                      className={`rounded-lg py-2 text-xs font-semibold border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                        tenders[0]?.mode === mode
                          ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cash Received & Change Return Calculation */}
              {tenders[0]?.mode === "Cash" && (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">Cash Received from Customer</label>
                    <input
                      ref={tenderCashInputRef}
                      type="number"
                      disabled={isFinalizing}
                      value={receivedCash}
                      onChange={(e) => setReceivedCash(parseFloat(e.target.value) || 0)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleFinalizeAndPrint();
                        }
                      }}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-800 focus:border-blue-600 focus:outline-none disabled:bg-slate-100 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-slate-500">Change Due to Customer:</span>
                    <span className="text-sm font-bold text-emerald-700">₹ {calculatedBalanceChange.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Print Output Format Selector */}
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1.5">Print Output Format</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={isFinalizing}
                    onClick={() => setPrintFormat("thermal")}
                    className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium border disabled:opacity-50 disabled:cursor-not-allowed ${
                      printFormat === "thermal"
                        ? "border-blue-600 bg-blue-50 text-blue-700 font-bold"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>Thermal 80mm</span>
                  </button>
                  <button
                    type="button"
                    disabled={isFinalizing}
                    onClick={() => setPrintFormat("a4")}
                    className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium border disabled:opacity-50 disabled:cursor-not-allowed ${
                      printFormat === "a4"
                        ? "border-blue-600 bg-blue-50 text-blue-700 font-bold"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>A4 Tax Invoice</span>
                  </button>
                  <button
                    type="button"
                    disabled={isFinalizing}
                    onClick={() => setPrintFormat("pdf")}
                    className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium border disabled:opacity-50 disabled:cursor-not-allowed ${
                      printFormat === "pdf"
                        ? "border-blue-600 bg-blue-50 text-blue-700 font-bold"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Save PDF</span>
                  </button>
                </div>
              </div>

              {/* Electronic Dispatch Actions */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={isFinalizing}
                  onClick={handleShareWhatsApp}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <MessageCircle className="h-3.5 w-3.5 text-emerald-600" />
                  <span>WhatsApp Bill</span>
                </button>
                <button
                  type="button"
                  disabled={isFinalizing}
                  onClick={handleShareEmail}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Mail className="h-3.5 w-3.5 text-slate-500" />
                  <span>Email Invoice</span>
                </button>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3.5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isFinalizing}
                onClick={() => setIsTenderModalOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel (Esc)
              </button>
              <button
                type="button"
                disabled={isFinalizing}
                onClick={handleFinalizeAndPrint}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-md hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <Printer className="h-4 w-4" />
                <span>{isFinalizing ? "Saving & Printing..." : `Save & Print (${printFormat.toUpperCase()})`}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recall Held Bills Modal (F9) */}
      {isRecallModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 select-none font-sans animate-in fade-in duration-100">
          <div className="w-full max-w-md rounded-card bg-surface shadow-modal overflow-hidden border border-border-main">
            <div className="flex items-center justify-between border-b border-border-main px-4 py-3 bg-canvas">
              <h3 className="text-xs font-bold text-text-main">Recall Held Bills</h3>
              <button
                onClick={() => setIsRecallModalOpen(false)}
                className="text-text-muted hover:text-text-main p-1 rounded-btn hover:bg-surface transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-border-main">
              {billingTenderService.listHeldBills().length === 0 ? (
                <div className="py-8 text-center text-text-muted text-xs">No bills are currently on hold.</div>
              ) : (
                billingTenderService.listHeldBills().map((b) => (
                  <div
                    key={b.id}
                    onClick={() => handleRecallBill(b.id)}
                    className="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-surface-hover text-xs transition-colors"
                  >
                    <div>
                      <p className="font-semibold text-text-main">{b.customer_name}</p>
                      <p className="text-[11px] text-text-muted">
                        {b.items_count} items | Held: {new Date(b.held_at).toLocaleTimeString()}
                      </p>
                    </div>
                    <span className="rounded-btn bg-accent-soft px-2.5 py-1 text-[11px] font-bold text-accent">
                      Recall →
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Invoice Revision Diff Confirmation Modal */}
      {isDiffModalOpen && editingInvoice && editDiff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 select-none font-sans animate-in fade-in duration-100">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-card border border-border-main bg-surface shadow-modal overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-main bg-canvas px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <History className="h-5 w-5 text-accent" />
                <div>
                  <h3 className="text-sm font-bold text-text-main">
                    Confirm Revision: {editingInvoice.invoice_number}
                  </h3>
                  <p className="text-[11px] text-text-muted">
                    Review item differences before reversing stock and saving changes.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsDiffModalOpen(false)}
                className="rounded-btn p-1.5 text-text-muted hover:bg-surface hover:text-text-main transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {/* Diff Summary Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">Original Total</span>
                  <p className="font-mono text-sm font-bold text-slate-700">₹ {editDiff.oldTotal.toFixed(2)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">Revised Total</span>
                  <p className="font-mono text-sm font-bold text-blue-700">₹ {editDiff.newTotal.toFixed(2)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">Net Difference</span>
                  <p
                    className={`font-mono text-sm font-bold ${
                      editDiff.totalDiff > 0
                        ? "text-emerald-600"
                        : editDiff.totalDiff < 0
                        ? "text-red-600"
                        : "text-slate-600"
                    }`}
                  >
                    {editDiff.totalDiff >= 0 ? "+" : ""}₹ {editDiff.totalDiff.toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Items Changed Table */}
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 border-b border-slate-200">
                  Item Modifications ({editDiff.changes.length})
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                  {editDiff.changes.length === 0 ? (
                    <div className="p-4 text-center text-slate-400">No line item modifications detected.</div>
                  ) : (
                    editDiff.changes.map((chg, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 text-xs">
                        <div className="flex items-center gap-2">
                          {chg.type === "ADDED" && (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                              + Added
                            </span>
                          )}
                          {chg.type === "REMOVED" && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                              - Removed
                            </span>
                          )}
                          {chg.type === "MODIFIED" && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                              • Changed
                            </span>
                          )}
                          <div>
                            <p className="font-bold text-slate-800">{chg.productName}</p>
                            <p className="font-mono text-[10px] text-slate-400">Batch: {chg.batchNo}</p>
                          </div>
                        </div>

                        <div className="text-right font-mono">
                          {chg.type === "MODIFIED" && (
                            <p className="text-slate-600">
                              Qty: {chg.oldQty} → <strong>{chg.newQty}</strong> (₹{chg.oldAmount?.toFixed(2)} → ₹{chg.newAmount?.toFixed(2)})
                            </p>
                          )}
                          {chg.type === "ADDED" && (
                            <p className="text-emerald-700 font-bold">
                              Qty: {chg.newQty} (₹{chg.newAmount?.toFixed(2)})
                            </p>
                          )}
                          {chg.type === "REMOVED" && (
                            <p className="text-red-700 line-through">
                              Qty: {chg.oldQty} (₹{chg.oldAmount?.toFixed(2)})
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Revision Reason */}
              <div>
                <label className="text-xs font-bold text-slate-700">Reason for Revision (Audit Trail):</label>
                <input
                  type="text"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="e.g., Customer altered quantity, corrected item..."
                  className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none mt-1"
                  autoFocus
                />
              </div>

              {/* Format selection */}
              <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="text-xs font-semibold text-slate-600">Reprint Format:</span>
                <div className="flex gap-2">
                  {(["thermal", "a4", "pdf"] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setPrintFormat(fmt)}
                      className={`rounded px-3 py-1 text-xs font-bold uppercase transition-all ${
                        printFormat === fmt
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsDiffModalOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Back to Editing (Esc)
              </button>
              <button
                type="button"
                disabled={isFinalizing}
                onClick={handleSaveEditedInvoice}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50 transition-all"
              >
                <Check className="h-4 w-4" />
                <span>{isFinalizing ? "Saving & Printing..." : "Confirm & Save Revision (Enter)"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Print Preview Modal */}
      {previewModalState.isOpen && previewModalState.data && (
        <PrintPreviewModal
          isOpen={previewModalState.isOpen}
          onClose={() => {
            setPreviewModalState({ isOpen: false, data: null });
            setTimeout(() => {
              searchInputRef.current?.focus();
            }, 50);
          }}
          docType="tax_invoice"
          title={previewModalState.title || "Print Preview - Tax Invoice"}
          data={previewModalState.data}
          initialFormat={previewModalState.initialFormat}
          customerPhone={customerPhone}
        />
      )}

      {/* Dynamic Columns & Billing Layout Configuration Modal */}
      <BillingColumnsModal
        isOpen={isColumnsModalOpen}
        onClose={() => setIsColumnsModalOpen(false)}
        onLayoutChange={(cols, hdrs) => {
          setPosColumns([...cols]);
          setPosHeaders([...hdrs]);
        }}
      />

      {/* Manual Unit Conversion Editor Modal */}
      <ConversionModal
        isOpen={Boolean(selectedLineForConversion)}
        line={selectedLineForConversion}
        onClose={() => setSelectedLineForConversion(null)}
        onSave={handleSaveLineConversion}
      />

      {/* Quick Product & Batch Editor (F4) Modal */}
      <QuickProductBatchEditModal
        isOpen={Boolean(selectedLineForProductBatchEdit)}
        line={selectedLineForProductBatchEdit}
        onClose={() => setSelectedLineForProductBatchEdit(null)}
        onSave={handleSaveProductBatchEdit}
      />

      {/* Quick Line Edit (F2 / F3) Modal */}
      <QuickLineEditModal
        isOpen={quickEditModal.isOpen}
        type={quickEditModal.type}
        line={quickEditModal.line}
        onClose={() => setQuickEditModal({ isOpen: false, type: "discount", line: null })}
        onSaveDiscount={(lineId, percent, amount) => {
          posCartService.updateLineDiscount(lineId, percent, amount);
          refreshCartState();
          showNotification("Item discount updated!", "success");
        }}
        onSaveRate={(lineId, unitPrice) => {
          const targetLine = lines.find((l) => l.id === lineId);
          if (targetLine) {
            posCartService.updateLinePrice(lineId, unitPrice, targetLine.rate_basis);
            refreshCartState();
            showNotification("Rate updated!", "success");
          }
        }}
      />

      {/* Overall Bill Discount (Ctrl+F2) Modal */}
      <BillDiscountModal
        isOpen={isBillDiscountModalOpen}
        currentDiscount={posCartService.getBillDiscount()}
        taxableSubtotal={totals.taxable_subtotal}
        totalTax={totals.total_tax}
        onClose={() => setIsBillDiscountModalOpen(false)}
        onApplyDiscount={handleApplyBillDiscount}
      />

      {/* Editable Round-Off / Net Payable (Alt+R) Modal */}
      <RoundOffModal
        isOpen={isRoundOffModalOpen}
        netBeforeRound={totals.net_before_round}
        currentRoundOff={totals.round_off}
        isManual={posCartService.getManualRoundOff() !== null}
        onClose={() => setIsRoundOffModalOpen(false)}
        onApplyRoundOff={handleApplyManualRoundOff}
      />

      {/* Keyboard Shortcuts Cheatsheet Modal (?) */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      {/* ARIA Live Region for Screen Readers */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {ariaAnnouncement}
      </div>
    </div>
  );
};

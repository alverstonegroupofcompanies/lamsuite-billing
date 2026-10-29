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
  AlertTriangle,
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
  Save,
  ChevronDown,
  ChevronUp,
  QrCode,
  RefreshCw,
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
  generateQrCodeSvg,
  type InvoicePrintData,
} from "../lib/printing/printingEngine";
import { isTauri } from "../lib/ipc/ipcBridge";
import { companySettingsService, DEFAULT_COLUMNS, DEFAULT_PAYMENT_MODES, type ColumnSetting, type HeaderFieldSetting, type PaymentModeConfig } from "../lib/settings/companySettingsService";
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
import { PosGridRow, type PosRateBasis } from "../components/PosGridRow";
import { BillingColumnsModal } from "../components/BillingColumnsModal";
import { ConversionModal } from "../components/ConversionModal";
import { PosShortcutHintBar, type PosFocusContext } from "../components/PosShortcutHintBar";
import { QuickLineEditModal } from "../components/QuickLineEditModal";
import { QuickProductBatchEditModal } from "../components/QuickProductBatchEditModal";
import { KeyboardShortcutsModal } from "../components/KeyboardShortcutsModal";
import { storeRegistryService } from "../lib/auth/storeRegistryService";
import { BillDiscountModal } from "../components/BillDiscountModal";
import { RoundOffModal } from "../components/RoundOffModal";
import { calculateDerivedLooseRate, formatQuantityDisplay, formatExpiryDisplay } from "../lib/billing/unitConversion";
import { partiesStore, type Customer, normalizeIndianPhone } from "../lib/masters/partiesStore";
import { unitsStore } from "../lib/masters/unitsStore";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

/**
 * Parses prefix multiplier for quantity entry e.g. "3*890123" or "5*Augmentin"
 */
export function parseQuantityPrefix(input: string): { qty: number; query: string } {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*[*xX]\s*(.+)$/);
  if (match) {
    const qty = parseFloat(match[1]);
    const query = match[2].trim();
    if (!isNaN(qty) && qty > 0 && query.length > 0) {
      return { qty, query };
    }
  }
  return { qty: 1, query: trimmed };
}

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
  const [pendingPrefixQty, setPendingPrefixQty] = useState<number>(1);

  // Product Entry Style & Inline Entry Row State
  const [appSettingsState, setAppSettingsState] = useState(() => companySettingsService.getSettings());
  const productEntryStyle = appSettingsState.keyboard?.productEntryStyle || "inline_row";
  const entryRowPosition = appSettingsState.keyboard?.entryRowPosition || "bottom";
  const addLineMode = appSettingsState.keyboard?.addLineMode || "immediate";
  const [justAddedLineId, setJustAddedLineId] = useState<string | null>(null);

  const [entryDraftProduct, setEntryDraftProduct] = useState<ProductItem | null>(null);
  const [entryDraftBatch, setEntryDraftBatch] = useState<ProductBatch | null>(null);
  const [entryPacks, setEntryPacks] = useState<number | string>(1);
  const [entryLoose, setEntryLoose] = useState<number | string>(0);
  const [entryRate, setEntryRate] = useState<number | string>("");
  const [entryDiscount, setEntryDiscount] = useState<number | string>("");
  const [entryRateBasis, setEntryRateBasis] = useState<PosRateBasis>("sel_rate");

  const draftLine: PosCartLine | null = useMemo(() => {
    if (!entryDraftProduct || !entryDraftBatch) return null;
    const packs = Math.max(0, Number(entryPacks) || 0);
    const loose = Math.max(0, Number(entryLoose) || 0);
    const price = entryRate !== "" && !isNaN(Number(entryRate))
      ? Number(entryRate)
      : (entryDraftBatch.selling_rate || entryDraftProduct.sel_rate || entryDraftProduct.mrp);

    const discountVal = Number(entryDiscount) || 0;

    const baseLine = {
      id: "draft_preview",
      product: entryDraftProduct,
      selectedBatch: entryDraftBatch,
      qty: packs,
      loose_qty: loose,
      unit_price: price,
      rate_basis: entryRateBasis,
      discount_percent: discountVal,
      discount_amount: 0,
      discount_manual: discountVal > 0,
      isNegativeStock: (entryDraftBatch.stock_qty || 0) <= 0,
      availableStockSnapshot: entryDraftBatch.stock_qty,
    };

    const calculated = posCartService.calculateLine(baseLine);

    return {
      ...baseLine,
      calculated,
    };
  }, [entryDraftProduct, entryDraftBatch, entryPacks, entryLoose, entryRate, entryDiscount, entryRateBasis]);

  const displayTotals = useMemo(() => {
    if (addLineMode === "after_enter" && draftLine) {
      const pendingTaxable = totals.taxable_subtotal + draftLine.calculated.taxable_amount;
      const pendingTax = totals.total_tax + draftLine.calculated.total_tax;
      const netBeforeRound =
        (totals.net_before_round ||
          totals.taxable_subtotal + totals.total_tax - totals.bill_discount_amount) +
        draftLine.calculated.total_amount;
      const grandTotal = Math.round(netBeforeRound);
      const roundOff = Number((grandTotal - netBeforeRound).toFixed(2));
      return {
        ...totals,
        taxable_subtotal: pendingTaxable,
        total_tax: pendingTax,
        grand_total: grandTotal,
        round_off: roundOff,
        pendingLineCount: 1,
      };
    }
    return { ...totals, pendingLineCount: 0 };
  }, [totals, addLineMode, draftLine]);

  // Inline entry row refs
  const entryProductInputRef = useRef<HTMLInputElement>(null);
  const entryPackInputRef = useRef<HTMLInputElement>(null);
  const entryLooseInputRef = useRef<HTMLInputElement>(null);
  const entryRateInputRef = useRef<HTMLInputElement>(null);
  const entryDiscInputRef = useRef<HTMLInputElement>(null);
  const entryRowRef = useRef<HTMLTableRowElement>(null);

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
  type PosPrintFormat = "thermal" | "a4" | "pdf" | "none" | "ask";
  const [tenders, setTenders] = useState<PaymentTenderLine[]>([
    { id: "pay_1", mode: "Cash", amount: 0, status: "received" },
  ]);
  const [activeTenderIndex, setActiveTenderIndex] = useState<number>(0);
  const [expandedTenderExtras, setExpandedTenderExtras] = useState<Record<number, boolean>>({});
  const [printFormat, setPrintFormatState] = useState<PosPrintFormat>(() => {
    try {
      const activeStore = storeRegistryService.getActiveStore();
      const storeKey = activeStore?.id || "default";
      return (localStorage.getItem(`lamsuite_print_fmt_${storeKey}`) as PosPrintFormat) || "thermal";
    } catch {
      return "thermal";
    }
  });

  const setPrintFormat = (fmt: PosPrintFormat) => {
    setPrintFormatState(fmt);
    try {
      const activeStore = storeRegistryService.getActiveStore();
      const storeKey = activeStore?.id || "default";
      localStorage.setItem(`lamsuite_print_fmt_${storeKey}`, fmt);
    } catch {
      // ignore
    }
  };

  const tenderCalc = useMemo(() => {
    return billingTenderService.calculateTenderBalance(totals.grand_total, tenders);
  }, [totals.grand_total, tenders]);

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
  const tenderAmountInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleAddPaymentLine = (mode: string = "Cash") => {
    const currentRemaining = billingTenderService.calculateTenderBalance(totals.grand_total, tenders).balanceDue;
    const remaining = currentRemaining > 0 ? currentRemaining : 0;
    const newLine: PaymentTenderLine = {
      id: `pay_${Date.now()}_${tenders.length}`,
      mode,
      amount: remaining,
      status: mode === "Cheque" || mode === "Bank Transfer" ? "pending_clearance" : "received",
    };
    const nextTenders = [...tenders, newLine];
    setTenders(nextTenders);
    const newIdx = nextTenders.length - 1;
    setActiveTenderIndex(newIdx);
    setTimeout(() => {
      tenderAmountInputRefs.current[newIdx]?.focus();
      tenderAmountInputRefs.current[newIdx]?.select();
    }, 50);
  };

  const handleRemovePaymentLine = (index: number) => {
    if (tenders.length <= 1) return;
    setTenders((prev) => prev.filter((_, i) => i !== index));
    setActiveTenderIndex((prev) => Math.max(0, prev - 1));
  };

  const handleUpdatePaymentLine = (index: number, updates: Partial<PaymentTenderLine>) => {
    setTenders((prev) => {
      const next = [...prev];
      const current = next[index] || { mode: "Cash", amount: 0 };
      const updatedRef = updates.reference !== undefined ? updates.reference : updates.reference_no !== undefined ? updates.reference_no : current.reference_no;
      next[index] = {
        ...current,
        ...updates,
        reference_no: updatedRef,
        reference: updatedRef,
        extra_fields: {
          ...current.extra_fields,
          card_last_four: updates.card_last_four !== undefined ? updates.card_last_four : current.card_last_four,
          card_network: updates.card_network !== undefined ? updates.card_network : current.card_network,
          bank_name: updates.bank_name !== undefined ? updates.bank_name : current.bank_name,
          cheque_date: updates.cheque_date !== undefined ? updates.cheque_date : current.cheque_date,
          payer_vpa: updates.payer_vpa !== undefined ? updates.payer_vpa : current.payer_vpa,
          notes: updates.notes !== undefined ? updates.notes : current.notes,
          ...updates.extra_fields,
        },
      };
      return next;
    });
  };

  const handleFillRemainder = (index: number) => {
    const remainder = billingTenderService.calculateRemainderForLine(totals.grand_total, tenders, index);
    handleUpdatePaymentLine(index, { amount: remainder });
  };

  const handleSplitHalf = () => {
    const split = billingTenderService.splitEvenly(totals.grand_total, ["Cash", "UPI"]);
    setTenders(split);
    setActiveTenderIndex(0);
  };

  const handleAddDenomination = (denom: number, index: number) => {
    const current = tenders[index]?.amount || 0;
    handleUpdatePaymentLine(index, { amount: Math.round((current + denom) * 100) / 100 });
  };

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
    try {
      if (packName.trim()) await unitsStore.ensureUnitExists(packName.trim());
      if (looseName.trim()) await unitsStore.ensureUnitExists(looseName.trim());
    } catch (err) {
      console.warn("Could not ensure unit in master:", err);
    }

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
      if (productEntryStyle === "inline_row") {
        entryProductInputRef.current?.focus();
      } else {
        searchInputRef.current?.focus();
      }
    }, 50);
  };

  useModalEscape(Boolean(selectedProductForBatch), closeBatchModal);
  useModalEscape(isTenderModalOpen, () => setIsTenderModalOpen(false));
  useModalEscape(isRecallModalOpen, () => setIsRecallModalOpen(false));
  useModalEscape(isDiffModalOpen, () => setIsDiffModalOpen(false));

  const updateDropdownPosition = () => {
    const el = productEntryStyle === "inline_row" ? entryProductInputRef.current : searchInputRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const dropdownHeight = 280;
      // If opening downwards overflows the viewport, anchor upwards
      const shouldOpenUp = rect.bottom + dropdownHeight > window.innerHeight && rect.top > dropdownHeight;
      setDropdownPosition({
        top: shouldOpenUp ? Math.max(10, rect.top - dropdownHeight - 6) : rect.bottom + 4,
        left: Math.max(10, rect.left),
        width: Math.max(480, Math.min(rect.width, window.innerWidth - rect.left - 20)),
      });
    }
  };

  const handleFocusSearch = () => {
    setSelectedRowIndex(null);
    setFocusContext("search");
    if (productEntryStyle === "inline_row") {
      entryProductInputRef.current?.focus();
      entryProductInputRef.current?.select();
    } else {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  };

  const handleSelectRow = (idx: number) => {
    if (idx >= 0 && idx < lines.length) {
      setSelectedRowIndex(idx);
      setFocusContext("grid");
      if (productEntryStyle === "inline_row") {
        entryProductInputRef.current?.blur();
      } else {
        searchInputRef.current?.blur();
      }
      setTimeout(() => {
        const line = lines[idx];
        if (line) {
          const rowEl = document.getElementById(`cart-row-${line.id}`);
          rowEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }, 20);
    } else if (idx >= lines.length && productEntryStyle === "inline_row") {
      handleFocusSearch();
    }
  };

  const handleQtyEnterAdvance = (currentIdx: number) => {
    // If this line was freshly added, confirm it by clearing justAddedLineId
    const currentLine = lines[currentIdx];
    if (currentLine && justAddedLineId === currentLine.id) {
      setJustAddedLineId(null);
    }

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
        const { qty, query } = parseQuantityPrefix(scanned);
        productsStore.findProductByBarcode(query).then(async (matched) => {
          if (matched) {
            await quickScanAddToCart(matched, qty);
          } else {
            setSearchQuery(query);
            if (productEntryStyle === "inline_row") {
              entryProductInputRef.current?.focus();
            } else {
              searchInputRef.current?.focus();
            }
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

      // If tender modal is open, handle settlement mode keys (1-8, C, U, D, B, Q, W, V, R, F, H, +, Alt+A, T, F12, Enter, Escape)
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
          handleFinalizeAndPrint(true);
          return;
        }
        if (isCmdOrCtrl && (keyLower === "s" || code === "KeyS")) {
          e.preventDefault();
          handleFinalizeAndPrint(false);
          return;
        }

        const activeTag = (document.activeElement?.tagName || "").toLowerCase();
        const isTypingField = activeTag === "input" || activeTag === "textarea";

        const modeMap: Record<string, string> = {
          "1": "Cash", c: "Cash",
          "2": "UPI", u: "UPI",
          "3": "Card", d: "Card",
          "4": "Bank Transfer", b: "Bank Transfer",
          "5": "Cheque", q: "Cheque",
          "6": "Wallet", w: "Wallet",
          "7": "Gift Voucher", v: "Gift Voucher",
          "8": "Credit", r: "Credit",
        };

        if (e.altKey) {
          if (keyLower === "a") {
            e.preventDefault();
            handleAddPaymentLine();
            return;
          }
          if (keyLower === "f") {
            e.preventDefault();
            handleFillRemainder(activeTenderIndex);
            return;
          }
          if (keyLower === "h") {
            e.preventDefault();
            handleSplitHalf();
            return;
          }
          if (modeMap[keyLower] || modeMap[e.key]) {
            e.preventDefault();
            const targetMode = modeMap[keyLower] || modeMap[e.key];
            if (tenders.length === 1 && tenders[0].amount >= totals.grand_total) {
              handleUpdatePaymentLine(0, { mode: targetMode });
            } else if (tenderCalc.balanceRemaining > 0) {
              handleAddPaymentLine(targetMode);
            } else {
              handleUpdatePaymentLine(activeTenderIndex, { mode: targetMode });
            }
            return;
          }
        }

        if (!isTypingField) {
          if (modeMap[keyLower] || modeMap[e.key]) {
            e.preventDefault();
            const targetMode = modeMap[keyLower] || modeMap[e.key];
            if (tenders.length === 1 && tenders[0].amount >= totals.grand_total) {
              handleUpdatePaymentLine(0, { mode: targetMode });
            } else if (tenderCalc.balanceRemaining > 0) {
              handleAddPaymentLine(targetMode);
            } else {
              handleUpdatePaymentLine(activeTenderIndex, { mode: targetMode });
            }
            return;
          }
          if (keyLower === "f") {
            e.preventDefault();
            handleFillRemainder(activeTenderIndex);
            return;
          }
          if (keyLower === "h" || keyLower === "s") {
            e.preventDefault();
            handleSplitHalf();
            return;
          }
          if (e.key === "+" || keyLower === "a") {
            e.preventDefault();
            handleAddPaymentLine();
            return;
          }
          if (keyLower === "t" || code === "KeyT") {
            e.preventDefault();
            const sequence: PosPrintFormat[] = ["thermal", "a4", "pdf", "none", "ask"];
            const currentIdx = sequence.indexOf(printFormat);
            const nextFmt = sequence[(currentIdx + 1) % sequence.length];
            setPrintFormat(nextFmt);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            handleFinalizeAndPrint(true);
            return;
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
        if (addLineMode === "after_enter" && draftLine) {
          const ok = window.confirm(`Add "${entryDraftProduct?.name || "product"}" to the bill before starting a new bill?`);
          if (ok) {
            commitEntryRow();
          } else {
            setEntryDraftProduct(null);
            setEntryDraftBatch(null);
          }
        }
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
            if (selectedRowIndex === lines.length - 1 && productEntryStyle === "inline_row") {
              handleFocusSearch();
            } else {
              handleSelectRow(Math.min(lines.length - 1, selectedRowIndex + 1));
            }
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
        if (justAddedLineId) {
          e.preventDefault();
          removeLine(justAddedLineId);
          setJustAddedLineId(null);
          handleFocusSearch();
          return;
        }
        if (entryDraftProduct) {
          e.preventDefault();
          setEntryDraftProduct(null);
          setEntryDraftBatch(null);
          handleFocusSearch();
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
      } else if (lines.length > 0 && productEntryStyle === "search_bar") {
        handleSelectRow(0);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (searchResults.length > 0) {
        setSelectedSearchIndex((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (productEntryStyle === "inline_row" && lines.length > 0) {
        handleSelectRow(lines.length - 1);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (searchResults.length > 0) {
        setSearchResults([]);
        return;
      }
      if (entryDraftProduct) {
        setEntryDraftProduct(null);
        setEntryDraftBatch(null);
        setEntryPacks(1);
        setEntryLoose(0);
        setEntryRate("");
        setEntryDiscount("");
        return;
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const raw = searchQuery.trim();
      if (!raw) return;

      const { qty, query } = parseQuantityPrefix(raw);

      // 1. First check if input matches exact barcode
      const productByBarcode = await productsStore.findProductByBarcode(query);
      if (productByBarcode) {
        await selectProductAndAddToCart(productByBarcode, qty);
        setSearchQuery("");
        setSearchResults([]);
        return;
      }

      // 2. Otherwise pick selected or first matching search result if available
      if (searchResults.length > 0) {
        const itemToSelect = searchResults[selectedSearchIndex] || searchResults[0];
        await selectProductAndAddToCart(itemToSelect, qty);
        setSearchQuery("");
        setSearchResults([]);
      } else if (query.length > 0) {
        const found = await productsStore.searchProducts(query);
        if (found.length > 0) {
          await selectProductAndAddToCart(found[0], qty);
          setSearchQuery("");
          setSearchResults([]);
        }
      }
    }
  };

  const quickScanAddToCart = async (product: ProductItem, qty = 1) => {
    const batches = await productsStore.getBatchesForProduct(product.id, false);
    const unexpired = batches.filter((b) => !isBatchExpired(b.expiry_date));
    const targetBatch = unexpired[0] || batches[0];
    if (targetBatch) {
      posCartService.addProductToCart(product, targetBatch, qty, 0);
    } else {
      const adhoc: ProductBatch = {
        id: `batch_adhoc_${product.id}_${Date.now()}`,
        product_id: product.id,
        batch_no: "NO_BATCH",
        expiry_date: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        stock_qty: 0,
        mrp: product.mrp,
        selling_rate: product.sel_rate,
        purchase_rate: product.sel_rate * 0.7,
      };
      posCartService.addProductToCart(product, adhoc, qty, 0, { isAdhocBatch: true });
    }
    refreshCartState();
    setAriaAnnouncement(`Scanned & added ${product.name}, Quantity ${qty}. Total: ₹${posCartService.getTotals().grand_total.toFixed(2)}`);
    setSearchQuery("");
    setSearchResults([]);
    setEntryDraftProduct(null);
    setEntryDraftBatch(null);
    setJustAddedLineId(null);
    setTimeout(() => {
      if (productEntryStyle === "inline_row") {
        entryProductInputRef.current?.focus();
      } else {
        searchInputRef.current?.focus();
      }
    }, 40);
  };

  const handleSelectProductForEntryRow = async (product: ProductItem, prefixQty = 1) => {
    const batches = await productsStore.getBatchesForProduct(product.id, false);
    const allowSellingOutOfStock = companySettingsService.getSettings().inventory?.allowSellingOutOfStock || "always";

    setSearchQuery("");
    setSearchResults([]);

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

      if (addLineMode === "immediate") {
        const res = posCartService.addProductToCart(product, adhocBatch, prefixQty || 1, 0, {
          isAdhocBatch: true,
        });
        refreshCartState();
        setAriaAnnouncement(
          `Added ${product.name}, Quantity ${prefixQty || 1}. Total: ₹${posCartService.getTotals().grand_total.toFixed(2)}`
        );
        if (res.line) {
          setJustAddedLineId(res.line.id);
          const newLines = posCartService.getLines();
          const targetIdx = newLines.findIndex((l) => l.id === res.line!.id);
          setSelectedRowIndex(targetIdx >= 0 ? targetIdx : newLines.length - 1);
          setFocusContext("cell_edit");
          setTimeout(() => {
            const el = (document.getElementById(`qty-input-${res.line!.id}-pack`) ||
              document.getElementById(`qty-input-${res.line!.id}`)) as HTMLInputElement | null;
            if (el) {
              el.focus();
              el.select();
            }
          }, 40);
        }
        return;
      }

      setEntryDraftProduct(product);
      setEntryDraftBatch(adhocBatch);
      setEntryPacks(prefixQty);
      setEntryLoose(0);
      setEntryRate(product.sel_rate || product.mrp);
      setEntryDiscount(0);
      setEntryRateBasis("sel_rate");
      setFocusContext("cell_edit");
      setTimeout(() => {
        entryPackInputRef.current?.focus();
        entryPackInputRef.current?.select();
      }, 50);
      return;
    }

    const unexpiredBatches = batches.filter((b) => !isBatchExpired(b.expiry_date));

    // If only 1 batch, auto-select batch and advance to Quantity
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

      if (addLineMode === "immediate") {
        const res = posCartService.addProductToCart(product, b, prefixQty || 1, 0);
        refreshCartState();
        setAriaAnnouncement(
          `Added ${product.name}, Quantity ${prefixQty || 1}. Total: ₹${posCartService.getTotals().grand_total.toFixed(2)}`
        );
        if (res.line) {
          setJustAddedLineId(res.line.id);
          const newLines = posCartService.getLines();
          const targetIdx = newLines.findIndex((l) => l.id === res.line!.id);
          setSelectedRowIndex(targetIdx >= 0 ? targetIdx : newLines.length - 1);
          setFocusContext("cell_edit");
          setTimeout(() => {
            const el = (document.getElementById(`qty-input-${res.line!.id}-pack`) ||
              document.getElementById(`qty-input-${res.line!.id}`)) as HTMLInputElement | null;
            if (el) {
              el.focus();
              el.select();
            }
          }, 40);
        }
        return;
      }

      setEntryDraftProduct(product);
      setEntryDraftBatch(b);
      setEntryPacks(prefixQty);
      setEntryLoose(0);
      setEntryRate(b.selling_rate || product.sel_rate || product.mrp);
      setEntryDiscount(0);
      setEntryRateBasis("sel_rate");
      setFocusContext("cell_edit");
      setTimeout(() => {
        entryPackInputRef.current?.focus();
        entryPackInputRef.current?.select();
      }, 50);
    } else {
      // Multiple batches: display FEFO batch picker
      setSelectedProductForBatch(product);
      setProductBatches(batches);
      setSelectedBatchIndex(0);
      setPendingPrefixQty(prefixQty);
    }
  };

  const commitEntryRow = () => {
    if (!entryDraftProduct || !entryDraftBatch) return;
    const packs = Math.max(0, Number(entryPacks) || 0);
    const loose = Math.max(0, Number(entryLoose) || 0);
    if (packs === 0 && loose === 0) {
      showNotification("Quantity must be at least 1", "warning");
      entryPackInputRef.current?.focus();
      return;
    }

    const customPrice = entryRate !== "" && !isNaN(Number(entryRate)) ? Number(entryRate) : undefined;
    const res = posCartService.addProductToCart(
      entryDraftProduct,
      entryDraftBatch,
      packs,
      loose,
      {
        isAdhocBatch: entryDraftBatch.batch_no === "NO_BATCH",
      }
    );

    if (customPrice !== undefined && res.line) {
      posCartService.updateLinePrice(res.line.id, customPrice, entryRateBasis);
    }

    if (entryDiscount && Number(entryDiscount) > 0 && res.line) {
      posCartService.updateLineDiscount(res.line.id, Number(entryDiscount), 0);
    }

    refreshCartState();
    setAriaAnnouncement(
      `Added ${entryDraftProduct.name}, Quantity ${packs}${loose > 0 ? ` + ${loose} loose` : ""}. Total: ₹${posCartService.getTotals().grand_total.toFixed(2)}`
    );

    // Reset entry row
    setEntryDraftProduct(null);
    setEntryDraftBatch(null);
    setEntryPacks(1);
    setEntryLoose(0);
    setEntryRate("");
    setEntryDiscount("");
    setSearchQuery("");
    setSearchResults([]);

    // Keep focus in the Product cell of the entry row!
    setTimeout(() => {
      entryProductInputRef.current?.focus();
    }, 40);
  };

  const selectProductAndAddToCart = async (product: ProductItem, prefixQty = 1) => {
    if (productEntryStyle === "inline_row") {
      await handleSelectProductForEntryRow(product, prefixQty);
      return;
    }

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

      const res = posCartService.addProductToCart(product, adhocBatch, prefixQty, 0, { isAdhocBatch: true });
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
      setAriaAnnouncement(`Added ${product.name}, Quantity ${prefixQty}. Total: ₹${posCartService.getTotals().grand_total.toFixed(2)}`);
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

      const res = posCartService.addProductToCart(product, b, prefixQty, 0);
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
      setAriaAnnouncement(`Added ${product.name}, Quantity ${prefixQty}. Total: ₹${posCartService.getTotals().grand_total.toFixed(2)}`);
    } else {
      // Multiple batches or expired batch: display batch picker modal
      setSelectedProductForBatch(product);
      setProductBatches(batches);
      setSelectedBatchIndex(0);
      setPendingPrefixQty(prefixQty);
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

    if (productEntryStyle === "inline_row") {
      if (addLineMode === "immediate") {
        const res = posCartService.addProductToCart(selectedProductForBatch, batch, pendingPrefixQty || 1, 0);
        refreshCartState();
        setSelectedProductForBatch(null);
        setSelectedBatchIndex(0);
        setPendingPrefixQty(1);
        setSearchQuery("");
        setSearchResults([]);
        if (res.line) {
          setJustAddedLineId(res.line.id);
          const newLines = posCartService.getLines();
          const targetIdx = newLines.findIndex((l) => l.id === res.line!.id);
          setSelectedRowIndex(targetIdx >= 0 ? targetIdx : newLines.length - 1);
          setFocusContext("cell_edit");
          setAriaAnnouncement(
            `Added ${selectedProductForBatch.name}, Quantity ${pendingPrefixQty || 1}. Total: ₹${posCartService.getTotals().grand_total.toFixed(2)}`
          );
          setTimeout(() => {
            const el = (document.getElementById(`qty-input-${res.line!.id}-pack`) ||
              document.getElementById(`qty-input-${res.line!.id}`)) as HTMLInputElement | null;
            if (el) {
              el.focus();
              el.select();
            }
          }, 40);
        }
        return;
      }

      setEntryDraftProduct(selectedProductForBatch);
      setEntryDraftBatch(batch);
      setEntryPacks(pendingPrefixQty || 1);
      setEntryLoose(0);
      setEntryRate(batch.selling_rate || selectedProductForBatch.sel_rate || selectedProductForBatch.mrp);
      setEntryDiscount(0);
      setEntryRateBasis("sel_rate");
      setSelectedProductForBatch(null);
      setSelectedBatchIndex(0);
      setSearchQuery("");
      setSearchResults([]);
      setFocusContext("cell_edit");
      setTimeout(() => {
        entryPackInputRef.current?.focus();
        entryPackInputRef.current?.select();
      }, 50);
      return;
    }

    const res = posCartService.addProductToCart(selectedProductForBatch, batch, pendingPrefixQty || 1, 0);
    refreshCartState();
    setSelectedProductForBatch(null);
    setSelectedBatchIndex(0);
    setPendingPrefixQty(1);
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
    if (justAddedLineId === lineId) {
      setJustAddedLineId(null);
    }
    posCartService.removeLine(lineId);
    refreshCartState();
  };

  const handleHoldBill = () => {
    if (addLineMode === "after_enter" && draftLine) {
      commitEntryRow();
    }
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
    if (addLineMode === "after_enter" && draftLine) {
      commitEntryRow();
    }

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
    const gTotal = Math.round(((t.grand_total || 0) + Number.EPSILON) * 100) / 100;
    setTenders([{ id: `pay_${Date.now()}_0`, mode: "Cash", amount: gTotal, status: "received" }]);
    setActiveTenderIndex(0);
    setExpandedTenderExtras({});
    setIsTenderModalOpen(true);
    setTimeout(() => {
      tenderAmountInputRefs.current[0]?.focus();
      tenderAmountInputRefs.current[0]?.select();
    }, 100);
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
    return tenderCalc.changeDue;
  }, [tenderCalc]);

  const preparePrintData = (linesSource?: PosCartLine[], totalsSource?: InvoiceTotals): InvoicePrintData => {
    const activeLines = linesSource || (posCartService.getLines().length > 0 ? posCartService.getLines() : lines);
    const activeTotals = totalsSource || (posCartService.getLines().length > 0 ? posCartService.getTotals() : totals);

    const settings = companySettingsService.getSettings();
    const tenderCalcSnapshot = billingTenderService.calculateTenderBalance(activeTotals.grand_total, tenders);

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
      payment_mode: tenders.length > 1 ? "Split" : (tenders[0]?.mode || "Cash"),
      payment_status: tenderCalcSnapshot.creditAmount >= activeTotals.grand_total - 0.01
        ? "Unpaid"
        : tenderCalcSnapshot.creditAmount > 0.001
        ? "Partial"
        : "Paid",
      payments: tenders.map((t) => ({
        mode: t.mode,
        amount: Number(t.amount) || 0,
        reference_no: settings.payments?.printShowReferences
          ? t.reference_no
          : t.reference_no
          ? `••••${t.reference_no.slice(-4)}`
          : undefined,
      })),
      change_due: tenderCalcSnapshot.changeDue,
      balance_due: tenderCalcSnapshot.creditAmount > 0 ? tenderCalcSnapshot.creditAmount : 0,
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

  const handleFinalizeAndPrint = async (shouldPrint = true) => {
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

      const appSettings = companySettingsService.getSettings();

      // Validate payment lines
      const validation = await billingTenderService.validatePaymentLines(
        totalsSnapshot.grand_total,
        tenders,
        selectedCustomer
          ? {
              id: selectedCustomer.id,
              name: selectedCustomer.name,
              credit_limit: selectedCustomer.credit_limit,
              current_balance: selectedCustomer.current_balance,
            }
          : customerName
          ? { name: customerName }
          : null,
        appSettings.payments
      );

      if (!validation.valid) {
        showNotification(validation.error || "Payment validation failed", "error");
        if (validation.focusIndex !== undefined) {
          setActiveTenderIndex(validation.focusIndex);
        }
        return;
      }

      if (validation.warning) {
        showNotification(validation.warning, "warning");
      }

      const tenderCalcSnapshot = billingTenderService.calculateTenderBalance(totalsSnapshot.grand_total, tenders);
      const printData = preparePrintData(cartSnapshot, totalsSnapshot);

      // 4. Save invoice with payment lines
      const res = await posCartService.finalizeInvoice(invoiceNumber, tenders, {
        autoClear: false,
        linesSnapshot: cartSnapshot,
        totalsSnapshot,
        cashChange: tenderCalcSnapshot.changeDue,
        payments: tenders,
      });

      if (res.success) {
        let savedPdfPath: string | undefined;

        // 5. Check if printing was requested
        if (shouldPrint && printFormat !== "none") {
          if (printFormat === "ask") {
            setPreviewModalState({
              isOpen: true,
              data: printData,
              initialFormat: "thermal_80mm",
              title: `Tax Invoice Preview - #${invoiceNumber}`,
            });
          } else {
            const previewMode = appSettings.printing.previewMode || "always";
            const isThermal = printFormat === "thermal";
            const shouldDirectPrint = previewMode === "never" || (previewMode === "skip_thermal" && isThermal);

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
          }
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
        {/* Product / Barcode Search Bar (only in search_bar mode) */}
        {productEntryStyle === "search_bar" && (
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
                    const { query } = parseQuantityPrefix(searchQuery.trim());
                    productsStore.searchProducts(query).then((res) => {
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
          </div>
        )}

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
              const isOutOfStock = (prod.current_stock || 0) <= 0;
              return (
                <div
                  key={prod.id}
                  onMouseEnter={() => setSelectedSearchIndex(index)}
                  onClick={() => {
                    const { qty } = parseQuantityPrefix(searchQuery);
                    selectProductAndAddToCart(prod, qty);
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`font-semibold ${isSelected ? "text-[var(--color-accent)] font-bold" : "text-[var(--color-text)]"}`}>
                        {prod.name}
                      </p>
                      {prod.generic_name && (
                        <span className="rounded-[4px] bg-[var(--color-surface-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] font-normal border border-[var(--color-border)]">
                          {prod.generic_name}
                        </span>
                      )}
                      {prod.units_per_pack > 1 && (
                        <span className="rounded-[4px] bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent font-medium">
                          Pack of {prod.units_per_pack} {prod.sub_unit_name || "pcs"}
                        </span>
                      )}
                      {isOutOfStock && (
                        <span className="rounded bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] text-[10px] font-bold px-1.5 py-0.2">
                          Out of Stock
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 font-mono">
                      Barcode: <span>{prod.barcode || "—"}</span>{" "}
                      {prod.hsn_sac_code ? `| HSN: ${prod.hsn_sac_code}` : ""} | GST: {prod.gst_percent}%
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-4 font-mono">
                    <p className="font-bold text-[var(--color-text)] text-sm tabular-nums">
                      ₹ {(prod.sel_rate || prod.mrp).toFixed(2)}
                      <span className="text-[10px] text-[var(--color-text-muted)] font-normal ml-0.5">
                        /{prod.units_per_pack > 1 ? (prod.unit_name || "Strip") : (prod.unit_name || "pc")}
                      </span>
                    </p>
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      MRP: ₹{prod.mrp.toFixed(2)}
                      {(prod as any).nearest_expiry ? ` • Exp: ${formatExpiryDisplay((prod as any).nearest_expiry)}` : ""}
                    </p>
                    <p
                      className={`text-[10px] font-medium ${
                        !isOutOfStock ? "text-[var(--color-success-text)]" : "text-[var(--color-danger-text)] font-bold"
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

        {/* Dynamic POS Grid Table */}
        {(() => {
          const visibleCols: ColumnSetting[] = (posColumns && posColumns.length > 0 ? posColumns : DEFAULT_COLUMNS)
            .filter((c: ColumnSetting) => c.visible !== false)
            .sort((a: ColumnSetting, b: ColumnSetting) => (a.order || 0) - (b.order || 0));

          const renderInlineEntryRow = () => (
            <PosGridRow
              idx={lines.length}
              line={draftLine}
              isDraft={true}
              isSelected={selectedRowIndex === null && focusContext === "search"}
              visibleCols={visibleCols}
              doctorName={doctorName}
              searchQuery={searchQuery}
              onSearchChange={(val) => {
                setSearchQuery(val);
                updateDropdownPosition();
              }}
              onSearchFocus={() => {
                setFocusContext("search");
                if (searchQuery.trim().length > 0 && searchResults.length === 0) {
                  const { query } = parseQuantityPrefix(searchQuery.trim());
                  productsStore.searchProducts(query).then((res) => {
                    setSearchResults(res);
                    setSelectedSearchIndex(0);
                    updateDropdownPosition();
                  });
                } else if (searchResults.length > 0) {
                  updateDropdownPosition();
                }
              }}
              onSearchBlur={(e) => {
                const related = e.relatedTarget as Node | null;
                if (dropdownRef.current && related && dropdownRef.current.contains(related)) {
                  return;
                }
                setTimeout(() => {
                  setSearchResults([]);
                }, 180);
              }}
              onSearchKeyDown={handleBarcodeOrEnter}
              searchInputRef={entryProductInputRef}
              isDropdownOpen={searchResults.length > 0}
              onSelectRow={() => handleFocusSearch()}
              onQtyChange={(newPacks, newLoose) => {
                setEntryPacks(newPacks);
                setEntryLoose(newLoose);
              }}
              onQtyEnter={() => commitEntryRow()}
              onRateChange={(newPrice, basis) => {
                setEntryRate(newPrice);
                setEntryRateBasis(basis);
              }}
              onDiscountClick={() => {
                const cur = Number(entryDiscount) || 0;
                const next = cur === 0 ? 5 : cur === 5 ? 10 : 0;
                setEntryDiscount(next);
              }}
              onEditProductBatch={() => {
                if (entryDraftProduct) {
                  setSelectedProductForBatch(entryDraftProduct);
                  productsStore.getBatchesForProduct(entryDraftProduct.id, false).then((b) => {
                    setProductBatches(b);
                  });
                }
              }}
              onEditConversion={() => {
                if (entryDraftProduct && draftLine) {
                  setSelectedLineForConversion(draftLine);
                }
              }}
              onClearDraft={() => {
                setEntryDraftProduct(null);
                setEntryDraftBatch(null);
                setSearchQuery("");
                setSearchResults([]);
                setTimeout(() => entryProductInputRef.current?.focus(), 40);
              }}
              onCommitDraft={() => commitEntryRow()}
              onRemoveLine={() => {
                setEntryDraftProduct(null);
                setEntryDraftBatch(null);
                setSearchQuery("");
                setSearchResults([]);
                setTimeout(() => entryProductInputRef.current?.focus(), 40);
              }}
            />
          );

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
                  {productEntryStyle === "inline_row" && entryRowPosition === "top" && renderInlineEntryRow()}
                  {lines.length === 0 ? (
                    productEntryStyle === "search_bar" ? (
                      <tr>
                        <td colSpan={visibleCols.length} className="py-16 text-center text-[var(--color-text-muted)]">
                          <Barcode className="mx-auto h-8 w-8 text-[var(--color-text-faint)] mb-2" />
                          <p className="font-semibold text-sm text-[var(--color-text)]">Billing cart is empty</p>
                          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">Scan a barcode or type a product name to begin billing</p>
                        </td>
                      </tr>
                    ) : entryRowPosition === "bottom" ? (
                      <tr>
                        <td colSpan={visibleCols.length} className="py-12 text-center text-[var(--color-text-muted)]">
                          <Barcode className="mx-auto h-7 w-7 text-[var(--color-text-faint)] mb-1.5" />
                          <p className="font-medium text-xs text-[var(--color-text-muted)]">Enter products in the row below or scan barcode</p>
                        </td>
                      </tr>
                    ) : null
                  ) : (
                    lines.map((line, idx) => (
                      <PosGridRow
                        key={line.id}
                        idx={idx}
                        line={line}
                        isJustAdded={line.id === justAddedLineId}
                        isSelected={selectedRowIndex === idx}
                        visibleCols={visibleCols}
                        doctorName={doctorName}
                        onSelectRow={() => handleSelectRow(idx)}
                        onQtyChange={(newPacks, newLoose) => {
                          posCartService.updateLineQuantity(line.id, newPacks, newLoose);
                          refreshCartState();
                        }}
                        onQtyEnter={() => handleQtyEnterAdvance(idx)}
                        onRateChange={(newPrice, basis) => {
                          posCartService.updateLinePrice(line.id, newPrice, basis);
                          refreshCartState();
                        }}
                        onDiscountClick={() => {
                          setSelectedRowIndex(idx);
                          handleQuickDiscount(line);
                        }}
                        onEditProductBatch={() => {
                          setSelectedRowIndex(idx);
                          setSelectedLineForProductBatchEdit(line);
                        }}
                        onEditConversion={() => {
                          setSelectedLineForConversion(line);
                        }}
                        onRemoveLine={() => removeLine(line.id)}
                      />
                    ))
                  )}
                </tbody>
                {productEntryStyle === "inline_row" && entryRowPosition === "bottom" && (
                  <tfoot className="sticky bottom-0 bg-[var(--color-surface)] z-10 border-t-2 border-accent/40 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
                    {renderInlineEntryRow()}
                  </tfoot>
                )}
              </table>
            </div>
          );
        })()}

        {/* Bottom Totals & Settlement Bar */}
        <div className="flex flex-wrap items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 gap-3">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-xs text-[var(--color-text-muted)]">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Items: </span>
              <span className="font-bold font-mono text-[var(--color-text)]">
                {lines.length}
                {displayTotals.pendingLineCount > 0 && (
                  <span className="ml-1 text-xs text-amber-600 font-semibold">(+1 pending)</span>
                )}
              </span>
              {displayTotals.pendingLineCount > 0 && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-300">
                  Pending line (1)
                </span>
              )}
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Subtotal: </span>
              <span className="font-bold font-mono text-[var(--color-text)]">₹ {displayTotals.taxable_subtotal.toFixed(2)}</span>
            </div>
            {displayTotals.line_discount_total > 0 && (
              <div className="text-[var(--color-warning-text)]">
                <span className="text-[11px] font-bold uppercase tracking-wider">Line Disc: </span>
                <span className="font-bold font-mono">-₹ {displayTotals.line_discount_total.toFixed(2)}</span>
              </div>
            )}
            <div>
              {displayTotals.bill_discount_amount > 0 ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setIsBillDiscountModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-[var(--color-warning-bg)] hover:opacity-90 text-[var(--color-warning-text)] font-bold border border-[var(--color-warning-border)] shadow-2xs transition-colors cursor-pointer"
                  title="Edit Overall Bill Discount (Ctrl+F2)"
                >
                  <span className="font-mono">Bill Disc: -₹{displayTotals.bill_discount_amount.toFixed(2)}</span>
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
                {displayTotals.igst_total > 0 || posCartService.getIsInterState() ? "IGST Tax: " : "GST Tax: "}
              </span>
              <span className="font-bold font-mono text-[var(--color-text)]">₹ {displayTotals.total_tax.toFixed(2)}</span>
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
                  Round-off: {displayTotals.round_off >= 0 ? `+₹${displayTotals.round_off.toFixed(2)}` : `-₹${Math.abs(displayTotals.round_off).toFixed(2)}`}
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
                ₹ {displayTotals.grand_total.toFixed(2)}
              </p>
            </div>

            <button
              onClick={openTenderModal}
              disabled={lines.length === 0 && !draftLine}
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
                            Exp: {formatExpiryDisplay(b.expiry_date)}
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
      {isTenderModalOpen && (() => {
        const appSettings = companySettingsService.getSettings();
        const rawModes: PaymentModeConfig[] = appSettings.payments?.modes?.length ? appSettings.payments.modes : DEFAULT_PAYMENT_MODES;
        const modeConfigs: Record<string, PaymentModeConfig> = {};
        for (const m of rawModes) {
          modeConfigs[m.name] = m;
        }
        const upiLine = tenders.find((t) => t.mode === "UPI" && t.amount > 0);
        const creditLine = tenders.find((t) => t.mode === "Credit" && t.amount > 0);
        const hasNamedCustomer = Boolean(selectedCustomer || (customerName && customerName.trim() !== "Walk-in Customer"));
        const availableModes = [
          "Cash",
          "UPI",
          "Card",
          "Bank Transfer",
          "Cheque",
          "Wallet",
          "Gift Voucher",
          "Credit",
        ].filter((m) => modeConfigs[m]?.enabled !== false);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 select-none font-sans animate-in fade-in duration-100">
            <div className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-card bg-surface shadow-modal overflow-hidden border border-border-main">
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-border-main px-5 py-3.5 bg-canvas shrink-0">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-sm font-bold text-text-main">Bill Settlement (F12)</h3>
                    {(() => {
                      const activeStore = storeRegistryService.getActiveStore();
                      if (!activeStore) return null;
                      return (
                        <span
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border"
                          style={{
                            backgroundColor: `${activeStore.color}15`,
                            borderColor: `${activeStore.color}40`,
                            color: activeStore.color,
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: activeStore.color }} />
                          {activeStore.alias || activeStore.name}
                        </span>
                      );
                    })()}
                  </div>
                  <p className="text-[11px] text-text-muted font-mono">Invoice: {invoiceNumber}</p>
                </div>
                <button
                  onClick={() => setIsTenderModalOpen(false)}
                  className="text-text-muted hover:text-text-main p-1.5 rounded-btn hover:bg-surface transition-colors cursor-pointer"
                  title="Close (Esc)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Scrollable Body */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                {/* 1. Live Totals Summary */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-center">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Total Due</span>
                    <p className="text-xl font-black text-slate-900 mt-0.5">₹ {totals.grand_total.toFixed(2)}</p>
                  </div>
                  <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-center">
                    <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">Paid So Far</span>
                    <p className="text-xl font-black text-blue-900 mt-0.5">₹ {tenderCalc.totalPaid.toFixed(2)}</p>
                  </div>
                  <div
                    className={`rounded-lg border p-3 text-center transition-colors ${
                      tenderCalc.nonCashOverpaid
                        ? "bg-rose-50 border-rose-300 text-rose-900"
                        : tenderCalc.isFullyPaid
                        ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                        : "bg-amber-50 border-amber-300 text-amber-900"
                    }`}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide">
                      {tenderCalc.nonCashOverpaid
                        ? "Non-Cash Overpaid"
                        : tenderCalc.isFullyPaid
                        ? tenderCalc.changeDue > 0
                          ? "Change Due"
                          : "Settlement Status"
                        : "Balance Remaining"}
                    </span>
                    <p className="text-xl font-black mt-0.5">
                      {tenderCalc.nonCashOverpaid
                        ? "Blocked"
                        : tenderCalc.isFullyPaid
                        ? tenderCalc.changeDue > 0
                          ? `₹ ${tenderCalc.changeDue.toFixed(2)}`
                          : "Fully Paid"
                        : `₹ ${tenderCalc.balanceRemaining.toFixed(2)}`}
                    </p>
                  </div>
                </div>

                {/* Non-cash Overpayment Error Alert */}
                {tenderCalc.nonCashOverpaid && (
                  <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-800">
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                    <span>Non-cash tender (UPI, Card, Bank) cannot exceed the bill amount. Change is only returned for Cash tenders.</span>
                  </div>
                )}

                {/* 2. Quick Mode & Helper Actions */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-700">Quick Tender / Add Mode</label>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <button
                        type="button"
                        onClick={handleSplitHalf}
                        className="px-2 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium cursor-pointer"
                        title="Split bill 50/50 between Cash and UPI (Hotkey: H)"
                      >
                        Split 50/50 <span className="text-slate-400 font-mono">[H]</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFillRemainder(activeTenderIndex)}
                        className="px-2 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium cursor-pointer"
                        title="Fill remaining balance into current line (Hotkey: F)"
                      >
                        Fill Remainder <span className="text-slate-400 font-mono">[F]</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddPaymentLine("Cash")}
                        className="px-2 py-0.5 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold cursor-pointer"
                        title="Add another payment line (Hotkey: Alt+A or +)"
                      >
                        + Add Payment <span className="text-blue-400 font-mono">[Alt+A]</span>
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                    {availableModes.map((mode, idx) => {
                      const shortcutKey = idx < 8 ? idx + 1 : "";
                      return (
                        <button
                          key={mode}
                          type="button"
                          disabled={isFinalizing}
                          onClick={() => {
                            if (tenders.length === 1 && (tenders[0].amount >= totals.grand_total || tenders[0].amount === 0)) {
                              handleUpdatePaymentLine(0, { mode });
                            } else if (tenderCalc.balanceRemaining > 0) {
                              handleAddPaymentLine(mode);
                            } else {
                              handleUpdatePaymentLine(activeTenderIndex, { mode });
                            }
                          }}
                          className={`rounded-lg py-1.5 px-1 text-center border transition-all text-xs font-semibold cursor-pointer disabled:opacity-50 ${
                            tenders[activeTenderIndex]?.mode === mode
                              ? "border-blue-600 bg-blue-600 text-white shadow-xs"
                              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <div className="truncate">{mode}</div>
                          {shortcutKey && (
                            <div className={`text-[10px] font-mono ${tenders[activeTenderIndex]?.mode === mode ? "text-blue-100" : "text-slate-400"}`}>
                              [{shortcutKey}]
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Cash Quick Denominations */}
                {(appSettings.payments?.enableQuickDenominations ?? true) && tenders[activeTenderIndex]?.mode === "Cash" && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50/60 border border-emerald-200">
                    <span className="text-[11px] font-semibold text-emerald-800 shrink-0">Cash Denominations:</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[100, 200, 500, 2000].map((denom) => (
                        <button
                          key={denom}
                          type="button"
                          onClick={() => handleAddDenomination(denom, activeTenderIndex)}
                          className="px-2 py-0.5 rounded bg-white border border-emerald-300 text-emerald-800 text-[11px] font-bold hover:bg-emerald-100 transition-colors cursor-pointer"
                        >
                          +₹{denom}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const rem = billingTenderService.calculateRemainderForLine(totals.grand_total, tenders, activeTenderIndex);
                          handleUpdatePaymentLine(activeTenderIndex, { amount: rem });
                        }}
                        className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 transition-colors cursor-pointer"
                      >
                        Exact Amount
                      </button>
                    </div>
                  </div>
                )}

                {/* 3. Payment Lines List */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">
                      Payment Tender Lines ({tenders.length})
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Enter on last line saves | Tab moves next
                    </span>
                  </div>

                  <div className="space-y-2">
                    {tenders.map((line, idx) => {
                      const modeCfg = modeConfigs[line.mode] || {
                        id: line.mode.toLowerCase(),
                        name: line.mode,
                        enabled: true,
                        referenceRequirement: "off",
                        referenceLabel: "Ref",
                        duplicateCheck: "off",
                      };
                      const isRefRequired = modeCfg.referenceRequirement === "required";
                      const showRefField = modeCfg.referenceRequirement !== "off";
                      const isExtrasOpen = Boolean(expandedTenderExtras[idx]);
                      const hasExtraFields =
                        Boolean(modeCfg.extraFields?.cardLastFour) ||
                        Boolean(modeCfg.extraFields?.cardNetwork) ||
                        Boolean(modeCfg.extraFields?.bankName) ||
                        Boolean(modeCfg.extraFields?.chequeDate) ||
                        Boolean(modeCfg.extraFields?.payerVpa) ||
                        Boolean(modeCfg.extraFields?.notes) ||
                        line.mode === "Cheque" ||
                        line.mode === "Bank Transfer";

                      return (
                        <div
                          key={line.id || `tender_${idx}`}
                          className={`rounded-lg border p-3 transition-colors ${
                            idx === activeTenderIndex
                              ? "border-blue-400 bg-blue-50/20 shadow-xs"
                              : "border-slate-200 bg-white"
                          }`}
                          onClick={() => setActiveTenderIndex(idx)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-5 text-center text-xs font-mono font-bold text-slate-400">
                              #{idx + 1}
                            </span>

                            {/* Mode Dropdown */}
                            <div className="w-32 shrink-0">
                              <select
                                value={line.mode}
                                onChange={(e) => handleUpdatePaymentLine(idx, { mode: e.target.value })}
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 focus:border-blue-600 focus:outline-none"
                              >
                                {availableModes.map((m) => (
                                  <option key={m} value={m}>
                                    {m}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Amount Input */}
                            <div className="w-36 shrink-0 relative">
                              <div className="absolute left-2.5 top-1.5 text-xs font-bold text-slate-400 pointer-events-none">
                                ₹
                              </div>
                              <input
                                ref={(el) => {
                                  tenderAmountInputRefs.current[idx] = el;
                                  if (idx === 0) tenderCashInputRef.current = el;
                                }}
                                type="number"
                                step="0.01"
                                disabled={isFinalizing}
                                value={line.amount === 0 ? "" : line.amount}
                                placeholder="0.00"
                                onFocus={() => setActiveTenderIndex(idx)}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  handleUpdatePaymentLine(idx, { amount: isNaN(val) ? 0 : val });
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    const step = e.shiftKey ? 10 : 1;
                                    handleUpdatePaymentLine(idx, {
                                      amount: Math.round(((line.amount || 0) + step) * 100) / 100,
                                    });
                                  } else if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    const step = e.shiftKey ? 10 : 1;
                                    handleUpdatePaymentLine(idx, {
                                      amount: Math.max(0, Math.round(((line.amount || 0) - step) * 100) / 100),
                                    });
                                  } else if (e.key === "Enter") {
                                    e.preventDefault();
                                    const rem = billingTenderService.calculateRemainderForLine(totals.grand_total, tenders, idx);
                                    if (rem > 0 && idx === tenders.length - 1) {
                                      handleAddPaymentLine(line.mode === "Cash" ? "UPI" : "Cash");
                                    } else if (idx < tenders.length - 1) {
                                      tenderAmountInputRefs.current[idx + 1]?.focus();
                                      tenderAmountInputRefs.current[idx + 1]?.select();
                                    } else {
                                      handleFinalizeAndPrint(false);
                                    }
                                  }
                                }}
                                className="w-full rounded border border-slate-300 bg-white pl-6 pr-2 py-1.5 text-sm font-bold font-mono text-right text-slate-900 focus:border-blue-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            </div>

                            {/* Reference / Txn ID */}
                            {showRefField ? (
                              <div className="flex-1 relative">
                                <input
                                  type="text"
                                  disabled={isFinalizing}
                                  value={line.reference || ""}
                                  placeholder={
                                    modeCfg.referencePlaceholder ||
                                    `${modeCfg.referenceLabel || "Ref ID"}${isRefRequired ? " *" : " (optional)"}`
                                  }
                                  onChange={(e) => handleUpdatePaymentLine(idx, { reference: e.target.value })}
                                  className={`w-full rounded border px-2.5 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none ${
                                    isRefRequired && !line.reference?.trim()
                                      ? "border-amber-300 bg-amber-50/30 focus:border-blue-600"
                                      : "border-slate-300 bg-white focus:border-blue-600"
                                  }`}
                                />
                              </div>
                            ) : (
                              <div className="flex-1 text-[11px] text-slate-400 italic">No reference required</div>
                            )}

                            {/* Extras toggle button */}
                            {hasExtraFields && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedTenderExtras((prev) => ({
                                    ...prev,
                                    [idx]: !prev[idx],
                                  }))
                                }
                                className={`p-1.5 rounded border text-xs cursor-pointer transition-colors ${
                                  isExtrasOpen
                                    ? "border-blue-400 bg-blue-50 text-blue-700"
                                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                                }`}
                                title="Extra details (Card last 4, Bank, Cheque Date, Notes)"
                              >
                                {isExtrasOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              </button>
                            )}

                            {/* Remove Line Button */}
                            <button
                              type="button"
                              disabled={tenders.length <= 1 || isFinalizing}
                              onClick={() => handleRemovePaymentLine(idx)}
                              className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                              title="Delete payment line"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {/* Expandable Extras Tray */}
                          {isExtrasOpen && (
                            <div className="mt-2.5 pt-2.5 border-t border-slate-200/80 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] animate-in fade-in duration-100">
                              {(line.mode === "Cheque" || line.mode === "Bank Transfer") && (
                                <div className="col-span-2 sm:col-span-4 flex items-center gap-2 p-1.5 rounded bg-amber-50/60 border border-amber-200 text-amber-900">
                                  <input
                                    type="checkbox"
                                    id={`pending_clear_${idx}`}
                                    checked={line.status === "pending_clearance"}
                                    onChange={(e) =>
                                      handleUpdatePaymentLine(idx, {
                                        status: e.target.checked ? "pending_clearance" : "received",
                                      })
                                    }
                                    className="rounded border-amber-300 text-blue-600 focus:ring-0 cursor-pointer"
                                  />
                                  <label htmlFor={`pending_clear_${idx}`} className="cursor-pointer font-medium">
                                    Mark as pending clearance (Receipt report will track clearance)
                                  </label>
                                </div>
                              )}

                              {Boolean(modeCfg.extraFields?.cardLastFour) && (
                                <div>
                                  <label className="text-slate-500 block mb-0.5">Card Last 4 Digits</label>
                                  <input
                                    type="text"
                                    maxLength={4}
                                    placeholder="•••• 1234"
                                    value={line.card_last_four || ""}
                                    onChange={(e) =>
                                      handleUpdatePaymentLine(idx, {
                                        card_last_four: e.target.value.replace(/\D/g, "").slice(0, 4),
                                      })
                                    }
                                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-mono text-slate-800"
                                  />
                                </div>
                              )}

                              {Boolean(modeCfg.extraFields?.cardNetwork) && (
                                <div>
                                  <label className="text-slate-500 block mb-0.5">Card Network</label>
                                  <select
                                    value={line.card_network || ""}
                                    onChange={(e) => handleUpdatePaymentLine(idx, { card_network: e.target.value })}
                                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-800"
                                  >
                                    <option value="">Select network</option>
                                    <option value="Visa">Visa</option>
                                    <option value="Mastercard">Mastercard</option>
                                    <option value="RuPay">RuPay</option>
                                    <option value="Amex">Amex</option>
                                  </select>
                                </div>
                              )}

                              {Boolean(modeCfg.extraFields?.bankName) && (
                                <div>
                                  <label className="text-slate-500 block mb-0.5">Bank Name</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. HDFC / SBI"
                                    value={line.bank_name || ""}
                                    onChange={(e) => handleUpdatePaymentLine(idx, { bank_name: e.target.value })}
                                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-800"
                                  />
                                </div>
                              )}

                              {Boolean(modeCfg.extraFields?.chequeDate) && (
                                <div>
                                  <label className="text-slate-500 block mb-0.5">Cheque Date</label>
                                  <input
                                    type="date"
                                    value={line.cheque_date || ""}
                                    onChange={(e) => handleUpdatePaymentLine(idx, { cheque_date: e.target.value })}
                                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-800"
                                  />
                                </div>
                              )}

                              {Boolean(modeCfg.extraFields?.payerVpa) && (
                                <div>
                                  <label className="text-slate-500 block mb-0.5">Customer UPI VPA</label>
                                  <input
                                    type="text"
                                    placeholder="customer@okhdfcbank"
                                    value={line.payer_vpa || ""}
                                    onChange={(e) => handleUpdatePaymentLine(idx, { payer_vpa: e.target.value })}
                                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-800"
                                  />
                                </div>
                              )}

                              {Boolean(modeCfg.extraFields?.notes) && (
                                <div className="col-span-2">
                                  <label className="text-slate-500 block mb-0.5">Payment Memo / Note</label>
                                  <input
                                    type="text"
                                    placeholder="Optional note"
                                    value={line.notes || ""}
                                    onChange={(e) => handleUpdatePaymentLine(idx, { notes: e.target.value })}
                                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-800"
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 4. Dynamic UPI QR Panel */}
                {upiLine && (appSettings.payments?.enableDynamicUpiQr ?? true) && (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 flex flex-col sm:flex-row items-center gap-4">
                    <div className="shrink-0 bg-white p-2 rounded-lg border border-indigo-200 shadow-xs flex items-center justify-center">
                      {(() => {
                        const upiUri = `upi://pay?pa=${encodeURIComponent(
                          appSettings.payments?.upiVpa || "store@upi"
                        )}&pn=${encodeURIComponent(
                          appSettings.payments?.upiPayeeName || "LamSuite Billing"
                        )}&am=${upiLine.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Inv ${invoiceNumber}`)}`;
                        const svg = generateQrCodeSvg(upiUri, 110);
                        return <div dangerouslySetInnerHTML={{ __html: svg }} />;
                      })()}
                    </div>
                    <div className="flex-1 space-y-1.5 text-xs text-slate-700">
                      <div className="flex items-center gap-1.5">
                        <QrCode className="h-4 w-4 text-indigo-600" />
                        <span className="font-bold text-indigo-900">Dynamic UPI Payment QR</span>
                      </div>
                      <p className="text-[11px] text-slate-600">
                        Scan with GPay, PhonePe, Paytm or BHIM for exact bill amount of{" "}
                        <strong className="text-indigo-900 font-bold">₹ {upiLine.amount.toFixed(2)}</strong>.
                      </p>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500">
                        <span>VPA: <strong className="text-slate-700 font-mono">{appSettings.payments?.upiVpa || "store@upi"}</strong></span>
                        <span>Ref: <strong className="text-slate-700 font-mono">Inv #{invoiceNumber}</strong></span>
                      </div>
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            const idx = tenders.indexOf(upiLine);
                            if (idx >= 0) handleUpdatePaymentLine(idx, { status: "received" });
                            showNotification("UPI payment marked as received!", "success");
                          }}
                          className="px-2.5 py-1 rounded bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          <span>Mark as Received</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. Credit (Udhari) Rules Panel */}
                {creditLine && (
                  <div
                    className={`rounded-lg border p-3 text-xs space-y-2 ${
                      !hasNamedCustomer
                        ? "border-rose-300 bg-rose-50/60 text-rose-900"
                        : "border-amber-300 bg-amber-50/50 text-amber-900"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                      <span>Credit Sale (Udhari) Check</span>
                    </div>

                    {!hasNamedCustomer ? (
                      <p className="text-xs text-rose-700 font-semibold">
                        Credit sales require a registered customer. Please select or add a customer to put ₹{" "}
                        {creditLine.amount.toFixed(2)} on credit.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1">
                        <div>
                          <span className="text-slate-500 block">Customer</span>
                          <span className="font-bold text-slate-800">{selectedCustomer?.name || customerName}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Current Balance</span>
                          <span className="font-bold text-slate-800">
                            ₹ {(selectedCustomer?.current_balance || 0).toFixed(2)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Credit Limit</span>
                          <span className="font-bold text-slate-800">
                            {selectedCustomer?.credit_limit ? `₹ ${selectedCustomer.credit_limit.toFixed(2)}` : "No limit"}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">New Balance After Sale</span>
                          <span className="font-bold text-amber-950">
                            ₹ {((selectedCustomer?.current_balance || 0) + creditLine.amount).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 6. Print Output Format Selector */}
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                    Print Output Format (Saved per Counter)
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                    {[
                      { key: "thermal" as const, label: "Thermal 80mm", icon: Printer },
                      { key: "a4" as const, label: "A4 Tax Invoice", icon: FileText },
                      { key: "pdf" as const, label: "Save PDF", icon: Download },
                      { key: "none" as const, label: "No Print", icon: X },
                      { key: "ask" as const, label: "Ask Each Time", icon: Sliders },
                    ].map((item) => {
                      const Icon = item.icon;
                      const isSelected = printFormat === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          disabled={isFinalizing}
                          onClick={() => setPrintFormat(item.key)}
                          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 px-2 text-xs font-medium border transition-all cursor-pointer disabled:opacity-50 ${
                            isSelected
                              ? "border-blue-600 bg-blue-50 text-blue-700 font-bold shadow-xs"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 7. Electronic Dispatch Actions */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isFinalizing || !customerPhone || customerPhone.trim().length < 10}
                    onClick={handleShareWhatsApp}
                    title={
                      customerPhone && customerPhone.trim().length >= 10
                        ? `Share via WhatsApp to ${customerPhone}`
                        : "Enter a valid 10-digit customer phone to enable WhatsApp"
                    }
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <MessageCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <span>WhatsApp Bill {customerPhone ? `(${customerPhone.slice(-4)})` : ""}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isFinalizing || !selectedCustomer?.email}
                    onClick={handleShareEmail}
                    title={
                      selectedCustomer?.email
                        ? `Email invoice to ${selectedCustomer.email}`
                        : "Customer has no email address on file"
                    }
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Mail className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                    <span>Email Invoice {selectedCustomer?.email ? `(${selectedCustomer.email.split("@")[0]})` : ""}</span>
                  </button>
                </div>
              </div>

              {/* Modal Footer (Sized cleanly on 1 line at >= 1366px screen width) */}
              <div className="border-t border-slate-200 bg-slate-50 px-4 sm:px-5 py-3 flex items-center justify-between gap-3 shrink-0">
                <div className="text-[11px] text-slate-500 font-mono hidden sm:block">
                  Esc: Cancel | Ctrl+S: Save | F12: Save & Print
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    disabled={isFinalizing}
                    onClick={() => setIsTenderModalOpen(false)}
                    className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                  >
                    Cancel (Esc)
                  </button>
                  <button
                    type="button"
                    disabled={isFinalizing || tenderCalc.nonCashOverpaid}
                    onClick={() => handleFinalizeAndPrint(false)}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
                    title="Save bill without printing (Ctrl+S)"
                  >
                    <Save className="h-3.5 w-3.5 text-slate-600" />
                    <span>{isFinalizing ? "Saving..." : "Save (Ctrl+S)"}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isFinalizing || tenderCalc.nonCashOverpaid}
                    onClick={() => handleFinalizeAndPrint(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow-md hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
                    title="Save and print bill (F12 or Enter)"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>
                      {isFinalizing
                        ? "Saving..."
                        : `Save & Print (${printFormat.toUpperCase()}) [F12]`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

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

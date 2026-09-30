import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
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
import { companySettingsService, type ColumnSetting } from "../lib/settings/companySettingsService";
import type { InvoiceTotals } from "../lib/billing/billingCalculations";

export const PosBillingPage: React.FC = () => {
  // Cart & Invoice State
  const [lines, setLines] = useState<PosCartLine[]>([]);
  const [totals, setTotals] = useState<InvoiceTotals>(posCartService.getTotals());
  const [customerName, setCustomerName] = useState("Walk-in Customer");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerGstin, setCustomerGstin] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState(`INV-${Date.now().toString().slice(-6)}`);

  // Search & Auto-complete
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProductItem[]>([]);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [selectedProductForBatch, setSelectedProductForBatch] = useState<ProductItem | null>(null);
  const [productBatches, setProductBatches] = useState<ProductBatch[]>([]);
  const [selectedBatchIndex, setSelectedBatchIndex] = useState(0);

  // Modals & Popups
  const [isTenderModalOpen, setIsTenderModalOpen] = useState(false);
  const [isRecallModalOpen, setIsRecallModalOpen] = useState(false);
  const [heldBillsCount, setHeldBillsCount] = useState(billingTenderService.listHeldBills().length);
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Tender form state
  const [tenders, setTenders] = useState<PaymentTenderLine[]>([{ mode: "Cash", amount: 0 }]);
  const [receivedCash, setReceivedCash] = useState<number>(0);
  const [printFormat, setPrintFormat] = useState<"thermal" | "a4" | "pdf">("thermal");
  const [posColumns, setPosColumns] = useState<ColumnSetting[]>([]);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const isFinalizingRef = useRef(false);

  // References for focus control
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tenderCashInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const batchListRef = useRef<HTMLDivElement>(null);

  const refreshCartState = () => {
    setLines(posCartService.getLines());
    setTotals(posCartService.getTotals());
    setHeldBillsCount(billingTenderService.listHeldBills().length);
  };

  const closeBatchModal = () => {
    setSelectedProductForBatch(null);
    setSelectedBatchIndex(0);
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  };

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

  // Focus search input on mount and handle global POS hotkeys
  useEffect(() => {
    searchInputRef.current?.focus();
    refreshCartState();

    const handleKeyDown = (e: KeyboardEvent) => {
      // If batch modal is open, let batch modal listeners handle navigation
      if (selectedProductForBatch) {
        if (e.key === "Escape" || e.key === "F1") {
          e.preventDefault();
          closeBatchModal();
        }
        return;
      }

      // If tender modal is open, handle tender modal hotkeys (F12, Enter, Escape)
      if (isTenderModalOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (!isFinalizingRef.current) {
            setIsTenderModalOpen(false);
            searchInputRef.current?.focus();
          }
          return;
        }
        if (e.key === "F12" || e.key === "Enter") {
          e.preventDefault();
          handleFinalizeAndPrint();
          return;
        }
        return;
      }

      // F1: Focus Search/Barcode
      if (e.key === "F1") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // F8: Hold Current Bill
      else if (e.key === "F8") {
        e.preventDefault();
        handleHoldBill();
      }
      // F9: Recall Held Bill
      else if (e.key === "F9") {
        e.preventDefault();
        setIsRecallModalOpen(true);
      }
      // F12: Open Checkout / Tender
      else if (e.key === "F12") {
        e.preventDefault();
        openTenderModal();
      }
      // Escape: Close dropdown or open modals
      else if (e.key === "Escape") {
        if (searchResults.length > 0) {
          setSearchResults([]);
          return;
        }
        if (isRecallModalOpen) setIsRecallModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isTenderModalOpen, isRecallModalOpen, selectedProductForBatch, searchResults.length, lines.length]);

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

  const showNotification = (message: string, type: "success" | "error" = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleBarcodeOrEnter = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (searchResults.length > 0) {
        setSelectedSearchIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : prev));
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
    // Retrieve all batches in FEFO order (including out-of-stock batches to display in modal)
    const batches = await productsStore.getBatchesForProduct(product.id, false);

    if (batches.length === 0) {
      showNotification(`No stock batches available for ${product.name}`, "error");
      return;
    }

    const selectableBatches = batches.filter((b) => isBatchSelectable(b));

    if (batches.length === 1 && selectableBatches.length === 1) {
      // Single selectable batch: auto-add with FEFO
      posCartService.addProductToCart(product, batches[0], 1, 0);
      refreshCartState();
      setSearchQuery("");
      setSearchResults([]);
      searchInputRef.current?.focus();
    } else {
      // Multiple batches or non-selectable batch: display batch picker modal
      setSelectedProductForBatch(product);
      setProductBatches(batches);
      setSelectedBatchIndex(0);
    }
  };

  const addBatchToCart = (batch: ProductBatch) => {
    if (!selectedProductForBatch) return;
    if (!isBatchSelectable(batch)) {
      const isOutOfStock = (batch.stock_qty || 0) <= 0;
      showNotification(
        isOutOfStock
          ? `Batch ${batch.batch_no} is out of stock`
          : `Batch ${batch.batch_no} is expired (${batch.expiry_date}) and cannot be billed`,
        "error"
      );
      return;
    }
    posCartService.addProductToCart(selectedProductForBatch, batch, 1, 0);
    refreshCartState();
    setSelectedProductForBatch(null);
    setSelectedBatchIndex(0);
    setSearchQuery("");
    setSearchResults([]);
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
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
      { lines: currentLines, customerPhone },
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

    setCustomerName(recalled.customer_name || "Walk-in Customer");
    setCustomerPhone((recalled.cart_payload.customerPhone as string) || "");
    setIsRecallModalOpen(false);
    refreshCartState();
    showNotification(`Recalled bill for ${recalled.customer_name}`);
  };

  const openTenderModal = () => {
    // Validate empty cart before opening modal
    const currentLines = posCartService.getLines().length > 0 ? posCartService.getLines() : lines;
    if (currentLines.length === 0) {
      showNotification("Cannot open checkout: Cart is empty. Please add products first.", "error");
      return;
    }

    const t = posCartService.getTotals();
    setTenders([{ mode: "Cash", amount: t.grand_total }]);
    setReceivedCash(t.grand_total);
    setIsTenderModalOpen(true);
    setTimeout(() => tenderCashInputRef.current?.focus(), 100);
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

    return {
      invoice_number: invoiceNumber,
      invoice_date: new Date().toISOString().slice(0, 10),
      store_name: "LamStone Pharmacy & Retail",
      store_phone: "9876543210",
      customer_name: customerName,
      customer_phone: customerPhone,
      lines: activeLines.map((l) => ({
        description: l.product.name,
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
    };
  };

  const handleShareWhatsApp = () => {
    if (!customerPhone.trim()) {
      showNotification("Please enter customer mobile number to share via WhatsApp", "error");
      return;
    }
    const data = preparePrintData();
    const url = generateWhatsAppShareUrl(customerPhone, data);
    window.open(url, "_blank");
    showNotification("WhatsApp invoice link opened!");
  };

  const handleShareEmail = () => {
    const data = preparePrintData();
    const url = generateEmailShareUrl("customer@example.com", data);
    window.open(url, "_blank");
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
        // 5. Execute print/export flow with snapshot
        if (printFormat === "thermal") {
          await printingEngine.printThermalReceipt(printData);
        } else if (printFormat === "a4") {
          await printingEngine.printA4TaxInvoice(printData);
        } else if (printFormat === "pdf") {
          await printingEngine.exportToPdf(printData);
        }

        // 6. Clear cart ONLY after BOTH save and print have succeeded
        posCartService.clearCart();
        refreshCartState();
        setIsTenderModalOpen(false);
        showNotification(`Invoice ${invoiceNumber} billed (${printFormat.toUpperCase()})!`);
        setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
        setCustomerName("Walk-in Customer");
        setCustomerPhone("");
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
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-xs font-semibold text-white shadow-lg transition-all ${
            notification.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {notification.type === "success" ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Header Strip: Customer & Bill Meta */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Invoice No</span>
            <p className="text-xs font-bold text-blue-700">{invoiceNumber}</p>
          </div>
          <div className="h-6 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer Name"
              className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Mobile (+91)"
              className="w-32 rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Action Shortcuts: Hold, Recall, Clear */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleHoldBill}
            className="flex items-center gap-1.5 rounded bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
          >
            <PauseCircle className="h-3.5 w-3.5" />
            <span>Hold (F8)</span>
          </button>

          <button
            onClick={() => setIsRecallModalOpen(true)}
            className="relative flex items-center gap-1.5 rounded bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            <PlayCircle className="h-3.5 w-3.5" />
            <span>Recall (F9)</span>
            {heldBillsCount > 0 && (
              <span className="ml-1 rounded-full bg-indigo-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                {heldBillsCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main Billing Workspace: Search & High-Speed Items Grid */}
      <div className="flex flex-1 flex-col rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Product / Barcode Search Bar */}
        <div className="relative border-b border-slate-200 p-3 bg-slate-50/70">
          <div className="relative flex items-center">
            <Search className="absolute left-3.5 h-4 w-4 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleBarcodeOrEnter}
              onFocus={() => {
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
              placeholder="Scan barcode or type medicine / product name (Press Enter)... [F1]"
              className="w-full rounded-md border border-slate-300 bg-white pl-10 pr-24 py-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 shadow-sm"
            />
            <div className="absolute right-3 flex items-center gap-1.5 text-[11px] text-slate-400">
              <Barcode className="h-4 w-4 text-slate-500" />
              <span>Scanner Ready</span>
            </div>
          </div>

          {/* Search Dropdown Results rendered in React Portal to escape overflow & stacking contexts */}
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
              className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-2xl divide-y divide-slate-100"
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
                        ? "bg-blue-50/90 text-blue-900 border-l-4 border-l-blue-600 pl-3"
                        : "hover:bg-slate-50 text-slate-800"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className={`font-semibold ${isSelected ? "text-blue-950 font-bold" : "text-slate-800"}`}>
                          {prod.name}
                        </p>
                        {prod.generic_name && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 font-normal">
                            {prod.generic_name}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Barcode: <span className="font-mono text-slate-600">{prod.barcode}</span>{" "}
                        {prod.hsn_sac_code ? `| HSN: ${prod.hsn_sac_code}` : ""} | GST: {prod.gst_percent}%
                      </p>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="font-bold text-slate-900 text-sm">₹ {(prod.sel_rate || prod.mrp).toFixed(2)}</p>
                      <p
                        className={`text-[10px] font-medium ${
                          (prod.current_stock || 0) > 0 ? "text-emerald-600" : "text-rose-500"
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

        {/* POS Grid Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-100/90 backdrop-blur-sm border-b border-slate-200 text-slate-700">
              <tr>
                <th className="px-3 py-2 w-10 text-center">#</th>
                <th className="px-3 py-2">Product Name</th>
                <th className="px-3 py-2 w-28">Batch</th>
                <th className="px-3 py-2 w-24">Expiry</th>
                <th className="px-3 py-2 w-28 text-center">Qty</th>
                <th className="px-3 py-2 w-24 text-right">MRP</th>
                <th className="px-3 py-2 w-24 text-right">Rate</th>
                <th className="px-3 py-2 w-20 text-center">GST %</th>
                <th className="px-3 py-2 w-28 text-right font-semibold">Total (₹)</th>
                <th className="px-3 py-2 w-12 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-slate-400">
                    <Barcode className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    <p className="font-medium">Billing cart is empty</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Scan a barcode or type a product name to begin billing</p>
                  </td>
                </tr>
              ) : (
                lines.map((line, idx) => (
                  <tr key={line.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 text-center text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-2 font-semibold text-slate-800">
                      {line.product.name}
                      {line.product.units_per_pack > 1 && (
                        <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 font-normal">
                          {line.product.units_per_pack}s
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{line.selectedBatch.batch_no}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{line.selectedBatch.expiry_date}</td>
                    <td className="px-3 py-2 text-center">
                      <div className="inline-flex items-center rounded border border-slate-200 bg-white">
                        <button
                          onClick={() => updateQuantity(line.id, -1)}
                          className="px-1.5 py-0.5 hover:bg-slate-100 text-slate-600"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="px-2 font-bold text-slate-800">{line.qty}</span>
                        <button
                          onClick={() => updateQuantity(line.id, 1)}
                          className="px-1.5 py-0.5 hover:bg-slate-100 text-slate-600"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">₹ {line.product.mrp.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-700">₹ {line.unit_price.toFixed(2)}</td>
                    <td className="px-3 py-2 text-center text-slate-600">{line.product.gst_percent}%</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">
                      ₹ {line.calculated.total_amount.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => removeLine(line.id)}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom Totals & Settlement Bar */}
        <div className="flex flex-wrap items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-6 text-xs text-slate-600">
            <div>
              <span className="text-slate-400">Items: </span>
              <span className="font-bold text-slate-800">{lines.length}</span>
            </div>
            <div>
              <span className="text-slate-400">Subtotal: </span>
              <span className="font-bold text-slate-800">₹ {totals.taxable_subtotal.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-slate-400">GST Tax: </span>
              <span className="font-bold text-slate-800">₹ {totals.total_tax.toFixed(2)}</span>
            </div>
            {totals.round_off !== 0 && (
              <div>
                <span className="text-slate-400">Round-off: </span>
                <span className="font-semibold text-slate-700">
                  {totals.round_off > 0 ? `+₹${totals.round_off.toFixed(2)}` : `-₹${Math.abs(totals.round_off).toFixed(2)}`}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Net Payable</span>
              <p className="text-xl font-black text-blue-700">₹ {totals.grand_total.toFixed(2)}</p>
            </div>

            <button
              onClick={openTenderModal}
              disabled={lines.length === 0}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50 transition-all"
            >
              <CreditCard className="h-4 w-4" />
              <span>Checkout & Pay (F12)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Batch Selection Modal (FEFO Order with keyboard navigation & ARIA listbox) */}
      {selectedProductForBatch && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-lg rounded-lg bg-white shadow-2xl overflow-hidden border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 bg-slate-50">
              <div>
                <h3 id="batch-modal-title" className="text-xs font-bold text-slate-800">
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
                const selectable = isBatchSelectable(b);
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
                          isOutOfStock ? "This batch is out of stock" : "This batch has expired and cannot be billed",
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
                          <span className="rounded bg-slate-200 px-1.5 py-0.2 text-[10px] font-semibold text-slate-600">
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
                          selectable
                            ? "bg-emerald-50 text-emerald-700"
                            : isExpired
                            ? "bg-rose-50 text-rose-600"
                            : "bg-slate-100 text-slate-500"
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
                  onClick={closeBatchModal}
                  className="rounded px-2.5 py-1 text-slate-600 hover:bg-slate-200 text-xs"
                >
                  Cancel (Esc)
                </button>
                <button
                  type="button"
                  disabled={
                    productBatches.length === 0 || !isBatchSelectable(productBatches[selectedBatchIndex])
                  }
                  onClick={() => {
                    const b = productBatches[selectedBatchIndex];
                    if (b && isBatchSelectable(b)) {
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
      )}

      {/* Tender / Settlement Modal (F12) */}
      {isTenderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl overflow-hidden border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Bill Settlement</h3>
                <p className="text-[11px] text-slate-500">Invoice: {invoiceNumber}</p>
              </div>
              <button onClick={() => setIsTenderModalOpen(false)} className="text-slate-400 hover:text-slate-600">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl overflow-hidden border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 bg-slate-50">
              <h3 className="text-xs font-bold text-slate-800">Recall Held Bills</h3>
              <button onClick={() => setIsRecallModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
              {billingTenderService.listHeldBills().length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">No bills are currently on hold.</div>
              ) : (
                billingTenderService.listHeldBills().map((b) => (
                  <div
                    key={b.id}
                    onClick={() => handleRecallBill(b.id)}
                    className="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-blue-50 text-xs transition-colors"
                  >
                    <div>
                      <p className="font-semibold text-slate-800">{b.customer_name}</p>
                      <p className="text-[11px] text-slate-400">
                        {b.items_count} items | Held: {new Date(b.held_at).toLocaleTimeString()}
                      </p>
                    </div>
                    <span className="rounded bg-blue-100 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                      Recall →
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

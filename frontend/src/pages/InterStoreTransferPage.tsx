import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  ArrowRightLeft,
  Search,
  Plus,
  Minus,
  Trash2,
  Copy,
  Split,
  FileSpreadsheet,
  Printer,
  Save,
  Send,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Building2,
  Truck,
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
  X,
  History,
  Inbox,
  PackageCheck,
  Tag,
  Clock,
  Sparkles,
  Barcode,
} from "lucide-react";
import {
  interStoreTransferService,
  type InterStoreTransfer,
  type InterStoreTransferLine,
  type TransferRateBasis,
  type TransferStatus,
  type TransferGstTreatment,
  type TransportDetails,
} from "../lib/stock/interStoreTransferService";
import { storeService, type BranchStore } from "../lib/masters/storeService";
import { productsStore, isBatchExpired, isBatchSelectable, type ProductItem, type ProductBatch } from "../lib/masters/productsStore";
import { companySettingsService } from "../lib/settings/companySettingsService";
import { sqliteStorage } from "../lib/db/sqliteStorage";
import { SmartQtyInput } from "../components/SmartQtyInput";
import { PrintPreviewModal } from "../components/PrintPreviewModal";
import { CsvTransferImportModal } from "../components/CsvTransferImportModal";
import { TransferReceiptModal } from "../components/TransferReceiptModal";
import type { InvoicePrintData } from "../lib/printing/printingEngine";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

export const InterStoreTransferPage: React.FC = () => {
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<"new_transfer" | "outgoing" | "incoming" | "history">("new_transfer");

  // Stores
  const [stores, setStores] = useState<BranchStore[]>([]);
  const [sourceStore, setSourceStore] = useState<BranchStore | null>(null);
  const [destStoreId, setDestStoreId] = useState<string>("");

  // Transfer Metadata
  const [transferId, setTransferId] = useState<string | null>(null);
  const [transferNo, setTransferNo] = useState<string>("");
  const [transferDate, setTransferDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>("");
  const [rateBasis, setRateBasis] = useState<TransferRateBasis>("sel_rate");
  const [notes, setNotes] = useState<string>("");
  const [isTransportOpen, setIsTransportOpen] = useState(false);
  const [transport, setTransport] = useState<TransportDetails>({
    transporter_name: "",
    vehicle_number: "",
    lr_number: "",
    eway_bill_number: "",
    driver_name: "",
    driver_phone: "",
  });

  // Transfer Lines & Focus
  const [lines, setLines] = useState<InterStoreTransferLine[]>([]);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [undoDeleteBuffer, setUndoDeleteBuffer] = useState<{ line: InterStoreTransferLine; index: number } | null>(null);

  // Search & Batch Selector Modal
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProductItem[]>([]);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const [batchModalProduct, setBatchModalProduct] = useState<ProductItem | null>(null);
  useModalEscape(Boolean(batchModalProduct), () => setBatchModalProduct(null));
  const [availableBatches, setAvailableBatches] = useState<ProductBatch[]>([]);
  const [selectedBatchIndex, setSelectedBatchIndex] = useState(0);

  // Transferred records lists
  const [allTransfers, setAllTransfers] = useState<InterStoreTransfer[]>([]);
  const [transferToReceive, setTransferToReceive] = useState<InterStoreTransfer | null>(null);

  // Helper Modals
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [previewModalState, setPreviewModalState] = useState<{
    isOpen: boolean;
    data: InvoicePrintData | null;
    title?: string;
  }>({
    isOpen: false,
    data: null,
  });

  // Notifications
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "error" | "info" | "warning";
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const batchListRef = useRef<HTMLDivElement>(null);
  const lastKeyTimeRef = useRef<number>(0);
  const scanBufferRef = useRef<string>("");

  const showNotification = (message: string, type: "success" | "error" | "info" | "warning" = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  // Load initial data
  useEffect(() => {
    loadStoresAndTransfers();
  }, []);

  const loadStoresAndTransfers = async () => {
    await storeService.ensureStoresSeeded();
    const allSt = await storeService.getAllStores();
    setStores(allSt);

    const current = await storeService.getCurrentStore();
    setSourceStore(current);

    const destOptions = allSt.filter((s: BranchStore) => s.id !== current.id);
    if (destOptions.length > 0 && !destStoreId) {
      setDestStoreId(destOptions[0].id);
    }

    if (!transferNo) {
      const nextNo = await companySettingsService.generateNextDocumentNumber("transfer");
      setTransferNo(nextNo);
    }

    const trfs = await interStoreTransferService.getAllTransfers();
    setAllTransfers(trfs);
  };

  const destinationStore = useMemo(() => {
    return stores.find((s) => s.id === destStoreId) || null;
  }, [stores, destStoreId]);

  const gstTreatment: TransferGstTreatment = useMemo(() => {
    if (!sourceStore || !destinationStore) return "intra_state";
    const evalResult = storeService.determineGstTreatment(sourceStore, destinationStore);
    return evalResult.treatment;
  }, [sourceStore, destinationStore]);

  const gstTreatmentInfo = useMemo(() => {
    if (!sourceStore || !destinationStore) return { label: "Intra-State", desc: "" };
    const evalResult = storeService.determineGstTreatment(sourceStore, destinationStore);
    return {
      label: evalResult.treatment === "inter_state" ? "Inter-State (IGST)" : "Intra-State (Rule 55 Challan)",
      desc: evalResult.description,
    };
  }, [sourceStore, destinationStore]);

  // Aggregate totals
  const totals = useMemo(() => {
    return interStoreTransferService.recomputeTransferTotals(lines);
  }, [lines]);

  // Search autocomplete
  useEffect(() => {
    if (searchQuery.trim().length === 0) {
      setSearchResults([]);
      setSelectedSearchIndex(0);
      return;
    }

    const timer = setTimeout(async () => {
      const results = await productsStore.searchProducts(searchQuery);
      setSearchResults(results.slice(0, 10));
      setSelectedSearchIndex(0);
    }, 80);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Keyboard navigation for batch modal
  useEffect(() => {
    if (!batchModalProduct) return;

    const handleBatchKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedBatchIndex((prev) => Math.min(availableBatches.length - 1, prev + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedBatchIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const b = availableBatches[selectedBatchIndex];
        if (b) {
          addBatchLineToTransfer(batchModalProduct, b);
          setBatchModalProduct(null);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setBatchModalProduct(null);
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleBatchKey);
    return () => window.removeEventListener("keydown", handleBatchKey);
  }, [batchModalProduct, availableBatches, selectedBatchIndex]);

  // Global POS / Transfer hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      const keyLower = e.key.toLowerCase();
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      if (batchModalProduct || isCsvModalOpen || isReceiptModalOpen || previewModalState.isOpen) {
        return;
      }

      // 1. Hardware Barcode Scanner Fast-Keystroke Interceptor (< 45ms per keystroke)
      const now = Date.now();
      const interval = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === "Enter" && scanBufferRef.current.length >= 3 && interval < 60) {
        const scanned = scanBufferRef.current;
        scanBufferRef.current = "";
        e.preventDefault();
        e.stopPropagation();
        productsStore.findProductByBarcode(scanned).then(async (matched: ProductItem | null) => {
          if (matched) {
            await handleSelectProductForBatch(matched);
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

      // F1 / Alt+1 / Cmd+K: Focus Search
      if (
        (e.key === "F1" && !e.ctrlKey && !e.altKey && !e.shiftKey) ||
        (e.altKey && (e.key === "1" || code === "Digit1")) ||
        (isCmdOrCtrl && (keyLower === "k" || code === "KeyK"))
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // F12 or Ctrl+Enter: Dispatch Transfer
      if (e.key === "F12" || (isCmdOrCtrl && e.key === "Enter")) {
        e.preventDefault();
        handleDispatch();
        return;
      }

      // Ctrl+S / Cmd+S: Save Draft
      if (isCmdOrCtrl && (keyLower === "s" || code === "KeyS")) {
        e.preventDefault();
        handleSaveDraft();
        return;
      }

      // Ctrl+P / Cmd+P: Print Challan
      if (isCmdOrCtrl && (keyLower === "p" || code === "KeyP")) {
        e.preventDefault();
        handlePrintPreview();
        return;
      }

      // Ctrl+Z / Cmd+Z: Undo Delete
      if (isCmdOrCtrl && (keyLower === "z" || code === "KeyZ")) {
        if (undoDeleteBuffer) {
          e.preventDefault();
          handleUndoDelete();
          return;
        }
      }

      // Grid navigation when a row is selected
      if (selectedRowIndex !== null && selectedRowIndex >= 0 && selectedRowIndex < lines.length) {
        // Ctrl+D / Delete: Delete selected line
        if ((isCmdOrCtrl && (keyLower === "d" || code === "KeyD")) || e.key === "Delete") {
          e.preventDefault();
          handleDeleteLine(selectedRowIndex);
          return;
        }

        // Alt+D: Duplicate selected line
        if (e.altKey && (keyLower === "d" || code === "KeyD")) {
          e.preventDefault();
          handleDuplicateLine(selectedRowIndex);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    lines,
    selectedRowIndex,
    undoDeleteBuffer,
    batchModalProduct,
    isCsvModalOpen,
    isReceiptModalOpen,
    previewModalState.isOpen,
  ]);

  const handleSelectProductForBatch = async (product: ProductItem) => {
    const batches = await productsStore.getBatchesForProduct(product.id, false);
    if (batches.length === 0) {
      showNotification(`No stock batches available for ${product.name}`, "error");
      return;
    }

    // Sort in FEFO order (First Expiring First Out)
    const sorted = [...batches].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
    setAvailableBatches(sorted);
    setBatchModalProduct(product);
    setSelectedBatchIndex(0);
  };

  const addBatchLineToTransfer = async (product: ProductItem, batch: ProductBatch) => {
    const line = await interStoreTransferService.buildTransferLine(
      product,
      batch,
      1, // default 1 pack
      0,
      lines.length + 1,
      rateBasis,
      undefined,
      gstTreatment
    );

    setLines((prev) => [...prev, line]);
    setSearchQuery("");
    setSearchResults([]);
    showNotification(`Added ${product.name} (Batch: ${batch.batch_no})`);

    setTimeout(() => {
      const el = document.getElementById(`transfer-qty-${line.id}-pack`) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 50);
  };

  const handleLineQtyChange = async (lineId: string, packs: number, loose: number) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;

        const dummyProd: ProductItem = {
          id: l.product_id,
          name: l.product_name,
          barcode: l.barcode || "",
          sel_rate: l.unit_rate,
          mrp: l.mrp,
          gst_percent: l.gst_percent,
          units_per_pack: l.units_per_pack,
          is_active: true,
        };

        const dummyBatch: ProductBatch = {
          id: l.batch_id,
          product_id: l.product_id,
          batch_no: l.batch_no,
          expiry_date: l.expiry_date,
          stock_qty: l.available_stock_total,
          mrp: l.mrp,
          selling_rate: l.unit_rate,
          purchase_rate: l.purchase_rate,
        };

        const financials = interStoreTransferService.calculateLineFinancials(
          dummyProd,
          dummyBatch,
          packs,
          loose,
          l.rate_basis,
          l.unit_rate,
          gstTreatment
        );

        const remaining = l.available_stock_total - financials.transfer_total_qty;
        const warnings: string[] = [];
        if (financials.transfer_total_qty > l.available_stock_total) {
          warnings.push(`Exceeds available stock (${l.available_stock_total} units)`);
        }

        return {
          ...l,
          transfer_packs: packs,
          transfer_loose: loose,
          transfer_total_qty: financials.transfer_total_qty,
          remaining_stock_total: remaining,
          taxable_amount: financials.taxable_amount,
          cgst_amount: financials.cgst_amount,
          sgst_amount: financials.sgst_amount,
          igst_amount: financials.igst_amount,
          total_amount: financials.total_amount,
          warnings,
        };
      })
    );
  };

  const handleRateBasisChange = async (newBasis: TransferRateBasis) => {
    setRateBasis(newBasis);
    // Recalculate all lines with new rate basis
    const updatedLines: InterStoreTransferLine[] = [];
    for (const l of lines) {
      const prod = await productsStore.getProductById(l.product_id);
      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", l.batch_id);
      if (prod && batch) {
        const recomputed = await interStoreTransferService.buildTransferLine(
          prod,
          batch,
          l.transfer_packs,
          l.transfer_loose,
          l.line_no,
          newBasis,
          undefined,
          gstTreatment
        );
        updatedLines.push(recomputed);
      } else {
        updatedLines.push(l);
      }
    }
    setLines(updatedLines);
    showNotification(`Switched transfer rate basis to ${newBasis.toUpperCase()}`);
  };

  const handleAutoSplitLine = async (line: InterStoreTransferLine) => {
    try {
      const splitLines = await interStoreTransferService.autoSplitAcrossBatches(
        line.product_id,
        line.transfer_packs,
        line.transfer_loose,
        rateBasis,
        gstTreatment
      );

      if (splitLines.length <= 1) {
        showNotification("Quantity fits within the current batch or no other batches exist", "info");
        return;
      }

      setLines((prev) => {
        const idx = prev.findIndex((l) => l.id === line.id);
        const next = [...prev];
        next.splice(idx, 1, ...splitLines);
        return next;
      });

      showNotification(`Auto-split ${line.product_name} into ${splitLines.length} FEFO batch lines!`, "success");
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Error auto-splitting line", "error");
    }
  };

  const handleDeleteLine = (index: number) => {
    const target = lines[index];
    if (!target) return;
    setUndoDeleteBuffer({ line: target, index });
    setLines((prev) => prev.filter((_, i) => i !== index));
    showNotification(`Removed ${target.product_name}`, "info");
  };

  const handleUndoDelete = () => {
    if (!undoDeleteBuffer) return;
    setLines((prev) => {
      const next = [...prev];
      next.splice(undoDeleteBuffer.index, 0, undoDeleteBuffer.line);
      return next;
    });
    showNotification(`Restored ${undoDeleteBuffer.line.product_name}`, "success");
    setUndoDeleteBuffer(null);
  };

  const handleDuplicateLine = (index: number) => {
    const target = lines[index];
    if (!target) return;
    const duplicated: InterStoreTransferLine = {
      ...target,
      id: `line_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      line_no: lines.length + 1,
    };
    setLines((prev) => [...prev, duplicated]);
    showNotification(`Duplicated ${target.product_name}`);
  };

  const handleSaveDraft = async () => {
    if (lines.length === 0) {
      showNotification("Please add at least one line item to save a draft", "error");
      return;
    }

    try {
      if (transferId) {
        const updated = await interStoreTransferService.updateTransfer(transferId, {
          destination_store_id: destStoreId,
          transfer_date: transferDate,
          expected_delivery_date: expectedDeliveryDate,
          transport_details: transport,
          notes,
          default_rate_basis: rateBasis,
          lines,
        });
        showNotification(`Updated draft ${updated.transfer_no}`);
      } else {
        const created = await interStoreTransferService.createDraft({
          transfer_no: transferNo,
          transfer_date: transferDate,
          expected_delivery_date: expectedDeliveryDate,
          destination_store_id: destStoreId,
          transport_details: transport,
          notes,
          default_rate_basis: rateBasis,
          lines: lines.map((l) => ({
            product_id: l.product_id,
            batch_id: l.batch_id,
            transfer_packs: l.transfer_packs,
            transfer_loose: l.transfer_loose,
            rate_basis: l.rate_basis,
            unit_rate: l.unit_rate,
          })),
        });
        setTransferId(created.id);
        showNotification(`Draft ${created.transfer_no} saved!`);
      }
      loadStoresAndTransfers();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Error saving draft", "error");
    }
  };

  const handleDispatch = async () => {
    if (lines.length === 0) {
      showNotification("Cannot dispatch empty transfer. Add items first.", "error");
      return;
    }

    // Check for stock errors
    const invalidStockLine = lines.find((l) => l.transfer_total_qty > l.available_stock_total);
    if (invalidStockLine) {
      showNotification(
        `Cannot dispatch: ${invalidStockLine.product_name} exceeds available stock (${invalidStockLine.available_stock_total} units)`,
        "error"
      );
      return;
    }

    // Validate 12-digit e-Way Bill number if entered
    if (transport.eway_bill_number && transport.eway_bill_number.trim()) {
      const cleanEway = transport.eway_bill_number.trim().replace(/\D/g, "");
      if (cleanEway.length !== 12) {
        showNotification(
          "Invalid e-Way Bill format: Statutory GST e-Way Bill must be exactly 12 numeric digits",
          "error"
        );
        return;
      }
    }

    try {
      let activeTransferId = transferId;
      if (!activeTransferId) {
        const draft = await interStoreTransferService.createDraft({
          transfer_no: transferNo,
          transfer_date: transferDate,
          expected_delivery_date: expectedDeliveryDate,
          destination_store_id: destStoreId,
          transport_details: transport,
          notes,
          default_rate_basis: rateBasis,
          lines: lines.map((l) => ({
            product_id: l.product_id,
            batch_id: l.batch_id,
            transfer_packs: l.transfer_packs,
            transfer_loose: l.transfer_loose,
            rate_basis: l.rate_basis,
            unit_rate: l.unit_rate,
          })),
        });
        activeTransferId = draft.id;
      } else {
        await interStoreTransferService.updateTransfer(activeTransferId, {
          destination_store_id: destStoreId,
          transfer_date: transferDate,
          expected_delivery_date: expectedDeliveryDate,
          transport_details: transport,
          notes,
          default_rate_basis: rateBasis,
          lines,
        });
      }

      const dispatched = await interStoreTransferService.dispatchTransfer(activeTransferId);
      showNotification(`Dispatched ${dispatched.transfer_no}! Source stock deducted into In-Transit.`, "success");

      // Auto-open print preview
      const printData = interStoreTransferService.generateTransferPrintData(dispatched);
      setPreviewModalState({
        isOpen: true,
        data: printData,
        title: `Delivery Challan / Stock Transfer Note - ${dispatched.transfer_no}`,
      });

      // Reset form
      resetForm();
      loadStoresAndTransfers();
      setActiveTab("outgoing");
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Error dispatching transfer", "error");
    }
  };

  const handlePrintPreview = () => {
    if (lines.length === 0) {
      showNotification("Add items before printing delivery challan", "error");
      return;
    }

    const dummyTransfer: InterStoreTransfer = {
      id: transferId || "temp",
      transfer_no: transferNo,
      transfer_date: transferDate,
      source_store_id: sourceStore?.id || "store_main",
      source_store_name: sourceStore?.name || "Main Store",
      source_store_gstin: sourceStore?.gstin || "",
      source_store_address: sourceStore?.address || "",
      source_store_state_code: sourceStore?.state_code || "32",
      destination_store_id: destinationStore?.id || "store_dest",
      destination_store_name: destinationStore?.name || "Destination Store",
      destination_store_gstin: destinationStore?.gstin || "",
      destination_store_address: destinationStore?.address || "",
      destination_store_state_code: destinationStore?.state_code || "32",
      transport_details: transport,
      notes,
      status: "draft",
      default_rate_basis: rateBasis,
      gst_treatment: gstTreatment,
      lines,
      item_count: totals.item_count,
      total_transfer_qty: totals.total_transfer_qty,
      total_transfer_packs: totals.total_transfer_packs,
      taxable_subtotal: totals.taxable_subtotal,
      total_tax: totals.total_tax,
      cgst_total: totals.cgst_total,
      sgst_total: totals.sgst_total,
      igst_total: totals.igst_total,
      grand_total: totals.grand_total,
      audit_logs: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const printData = interStoreTransferService.generateTransferPrintData(dummyTransfer);
    setPreviewModalState({
      isOpen: true,
      data: printData,
      title: `Delivery Challan Preview - ${dummyTransfer.transfer_no}`,
    });
  };

  const resetForm = async () => {
    setTransferId(null);
    const nextNo = await companySettingsService.generateNextDocumentNumber("transfer");
    setTransferNo(nextNo);
    setLines([]);
    setNotes("");
    setExpectedDeliveryDate("");
    setTransport({
      transporter_name: "",
      vehicle_number: "",
      lr_number: "",
      eway_bill_number: "",
      driver_name: "",
      driver_phone: "",
    });
    setSelectedRowIndex(null);
  };

  const handleAddNearExpiryStock = async () => {
    try {
      const batches = await interStoreTransferService.getNearExpirySuggestions(60);
      if (batches.length === 0) {
        showNotification("No near-expiry batches (within 60 days) found in stock", "info");
        return;
      }

      const newLines: InterStoreTransferLine[] = [];
      for (const b of batches.slice(0, 15)) {
        const prod = await productsStore.getProductById(b.product_id);
        if (prod) {
          const l = await interStoreTransferService.buildTransferLine(
            prod,
            b,
            Math.floor(b.stock_qty / (prod.units_per_pack || 1)),
            b.stock_qty % (prod.units_per_pack || 1),
            lines.length + newLines.length + 1,
            rateBasis,
            undefined,
            gstTreatment
          );
          newLines.push(l);
        }
      }

      setLines((prev) => [...prev, ...newLines]);
      showNotification(`Added ${newLines.length} near-expiry batches to transfer!`, "success");
    } catch (err) {
      showNotification("Error loading near-expiry batches", "error");
    }
  };

  const handleAddLowStockAtDest = async () => {
    try {
      const lowProds = await interStoreTransferService.getLowStockSuggestions(destStoreId);
      if (lowProds.length === 0) {
        showNotification("No reorder stock items needed at destination", "info");
        return;
      }

      const newLines: InterStoreTransferLine[] = [];
      for (const p of lowProds.slice(0, 10)) {
        const batches = await productsStore.getBatchesForProduct(p.id, false);
        const topBatch = batches.find((b: ProductBatch) => b.stock_qty > 0);
        if (topBatch) {
          const l = await interStoreTransferService.buildTransferLine(
            p,
            topBatch,
            2, // Default 2 packs
            0,
            lines.length + newLines.length + 1,
            rateBasis,
            undefined,
            gstTreatment
          );
          newLines.push(l);
        }
      }

      setLines((prev) => [...prev, ...newLines]);
      showNotification(`Added ${newLines.length} suggested products to transfer`, "success");
    } catch (err) {
      showNotification("Error loading low stock suggestions", "error");
    }
  };

  const handleResumeDraft = (transfer: InterStoreTransfer) => {
    setTransferId(transfer.id);
    setTransferNo(transfer.transfer_no);
    setTransferDate(transfer.transfer_date);
    setExpectedDeliveryDate(transfer.expected_delivery_date || "");
    setDestStoreId(transfer.destination_store_id);
    setRateBasis(transfer.default_rate_basis);
    setTransport(transfer.transport_details || {});
    setNotes(transfer.notes || "");
    setLines(transfer.lines);
    setActiveTab("new_transfer");
    showNotification(`Resumed draft ${transfer.transfer_no}`);
  };

  const handleCancelDispatchedTransfer = async (transfer: InterStoreTransfer) => {
    const reason = window.prompt("Enter cancellation reason (stock will be restored to source):", "Cancelled by manager");
    if (!reason) return;

    try {
      await interStoreTransferService.cancelTransfer(transfer.id, reason);
      showNotification(`Cancelled transfer ${transfer.transfer_no} and restored source inventory!`, "info");
      loadStoresAndTransfers();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Error cancelling transfer", "error");
    }
  };

  const handleConfirmReceipt = async (receiptLines: any[]) => {
    if (!transferToReceive) return;
    try {
      await interStoreTransferService.receiveTransfer(transferToReceive.id, receiptLines);
      showNotification(`Successfully received and verified transfer ${transferToReceive.transfer_no}!`, "success");
      setIsReceiptModalOpen(false);
      setTransferToReceive(null);
      loadStoresAndTransfers();
      setActiveTab("history");
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Error receiving transfer", "error");
    }
  };

  // Filter outgoing and incoming lists
  const outgoingTransfers = allTransfers.filter(
    (t) => sourceStore && t.source_store_id === sourceStore.id
  );
  const incomingTransfers = allTransfers.filter(
    (t) => sourceStore && t.destination_store_id === sourceStore.id && (t.status === "dispatched" || t.status === "in_transit" || t.status === "partially_received")
  );

  return (
    <div className="space-y-4 font-sans select-none pb-12">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-btn px-4 py-3 text-xs font-semibold shadow-modal transition-all ${
            notification.type === "success"
              ? "bg-accent-soft text-accent border border-accent/20"
              : notification.type === "error"
              ? "bg-status-danger/10 text-status-danger border border-status-danger/20"
              : "bg-surface text-text-main border border-border-main"
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

      {/* Main Header & Tab Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-main pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-btn bg-accent text-white shadow-xs">
            <ArrowRightLeft className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[26px] font-bold text-text-main tracking-tight flex items-center gap-2">
              <span>Inter-Store Stock Transfers</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-accent-soft text-accent font-mono font-semibold">
                Multi-Product
              </span>
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Bulk branch dispatch, FEFO auto-split, in-transit tracking, Rule 55 delivery challan, and line variance reconciler.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1.5 rounded-btn bg-canvas p-1 border border-border-main text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("new_transfer")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-btn transition-all cursor-pointer ${
              activeTab === "new_transfer"
                ? "bg-surface text-accent shadow-xs border border-border-main/50"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Transfer</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("outgoing")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-btn transition-all cursor-pointer ${
              activeTab === "outgoing"
                ? "bg-surface text-accent shadow-xs border border-border-main/50"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            <Truck className="h-3.5 w-3.5" />
            <span>Outgoing ({outgoingTransfers.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("incoming")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-btn transition-all cursor-pointer ${
              activeTab === "incoming"
                ? "bg-surface text-accent shadow-xs border border-border-main/50"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            <Inbox className="h-3.5 w-3.5 text-accent" />
            <span>Incoming Receipts ({incomingTransfers.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-btn transition-all cursor-pointer ${
              activeTab === "history"
                ? "bg-surface text-accent shadow-xs border border-border-main/50"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>Audit History ({allTransfers.length})</span>
          </button>
        </div>
      </div>

      {/* TAB 1: NEW / EDIT TRANSFER WORKSPACE */}
      {activeTab === "new_transfer" && (
        <div className="space-y-4">
          {/* Header Card: Store Routing & Transfer Meta */}
          <div className="rounded-card border border-border-main bg-surface p-5 shadow-xs space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Source Store */}
              <div>
                <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                  Source Store (From)
                </label>
                <div className="flex items-center gap-2 p-2.5 rounded-btn bg-canvas border border-border-main text-xs">
                  <Building2 className="h-4 w-4 text-accent shrink-0" />
                  <div className="truncate">
                    <p className="font-semibold text-text-main truncate">{sourceStore?.name || "Main Store"}</p>
                    <p className="text-[10px] text-text-muted font-mono">{sourceStore?.gstin || "GSTIN: N/A"}</p>
                  </div>
                </div>
              </div>

              {/* Destination Branch Store */}
              <div>
                <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                  Destination Branch (To) *
                </label>
                <select
                  value={destStoreId}
                  onChange={(e) => setDestStoreId(e.target.value)}
                  className="w-full rounded-btn border border-border-main bg-surface p-2.5 text-xs font-semibold text-text-main focus:border-accent focus:outline-none"
                >
                  {stores
                    .filter((s) => !sourceStore || s.id !== sourceStore.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.city})
                      </option>
                    ))}
                </select>
                <div className="mt-1 flex items-center justify-between text-[10px]">
                  <span className="font-semibold text-accent">{gstTreatmentInfo.label}</span>
                  <span className="text-text-muted font-mono">{destinationStore?.gstin || ""}</span>
                </div>
              </div>

              {/* Transfer No & Date */}
              <div>
                <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                  Transfer No & Date
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={transferNo}
                    onChange={(e) => setTransferNo(e.target.value)}
                    placeholder="TRF-001"
                    className="w-1/2 rounded-btn border border-border-main bg-surface p-2 text-xs font-mono font-bold text-text-main focus:border-accent focus:outline-none tabular-nums"
                  />
                  <input
                    type="date"
                    value={transferDate}
                    onChange={(e) => setTransferDate(e.target.value)}
                    className="w-1/2 rounded-btn border border-border-main bg-surface p-2 text-xs font-medium text-text-main focus:border-accent focus:outline-none font-mono tabular-nums"
                  />
                </div>
              </div>

              {/* Rate Basis & Transport toggle */}
              <div>
                <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                  Valuation Rate Basis
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={rateBasis}
                    onChange={(e) => handleRateBasisChange(e.target.value as any)}
                    className="flex-1 rounded-btn border border-border-main bg-surface p-2 text-xs font-semibold text-text-main focus:border-accent focus:outline-none"
                  >
                    <option value="sel_rate">Selling Rate (MRP/Sel)</option>
                    <option value="mrp">Maximum Retail Price (MRP)</option>
                    <option value="ptr">Price to Retailer (PTR)</option>
                    <option value="pts">Price to Stockist (PTS)</option>
                    <option value="cost_price">Cost / Purchase Rate</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setIsTransportOpen((prev) => !prev)}
                    className={`px-3 py-2 rounded-btn border text-xs font-medium flex items-center gap-1 transition-colors ${
                      isTransportOpen || transport.vehicle_number
                        ? "bg-accent-soft text-accent border-accent/20"
                        : "bg-surface text-text-main border-border-main hover:bg-canvas"
                    }`}
                  >
                    <Truck className="h-3.5 w-3.5" />
                    <span>Transport</span>
                    {isTransportOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Transport Details Collapsible Accordion */}
            {isTransportOpen && (
              <div className="rounded-card border border-border-main bg-canvas p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                    <Truck className="h-4 w-4 text-accent" />
                    <span>Logistics & Vehicle Details (Printed on Delivery Challan)</span>
                  </h4>
                  <span className="text-[11px] text-text-muted font-medium">Optional for internal dispatch</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-6 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted mb-0.5">Vehicle Number</label>
                    <input
                      type="text"
                      placeholder="e.g. KL-09-AB-1234"
                      value={transport.vehicle_number || ""}
                      onChange={(e) => setTransport({ ...transport, vehicle_number: e.target.value })}
                      className="w-full rounded-btn border border-border-main bg-surface p-1.5 text-xs font-mono font-bold text-text-main focus:border-accent focus:outline-none tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted mb-0.5">Transporter Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Swift Roadways"
                      value={transport.transporter_name || ""}
                      onChange={(e) => setTransport({ ...transport, transporter_name: e.target.value })}
                      className="w-full rounded-btn border border-border-main bg-surface p-1.5 text-xs text-text-main focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted mb-0.5">LR / Bilty No</label>
                    <input
                      type="text"
                      placeholder="LR-9821"
                      value={transport.lr_number || ""}
                      onChange={(e) => setTransport({ ...transport, lr_number: e.target.value })}
                      className="w-full rounded-btn border border-border-main bg-surface p-1.5 text-xs font-mono text-text-main focus:border-accent focus:outline-none tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted mb-0.5">E-Way Bill No</label>
                    <input
                      type="text"
                      placeholder="12-digit E-Way Bill"
                      value={transport.eway_bill_number || ""}
                      onChange={(e) => setTransport({ ...transport, eway_bill_number: e.target.value })}
                      className="w-full rounded-btn border border-border-main bg-surface p-1.5 text-xs font-mono text-text-main focus:border-accent focus:outline-none tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted mb-0.5">Driver Name</label>
                    <input
                      type="text"
                      placeholder="Driver name"
                      value={transport.driver_name || ""}
                      onChange={(e) => setTransport({ ...transport, driver_name: e.target.value })}
                      className="w-full rounded-btn border border-border-main bg-surface p-1.5 text-xs text-text-main focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted mb-0.5">Expected Delivery</label>
                    <input
                      type="date"
                      value={expectedDeliveryDate}
                      onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                      className="w-full rounded-btn border border-border-main bg-surface p-1.5 text-xs text-text-main focus:border-accent focus:outline-none font-mono tabular-nums"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Search Bar & Fast Product Picker */}
          <div className="relative">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Scan Barcode or Search Products to Transfer (Press F1 / Type name)..."
                  className="w-full rounded-btn border border-border-main bg-surface py-2.5 pl-10 pr-24 text-xs font-medium text-text-main shadow-xs focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono font-medium text-text-muted bg-canvas px-2 py-0.5 rounded border border-border-main">
                  F1 / Scan
                </span>
              </div>

              {/* Bulk helpers buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsCsvModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-btn bg-surface hover:bg-canvas text-text-main text-xs font-medium border border-border-main shadow-xs transition-colors"
                  title="Import products and quantities from CSV / Excel"
                >
                  <FileSpreadsheet className="h-4 w-4 text-accent" />
                  <span>Import Excel</span>
                </button>
                <button
                  type="button"
                  onClick={handleAddLowStockAtDest}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-btn bg-surface hover:bg-accent-soft hover:text-accent text-text-main text-xs font-medium border border-border-main shadow-xs transition-colors"
                  title="Auto-load products below reorder level at destination store"
                >
                  <Sparkles className="h-4 w-4 text-accent" />
                  <span>Low Stock at Dest</span>
                </button>
                <button
                  type="button"
                  onClick={handleAddNearExpiryStock}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-btn bg-surface hover:bg-status-warning/10 hover:text-status-warning text-text-main text-xs font-medium border border-border-main shadow-xs transition-colors"
                  title="Transfer source batches expiring within 60 days"
                >
                  <Calendar className="h-4 w-4 text-status-warning" />
                  <span>Near Expiry</span>
                </button>
              </div>
            </div>

            {/* Product Auto-Complete Dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-card bg-surface shadow-dropdown border border-border-main overflow-hidden divide-y divide-border-main max-h-64 overflow-y-auto">
                {searchResults.map((prod, idx) => (
                  <div
                    key={prod.id}
                    onClick={() => handleSelectProductForBatch(prod)}
                    className={`flex items-center justify-between px-4 py-2.5 text-xs cursor-pointer transition-colors ${
                      idx === selectedSearchIndex ? "bg-accent-soft text-accent font-semibold" : "hover:bg-canvas text-text-main"
                    }`}
                  >
                    <div>
                      <div className="font-semibold">{prod.name}</div>
                      <div className="text-[11px] text-text-muted flex items-center gap-2">
                        <span className="font-mono tabular-nums">Barcode: {prod.barcode}</span>
                        <span>•</span>
                        <span>Pack: {prod.units_per_pack || 1} units</span>
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <div className="font-bold text-text-main">₹{prod.sel_rate}</div>
                      <div className="text-[10px] text-accent font-medium">Stock: {prod.current_stock || 0}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Lines Table Grid */}
          <div className="rounded-card border border-border-main bg-surface overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-canvas border-b border-border-main text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="px-4 py-3 w-10 text-center">#</th>
                    <th className="px-4 py-3">Product Name & HSN</th>
                    <th className="px-4 py-3">Batch & Expiry</th>
                    <th className="px-4 py-3 text-center">Available Stock</th>
                    <th className="px-4 py-3 text-center bg-accent-soft/40 text-accent border-x border-border-main">
                      Transfer Qty (Pack + Loose)
                    </th>
                    <th className="px-4 py-3 text-center">Remaining Stock</th>
                    <th className="px-4 py-3 text-right">Rate (₹)</th>
                    <th className="px-4 py-3 text-right">GST %</th>
                    <th className="px-4 py-3 text-right">Total (₹)</th>
                    <th className="px-4 py-3 text-center w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-main">
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-12 text-center text-text-muted">
                        <Layers className="h-8 w-8 mx-auto mb-2 text-text-muted/40" />
                        <p className="font-semibold text-text-main">No transfer lines added yet</p>
                        <p className="text-xs text-text-muted mt-0.5">
                          Search a product above (F1), scan a barcode, or import from Excel to start building this transfer.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    lines.map((line, idx) => {
                      const isSelected = selectedRowIndex === idx;
                      const hasStockError = line.transfer_total_qty > line.available_stock_total;

                      return (
                        <tr
                          key={line.id}
                          id={`transfer-row-${line.id}`}
                          onClick={() => setSelectedRowIndex(idx)}
                          className={`hover:bg-canvas/50 transition-colors ${
                            isSelected ? "bg-accent-soft/30 ring-1 ring-accent/30 font-medium" : ""
                          } ${hasStockError ? "bg-status-danger/5" : ""}`}
                        >
                          <td className="px-4 py-3 text-center text-text-muted font-mono tabular-nums">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-text-main">{line.product_name}</div>
                            <div className="text-[11px] text-text-muted flex items-center gap-2">
                              <span>HSN: {line.hsn_code}</span>
                              {line.barcode && <span>• Barcode: {line.barcode}</span>}
                            </div>
                            {line.warnings.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {line.warnings.map((w, wIdx) => (
                                  <span
                                    key={wIdx}
                                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-status-danger bg-status-danger/10 px-2 py-0.5 rounded-full"
                                  >
                                    <AlertTriangle className="h-3 w-3" />
                                    {w}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-mono font-semibold text-text-main tabular-nums">{line.batch_no}</div>
                            <div className="text-[11px] text-text-muted font-mono tabular-nums">Exp: {line.expiry_date}</div>
                          </td>
                          <td className="px-4 py-3 text-center font-mono font-medium text-text-main tabular-nums">
                            {line.available_stock_packs > 0 && <span>{line.available_stock_packs} pk </span>}
                            {line.available_stock_loose > 0 && <span>{line.available_stock_loose} pc</span>}
                            {line.available_stock_packs === 0 && line.available_stock_loose === 0 && <span>0</span>}
                          </td>

                          {/* Smart Qty Input */}
                          <td className="p-2 text-center bg-accent-soft/20 border-x border-border-main">
                            <div className="inline-block">
                              <SmartQtyInput
                                inputId={`transfer-qty-${line.id}`}
                                packs={line.transfer_packs}
                                loose={line.transfer_loose}
                                unitsPerPack={line.units_per_pack}
                                packName="pk"
                                looseName="pc"
                                allowLoose={line.units_per_pack > 1}
                                onChange={(p, l) => handleLineQtyChange(line.id, p, l)}
                              />
                            </div>
                          </td>

                          <td className="px-4 py-3 text-center">
                            <span
                              className={`font-mono font-bold tabular-nums ${
                                line.remaining_stock_total < 0 ? "text-status-danger" : "text-text-main"
                              }`}
                            >
                              {line.remaining_stock_total} pc
                            </span>
                          </td>

                          <td className="px-4 py-3 text-right font-mono text-text-main tabular-nums">₹{line.unit_rate.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right font-mono text-text-muted tabular-nums">{line.gst_percent}%</td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-text-main tabular-nums">
                            ₹{line.total_amount.toFixed(2)}
                          </td>

                          {/* Actions */}
                          <td className="p-2 text-center">
                            <div className="inline-flex items-center gap-1">
                              {hasStockError && (
                                <button
                                  type="button"
                                  onClick={() => handleAutoSplitLine(line)}
                                  className="p-1 rounded text-status-warning hover:bg-status-warning/10 transition-colors"
                                  title="Auto-split excess quantity across other FEFO batches"
                                >
                                  <Split className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDuplicateLine(idx)}
                                className="p-1 rounded text-text-muted hover:text-accent hover:bg-accent-soft transition-colors"
                                title="Duplicate Line (Alt+D)"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteLine(idx)}
                                className="p-1 rounded text-text-muted hover:text-status-danger hover:bg-status-danger/10 transition-colors"
                                title="Delete Line (Ctrl+D)"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Bottom Totals Bar */}
            <div className="border-t border-border-main bg-canvas px-6 py-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-6 text-xs text-text-muted">
                <div>
                  <span className="text-text-muted">Total Items: </span>
                  <span className="font-mono font-bold text-text-main tabular-nums">{totals.item_count}</span>
                </div>
                <div>
                  <span className="text-text-muted">Total Units: </span>
                  <span className="font-mono font-bold text-text-main tabular-nums">{totals.total_transfer_qty} units</span>
                </div>
                <div>
                  <span className="text-text-muted">Taxable Value: </span>
                  <span className="font-mono font-bold text-text-main tabular-nums">₹{totals.taxable_subtotal.toFixed(2)}</span>
                </div>
                {gstTreatment === "inter_state" ? (
                  <div>
                    <span className="text-text-muted">IGST Tax: </span>
                    <span className="font-mono font-bold text-text-main tabular-nums">₹{totals.igst_total.toFixed(2)}</span>
                  </div>
                ) : (
                  <div>
                    <span className="text-text-muted">CGST + SGST: </span>
                    <span className="font-mono font-bold text-text-main tabular-nums">₹{totals.total_tax.toFixed(2)}</span>
                  </div>
                )}
                <div>
                  <span className="text-text-muted">Grand Total: </span>
                  <span className="text-xl font-mono font-bold text-accent tabular-nums">₹{totals.grand_total.toFixed(2)}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3.5 py-2 rounded-btn border border-border-main bg-surface hover:bg-canvas text-xs font-medium text-text-main transition-colors"
                >
                  Clear Form
                </button>
                <button
                  type="button"
                  onClick={handlePrintPreview}
                  disabled={lines.length === 0}
                  className="px-3.5 py-2 rounded-btn border border-border-main bg-surface hover:bg-canvas text-xs font-semibold text-text-main transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
                  title="Print Delivery Challan (Ctrl+P)"
                >
                  <Printer className="h-4 w-4 text-text-muted" />
                  <span>Challan Preview (Ctrl+P)</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={lines.length === 0}
                  className="px-4 py-2 rounded-btn border border-accent/20 bg-accent-soft hover:bg-accent-soft/80 text-xs font-semibold text-accent transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
                  title="Save Draft (Ctrl+S)"
                >
                  <Save className="h-4 w-4" />
                  <span>Save Draft (Ctrl+S)</span>
                </button>
                <button
                  type="button"
                  onClick={handleDispatch}
                  disabled={lines.length === 0}
                  className="px-5 py-2 rounded-btn bg-accent hover:bg-accent/90 text-xs font-semibold text-white shadow-xs transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  title="Dispatch Transfer (F12)"
                >
                  <Send className="h-4 w-4" />
                  <span>Dispatch Transfer (F12)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: OUTGOING TRANSFERS LIST */}
      {activeTab === "outgoing" && (
        <div className="rounded-card border border-border-main bg-surface overflow-hidden shadow-xs">
          <div className="p-4 border-b border-border-main bg-canvas flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
              <Truck className="h-4 w-4 text-accent" />
              <span>Outgoing Store Transfers from {sourceStore?.name}</span>
            </h3>
            <span className="text-xs text-text-muted font-medium font-mono tabular-nums">Total: {outgoingTransfers.length} records</span>
          </div>

          <div className="divide-y divide-border-main">
            {outgoingTransfers.length === 0 ? (
              <div className="p-12 text-center text-text-muted">
                <Truck className="h-8 w-8 mx-auto mb-2 text-text-muted/40" />
                <p className="font-semibold text-text-main">No outgoing transfers found</p>
                <p className="text-xs text-text-muted mt-0.5">Click 'New Transfer' above to dispatch stock to other branches.</p>
              </div>
            ) : (
              outgoingTransfers.map((tr) => (
                <div key={tr.id} className="p-4 hover:bg-canvas/50 flex flex-wrap items-center justify-between gap-4 text-xs transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-text-main text-sm tabular-nums">{tr.transfer_no}</span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                          tr.status === "dispatched" || tr.status === "in_transit"
                            ? "bg-accent-soft text-accent"
                            : tr.status === "received"
                            ? "bg-accent-soft text-accent"
                            : tr.status === "draft"
                            ? "bg-canvas text-text-muted border border-border-main"
                            : "bg-status-danger/10 text-status-danger"
                        }`}
                      >
                        {tr.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="text-text-muted">
                      Destination: <strong className="text-text-main font-semibold">{tr.destination_store_name}</strong> • Date: <span className="font-mono tabular-nums">{tr.transfer_date}</span>
                    </p>
                    <p className="text-[11px] text-text-muted font-mono tabular-nums">
                      {tr.item_count} items ({tr.total_transfer_qty} units) • Total: ₹{tr.grand_total.toFixed(2)}
                      {tr.transport_details.vehicle_number ? ` • Vehicle: ${tr.transport_details.vehicle_number}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {tr.status === "draft" && (
                      <button
                        type="button"
                        onClick={() => handleResumeDraft(tr)}
                        className="px-3 py-1.5 rounded-btn bg-accent-soft hover:bg-accent-soft/80 text-accent font-semibold transition-colors"
                      >
                        Resume Draft
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const printData = interStoreTransferService.generateTransferPrintData(tr);
                        setPreviewModalState({
                          isOpen: true,
                          data: printData,
                          title: `Delivery Challan - ${tr.transfer_no}`,
                        });
                      }}
                      className="px-3 py-1.5 rounded-btn border border-border-main bg-surface hover:bg-canvas text-text-main font-semibold transition-colors inline-flex items-center gap-1"
                    >
                      <Printer className="h-3.5 w-3.5 text-text-muted" />
                      <span>Print Challan</span>
                    </button>
                    {(tr.status === "dispatched" || tr.status === "in_transit") && (
                      <button
                        type="button"
                        onClick={() => handleCancelDispatchedTransfer(tr)}
                        className="px-3 py-1.5 rounded-btn border border-status-danger/20 bg-status-danger/10 hover:bg-status-danger/20 text-status-danger font-semibold transition-colors"
                      >
                        Cancel & Restore Stock
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: INCOMING RECEIPTS */}
      {activeTab === "incoming" && (
        <div className="rounded-card border border-border-main bg-surface overflow-hidden shadow-xs">
          <div className="p-4 border-b border-border-main bg-canvas flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
              <Inbox className="h-4 w-4 text-accent" />
              <span>Incoming Stock Transfers Arriving at {sourceStore?.name}</span>
            </h3>
            <span className="text-xs text-accent font-semibold font-mono tabular-nums">{incomingTransfers.length} Pending Receipts</span>
          </div>

          <div className="divide-y divide-border-main">
            {incomingTransfers.length === 0 ? (
              <div className="p-12 text-center text-text-muted">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 text-accent" />
                <p className="font-semibold text-text-main">All incoming transfers received and up to date!</p>
                <p className="text-xs text-text-muted mt-0.5">No pending store transfers awaiting receipt at this branch.</p>
              </div>
            ) : (
              incomingTransfers.map((tr) => (
                <div key={tr.id} className="p-5 hover:bg-canvas/50 flex flex-wrap items-center justify-between gap-4 text-xs transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-text-main text-sm tabular-nums">{tr.transfer_no}</span>
                      <span className="bg-status-warning/15 text-status-warning px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase">
                        {tr.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="text-text-muted">
                      Dispatched from: <strong className="text-text-main font-semibold">{tr.source_store_name}</strong> • Date: <span className="font-mono tabular-nums">{tr.transfer_date}</span>
                    </p>
                    <p className="text-[11px] text-text-muted font-mono tabular-nums">
                      {tr.item_count} products ({tr.total_transfer_qty} units) • Total Value: ₹{tr.grand_total.toFixed(2)}
                      {tr.transport_details.vehicle_number ? ` • Vehicle: ${tr.transport_details.vehicle_number}` : ""}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setTransferToReceive(tr);
                      setIsReceiptModalOpen(true);
                    }}
                    className="px-5 py-2.5 rounded-btn bg-accent hover:bg-accent/90 text-white font-semibold transition-all shadow-xs inline-flex items-center gap-2"
                  >
                    <PackageCheck className="h-4 w-4" />
                    <span>Receive & Verify Stock</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4: AUDIT HISTORY */}
      {activeTab === "history" && (
        <div className="rounded-card border border-border-main bg-surface overflow-hidden shadow-xs">
          <div className="p-4 border-b border-border-main bg-canvas flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
              <History className="h-4 w-4 text-text-muted" />
              <span>Full Transfer Audit Ledger & History</span>
            </h3>
            <span className="text-xs text-text-muted font-medium font-mono tabular-nums">{allTransfers.length} Total Records</span>
          </div>

          <div className="divide-y divide-border-main">
            {allTransfers.map((tr) => (
              <div key={tr.id} className="p-4 hover:bg-canvas/50 flex flex-wrap items-center justify-between gap-4 text-xs transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-text-main tabular-nums">{tr.transfer_no}</span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                        tr.status === "received"
                          ? "bg-accent-soft text-accent"
                          : tr.status === "cancelled"
                          ? "bg-status-danger/10 text-status-danger"
                          : "bg-accent-soft text-accent"
                      }`}
                    >
                      {tr.status.replace("_", " ")}
                    </span>
                    <span className="text-text-muted font-mono tabular-nums">{tr.transfer_date}</span>
                  </div>
                  <p className="text-text-muted">
                    <strong className="text-text-main font-semibold">{tr.source_store_name}</strong> →{" "}
                    <strong className="text-text-main font-semibold">{tr.destination_store_name}</strong>
                  </p>
                  <p className="text-[11px] text-text-muted font-mono tabular-nums">
                    {tr.item_count} items ({tr.total_transfer_qty} units) • ₹{tr.grand_total.toFixed(2)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const printData = interStoreTransferService.generateTransferPrintData(tr);
                      setPreviewModalState({
                        isOpen: true,
                        data: printData,
                        title: `Challan - ${tr.transfer_no}`,
                      });
                    }}
                    className="px-3 py-1.5 rounded-btn border border-border-main bg-surface hover:bg-canvas text-text-main font-semibold transition-colors inline-flex items-center gap-1"
                  >
                    <Printer className="h-3.5 w-3.5 text-text-muted" />
                    <span>Print Challan</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FEFO Batch Selection Modal */}
      {batchModalProduct && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 select-none"
        >
          <div className="w-full max-w-lg rounded-card bg-surface shadow-modal overflow-hidden border border-border-main">
            <div className="flex items-center justify-between border-b border-border-main px-5 py-3.5 bg-canvas">
              <div>
                <h3 className="text-sm font-semibold text-text-main">
                  Select Batch (FEFO Order): {batchModalProduct.name}
                </h3>
                <p className="text-[11px] text-text-muted mt-0.5">Use ↑/↓ arrows to choose, Enter to select, Esc to cancel</p>
              </div>
              <button onClick={() => setBatchModalProduct(null)} className="text-text-muted hover:text-text-main">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div ref={batchListRef} className="max-h-64 overflow-y-auto divide-y divide-border-main outline-none">
              {availableBatches.map((b, idx) => {
                const isSelected = idx === selectedBatchIndex;
                const isExpired = isBatchExpired(b.expiry_date);
                const isOutOfStock = (b.stock_qty || 0) <= 0;

                return (
                  <div
                    key={b.id}
                    onClick={() => {
                      if (!isOutOfStock) {
                        addBatchLineToTransfer(batchModalProduct, b);
                        setBatchModalProduct(null);
                      }
                    }}
                    className={`flex items-center justify-between px-5 py-3 text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-accent-soft text-accent font-semibold border-l-4 border-l-accent pl-4"
                        : "hover:bg-canvas text-text-main"
                    }`}
                  >
                    <div>
                      <div className="font-mono font-semibold text-text-main tabular-nums">{b.batch_no}</div>
                      <div className="text-[11px] text-text-muted font-mono tabular-nums">Exp: {b.expiry_date}</div>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <div className="font-semibold text-accent">Stock: {b.stock_qty} units</div>
                      <div className="text-[11px] text-text-muted">MRP: ₹{b.mrp}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* CSV / Excel Import Modal */}
      <CsvTransferImportModal
        isOpen={isCsvModalOpen}
        rateBasis={rateBasis}
        gstTreatment={gstTreatment}
        onClose={() => setIsCsvModalOpen(false)}
        onImportSuccess={(newLines) => {
          setLines((prev) => [...prev, ...newLines]);
          showNotification(`Imported ${newLines.length} lines from CSV/Excel!`, "success");
        }}
      />

      {/* Destination Receipt Verification Modal */}
      <TransferReceiptModal
        isOpen={isReceiptModalOpen}
        transfer={transferToReceive}
        onClose={() => {
          setIsReceiptModalOpen(false);
          setTransferToReceive(null);
        }}
        onConfirmReceipt={handleConfirmReceipt}
      />

      {/* Print Preview Modal */}
      <PrintPreviewModal
        isOpen={previewModalState.isOpen}
        data={previewModalState.data}
        title={previewModalState.title}
        initialFormat="a4"
        onClose={() => setPreviewModalState({ isOpen: false, data: null })}
      />
    </div>
  );
};

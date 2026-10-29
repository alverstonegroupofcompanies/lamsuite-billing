import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Calendar,
  Filter,
  Receipt,
  FileText,
  Printer,
  Download,
  Share2,
  Copy,
  Edit,
  XCircle,
  CheckCircle,
  Clock,
  ArrowLeft,
  AlertCircle,
  Eye,
  Lock,
  UserCheck,
  RefreshCw,
  FolderOpen,
  ExternalLink,
  CreditCard,
  PlusCircle,
  Check,
} from "lucide-react";
import {
  invoiceManagementService,
  type InvoiceRecord,
  type InvoiceItemRecord,
  type InvoiceAuditEntry,
  type InvoiceFilterCriteria,
} from "../lib/billing/invoiceManagementService";
import {
  printingEngine,
  generateWhatsAppShareUrl,
  generateEmailShareUrl,
  type InvoicePrintData,
} from "../lib/printing/printingEngine";
import { isTauri } from "../lib/ipc/ipcBridge";
import { posCartService } from "../lib/billing/posCartService";
import { productsStore, type ProductBatch, type ProductItem } from "../lib/masters/productsStore";
import { companySettingsService } from "../lib/settings/companySettingsService";
import { sqliteStorage } from "../lib/db/sqliteStorage";
import { onlineTransactionService } from "../lib/sync/onlineTransactionService";
import { storeRegistryService, type RegisteredStoreRecord } from "../lib/auth/storeRegistryService";
import { storeDeviceService, type StoreDeviceProfile } from "../lib/auth/storeDeviceService";
import { PrintPreviewModal } from "../components/PrintPreviewModal";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

export const BillsPage: React.FC = () => {
  const navigate = useNavigate();

  // State
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Store & Device Diagnostics State
  const [activeStore, setActiveStore] = useState<RegisteredStoreRecord | null>(storeRegistryService.getActiveStore());
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [lastSyncTime, setLastSyncTime] = useState<string>("");
  const [serverTotalCount, setServerTotalCount] = useState<number | null>(null);
  const [serverTotalStoreInvoices, setServerTotalStoreInvoices] = useState<number | null>(null);
  const [isOfflineCache, setIsOfflineCache] = useState<boolean>(false);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(50);
  const [totalPages, setTotalPages] = useState<number>(1);

  // History Sync Modal State
  const [isSyncingHistory, setIsSyncingHistory] = useState<boolean>(false);
  const [syncHistoryProgress, setSyncHistoryProgress] = useState<{ current: number; total: number; step: string }>({
    current: 0,
    total: 0,
    step: "",
  });

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [dateRange, setDateRange] = useState<"today" | "yesterday" | "last7days" | "month" | "all">("today");
  const [paymentModeFilter, setPaymentModeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Selected Detail Modal
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [selectedInvoiceItems, setSelectedInvoiceItems] = useState<InvoiceItemRecord[]>([]);
  const [selectedInvoiceAudit, setSelectedInvoiceAudit] = useState<InvoiceAuditEntry[]>([]);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  useModalEscape(isDetailModalOpen, () => setIsDetailModalOpen(false));

  // Cancel & PIN Dialog
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  useModalEscape(isCancelModalOpen, () => setIsCancelModalOpen(false));
  const [cancelReason, setCancelReason] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [pinError, setPinError] = useState("");

  // Edit PIN Dialog
  const [isEditPinModalOpen, setIsEditPinModalOpen] = useState(false);
  useModalEscape(isEditPinModalOpen, () => setIsEditPinModalOpen(false));
  const [editPin, setEditPin] = useState("");
  const [editPinError, setEditPinError] = useState("");

  // Receive Payment Dialog
  const [isReceivePaymentModalOpen, setIsReceivePaymentModalOpen] = useState(false);
  useModalEscape(isReceivePaymentModalOpen, () => setIsReceivePaymentModalOpen(false));
  const [receiptMode, setReceiptMode] = useState("Cash");
  const [receiptAmount, setReceiptAmount] = useState(0);
  const [receiptReference, setReceiptReference] = useState("");
  const [receiptNotes, setReceiptNotes] = useState("");
  const [isSubmittingReceipt, setIsSubmittingReceipt] = useState(false);

  // Notification Toast
  interface NotificationAction {
    label: string;
    icon?: "open" | "folder";
    onClick: () => void;
  }
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "error";
    actions?: NotificationAction[];
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  const showNotification = (
    message: string,
    type: "success" | "error" = "success",
    actions?: NotificationAction[]
  ) => {
    setNotification({ message, type, actions });
    setTimeout(() => setNotification(null), actions && actions.length > 0 ? 8000 : 3500);
  };

  const [isRefreshingServer, setIsRefreshingServer] = useState(false);

  // Subscribe to store registry changes
  useEffect(() => {
    const unsub = storeRegistryService.onRegistryChange(() => {
      setActiveStore(storeRegistryService.getActiveStore());
    });
    return unsub;
  }, []);

  const loadInvoices = async (page = currentPage, forceServer = false) => {
    setLoading(true);
    try {
      const reg = storeRegistryService.getActiveStore();
      setActiveStore(reg);
      const activeStoreId = reg?.id || "1";

      const now = new Date();
      const formatYmdKolkata = (d: Date) => {
        try {
          return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        } catch {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
      };
      const todayStr = formatYmdKolkata(now);
      const yesterdayDate = new Date(now);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterdayStr = formatYmdKolkata(yesterdayDate);
      const sevenDaysAgoDate = new Date(now);
      sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 7);
      const sevenDaysAgoStr = formatYmdKolkata(sevenDaysAgoDate);
      const monthStartStr = `${todayStr.slice(0, 7)}-01`;
      const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const monthEndStr = `${todayStr.slice(0, 7)}-${String(lastDayOfMonth).padStart(2, "0")}`;

      let startDate: string | undefined;
      let endDate: string | undefined;

      if (dateRange === "today") {
        startDate = todayStr;
        endDate = todayStr;
      } else if (dateRange === "yesterday") {
        startDate = yesterdayStr;
        endDate = yesterdayStr;
      } else if (dateRange === "last7days") {
        startDate = sevenDaysAgoStr;
        endDate = todayStr;
      } else if (dateRange === "month") {
        startDate = monthStartStr;
        endDate = monthEndStr;
      }

      const health = await onlineTransactionService.getHealthSnapshot();
      const online = health.state !== "offline";
      setIsOnline(online);

      // Check unsynced local bills
      const localInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
      const unsyncedBills = localInvoices.filter(
        (inv) => inv.sync_state === "pending" || (inv as any).sync_status === "pending"
      );
      setPendingSyncCount(unsyncedBills.length);

      let loadedInvoices: InvoiceRecord[] = [];
      let totalCount = 0;
      let storeTotalCount = 0;
      let pagesCount = 1;
      let loadedFromLiveServer = false;

      if (online || forceServer) {
        try {
          const baseUrl = onlineTransactionService.getEffectiveBaseUrl();
          const queryParams = new URLSearchParams();
          queryParams.set("store_id", activeStoreId);
          queryParams.set("page", String(page));
          queryParams.set("per_page", String(perPage));
          if (startDate) queryParams.set("start_date", startDate);
          if (endDate) queryParams.set("end_date", endDate);
          if (statusFilter && statusFilter.toLowerCase() !== "all") {
            queryParams.set("status", statusFilter);
          }
          if (paymentModeFilter && paymentModeFilter.toLowerCase() !== "all") {
            queryParams.set("payment_mode", paymentModeFilter);
          }
          if (searchQuery.trim()) {
            queryParams.set("search", searchQuery.trim());
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(`${baseUrl}/api/invoices?${queryParams.toString()}`, {
            headers: {
              Accept: "application/json",
              "X-Store-Id": activeStoreId,
              "Store-Id": activeStoreId,
            },
            cache: "no-store",
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (res.ok) {
            const json = await res.json();
            const serverList = json.data || (Array.isArray(json) ? json : []);
            totalCount = json.total !== undefined ? json.total : serverList.length;
            storeTotalCount = json.total_store_invoices !== undefined ? json.total_store_invoices : totalCount;
            pagesCount = json.last_page || 1;

            // Ingest server bills into local SQLite cache
            for (const sinv of serverList) {
              const rec: InvoiceRecord = {
                id: String(sinv.id),
                module_key: "invoice",
                invoice_number: sinv.invoice_number,
                invoice_date: sinv.invoice_date,
                customer_name: sinv.customer_name || "Walk-in Customer",
                customer_phone: sinv.customer_phone || "",
                customer_gstin: sinv.customer_gstin || "",
                subtotal: Number(sinv.subtotal) || 0,
                discount_total: Number(sinv.discount_total) || 0,
                tax_total: Number(sinv.tax_total) || 0,
                round_off: Number(sinv.round_off) || 0,
                grand_total: Number(sinv.grand_total) || 0,
                paid_amount: Number(sinv.paid_amount) || Number(sinv.grand_total) || 0,
                payment_mode: sinv.payment_mode || "Cash",
                payment_status: sinv.payment_status || "paid",
                status: sinv.status || "issued",
                user_counter: sinv.counter_code ? `Counter ${sinv.counter_code}` : (sinv.user_counter || "Counter 01"),
                sync_state: "synced",
                created_at: sinv.created_at ? new Date(sinv.created_at).getTime() : Date.now(),
                updated_at: sinv.updated_at ? new Date(sinv.updated_at).getTime() : Date.now(),
              };
              await sqliteStorage.insertRecord("invoices", String(sinv.id), rec);
              if (Array.isArray(sinv.items)) {
                for (const item of sinv.items) {
                  await sqliteStorage.insertRecord("invoice_items", `item_${item.id || Math.random()}`, {
                    id: String(item.id || `item_${Math.random()}`),
                    invoice_id: String(sinv.id),
                    product_id: String(item.product_id),
                    product_name: item.product_name,
                    batch_no: item.batch_no,
                    expiry_date: item.expiry_date,
                    qty: Number(item.qty || 0),
                    loose_qty: Number(item.loose_qty || 0),
                    units_per_pack: Number(item.units_per_pack || 1),
                    unit_price: Number(item.unit_price || 0),
                    mrp: Number(item.mrp || item.unit_price || 0),
                    discount_percent: Number(item.discount_percent || 0),
                    discount_amount: Number(item.discount_amount || 0),
                    gst_percent: Number(item.gst_percent || 0),
                    tax_amount: Number(item.tax_amount || 0),
                    total_amount: Number(item.total_amount || 0),
                  });
                }
              }
            }

            loadedInvoices = serverList.map((sinv: any) => ({
              id: String(sinv.id),
              module_key: "invoice",
              invoice_number: sinv.invoice_number,
              invoice_date: sinv.invoice_date,
              customer_name: sinv.customer_name || "Walk-in Customer",
              customer_phone: sinv.customer_phone || "",
              customer_gstin: sinv.customer_gstin || "",
              subtotal: Number(sinv.subtotal) || 0,
              discount_total: Number(sinv.discount_total) || 0,
              tax_total: Number(sinv.tax_total) || 0,
              round_off: Number(sinv.round_off) || 0,
              grand_total: Number(sinv.grand_total) || 0,
              paid_amount: Number(sinv.paid_amount) || Number(sinv.grand_total) || 0,
              payment_mode: sinv.payment_mode || "Cash",
              payment_status: sinv.payment_status || "paid",
              status: sinv.status || "issued",
              user_counter: sinv.counter_code ? `Counter ${sinv.counter_code}` : (sinv.user_counter || "Counter 01"),
              sync_state: "synced",
              created_at: sinv.created_at ? new Date(sinv.created_at).getTime() : Date.now(),
              updated_at: sinv.updated_at ? new Date(sinv.updated_at).getTime() : Date.now(),
            }));

            // Prepend unsynced local bills matching criteria
            if (unsyncedBills.length > 0) {
              const matchedUnsynced = unsyncedBills.filter((ub) => {
                const ubDate = (ub.invoice_date || "").slice(0, 10);
                if (startDate && ubDate < startDate) return false;
                if (endDate && ubDate > endDate) return false;
                return true;
              });
              loadedInvoices = [...matchedUnsynced, ...loadedInvoices];
            }

            loadedFromLiveServer = true;
            setIsOfflineCache(false);
            setLastSyncTime(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }));
          }
        } catch (serverErr) {
          console.warn("Failed to load from server API, falling back to SQLite cache:", serverErr);
        }
      }

      // Offline fallback: load from local SQLite cache
      if (!loadedFromLiveServer) {
        const criteria: InvoiceFilterCriteria = {
          searchQuery,
          dateRange,
          paymentMode: paymentModeFilter,
          status: statusFilter,
        };
        const localList = await invoiceManagementService.listInvoices(criteria);
        loadedInvoices = localList;
        totalCount = localList.length;
        storeTotalCount = localList.length;
        pagesCount = Math.max(1, Math.ceil(localList.length / perPage));
        setIsOfflineCache(true);
      }

      setInvoices(loadedInvoices);
      setServerTotalCount(totalCount);
      setServerTotalStoreInvoices(storeTotalCount);
      setTotalPages(pagesCount);
      setCurrentPage(page);
      setSelectedIndex(0);
    } catch (err) {
      showNotification("Failed to load invoices", "error");
    } finally {
      setLoading(false);
    }
  };

  const downloadStoreInvoiceHistory = async (months = 12) => {
    setIsSyncingHistory(true);
    setSyncHistoryProgress({ current: 0, total: 1, step: "Connecting to server..." });
    try {
      const activeStore = storeRegistryService.getActiveStore();
      const activeStoreId = activeStore?.id || "1";
      const baseUrl = onlineTransactionService.getEffectiveBaseUrl();

      let page = 1;
      let totalPages = 1;
      let totalDownloaded = 0;

      while (page <= totalPages) {
        setSyncHistoryProgress({
          current: page,
          total: totalPages,
          step: `Fetching batch ${page} of ${totalPages}...`,
        });

        const res = await fetch(`${baseUrl}/api/invoices?store_id=${activeStoreId}&page=${page}&per_page=100`, {
          headers: {
            Accept: "application/json",
            "X-Store-Id": activeStoreId,
            "Store-Id": activeStoreId,
          },
          cache: "no-store",
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const serverInvoices = json.data || (Array.isArray(json) ? json : []);
        totalPages = json.last_page || 1;

        for (const sinv of serverInvoices) {
          await sqliteStorage.insertRecord("invoices", String(sinv.id), {
            id: String(sinv.id),
            module_key: "invoice",
            invoice_number: sinv.invoice_number,
            invoice_date: sinv.invoice_date,
            customer_name: sinv.customer_name || "Walk-in Customer",
            customer_phone: sinv.customer_phone || "",
            customer_gstin: sinv.customer_gstin || "",
            subtotal: Number(sinv.subtotal) || 0,
            discount_total: Number(sinv.discount_total) || 0,
            tax_total: Number(sinv.tax_total) || 0,
            round_off: Number(sinv.round_off) || 0,
            grand_total: Number(sinv.grand_total) || 0,
            paid_amount: Number(sinv.paid_amount) || Number(sinv.grand_total) || 0,
            payment_mode: sinv.payment_mode || "Cash",
            payment_status: sinv.payment_status || "paid",
            status: sinv.status || "issued",
            user_counter: sinv.counter_code ? `Counter ${sinv.counter_code}` : (sinv.user_counter || "Counter 01"),
            sync_state: "synced",
            created_at: sinv.created_at ? new Date(sinv.created_at).getTime() : Date.now(),
            updated_at: sinv.updated_at ? new Date(sinv.updated_at).getTime() : Date.now(),
          });
          if (Array.isArray(sinv.items)) {
            for (const item of sinv.items) {
              await sqliteStorage.insertRecord("invoice_items", `item_${item.id || Math.random()}`, {
                id: String(item.id || `item_${Math.random()}`),
                invoice_id: String(sinv.id),
                product_id: String(item.product_id),
                product_name: item.product_name,
                batch_no: item.batch_no,
                expiry_date: item.expiry_date,
                qty: Number(item.qty || 0),
                loose_qty: Number(item.loose_qty || 0),
                units_per_pack: Number(item.units_per_pack || 1),
                unit_price: Number(item.unit_price || 0),
                mrp: Number(item.mrp || item.unit_price || 0),
                discount_percent: Number(item.discount_percent || 0),
                discount_amount: Number(item.discount_amount || 0),
                gst_percent: Number(item.gst_percent || 0),
                tax_amount: Number(item.tax_amount || 0),
                total_amount: Number(item.total_amount || 0),
              });
            }
          }
          totalDownloaded++;
        }
        page++;
      }

      showNotification(`Successfully synchronized ${totalDownloaded} historical store invoices!`, "success");
      await loadInvoices(1, true);
    } catch (err: any) {
      showNotification(`History sync stopped: ${err.message || "Network issue"}`, "error");
    } finally {
      setIsSyncingHistory(false);
    }
  };

  const handleSwitchStore = async (storeId: string) => {
    try {
      await storeRegistryService.switchActiveStore(storeId, true);
      setActiveStore(storeRegistryService.getActiveStore());
      showNotification(`Switched active store to STORE-01`, "success");
      loadInvoices(1, true);
    } catch (err: any) {
      showNotification(`Failed to switch store: ${err.message}`, "error");
    }
  };

  const handleRefreshSync = async () => {
    setIsRefreshingServer(true);
    try {
      await loadInvoices(currentPage, true);
      showNotification("Refreshed invoice register from server.", "success");
    } catch {
      await loadInvoices(currentPage, false);
    } finally {
      setIsRefreshingServer(false);
    }
  };

  const formatDisplayDate = (inv: InvoiceRecord) => {
    const raw = inv.invoice_date || "";
    if (raw) {
      try {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
        }
      } catch {}
      return raw.slice(0, 10);
    }
    if (inv.created_at) {
      return new Date(inv.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
    }
    return "-";
  };

  const formatDisplayTime = (inv: InvoiceRecord) => {
    const timestamp = inv.created_at || (inv.invoice_date ? new Date(inv.invoice_date).getTime() : 0);
    if (timestamp) {
      try {
        const d = new Date(timestamp);
        if (!isNaN(d.getTime())) {
          return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
        }
      } catch {}
    }
    return "";
  };

  useEffect(() => {
    loadInvoices();
  }, [dateRange, paymentModeFilter, statusFilter]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadInvoices();
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If modal is open, Escape closes modal
      if (isDetailModalOpen || isCancelModalOpen || isEditPinModalOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (isCancelModalOpen) setIsCancelModalOpen(false);
          else if (isEditPinModalOpen) setIsEditPinModalOpen(false);
          else if (isDetailModalOpen) setIsDetailModalOpen(false);
        }
        return;
      }

      // Escape navigates back to POS billing
      if (e.key === "Escape") {
        e.preventDefault();
        navigate("/pos");
        return;
      }

      // F1 navigates to POS
      if (e.key === "F1") {
        e.preventDefault();
        navigate("/pos");
        return;
      }

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (invoices.length > 0) {
          setSelectedIndex((prev) => Math.min(prev + 1, invoices.length - 1));
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (invoices.length > 0) {
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = invoices[selectedIndex];
        if (selected) {
          openDetailModal(selected);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDetailModalOpen, isCancelModalOpen, isEditPinModalOpen, invoices, selectedIndex, navigate]);

  // Auto-scroll selected row into view
  useEffect(() => {
    if (tableRef.current && tableRef.current.children[selectedIndex]) {
      const row = tableRef.current.children[selectedIndex] as HTMLElement;
      row.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const openDetailModal = async (invoice: InvoiceRecord) => {
    const details = await invoiceManagementService.getInvoiceWithDetails(invoice.id);
    if (!details) {
      showNotification("Could not load invoice details", "error");
      return;
    }
    setSelectedInvoice(details.invoice);
    setSelectedInvoiceItems(details.items);
    setSelectedInvoiceAudit(details.auditLog);
    setIsDetailModalOpen(true);
  };

  const buildPrintData = (invoice: InvoiceRecord, items: InvoiceItemRecord[]): InvoicePrintData => {
    return {
      invoice_number: invoice.invoice_number + (invoice.is_revised ? " (Revised)" : ""),
      invoice_date: invoice.invoice_date,
      store_name: "LamStone Pharmacy & Retail",
      store_address: "Main Road, Palakkad, Kerala - 678001",
      store_phone: "9876543210",
      store_gstin: "32ABCDE1234F1Z5",
      drug_license_numbers: ["20B/KL-PKD-1029", "21B/KL-PKD-1030"],
      fssai_no: "10020042001234",
      place_of_supply: invoice.place_of_supply || "32-Kerala",
      customer_name: invoice.customer_name || "Walk-in Customer",
      customer_phone: invoice.customer_phone || "",
      customer_gstin: invoice.customer_gstin || undefined,
      payment_mode: invoice.payment_mode || "Cash",
      payment_status: (invoice as any).payment_status || "Paid",
      lines: items.map((it) => ({
        description: it.product_name,
        hsn_code: (it as any).hsn_code || "300490",
        batch_no: it.batch_no,
        expiry_date: it.expiry_date,
        qty: it.qty,
        loose_qty: it.loose_qty,
        rate: it.unit_price,
        gst_percent: it.gst_percent,
        amount: it.total_amount,
      })),
      subtotal: invoice.subtotal,
      tax_total: invoice.tax_total,
      round_off: invoice.round_off,
      grand_total: invoice.grand_total,
      payments: invoice.payments?.map((p) => ({
        mode: p.payment_mode,
        amount: p.amount,
        reference: p.reference_no,
        status: p.status,
      })),
      upi_vpa: "pharmacy@upi",
    };
  };

  const handleOpenReceivePayment = () => {
    if (!selectedInvoice) return;
    const paidSoFar = (selectedInvoice.payments || []).reduce(
      (sum, p) => (p.status !== "refunded" ? sum + p.amount : sum),
      0
    );
    const balanceRemaining = Math.max(
      0,
      Math.round((selectedInvoice.grand_total - paidSoFar + Number.EPSILON) * 100) / 100
    );
    setReceiptAmount(balanceRemaining);
    setReceiptMode("Cash");
    setReceiptReference("");
    setReceiptNotes("");
    setIsReceivePaymentModalOpen(true);
  };

  const handleRecordReceipt = async () => {
    if (!selectedInvoice) return;
    if (receiptAmount <= 0) {
      showNotification("Receipt amount must be greater than 0", "error");
      return;
    }
    setIsSubmittingReceipt(true);
    try {
      const res = await invoiceManagementService.recordInvoiceReceipt(selectedInvoice.id, {
        mode: receiptMode,
        amount: receiptAmount,
        reference_no: receiptReference || undefined,
        notes: receiptNotes || undefined,
      });
      if (res.success) {
        showNotification("Payment receipt recorded successfully!", "success");
        setIsReceivePaymentModalOpen(false);
        const updated = await invoiceManagementService.getInvoiceWithDetails(selectedInvoice.id);
        if (updated) {
          setSelectedInvoice(updated.invoice);
          setSelectedInvoiceItems(updated.items);
          setSelectedInvoiceAudit(updated.auditLog);
        }
        loadInvoices();
      }
    } catch (e: any) {
      showNotification(e.message || "Failed to record payment", "error");
    } finally {
      setIsSubmittingReceipt(false);
    }
  };

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

  // Actions
  const handleReprint = async (format: "a4" | "thermal" | "pdf", e?: React.MouseEvent) => {
    if (!selectedInvoice) return;
    const printData = buildPrintData(selectedInvoice, selectedInvoiceItems);
    const settings = companySettingsService.getSettings();
    const previewMode = settings.printing.previewMode || "always";
    const bypassPreview = (e && e.shiftKey) || previewMode === "never" || (previewMode === "skip_thermal" && format === "thermal");

    if (!bypassPreview) {
      setPreviewModalState({
        isOpen: true,
        data: printData,
        initialFormat: format === "a4" ? "a4" : "thermal_80mm",
        title: `Reprint Preview - #${selectedInvoice.invoice_number}`,
      });
      return;
    }

    try {
      if (format === "thermal") {
        await printingEngine.printThermalReceipt(printData);
        showNotification("Thermal receipt sent to printer");
      } else if (format === "a4") {
        await printingEngine.printA4TaxInvoice(printData);
        showNotification("A4 Tax Invoice sent to printer");
      } else if (format === "pdf") {
        const res = await printingEngine.exportToPdf(printData);
        if (res.cancelled) {
          // User intentionally cancelled the file dialog - show nothing
          return;
        }
        if (!res.success) {
          showNotification(res.error || "Failed to save PDF invoice", "error");
          return;
        }
        showNotification(
          res.file_path ? `Saved to: ${res.file_path}` : "PDF invoice saved successfully!",
          "success",
          res.file_path
            ? [
                {
                  label: "Open file",
                  icon: "open",
                  onClick: () => printingEngine.openFile(res.file_path!),
                },
                {
                  label: "Show in folder",
                  icon: "folder",
                  onClick: () => printingEngine.revealFile(res.file_path!),
                },
              ]
            : undefined
        );
      }
    } catch (err) {
      showNotification("Error printing invoice", "error");
    }
  };

  const handleWhatsAppShare = () => {
    if (!selectedInvoice) return;
    if (!selectedInvoice.customer_phone?.trim()) {
      showNotification("Customer mobile number not recorded on this bill", "error");
      return;
    }
    const printData = buildPrintData(selectedInvoice, selectedInvoiceItems);
    const url = generateWhatsAppShareUrl(selectedInvoice.customer_phone, printData);
    if (isTauri()) {
      import("@tauri-apps/api/shell").then(({ open }) => open(url)).catch(() => window.open(url, "_blank"));
    } else {
      window.open(url, "_blank");
    }
    showNotification("WhatsApp share window opened");
  };

  const handleEmailShare = () => {
    if (!selectedInvoice) return;
    const printData = buildPrintData(selectedInvoice, selectedInvoiceItems);
    const url = generateEmailShareUrl("customer@example.com", printData);
    if (isTauri()) {
      import("@tauri-apps/api/shell").then(({ open }) => open(url)).catch(() => window.open(url, "_blank"));
    } else {
      window.open(url, "_blank");
    }
    showNotification("Email client opened");
  };

  const handleDuplicateAsNewBill = async () => {
    if (!selectedInvoice || selectedInvoiceItems.length === 0) return;

    // Clear cart and populate with selected invoice items
    posCartService.clearCart();

    for (const it of selectedInvoiceItems) {
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

      const productItem: ProductItem = {
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

      posCartService.addProductToCart(productItem, batch, it.qty, it.loose_qty);
    }

    setIsDetailModalOpen(false);
    navigate("/pos");
  };

  const handlePromptEdit = () => {
    if (!selectedInvoice) return;
    const lock = invoiceManagementService.checkInvoiceLockStatus(selectedInvoice);
    if (lock.isLocked) {
      showNotification(lock.lockReason || "Invoice is locked from editing", "error");
      return;
    }
    setEditPin("");
    setEditPinError("");
    setIsEditPinModalOpen(true);
  };

  const handleConfirmEditPin = () => {
    if (!invoiceManagementService.verifyManagerPin(editPin)) {
      setEditPinError("Invalid Manager PIN. Default is 1234.");
      return;
    }
    setIsEditPinModalOpen(false);
    setIsDetailModalOpen(false);
    navigate(`/pos?edit=${selectedInvoice?.id}`);
  };

  const handlePromptCancel = () => {
    if (!selectedInvoice) return;
    const lock = invoiceManagementService.checkInvoiceLockStatus(selectedInvoice);
    if (lock.isLocked) {
      showNotification(lock.lockReason || "Invoice cannot be cancelled", "error");
      return;
    }
    setCancelReason("");
    setManagerPin("");
    setPinError("");
    setIsCancelModalOpen(true);
  };

  const handleConfirmCancel = async () => {
    if (!cancelReason.trim()) {
      setPinError("Mandatory cancellation reason required");
      return;
    }
    if (!invoiceManagementService.verifyManagerPin(managerPin)) {
      setPinError("Invalid Manager PIN. Default is 1234.");
      return;
    }

    try {
      await invoiceManagementService.cancelInvoice(
        selectedInvoice!.id,
        cancelReason.trim(),
        "Manager (Counter 01)"
      );
      showNotification(`Invoice ${selectedInvoice?.invoice_number} cancelled. Stock restored.`);
      setIsCancelModalOpen(false);
      setIsDetailModalOpen(false);
      loadInvoices();
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Error cancelling bill");
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
              : "bg-red-800 text-white border-red-600"
          }`}
        >
          <div className="flex items-start gap-2.5">
            {notification.type === "success" ? (
              <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-200 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 overflow-hidden">
              <p className="font-medium break-all leading-relaxed">{notification.message}</p>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-slate-400 hover:text-white p-0.5 cursor-pointer ml-1"
            >
              <XCircle className="h-3.5 w-3.5" />
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

      {/* Top Header & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-2xs">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/pos")}
            className="flex items-center gap-1.5 rounded-[10px] border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
            title="Return to POS Billing (Esc)"
          >
            <ArrowLeft className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span>Back to POS (Esc)</span>
          </button>
          <div className="h-6 w-px bg-[var(--color-border)]" />
          <div>
            <h1 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
              <Receipt className="h-4 w-4 text-[var(--color-accent)]" />
              <span>Invoices & Past Bills Register</span>
            </h1>
            <p className="text-[11px] text-[var(--color-text-muted)]">
              Search, reprint, audit, edit, or cancel customer tax invoices offline.
            </p>
          </div>
        </div>

        {/* Global Search Input */}
        <div className="relative w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--color-text-faint)]" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search invoice no, customer, mobile, product..."
            className="w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1.5 pl-9 pr-3 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 shadow-2xs">
        {/* Date Range Chips */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mr-1">Period:</span>
          {(
            [
              { id: "today", label: "Today" },
              { id: "yesterday", label: "Yesterday" },
              { id: "last7days", label: "Last 7 Days" },
              { id: "month", label: "This Month" },
              { id: "all", label: "All Time" },
            ] as const
          ).map((chip) => (
            <button
              key={chip.id}
              onClick={() => setDateRange(chip.id)}
              className={`rounded-[8px] px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                dateRange === chip.id
                  ? "bg-[var(--color-accent)] text-white shadow-2xs"
                  : "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Mode & Status Filters */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Payment:</span>
            <select
              value={paymentModeFilter}
              onChange={(e) => setPaymentModeFilter(e.target.value)}
              className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs font-medium text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
            >
              <option value="all">All Modes</option>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Card">Card</option>
              <option value="Credit">Credit</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs font-medium text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="issued">Issued</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <button
            onClick={handleRefreshSync}
            disabled={isRefreshingServer}
            className="flex items-center gap-1.5 rounded-[8px] border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer disabled:opacity-50"
            title="Refresh & Pull from Server"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingServer ? "animate-spin text-emerald-500" : ""}`} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Offline Mode Warning Banner */}
      {isOfflineCache && (
        <div className="flex items-center justify-between rounded-[10px] border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
            <span>
              <strong>Showing cached bills</strong>, last updated {lastSyncTime || "earlier"}. Some bills may be missing ({pendingSyncCount} bills waiting to sync).
            </span>
          </div>
          <button
            onClick={() => loadInvoices(currentPage, true)}
            className="text-[11px] font-bold underline hover:no-underline ml-2 cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Diagnostics & Store Identification Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-[11px] text-[var(--color-text-muted)] shadow-2xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-semibold text-[var(--color-text)] flex items-center gap-1.5">
            <span>🏪 Store:</span>
            <strong className="font-mono">{activeStore?.alias || activeStore?.name || "Store 01"}</strong>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] font-mono font-bold">
              {activeStore?.code || `STORE-${String(activeStore?.id || "01").padStart(2, "0")}`}
            </span>
            <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
              (Store ID: {activeStore?.id || "1"})
            </span>
          </span>
          <span>•</span>
          <span>Counter: <strong className="font-mono text-[var(--color-text)]">{activeStore?.counter_code || "C01"}</strong></span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${isOnline && !isOfflineCache ? "bg-emerald-500" : "bg-amber-500"}`} />
            <strong className={isOnline && !isOfflineCache ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
              {isOnline && !isOfflineCache ? "Live Cloud Mode" : "Offline Cache Mode"}
            </strong>
          </span>
          {lastSyncTime && (
            <>
              <span>•</span>
              <span>Last Sync: <span className="font-mono">{lastSyncTime}</span></span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {serverTotalCount !== null && (
            <span className="font-mono text-[11px]">
              Showing <strong>{invoices.length}</strong> of <strong>{serverTotalCount}</strong> matching bills ({serverTotalStoreInvoices ?? serverTotalCount} in store)
            </span>
          )}
          {serverTotalCount !== null && serverTotalCount !== invoices.length && !loading && (
            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
              Filtered / Paged View
            </span>
          )}
          <button
            onClick={() => loadInvoices(currentPage, true)}
            title="Reload live from server"
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[11px] font-semibold text-[var(--color-text)] cursor-pointer transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            <span>Reload</span>
          </button>
          <button
            onClick={() => downloadStoreInvoiceHistory(12)}
            title="Download full 12-month store invoice history for offline cache"
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[11px] font-semibold text-[var(--color-accent)] cursor-pointer transition-colors"
          >
            <Download className="h-3 w-3" />
            <span>Sync History</span>
          </button>
        </div>
      </div>

      {/* Invoices List Table */}
      <div className="flex-1 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xs overflow-hidden flex flex-col">
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] border-b border-[var(--color-border)] z-10">
              <tr>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Invoice No</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Date & Time</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Customer</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Mobile</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] text-right">Net Amount</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Tender</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] text-center">Status</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] text-center">Sync</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] text-center">Action</th>
              </tr>
            </thead>
            <tbody ref={tableRef} className="divide-y divide-[var(--color-border-subtle)]">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-[var(--color-text-muted)]">
                    <RefreshCw className="mx-auto h-6 w-6 animate-spin text-[var(--color-accent)] mb-2" />
                    <span>Loading invoices from server...</span>
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center">
                    <div className="max-w-md mx-auto p-4 flex flex-col items-center">
                      <Receipt className="h-10 w-10 text-[var(--color-text-faint)] mb-3" />
                      <h4 className="text-sm font-bold text-[var(--color-text)]">No invoices found matching criteria</h4>

                      {isOfflineCache ? (
                        <p className="text-xs text-[var(--color-warning-text)] bg-[var(--color-warning-bg)]/20 border border-[var(--color-warning-border)]/40 p-2.5 rounded-lg mt-2 mb-3">
                          Device is currently in <strong>Offline Mode</strong>. The local SQLite cache has no bills matching <strong>{dateRange}</strong>.
                        </p>
                      ) : activeStore?.id === "4" || (serverTotalStoreInvoices === 0 && activeStore?.id !== "1") ? (
                        <div className="text-xs text-[var(--color-text-muted)] bg-[var(--color-surface-subtle)] border border-[var(--color-border)] p-3 rounded-lg mt-2 mb-3 text-left w-full space-y-1.5">
                          <p className="font-semibold text-[var(--color-text)]">
                            Active Store is &ldquo;{activeStore?.name}&rdquo; (ID: {activeStore?.id}, Code: {activeStore?.code}).
                          </p>
                          <p>This store currently has 0 invoices on the cloud server. Active store bills belong to <strong>LamStone Pharmacy & Retail (STORE-01)</strong>.</p>
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--color-text-muted)] mt-1.5 mb-3">
                          No bills found for Period: <strong>{dateRange}</strong>, Payment: <strong>{paymentModeFilter}</strong>, Status: <strong>{statusFilter}</strong>.
                        </p>
                      )}

                      <div className="flex flex-wrap gap-2 justify-center">
                        {dateRange !== "all" && (
                          <button
                            type="button"
                            onClick={() => setDateRange("all")}
                            className="px-3 py-1.5 text-xs font-semibold rounded-btn bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity cursor-pointer"
                          >
                            View All Time
                          </button>
                        )}
                        {activeStore?.id !== "1" && (
                          <button
                            type="button"
                            onClick={() => handleSwitchStore("1")}
                            className="px-3 py-1.5 text-xs font-semibold rounded-btn bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
                          >
                            Switch to STORE-01 (ID: 1)
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setDateRange("all");
                            setPaymentModeFilter("all");
                            setStatusFilter("all");
                            setSearchQuery("");
                            loadInvoices(1, true);
                          }}
                          className="px-3 py-1.5 text-xs font-semibold rounded-btn bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
                        >
                          Reset All Filters
                        </button>
                        <button
                          type="button"
                          onClick={() => loadInvoices(1, true)}
                          className="px-3 py-1.5 text-xs font-semibold rounded-btn bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>Reload From Server</span>
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                invoices.map((inv, idx) => {
                  const isHighlighted = idx === selectedIndex;
                  const isCancelled = inv.status === "cancelled";
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => {
                        setSelectedIndex(idx);
                        openDetailModal(inv);
                      }}
                      className={`cursor-pointer transition-colors ${
                        isHighlighted
                          ? "bg-[var(--color-accent-soft)] ring-1 ring-inset ring-[var(--color-accent)] font-medium text-[var(--color-text)]"
                          : "hover:bg-[var(--color-surface-hover)] text-[var(--color-text)]"
                      } ${isCancelled ? "opacity-75 bg-[var(--color-danger-bg)]/20" : ""}`}
                    >
                      <td className="px-4 py-2.5 font-mono font-bold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span className={isCancelled ? "line-through text-red-500" : "text-blue-700"}>
                            {inv.invoice_number}
                          </span>
                          {inv.is_revised ? (
                            <span className="rounded bg-purple-100 px-1.5 py-0.2 text-[9px] font-bold text-purple-700 uppercase">
                              Revised
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        <span>{formatDisplayDate(inv)}</span>
                        {formatDisplayTime(inv) ? (
                          <span className="ml-1 text-[10px] text-slate-400 font-mono">
                            {formatDisplayTime(inv)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-slate-800">
                        {inv.customer_name || "Walk-in Customer"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 font-mono">
                        {inv.customer_phone || "-"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">
                        <span className={isCancelled ? "line-through text-red-400" : ""}>
                          ₹ {Number(inv.grand_total || 0).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          {inv.payment_mode || "Cash"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {isCancelled ? (
                          <span className="rounded-full bg-[var(--color-danger-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-danger-text)] border border-[var(--color-danger-border)]">
                            Cancelled
                          </span>
                        ) : (
                          <span className="rounded-full bg-[var(--color-success-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-success-text)] border border-[var(--color-success-border)]">
                            Issued
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {inv.sync_state === "pending" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-warning-text)] border border-[var(--color-warning-border)]">
                            <Clock className="h-3 w-3" />
                            <span>Unsynced</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-success-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-success-text)] border border-[var(--color-success-border)]">
                            <CheckCircle className="h-3 w-3 text-[var(--color-accent)]" />
                            <span>Synced</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetailModal(inv);
                          }}
                          className="rounded-[8px] bg-[var(--color-surface-subtle)] border border-[var(--color-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
                        >
                          View / Actions
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer shortcuts & Pagination Bar */}
        <div className="flex flex-wrap items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-canvas)] px-4 py-2 text-[11px] text-[var(--color-text-muted)] font-medium gap-2">
          <div className="flex items-center gap-4">
            <span><kbd className="rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 shadow-2xs font-mono">↑/↓</kbd> Select Invoice</span>
            <span><kbd className="rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 shadow-2xs font-mono">Enter</kbd> Open Details</span>
            <span><kbd className="rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 shadow-2xs font-mono">Esc</kbd> Return to POS</span>
          </div>

          <div className="flex items-center gap-3">
            <span>Total Shown: <strong className="font-mono text-[var(--color-text)]">{invoices.length}</strong></span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1 || loading}
                  onClick={() => loadInvoices(currentPage - 1)}
                  className="px-2 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40 cursor-pointer"
                >
                  Prev
                </button>
                <span className="font-mono font-medium">Page {currentPage} of {totalPages}</span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages || loading}
                  onClick={() => loadInvoices(currentPage + 1)}
                  className="px-2 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40 cursor-pointer"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* History Sync Progress Modal */}
      {isSyncingHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-card p-5 max-w-sm w-full shadow-2xl text-center space-y-3">
            <RefreshCw className="h-8 w-8 animate-spin text-[var(--color-accent)] mx-auto" />
            <h3 className="text-sm font-bold text-[var(--color-text)]">Synchronizing Invoice History</h3>
            <p className="text-xs text-[var(--color-text-muted)]">{syncHistoryProgress.step}</p>
            <div className="w-full bg-[var(--color-surface-subtle)] rounded-full h-2 overflow-hidden border border-[var(--color-border)]">
              <div
                className="bg-[var(--color-accent)] h-full transition-all duration-300"
                style={{
                  width: `${syncHistoryProgress.total > 0 ? (syncHistoryProgress.current / syncHistoryProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {isDetailModalOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 font-sans">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-modal overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
              <div className="flex items-center gap-3">
                <Receipt className="h-5 w-5 text-[var(--color-accent)]" />
                <div>
                  <h3 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
                    <span className="font-mono">Tax Invoice: {selectedInvoice.invoice_number}</span>
                    {selectedInvoice.status === "cancelled" ? (
                      <span className="rounded-full bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-danger-text)]">
                        Cancelled
                      </span>
                    ) : (
                      <span className="rounded-full bg-[var(--color-accent-soft)] border border-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-accent)]">
                        Issued
                      </span>
                    )}
                    {selectedInvoice.is_revised ? (
                      <span className="rounded-full bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-warning-text)]">
                        Revised Bill
                      </span>
                    ) : null}
                  </h3>
                  <p className="text-[11px] text-[var(--color-text-muted)] font-mono">
                    Billed on {selectedInvoice.invoice_date} • Counter: {selectedInvoice.user_counter || "Counter 01"}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="rounded-[6px] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {/* Customer & Bill Meta */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)] p-3">
                <div>
                  <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Customer Name</span>
                  <p className="font-bold text-[var(--color-text)] mt-0.5">{selectedInvoice.customer_name || "Walk-in Customer"}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Mobile Number</span>
                  <p className="font-mono font-medium text-[var(--color-text)] mt-0.5">{selectedInvoice.customer_phone || "Not specified"}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Payment Mode</span>
                  <p className="font-semibold text-[var(--color-accent)] mt-0.5">{selectedInvoice.payment_mode || "Cash"}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">GSTIN / Place of Supply</span>
                  <p className="font-mono text-[var(--color-text-muted)] mt-0.5">
                    {selectedInvoice.customer_gstin || "Unregistered"} ({selectedInvoice.place_of_supply || "32-Kerala"})
                  </p>
                </div>
              </div>

              {selectedInvoice.status === "cancelled" && (
                <div className="rounded-[10px] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] p-3 text-[var(--color-danger-text)]">
                  <span className="font-bold uppercase tracking-wider text-[10px]">Cancellation Reason:</span>
                  <p className="font-medium text-xs mt-0.5">{selectedInvoice.cancel_reason || "No reason specified"}</p>
                </div>
              )}

              {/* Items Table */}
              <div className="rounded-[10px] border border-[var(--color-border)] overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-[var(--color-canvas)] text-[var(--color-text-muted)] border-b border-[var(--color-border)] uppercase tracking-wider text-[11px] font-bold">
                    <tr>
                      <th className="px-3 py-2">Item & Description</th>
                      <th className="px-3 py-2">Batch</th>
                      <th className="px-3 py-2">Expiry</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit Rate</th>
                      <th className="px-3 py-2 text-right">GST %</th>
                      <th className="px-3 py-2 text-right">Total (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {selectedInvoiceItems.map((item, idx) => (
                      <tr key={item.id || idx} className="hover:bg-[var(--color-surface-hover)]">
                        <td className="px-3 py-2 font-bold text-[var(--color-text)]">{item.product_name}</td>
                        <td className="px-3 py-2 font-mono text-[var(--color-text-muted)]">{item.batch_no}</td>
                        <td className="px-3 py-2 font-mono text-[var(--color-text-muted)]">{item.expiry_date}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                          {item.qty} {item.loose_qty ? `+ ${item.loose_qty}L` : ""}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">₹ {item.unit_price.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono">{item.gst_percent}%</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-[var(--color-text)] tabular-nums">
                          ₹ {item.total_amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals Breakdown */}
              <div className="flex justify-end">
                <div className="w-64 space-y-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)] p-3 text-xs">
                  <div className="flex justify-between text-[var(--color-text-muted)]">
                    <span>Taxable Subtotal:</span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">₹ {selectedInvoice.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[var(--color-text-muted)]">
                    <span>GST Tax Total:</span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">₹ {selectedInvoice.tax_total.toFixed(2)}</span>
                  </div>
                  {selectedInvoice.round_off !== 0 && (
                    <div className="flex justify-between text-[var(--color-text-muted)]">
                      <span>Round-Off:</span>
                      <span className="font-mono tabular-nums">
                        {selectedInvoice.round_off > 0 ? "+" : ""}
                        {selectedInvoice.round_off.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="border-t border-[var(--color-border)] pt-1 flex justify-between font-bold text-sm text-[var(--color-text)]">
                    <span>Grand Total:</span>
                    <span className="font-mono text-[var(--color-accent)] tabular-nums">₹ {selectedInvoice.grand_total.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Payment Tenders & Receipts Breakdown */}
              <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 font-bold text-[var(--color-text)] text-xs uppercase tracking-wider">
                    <CreditCard className="h-4 w-4 text-[var(--color-accent)]" />
                    <span>Payment Tenders & Receipts ({selectedInvoice.payments?.length || 1})</span>
                  </div>
                  {(() => {
                    const totalPaid = (selectedInvoice.payments || []).reduce(
                      (sum, p) => (p.status !== "refunded" ? sum + p.amount : sum),
                      0
                    );
                    const balDue = Math.max(0, Math.round((selectedInvoice.grand_total - totalPaid + Number.EPSILON) * 100) / 100);
                    if (selectedInvoice.status !== "cancelled" && balDue > 0) {
                      return (
                        <button
                          type="button"
                          onClick={handleOpenReceivePayment}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer transition-colors shadow-xs"
                        >
                          <PlusCircle className="h-3.5 w-3.5" />
                          <span>Receive Payment (₹{balDue.toFixed(2)} due)</span>
                        </button>
                      );
                    }
                    return null;
                  })()}
                </div>

                <div className="overflow-hidden rounded border border-[var(--color-border)]">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-[var(--color-canvas)] text-[var(--color-text-muted)] border-b border-[var(--color-border)] uppercase tracking-wider font-bold">
                      <tr>
                        <th className="px-3 py-1.5">Mode</th>
                        <th className="px-3 py-1.5 text-right">Amount</th>
                        <th className="px-3 py-1.5">Reference / Txn ID</th>
                        <th className="px-3 py-1.5">Status</th>
                        <th className="px-3 py-1.5">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {selectedInvoice.payments && selectedInvoice.payments.length > 0 ? (
                        selectedInvoice.payments.map((p, idx) => {
                          let extra: any = {};
                          try {
                            extra = typeof p.extra_fields === "string" ? JSON.parse(p.extra_fields) : p.extra_fields || {};
                          } catch {
                            // ignore
                          }
                          return (
                            <tr key={p.id || idx} className="hover:bg-[var(--color-surface-hover)]">
                              <td className="px-3 py-1.5 font-bold text-[var(--color-text)]">{p.payment_mode}</td>
                              <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums text-[var(--color-text)]">
                                ₹ {p.amount.toFixed(2)}
                              </td>
                              <td className="px-3 py-1.5 font-mono text-[var(--color-text-muted)]">
                                {p.reference_no || "—"}
                              </td>
                              <td className="px-3 py-1.5">
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                    p.status === "refunded"
                                      ? "bg-rose-100 text-rose-800"
                                      : p.status === "pending_clearance"
                                      ? "bg-amber-100 text-amber-800"
                                      : "bg-emerald-100 text-emerald-800"
                                  }`}
                                >
                                  {p.status || "received"}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-[var(--color-text-muted)]">
                                {extra.bank_name ? `Bank: ${extra.bank_name} ` : ""}
                                {extra.card_last_four ? `Card: •••• ${extra.card_last_four} ` : ""}
                                {extra.card_network ? `(${extra.card_network}) ` : ""}
                                {extra.payer_vpa ? `VPA: ${extra.payer_vpa} ` : ""}
                                {p.notes ? `Note: ${p.notes}` : ""}
                                {!extra.bank_name && !extra.card_last_four && !extra.payer_vpa && !p.notes && "—"}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td className="px-3 py-1.5 font-bold text-[var(--color-text)]">{selectedInvoice.payment_mode || "Cash"}</td>
                          <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums text-[var(--color-text)]">
                            ₹ {selectedInvoice.grand_total.toFixed(2)}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[var(--color-text-muted)]">—</td>
                          <td className="px-3 py-1.5">
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800">
                              received
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-[var(--color-text-muted)]">—</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Audit History Log */}
              {selectedInvoiceAudit.length > 0 && (
                <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  <h4 className="font-bold text-[var(--color-text)] text-xs mb-2 uppercase tracking-wider">Audit & Revision Trail</h4>
                  <div className="space-y-1.5">
                    {selectedInvoiceAudit.map((entry, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-[11px] text-[var(--color-text-muted)]">
                        <span className="rounded-full bg-[var(--color-canvas)] border border-[var(--color-border)] px-2 py-0.5 font-bold uppercase text-[9px] text-[var(--color-text)]">
                          {entry.action}
                        </span>
                        <span className="font-semibold text-[var(--color-text)]">{entry.user}</span>
                        <span className="font-mono text-[var(--color-text-muted)]">
                          ({new Date(entry.timestamp).toLocaleString()})
                        </span>
                        <span>— {entry.diffSummary || entry.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
              {/* Reprints */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleReprint("a4")}
                  className="flex items-center gap-1 rounded-[10px] bg-[var(--color-accent)] px-3 py-1.5 text-xs font-bold text-white hover:bg-[var(--color-accent-hover)] cursor-pointer transition-colors"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Reprint A4</span>
                </button>
                <button
                  onClick={() => handleReprint("thermal")}
                  className="flex items-center gap-1 rounded-[10px] bg-[var(--color-text)] px-3 py-1.5 text-xs font-bold text-white hover:bg-black cursor-pointer transition-colors"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Reprint Thermal</span>
                </button>
                <button
                  onClick={() => handleReprint("pdf")}
                  className="flex items-center gap-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Save PDF</span>
                </button>
                <button
                  onClick={handleWhatsAppShare}
                  className="flex items-center gap-1 rounded-[10px] bg-[var(--color-accent-soft)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-border)] cursor-pointer transition-colors"
                  title="Share via WhatsApp"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  <span>WhatsApp</span>
                </button>
              </div>

              {/* Privileged / Modification Operations */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDuplicateAsNewBill}
                  className="flex items-center gap-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
                  title="Load into POS cart as a new bill"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Duplicate as New</span>
                </button>

                {selectedInvoice.status !== "cancelled" && (
                  <>
                    <button
                      onClick={() => {
                        setIsDetailModalOpen(false);
                        navigate(`/returns/sales?invoiceId=${selectedInvoice.id}`);
                      }}
                      className="flex items-center gap-1 rounded-[10px] bg-[var(--color-surface)] border border-[var(--color-warning-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-warning-text)] hover:bg-[var(--color-warning-bg)] cursor-pointer transition-colors"
                      title="Issue credit note / process customer return"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Return / Credit Note</span>
                    </button>
                    <button
                      onClick={handlePromptEdit}
                      className="flex items-center gap-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
                    >
                      <Edit className="h-3.5 w-3.5" />
                      <span>Edit Bill</span>
                    </button>
                    <button
                      onClick={handlePromptCancel}
                      className="flex items-center gap-1 rounded-[10px] bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-danger-text)] hover:bg-red-700 hover:text-white cursor-pointer transition-colors"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>Cancel Bill</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit PIN Prompt Modal */}
      {isEditPinModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4 font-sans">
          <div className="w-full max-w-sm rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-modal">
            <div className="flex items-center gap-2 text-[var(--color-warning-text)] mb-3">
              <Lock className="h-5 w-5" />
              <h3 className="font-bold text-[var(--color-text)] text-sm">Manager Authorization Required</h3>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mb-3">
              Editing a saved invoice requires manager verification. Please enter Manager PIN.
            </p>
            <input
              type="password"
              value={editPin}
              onChange={(e) => setEditPin(e.target.value)}
              placeholder="Enter PIN (Default: 1234)"
              autoFocus
              className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 text-center text-sm font-mono tracking-widest text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)]"
            />
            {editPinError && <p className="mt-1.5 text-[11px] font-bold text-[var(--color-danger-text)]">{editPinError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setIsEditPinModalOpen(false)}
                className="rounded-[10px] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmEditPin}
                className="rounded-[10px] bg-[var(--color-accent)] px-4 py-1.5 text-xs font-bold text-white hover:bg-[var(--color-accent-hover)] cursor-pointer transition-colors"
              >
                Authorize & Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Invoice Modal */}
      {isCancelModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4 font-sans">
          <div className="w-full max-w-md rounded-[14px] border border-[var(--color-danger-border)] bg-[var(--color-surface)] p-5 shadow-modal space-y-4">
            <div className="flex items-center gap-2 text-[var(--color-danger-text)]">
              <AlertCircle className="h-5 w-5" />
              <h3 className="font-bold text-[var(--color-text)] text-sm">Cancel Invoice {selectedInvoice?.invoice_number}</h3>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Cancelling will restore all items to batch inventory, update reports, and retain this invoice number marked as <strong>Cancelled</strong>.
            </p>

            <div>
              <label className="text-xs font-bold text-[var(--color-text)]">Mandatory Cancellation Reason:</label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g., Customer returned items, Billing mistake..."
                className="w-full rounded-[10px] border border-[var(--color-border)] p-2 text-xs text-[var(--color-text)] focus:border-[var(--color-danger-text)] focus:outline-none mt-1 bg-[var(--color-surface)]"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[var(--color-text)]">Manager PIN:</label>
              <input
                type="password"
                value={managerPin}
                onChange={(e) => setManagerPin(e.target.value)}
                placeholder="Default: 1234"
                className="w-full rounded-[10px] border border-[var(--color-border)] p-2 text-xs font-mono tracking-widest text-[var(--color-text)] focus:border-[var(--color-danger-text)] focus:outline-none mt-1 bg-[var(--color-surface)]"
              />
            </div>

            {pinError && <p className="text-xs font-bold text-[var(--color-danger-text)]">{pinError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsCancelModalOpen(false)}
                className="rounded-[10px] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
              >
                Keep Invoice
              </button>
              <button
                onClick={handleConfirmCancel}
                className="rounded-[10px] bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-1.5 text-xs font-bold text-[var(--color-danger-text)] hover:bg-red-700 hover:text-white cursor-pointer transition-colors"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Payment Modal */}
      {isReceivePaymentModalOpen && selectedInvoice && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 font-sans animate-in fade-in duration-100">
          <div className="w-full max-w-md rounded-[14px] bg-[var(--color-surface)] shadow-modal overflow-hidden border border-[var(--color-border)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3.5 bg-[var(--color-canvas)]">
              <div>
                <h3 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4 text-emerald-600" />
                  <span>Receive Payment - #{selectedInvoice.invoice_number}</span>
                </h3>
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  Customer: {selectedInvoice.customer_name || "Walk-in Customer"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsReceivePaymentModalOpen(false)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1 rounded-btn hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="text-[11px] font-semibold text-[var(--color-text-muted)] block mb-1">
                  Payment Mode
                </label>
                <select
                  value={receiptMode}
                  onChange={(e) => setReceiptMode(e.target.value)}
                  className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
                >
                  {["Cash", "UPI", "Card", "Bank Transfer", "Cheque"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--color-text-muted)] block mb-1">
                  Receipt Amount (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={receiptAmount === 0 ? "" : receiptAmount}
                  onChange={(e) => setReceiptAmount(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm font-mono font-bold text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--color-text-muted)] block mb-1">
                  Transaction ID / Reference (Optional)
                </label>
                <input
                  type="text"
                  value={receiptReference}
                  onChange={(e) => setReceiptReference(e.target.value)}
                  placeholder="e.g. UTR / Approval code / Cheque No."
                  className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--color-text-muted)] block mb-1">
                  Receipt Note
                </label>
                <input
                  type="text"
                  value={receiptNotes}
                  onChange={(e) => setReceiptNotes(e.target.value)}
                  placeholder="Optional memo"
                  className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
                />
              </div>
            </div>

            <div className="border-t border-[var(--color-border)] bg-[var(--color-canvas)] px-5 py-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsReceivePaymentModalOpen(false)}
                className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingReceipt || receiptAmount <= 0}
                onClick={handleRecordReceipt}
                className="flex items-center gap-1.5 rounded-[8px] bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" />
                <span>{isSubmittingReceipt ? "Recording..." : "Record Payment Receipt"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print Preview Modal */}
      {previewModalState.isOpen && previewModalState.data && (
        <PrintPreviewModal
          isOpen={previewModalState.isOpen}
          onClose={() => setPreviewModalState({ isOpen: false, data: null })}
          docType="tax_invoice"
          title={previewModalState.title || "Print Preview - Tax Invoice"}
          data={previewModalState.data}
          initialFormat={previewModalState.initialFormat}
          customerPhone={selectedInvoice?.customer_phone}
        />
      )}
    </div>
  );
};

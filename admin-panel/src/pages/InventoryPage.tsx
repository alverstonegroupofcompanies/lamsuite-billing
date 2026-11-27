import React, { useEffect, useState } from "react";
import { ProductBatch } from "../types";
import { api } from "../services/api";
import { formatINR, formatDate, formatDateTime, formatIndianNumber } from "../utils/formatters";
import { useAuth } from "../context/AuthContext";
import { RowAction } from "../components/RowAction";
import { RecordInspector, type InspectorColumn, type InspectorField } from "../components/RecordInspector";
import {
  Boxes,
  Search,
  Clock,
  ArrowRightLeft,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Plus,
  RefreshCw,
  X,
  ShieldCheck,
  Eye,
} from "lucide-react";

type InspectorRequest = Omit<React.ComponentProps<typeof RecordInspector>, "onClose">;

/**
 * MV-BAT-01 — the batch behind a row of the batch list or a near-expiry alert, read inline.
 *
 * A batch has no show endpoint of its own, so the inspector shows the batch facts from the list row
 * and pulls the product's inward/outward ledger, which is what an owner checks before writing a batch
 * down: where the remaining units came from and when. The two lists carry the product differently —
 * the alert query flattens it to product_name, the batch list nests it under product — and only the
 * alert row knows days_remaining, so both readers are resolved field by field.
 */
const batchLedgerColumns: InspectorColumn[] = [
  { key: "transaction_date", label: "Date", render: (line: any) => formatDate(line.transaction_date) },
  { key: "voucher_type", label: "Voucher" },
  { key: "reference_number", label: "Reference", mono: true },
  { key: "batch_no", label: "Batch", mono: true },
  { label: "In", align: "right", render: (line: any) => formatIndianNumber(line.in_qty) },
  { label: "Out", align: "right", render: (line: any) => formatIndianNumber(line.out_qty) },
  { label: "Party", render: (line: any) => line.party_name || "—" },
];

const inspectBatch = (b: any): InspectorRequest => ({
  kind: "Batch",
  heading: `Batch ${b.batch_no}`,
  subheading: b.product_name || b.product?.name,
  endpoint: `/admin/inventory/ledger?product_id=${b.product_id}`,
  row: b,
  lineKey: "data",
  columns: batchLedgerColumns,
  linesEmpty: "No inward or outward movement recorded for this product.",
  fields: (record) => [
    { label: "Product", value: record.product_name || record.product?.name, strong: true },
    { label: "Batch", value: record.batch_no, mono: true },
    { label: "Expiry", value: formatDate(record.expiry_date) },
    record.days_remaining === undefined || record.days_remaining === null
      ? null
      : {
          label: "Days remaining",
          value: `${record.days_remaining} days`,
          tone: Number(record.days_remaining) < 0 ? "credit" : undefined,
        },
    { label: "Stock on hand", value: formatIndianNumber(record.stock_qty), strong: true },
    { label: "MRP", value: record.mrp, money: true },
    { label: "Selling rate", value: record.selling_rate, money: true },
  ].filter(Boolean) as InspectorField[],
  note: "The ledger below is the product's whole movement history — read the Batch column for this batch's rows. Rate, MRP and expiry are corrected on the batch record itself; this row's Reconcile action writes the physical count.",
});

/**
 * STK-05 — a branch transfer read inline from the inventory tab.
 *
 * `/admin/stock/transfers` eager-loads the batch lines, and the server has no show route for one
 * transfer, so this inspector reads the row it was opened from rather than fetching a document that
 * does not exist. The lines carry sent and received quantities; the shortfall is what the receive
 * dialog below has to account for.
 */
const transferLineColumns: InspectorColumn[] = [
  { label: "Item", render: (line: any) => line.product?.name || line.product_name },
  { label: "Batch", mono: true, render: (line: any) => line.batch_no },
  { label: "Sent", align: "right", mono: true, render: (line: any) => formatIndianNumber(line.qty) },
  {
    label: "Received",
    align: "right",
    mono: true,
    render: (line: any) => (line.received_qty === null || line.received_qty === undefined ? "—" : formatIndianNumber(line.received_qty)),
  },
  {
    label: "Short",
    align: "right",
    mono: true,
    render: (line: any) => (Number(line.short_qty) ? formatIndianNumber(line.short_qty) : "—"),
  },
  { label: "Shortage reason", render: (line: any) => line.shortage_reason || "—" },
];

const inspectInventoryTransfer = (t: any): InspectorRequest => ({
  kind: "Stock Transfer",
  heading: t.transfer_number || `Transfer #${t.id}`,
  subheading: `${t.from_store?.name || `Store #${t.from_store_id}`} → ${t.to_store?.name || `Store #${t.to_store_id}`}`,
  row: t,
  columns: transferLineColumns,
  linesEmpty: "This transfer has no batch lines recorded.",
  fields: (record) => [
    { label: "Status", value: record.status },
    { label: "Raised", value: formatDateTime(record.created_at) },
    { label: "Dispatched By", value: record.creator?.name },
    { label: "Received", value: record.received_at ? formatDateTime(record.received_at) : undefined },
    { label: "Notes", value: record.notes },
  ],
  note: "Stock leaves the origin branch on dispatch and reaches the destination only when the receiving branch posts goods receipt from this row's Actions.",
});

/**
 * STK-04 — one row of the stock ledger is a movement, not a document.
 *
 * `stockLedger` unions purchase and invoice lines and keeps only the reference number, so a ledger
 * row has no id to open. The inspector therefore reads the row itself and copies the reference out,
 * and the second action hands the batch to the Batch Inventory list where the quantity is actionable.
 */
const inspectLedgerMovement = (entry: any): InspectorRequest => ({
  kind: "Stock movement",
  heading: entry.reference_number || `${entry.voucher_type}`,
  subheading: `${entry.product_name} · ${entry.batch_no || "no batch"}`,
  row: entry,
  fields: (record) => [
    { label: "Voucher", value: record.voucher_type, strong: true },
    { label: "Reference", value: record.reference_number, mono: true },
    { label: "Date", value: formatDate(record.transaction_date) },
    { label: "Product", value: record.product_name },
    { label: "Batch", value: record.batch_no, mono: true },
    { label: "Party", value: record.party_name },
  ],
  totals: (record) => [
    { label: "Units in", value: `${formatIndianNumber(record.in_qty)} units` },
    { label: "Units out", value: `${formatIndianNumber(record.out_qty)} units` },
    {
      label: "Net movement",
      value: `${Number(record.in_qty) > 0 ? "+" : "−"}${formatIndianNumber(Math.abs(Number(record.in_qty) || Number(record.out_qty)))} units`,
    },
  ],
  note: "The ledger stores the voucher number, not the voucher itself — the document is under Transactions, and the quantity this movement left behind is on the Batch Inventory list.",
});

/** MV-ADJ-01 — the lines behind an adjustment document, which the list row only counts. */
const adjustmentLineColumns: InspectorColumn[] = [
  { label: "Product", render: (line: any) => line.product?.name || line.product_name },
  { label: "Batch", mono: true, render: (line: any) => line.batch?.batch_no || line.batch_no || "—" },
  { label: "System", align: "right", render: (line: any) => formatIndianNumber(line.system_qty) },
  {
    label: "Counted",
    align: "right",
    render: (line: any) => (line.counted_qty === null || line.counted_qty === undefined ? "—" : formatIndianNumber(line.counted_qty)),
  },
  {
    label: "Adjustment",
    align: "right",
    mono: true,
    render: (line: any) => `${Number(line.adjustment_qty) > 0 ? "+" : ""}${formatIndianNumber(line.adjustment_qty)}`,
  },
  { label: "Reason", render: (line: any) => line.reason || line.notes || "—" },
];

const inspectAdjustmentDocument = (doc: AdjustmentDocument): InspectorRequest => ({
  kind: "Stock adjustment",
  heading: doc.document_id,
  subheading: doc.mode === "physical_count" ? "Physical count" : "Manual adjustment",
  endpoint: `/admin/stock-adjustments/${doc.id}`,
  row: doc,
  lineKey: "lines",
  columns: adjustmentLineColumns,
  linesEmpty: "This document has no lines.",
  fields: (record) => [
    { label: "Document", value: record.document_id, mono: true, strong: true },
    { label: "Mode", value: record.mode === "physical_count" ? "Physical count" : "Manual adjustment" },
    { label: "Document date", value: formatDate(record.document_date) },
    { label: "Submitted", value: formatDate(record.created_at) },
    { label: "Submitted by", value: record.creator?.name || "—" },
    { label: "Decided by", value: record.approver?.name || "—" },
    { label: "Status", value: String(record.status || "").replace("_", " ") },
    { label: "Held by rule", value: record.blocking_rule || "—" },
    { label: "Reason", value: record.reason || "—" },
    { label: "Notes", value: record.notes || "—" },
  ],
  totals: (record) => [
    { label: "Lines", value: String(record.lines_count ?? (record.lines || []).length) },
    { label: "Net units", value: formatIndianNumber(record.total_qty) },
    { label: "Value at cost", value: record.total_value, money: true },
  ],
  note: "A pending document has moved no stock yet — approving it from this row's Actions posts every line to the batch ledger.",
});


interface AdjustmentLine {
  id: number;
  product_name?: string;
  batch_no?: string;
  system_qty?: number;
  counted_qty?: number | null;
  adjustment_qty?: number;
  reason?: string;
  notes?: string;
}

interface AdjustmentDocument {
  id: number;
  document_id: string;
  mode: "adjustment" | "physical_count";
  status: string;
  lines_count: number;
  total_qty: number;
  total_value: number;
  requires_approval: boolean;
  created_at: string;
  creator?: { name?: string };
  approver?: { name?: string };
  lines?: AdjustmentLine[];
}

interface ReceiptLineDraft {
  item_id: number;
  product_name: string;
  batch_no: string;
  dispatched: number;
  received: number;
  reason: string;
  dest_product_id: number | "";
}

interface AdjustmentPolicy {
  allow_negative_stock: boolean;
  allowed_roles: string[];
  allowed_reasons: string[];
  max_qty_per_line: number | null;
  max_value_per_document: number | null;
  max_documents_per_day: number | null;
  max_units_per_day: number | null;
  require_notes: boolean;
  approval_threshold_value: number | null;
  approval_threshold_qty: number | null;
  approver_roles: string[];
  locked_before_date: string | null;
  allowed_time_window: { start: string; end: string } | null;
}

export const InventoryPage: React.FC = () => {
  const { activeStore, stores, hasPermission, isAllStores } = useAuth();
  const [activeTab, setActiveTab] = useState<
    "batches" | "ledger" | "near_expiry" | "transfers" | "adjustments"
  >("batches");

  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [nearExpiryBatches, setNearExpiryBatches] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentDocument[]>([]);
  const [adjustmentStatus, setAdjustmentStatus] = useState<"pending_approval" | "all">("pending_approval");
  const [adjustmentPolicy, setAdjustmentPolicy] = useState<AdjustmentPolicy | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Pagination for Batches
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [perPage, setPerPage] = useState(50);

  // Transfer Dispatch Modal
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [toStoreId, setToStoreId] = useState<number | "">("");
  const [transferItems, setTransferItems] = useState<Array<{ product_id: number; batch_no: string; qty: number }>>([
    { product_id: 1, batch_no: "DL9812", qty: 10 },
  ]);

  // Receive Transfer Modal
  const [receiptTransfer, setReceiptTransfer] = useState<any | null>(null);
  const [receiptLines, setReceiptLines] = useState<ReceiptLineDraft[]>([]);
  const [receiptProducts, setReceiptProducts] = useState<Array<{ id: number; name: string; barcode?: string | null }>>([]);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);

  // Reconciliation Modal
  const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
  const [reconcileBatch, setReconcileBatch] = useState<ProductBatch | null>(null);
  const [physicalQty, setPhysicalQty] = useState<number>(0);
  const [reconcileReason, setReconcileReason] = useState("");

  const [inspector, setInspector] = useState<InspectorRequest | null>(null);

  const fetchInventory = async () => {
    setIsLoading(true);
    try {
      if (activeTab === "batches") {
        const res = await api.get<{
          data: ProductBatch[];
          current_page: number;
          last_page: number;
          total: number;
        }>("/admin/inventory/batches", { search, page, per_page: perPage });
        setBatches(res.data || []);
        setPage(res.current_page || 1);
        setTotalPages(res.last_page || 1);
        setTotalCount(res.total || 0);
      } else if (activeTab === "ledger") {
        const res = await api.get<{ data: any[] }>("/admin/inventory/ledger");
        setLedgerEntries(res.data || []);
      } else if (activeTab === "near_expiry") {
        const res = await api.get<any[]>("/admin/inventory/near-expiry");
        setNearExpiryBatches(res || []);
      } else if (activeTab === "transfers") {
        const res = await api.get<{ data: any[] }>("/admin/stock/transfers");
        setTransfers(res.data || []);
      } else if (activeTab === "adjustments") {
        const [docs, policyRes] = await Promise.all([
          api.get<{ data: AdjustmentDocument[] }>("/admin/stock-adjustments", {
            status: adjustmentStatus === "all" ? undefined : adjustmentStatus,
            per_page: 50,
          }),
          api.get<{ policy: AdjustmentPolicy }>("/admin/stock-adjustments/policy"),
        ]);
        setAdjustments(docs.data || []);
        setAdjustmentPolicy(policyRes.policy || null);
      }
    } catch (err) {
      console.error("Failed to load inventory:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, [activeTab, search, page, perPage, activeStore, adjustmentStatus]);

  const handleDispatchTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStore || !toStoreId) return;

    try {
      await api.post("/admin/inventory/transfers/dispatch", {
        from_store_id: activeStore.id,
        to_store_id: Number(toStoreId),
        items: transferItems,
      });
      alert("Inter-store stock transfer dispatched successfully.");
      setIsTransferModalOpen(false);
      await fetchInventory();
    } catch (err: any) {
      alert(err?.message || "Transfer dispatch failed.");
    }
  };

  const openReceiveDialog = async (transfer: any) => {
    setReceiptError(null);
    setReceiptTransfer(transfer);
    setReceiptLines(
      (transfer.items || []).map((item: any) => ({
        item_id: item.id,
        product_name: item.product?.name ?? `#${item.product_id}`,
        batch_no: item.batch_no,
        dispatched: Number(item.qty),
        received: Number(item.qty),
        reason: "",
        dest_product_id: "",
      }))
    );

    try {
      const res = await api.get<any>("/admin/products", { per_page: 200 });
      const list = Array.isArray(res) ? res : res?.data || [];
      setReceiptProducts(list);
    } catch {
      setReceiptProducts([]);
    }
  };

  const handleSubmitReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptTransfer) return;

    const invalid = receiptLines.find(
      (line) => line.received < 0 || line.received > line.dispatched || (line.received < line.dispatched && !line.reason.trim())
    );
    if (invalid) {
      setReceiptError(
        `Batch ${invalid.batch_no}: received quantity must be between 0 and ${invalid.dispatched}, and a shortage reason is required when short.`
      );
      return;
    }

    setReceiptBusy(true);
    setReceiptError(null);
    try {
      await api.post(`/admin/inventory/transfers/${receiptTransfer.id}/receive`, {
        lines: receiptLines.map((line) => ({
          item_id: line.item_id,
          received_qty: line.received,
          shortage_reason: line.reason.trim() || undefined,
          dest_product_id: line.dest_product_id === "" ? undefined : line.dest_product_id,
        })),
      });
      setReceiptTransfer(null);
      await fetchInventory();
    } catch (err: any) {
      setReceiptError(err?.message || "Transfer receive failed.");
    } finally {
      setReceiptBusy(false);
    }
  };

  const handleReconcileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reconcileBatch || !activeStore) return;

    try {
      await api.post("/admin/inventory/reconcile", {
        store_id: activeStore.id,
        product_id: reconcileBatch.product_id,
        batch_no: reconcileBatch.batch_no,
        physical_qty: Number(physicalQty),
        reason: reconcileReason,
      });
      alert("Stock successfully reconciled with adjustment voucher created.");
      setIsReconcileModalOpen(false);
      await fetchInventory();
    } catch (err: any) {
      alert(err?.message || "Reconciliation failed.");
    }
  };

  const handleApproveAdjustment = async (documentId: number) => {
    try {
      await api.post(`/admin/stock-adjustments/${documentId}/approve`);
      await fetchInventory();
    } catch (err: any) {
      alert(err?.message || "Approval failed.");
    }
  };

  const handleRejectAdjustment = async (documentId: number) => {
    const reason = window.prompt("Rejection reason (optional)");
    if (reason === null) return;
    try {
      await api.post(`/admin/stock-adjustments/${documentId}/reject`, { reason });
      await fetchInventory();
    } catch (err: any) {
      alert(err?.message || "Rejection failed.");
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustmentPolicy) return;
    setPolicyBusy(true);
    try {
      const res = await api.put<{ policy: AdjustmentPolicy }>("/admin/stock-adjustments/policy", {
        policy: adjustmentPolicy,
      });
      setAdjustmentPolicy(res.policy);
      alert("Stock adjustment policy saved. Desktop and sync workers pick it up on next load.");
    } catch (err: any) {
      alert(err?.message || "Could not save the policy.");
    } finally {
      setPolicyBusy(false);
    }
  };

  const updatePolicy = (patch: Partial<AdjustmentPolicy>) => {
    setAdjustmentPolicy((current) => (current ? { ...current, ...patch } : current));
  };

  const parseNumber = (value: string): number | null => (value === "" ? null : Number(value));

  return (
    <div className="space-y-6">
      {/* Title & Dispatch Transfer Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Inventory & Batch Control
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Batch-level tracking, near-expiry alerts, stock ledger timeline, and inter-store branch transfers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {hasPermission("inventory", "create") && stores.length > 1 && (
            <button
              onClick={() => setIsTransferModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl shadow-sm"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Dispatch Transfer</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-4 text-xs font-semibold overflow-x-auto pb-0.5">
        {[
          { id: "batches", label: "Batch Inventory", icon: Boxes },
          { id: "ledger", label: "Stock Ledger", icon: Sliders },
          { id: "near_expiry", label: "Near-Expiry & Expired", icon: Clock },
          { id: "transfers", label: "Inter-Store Transfers", icon: ArrowRightLeft },
          { id: "adjustments", label: "Adjustments & Policy", icon: ShieldCheck },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-2.5 flex items-center gap-1.5 border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? "border-brand-600 text-brand-600 dark:text-brand-400 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Search Bar & Toolbar */}
      {activeTab === "batches" && (
        <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search batch number, SKU name..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={() => fetchInventory()}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200 transition-colors"
              title="Refresh inventory"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-brand-600" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      )}

      {/* Batches Table */}
      {activeTab === "batches" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Product Name</th>
                  {isAllStores && <th className="px-4 py-3">Store</th>}
                  <th className="px-4 py-3">Batch Number</th>
                  <th className="px-4 py-3">Expiry Date</th>
                  <th className="px-4 py-3 text-right">MRP</th>
                  <th className="px-4 py-3 text-right">Selling Rate</th>
                  <th className="px-4 py-3 text-center">In-Stock Qty</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={isAllStores ? 8 : 7} className="px-4 py-8 text-center text-slate-400">
                      Loading batch inventory...
                    </td>
                  </tr>
                ) : batches.length === 0 ? (
                  <tr>
                    <td colSpan={isAllStores ? 8 : 7} className="px-4 py-8 text-center text-slate-400">
                      No batch inventory recorded.
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                        {b.product?.name || "SKU Item"}
                      </td>
                      {isAllStores && (
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-700 dark:text-slate-300">{b.store?.name || `Store #${b.store_id}`}</div>
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono font-semibold text-slate-700 dark:text-slate-300">
                        {b.batch_no}
                      </td>
                      <td className="px-4 py-3 font-mono">{formatDate(b.expiry_date)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatINR(b.mrp)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {formatINR(b.selling_rate)}
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-bold">
                        {formatIndianNumber(b.stock_qty)} units
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <RowAction
                            icon={Eye}
                            title="View batch & product movement"
                            onClick={() => setInspector(inspectBatch(b))}
                          />
                          {hasPermission("inventory", "edit") && (
                            <RowAction
                              icon={Sliders}
                              title="Reconcile this batch against physical stock"
                              tone="emerald"
                              onClick={() => {
                                setReconcileBatch(b);
                                setPhysicalQty(Number(b.stock_qty));
                                setReconcileReason("");
                                setIsReconcileModalOpen(true);
                              }}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <span>
                Showing page <strong className="text-slate-800 dark:text-slate-200 font-semibold">{page}</strong> of{" "}
                <strong className="text-slate-800 dark:text-slate-200 font-semibold">{totalPages}</strong> ({totalCount.toLocaleString()} total batches)
              </span>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <div className="flex items-center gap-1.5">
                <span>Per page:</span>
                <select
                  value={perPage}
                  onChange={(e) => {
                    setPerPage(Number(e.target.value));
                    setPage(1);
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
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50 dark:hover:bg-slate-700/60 transition shadow-2xs"
              >
                Previous
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                  let pNum = page - 2 + idx;
                  if (page < 3) pNum = idx + 1;
                  if (page > totalPages - 2) pNum = totalPages - 4 + idx;
                  if (pNum < 1 || pNum > totalPages) return null;

                  return (
                    <button
                      key={pNum}
                      onClick={() => setPage(pNum)}
                      className={`w-7 h-7 rounded-lg text-xs font-semibold transition ${
                        page === pNum
                          ? "bg-brand-600 text-white shadow-2xs"
                          : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      {pNum}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50 dark:hover:bg-slate-700/60 transition shadow-2xs"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stock Ledger Tab */}
      {activeTab === "ledger" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Stock Ledger</h2>
            <p className="text-[11px] text-slate-500">
              Purchases in, sales out, as the server unions them — the newest {ledgerEntries.length} movements of
              this store.
            </p>
          </div>
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Voucher</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3 text-right">In</th>
                <th className="px-4 py-3 text-right">Out</th>
                <th className="px-4 py-3">Party</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    Loading stock ledger...
                  </td>
                </tr>
              ) : ledgerEntries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    No stock movements recorded for this store yet.
                  </td>
                </tr>
              ) : (
                ledgerEntries.map((entry, index) => (
                  <tr
                    key={`${entry.reference_number}-${entry.batch_no}-${index}`}
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-3 font-mono">{formatDate(entry.transaction_date)}</td>
                    <td className="px-4 py-3">{entry.voucher_type}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-800 dark:text-slate-200">
                      {entry.reference_number || "—"}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{entry.product_name}</td>
                    <td className="px-4 py-3 font-mono">{entry.batch_no || "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                      {Number(entry.in_qty) > 0 ? formatIndianNumber(entry.in_qty) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-rose-500">
                      {Number(entry.out_qty) > 0 ? formatIndianNumber(entry.out_qty) : "—"}
                    </td>
                    <td className="px-4 py-3">{entry.party_name || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <RowAction
                          icon={Eye}
                          title="View this movement"
                          onClick={() => setInspector(inspectLedgerMovement(entry))}
                        />
                        {entry.batch_no ? (
                          <RowAction
                            icon={Search}
                            title="Find this batch in the batch list"
                            tone="brand"
                            onClick={() => {
                              setSearch(entry.batch_no);
                              setPage(1);
                              setActiveTab("batches");
                            }}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Near Expiry Tab */}
      {activeTab === "near_expiry" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3">Batch No</th>
                <th className="px-4 py-3">Expiry Date</th>
                <th className="px-4 py-3 text-center">Remaining Days</th>
                <th className="px-4 py-3 text-center">Stock Units</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {nearExpiryBatches.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{b.product_name}</td>
                  <td className="px-4 py-3 font-mono font-semibold">{b.batch_no}</td>
                  <td className="px-4 py-3 font-mono text-rose-500 font-semibold">{formatDate(b.expiry_date)}</td>
                  <td className="px-4 py-3 text-center font-mono font-bold">{b.days_remaining} days</td>
                  <td className="px-4 py-3 text-center font-mono">{formatIndianNumber(b.stock_qty)}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        b.is_expired
                          ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                      }`}
                    >
                      {b.is_expired ? "EXPIRED" : "NEAR EXPIRY"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <RowAction icon={Eye} title="View batch & product movement" onClick={() => setInspector(inspectBatch(b))} />
                      {activeStore && hasPermission("inventory", "edit") ? (
                        <RowAction
                          icon={Sliders}
                          title="Reconcile this batch against physical stock"
                          tone="emerald"
                          onClick={() => {
                            setReconcileBatch(b as unknown as ProductBatch);
                            setPhysicalQty(Number(b.stock_qty));
                            setReconcileReason("");
                            setIsReconcileModalOpen(true);
                          }}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Stock Transfers Tab */}
      {activeTab === "transfers" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Transfer No</th>
                <th className="px-4 py-3">Origin Branch</th>
                <th className="px-4 py-3">Destination Branch</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No branch transfers recorded.
                  </td>
                </tr>
              ) : (
              transfers.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                    {t.transfer_number}
                  </td>
                  <td className="px-4 py-3 font-semibold">{t.from_store?.name}</td>
                  <td className="px-4 py-3 font-semibold">{t.to_store?.name}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                        t.status === "received"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                          : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <RowAction
                        icon={Eye}
                        title="View transfer lines"
                        onClick={() => setInspector(inspectInventoryTransfer(t))}
                      />
                      {t.status === "dispatched" && (
                        <button
                          onClick={() => openReceiveDialog(t)}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-[10px]"
                        >
                          Receive Stock
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
      )}

      {/* Adjustments & Policy */}
      {activeTab === "adjustments" && (
        <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Stock Adjustment Documents</h2>
                <p className="text-[11px] text-slate-500">
                  Multi-line adjustments and physical counts. Documents above the approval threshold stay pending
                  until a permitted approver releases them.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={adjustmentStatus}
                  onChange={(e) => setAdjustmentStatus(e.target.value as "pending_approval" | "all")}
                  className="px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-300"
                >
                  <option value="pending_approval">Pending Approval</option>
                  <option value="all">All Documents</option>
                </select>
                <button
                  onClick={() => fetchInventory()}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-brand-600" : ""}`} />
                  <span>Refresh</span>
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Document</th>
                    <th className="px-4 py-3">Mode</th>
                    <th className="px-4 py-3 text-center">Lines</th>
                    <th className="px-4 py-3 text-right">Qty / Value</th>
                    <th className="px-4 py-3">Submitted By</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                        Loading adjustment documents...
                      </td>
                    </tr>
                  ) : adjustments.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                        No adjustment documents for this filter.
                      </td>
                    </tr>
                  ) : (
                    adjustments.map((doc) => (
                      <tr key={doc.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <div className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                            {doc.document_id}
                          </div>
                          <div className="text-[10px] text-slate-400">{formatDate(doc.created_at)}</div>
                        </td>
                        <td className="px-4 py-3 capitalize">{doc.mode.replace("_", " ")}</td>
                        <td className="px-4 py-3 text-center font-mono">{doc.lines_count}</td>
                        <td className="px-4 py-3 text-right font-mono">
                          {formatIndianNumber(doc.total_qty)} / {formatINR(doc.total_value)}
                        </td>
                        <td className="px-4 py-3">{doc.creator?.name || "-"}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                              doc.status === "pending_approval"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                                : doc.status === "approved" || doc.status === "posted"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                                : doc.status === "rejected"
                                ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
                                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            {doc.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <RowAction
                              icon={Eye}
                              title="View adjustment lines"
                              onClick={() => setInspector(inspectAdjustmentDocument(doc))}
                            />
                            {doc.status === "pending_approval" && hasPermission("inventory", "edit") ? (
                              <>
                                <button
                                  onClick={() => handleRejectAdjustment(doc.id)}
                                  className="px-2.5 py-1 bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-rose-950 dark:text-rose-400 font-semibold rounded-lg text-[10px]"
                                >
                                  Reject
                                </button>
                                <button
                                  onClick={() => handleApproveAdjustment(doc.id)}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-[10px]"
                                >
                                  Approve &amp; Post
                                </button>
                              </>
                            ) : (
                              <span className="text-[10px] text-slate-400">
                                {doc.approver?.name ? `By ${doc.approver.name}` : "—"}
                              </span>
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

          <form
            onSubmit={handleSavePolicy}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-3"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-brand-600" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Store Adjustment Policy</h2>
            </div>
            <p className="text-[11px] text-slate-500">
              One policy is enforced server-side for the desktop, sync worker and this admin panel.
            </p>

            {!adjustmentPolicy ? (
              <div className="text-xs text-slate-400">Loading policy...</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={adjustmentPolicy.allow_negative_stock}
                      onChange={(e) => updatePolicy({ allow_negative_stock: e.target.checked })}
                      className="rounded border-slate-300"
                    />
                    Allow negative stock
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={adjustmentPolicy.require_notes}
                      onChange={(e) => updatePolicy({ require_notes: e.target.checked })}
                      className="rounded border-slate-300"
                    />
                    Require notes/reason
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs">
                    <span className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Max qty / line</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={adjustmentPolicy.max_qty_per_line ?? ""}
                      onChange={(e) => updatePolicy({ max_qty_per_line: parseNumber(e.target.value) })}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white font-mono"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Max value / document</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={adjustmentPolicy.max_value_per_document ?? ""}
                      onChange={(e) => updatePolicy({ max_value_per_document: parseNumber(e.target.value) })}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white font-mono"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Approval threshold qty</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={adjustmentPolicy.approval_threshold_qty ?? ""}
                      onChange={(e) => updatePolicy({ approval_threshold_qty: parseNumber(e.target.value) })}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white font-mono"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Approval threshold value</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={adjustmentPolicy.approval_threshold_value ?? ""}
                      onChange={(e) => updatePolicy({ approval_threshold_value: parseNumber(e.target.value) })}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white font-mono"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Max documents / day</span>
                    <input
                      type="number"
                      min={0}
                      value={adjustmentPolicy.max_documents_per_day ?? ""}
                      onChange={(e) => updatePolicy({ max_documents_per_day: parseNumber(e.target.value) })}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white font-mono"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Max units / day</span>
                    <input
                      type="number"
                      min={0}
                      step="0.001"
                      value={adjustmentPolicy.max_units_per_day ?? ""}
                      onChange={(e) => updatePolicy({ max_units_per_day: parseNumber(e.target.value) })}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white font-mono"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Lock documents on/before</span>
                    <input
                      type="date"
                      value={adjustmentPolicy.locked_before_date ?? ""}
                      onChange={(e) => updatePolicy({ locked_before_date: e.target.value || null })}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </label>
                </div>

                <label className="block text-xs">
                  <span className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Allowed posting roles (comma separated)
                  </span>
                  <input
                    type="text"
                    value={adjustmentPolicy.allowed_roles.join(", ")}
                    onChange={(e) =>
                      updatePolicy({
                        allowed_roles: e.target.value
                          .split(",")
                          .map((role) => role.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="store_owner, manager"
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </label>

                <label className="block text-xs">
                  <span className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Approver roles (comma separated)
                  </span>
                  <input
                    type="text"
                    value={adjustmentPolicy.approver_roles.join(", ")}
                    onChange={(e) =>
                      updatePolicy({
                        approver_roles: e.target.value
                          .split(",")
                          .map((role) => role.trim())
                          .filter(Boolean),
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs">
                    <span className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Allowed from</span>
                    <input
                      type="time"
                      value={adjustmentPolicy.allowed_time_window?.start || ""}
                      onChange={(e) =>
                        updatePolicy({
                          allowed_time_window: e.target.value
                            ? { start: e.target.value, end: adjustmentPolicy.allowed_time_window?.end || "23:59" }
                            : null,
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Allowed until</span>
                    <input
                      type="time"
                      value={adjustmentPolicy.allowed_time_window?.end || ""}
                      onChange={(e) =>
                        updatePolicy({
                          allowed_time_window: e.target.value
                            ? { start: adjustmentPolicy.allowed_time_window?.start || "00:00", end: e.target.value }
                            : null,
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </label>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={policyBusy || !hasPermission("inventory", "edit")}
                    className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl shadow-sm disabled:opacity-50"
                  >
                    {policyBusy ? "Saving..." : "Save Policy"}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}

      {/* Transfer Dispatch Modal */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Dispatch Inter-Store Stock Transfer
              </h3>
              <button
                onClick={() => setIsTransferModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleDispatchTransfer} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Destination Branch Store *
                </label>
                <select
                  required
                  value={toStoreId}
                  onChange={(e) => setToStoreId(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="">Select destination store</option>
                  {stores
                    .filter((s) => s.id !== activeStore?.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Transfer Item & Batch
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    disabled
                    value="Dolo 650mg (Batch DL9812)"
                    className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  />
                  <input
                    type="number"
                    min={1}
                    required
                    value={transferItems[0].qty}
                    onChange={(e) =>
                      setTransferItems([{ ...transferItems[0], qty: Number(e.target.value) }])
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white font-mono"
                    placeholder="Units to transfer"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="px-3.5 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-lg shadow-sm"
                >
                  Dispatch Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock Reconciliation Modal */}
      {isReconcileModalOpen && reconcileBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Physical Stock Reconciliation: {reconcileBatch.batch_no}
              </h3>
              <button
                onClick={() => setIsReconcileModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleReconcileSubmit} className="space-y-4 text-xs">
              <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
                <div>System Ledger Stock: <strong>{reconcileBatch.stock_qty} units</strong></div>
                <div className="text-[11px] text-slate-500">
                  Adjustment difference will automatically record an inventory audit entry.
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Actual Physical Counted Qty *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={physicalQty}
                  onChange={(e) => setPhysicalQty(Number(e.target.value))}
                  className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Reconciliation Audit Reason *
                </label>
                <input
                  type="text"
                  required
                  value={reconcileReason}
                  onChange={(e) => setReconcileReason(e.target.value)}
                  placeholder="e.g. Physical inventory count discrepancy or damaged pack write-off"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsReconcileModalOpen(false)}
                  className="px-3.5 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-lg shadow-sm"
                >
                  Apply Reconciliation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {receiptTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-3xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  Receive {receiptTransfer.transfer_number}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Enter what actually arrived per line. A short line needs a reason; the sender already moved the full quantity out.
                </p>
              </div>
              <button
                onClick={() => setReceiptTransfer(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {receiptError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{receiptError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitReceipt} className="space-y-3 text-xs">
              {receiptLines.map((line, index) => {
                const short = line.received < line.dispatched;
                return (
                  <div
                    key={line.item_id}
                    className="grid gap-2 md:grid-cols-[1.4fr_0.7fr_0.7fr_0.9fr_1.2fr] items-end p-3 rounded-xl border border-slate-200 dark:border-slate-700"
                  >
                    <div>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{line.product_name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">Batch {line.batch_no}</div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Dispatched</label>
                      <input
                        type="text"
                        disabled
                        value={line.dispatched}
                        className="w-full px-2 py-1 font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Received</label>
                      <input
                        type="number"
                        min={0}
                        max={line.dispatched}
                        step="0.01"
                        value={line.received}
                        onChange={(e) =>
                          setReceiptLines((lines) =>
                            lines.map((l, i) => (i === index ? { ...l, received: Number(e.target.value) } : l))
                          )
                        }
                        className="w-full px-2 py-1 font-mono rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Destination Product</label>
                      <select
                        value={line.dest_product_id}
                        onChange={(e) =>
                          setReceiptLines((lines) =>
                            lines.map((l, i) =>
                              i === index ? { ...l, dest_product_id: e.target.value === "" ? "" : Number(e.target.value) } : l
                            )
                          )
                        }
                        className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-800"
                      >
                        <option value="">Auto-match by barcode</option>
                        {receiptProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                            {product.barcode ? ` (${product.barcode})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">
                        Shortage Reason {short ? "*" : ""}
                      </label>
                      <input
                        type="text"
                        value={line.reason}
                        onChange={(e) =>
                          setReceiptLines((lines) =>
                            lines.map((l, i) => (i === index ? { ...l, reason: e.target.value } : l))
                          )
                        }
                        placeholder={short ? "e.g. 5 strips crushed in transit" : "—"}
                        className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-800"
                      />
                    </div>
                  </div>
                );
              })}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReceiptTransfer(null)}
                  className="px-3.5 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={receiptBusy}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold rounded-lg shadow-sm"
                >
                  {receiptBusy ? "Receiving…" : "Receive Stock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Row Inspector: the batch or adjustment document behind any list row */}
      {inspector && <RecordInspector {...inspector} onClose={() => setInspector(null)} />}
    </div>
  );
};

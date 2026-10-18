import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package,
  Plus,
  ArrowRightLeft,
  AlertTriangle,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  X,
  FileCheck,
  Calendar,
} from "lucide-react";
import {
  inventoryService,
  type StockAdjustmentInput,
  type PhysicalReconciliationLine,
  type InterStoreTransferInput,
} from "../lib/stock/inventoryService";
import { productsStore, type ProductBatch, type ProductItem } from "../lib/masters/productsStore";
import { sqliteStorage } from "../lib/db/sqliteStorage";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

export const StockLedgerPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"ledger" | "adjustments" | "expiry" | "low_stock" | "negative_stock">("ledger");
  const [transactions, setTransactions] = useState<any[]>([]);
  const [nearExpiryBatches, setNearExpiryBatches] = useState<ProductBatch[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<ProductItem[]>([]);
  const [negativeStockBatches, setNegativeStockBatches] = useState<ProductBatch[]>([]);
  const [allBatches, setAllBatches] = useState<ProductBatch[]>([]);
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Modals State
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  useModalEscape(isAdjustmentModalOpen, () => setIsAdjustmentModalOpen(false));
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  useModalEscape(isTransferModalOpen, () => setIsTransferModalOpen(false));

  // Adjustment Form State
  const [adjBatchId, setAdjBatchId] = useState("");
  const [adjQty, setAdjQty] = useState<number>(-1);
  const [adjReason, setAdjReason] = useState<StockAdjustmentInput["reason"]>("Damaged");
  const [adjNotes, setAdjNotes] = useState("");

  // Transfer Form State
  const [trDestStore, setTrDestStore] = useState("Branch Store 02");
  const [trBatchId, setTrBatchId] = useState("");
  const [trQty, setTrQty] = useState<number>(1);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const txs = await sqliteStorage.findAll<any>("stock_transactions");
    setTransactions(txs.sort((a, b) => (b.created_at || 0) - (a.created_at || 0)));

    const batches = await sqliteStorage.findAll<ProductBatch>("product_batches");
    setAllBatches(batches);

    const near = await inventoryService.getBatchesNearExpiry(60);
    setNearExpiryBatches(near);

    const low = await inventoryService.getLowStockProducts();
    setLowStockProducts(low);

    const neg = await inventoryService.getNegativeStockBatches();
    setNegativeStockBatches(neg);
  };

  const showNotification = (message: string, type: "success" | "error" = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleRecordAdjustment = async () => {
    if (!adjBatchId) {
      showNotification("Please select a batch to adjust", "error");
      return;
    }

    const batch = allBatches.find((b) => b.id === adjBatchId);
    if (!batch) return;

    try {
      const res = await inventoryService.recordStockAdjustment({
        product_id: batch.product_id,
        batch_id: adjBatchId,
        adjustment_qty: adjQty,
        reason: adjReason,
        notes: adjNotes,
      });

      if (res.success) {
        showNotification("Stock adjustment recorded in ledger!");
        setIsAdjustmentModalOpen(false);
        setAdjNotes("");
        loadData();
      }
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Error recording adjustment", "error");
    }
  };

  const handleDispatchTransfer = async () => {
    if (!trBatchId) {
      showNotification("Please select a batch to transfer", "error");
      return;
    }

    const batch = allBatches.find((b) => b.id === trBatchId);
    if (!batch) return;

    try {
      const transferNo = `TR-${Date.now().toString().slice(-6)}`;
      const res = await inventoryService.dispatchInterStoreTransfer({
        transfer_no: transferNo,
        source_store_id: "store_main",
        destination_store_id: trDestStore,
        product_id: batch.product_id,
        batch_id: trBatchId,
        transfer_qty: trQty,
      });

      if (res.success) {
        showNotification(`Dispatched stock transfer ${transferNo}!`);
        setIsTransferModalOpen(false);
        loadData();
      }
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Error dispatching transfer", "error");
    }
  };

  return (
    <div className="space-y-4 font-sans">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-btn px-4 py-3 text-xs font-semibold shadow-modal transition-all ${
            notification.type === "success"
              ? "bg-accent-soft text-accent border border-accent/20"
              : "bg-status-danger/10 text-status-danger border border-status-danger/20"
          }`}
        >
          {notification.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[26px] font-bold text-text-main tracking-tight">Stock & Inventory Ledger</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Double-entry stock movements, write-off adjustments, inter-store transfers, and FEFO expiry tracking.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsAdjustmentModalOpen(true)}
            className="flex items-center gap-2 rounded-btn border border-border-main bg-surface px-3.5 py-2 text-xs font-medium text-text-main shadow-xs hover:bg-canvas transition-colors"
          >
            <RotateCcw className="h-4 w-4 text-status-warning" />
            <span>Stock Adjustment</span>
          </button>
          <button
            onClick={() => navigate("/stock/transfers")}
            className="flex items-center gap-2 rounded-btn bg-accent px-3.5 py-2 text-xs font-medium text-white shadow-xs hover:bg-accent/90 transition-colors"
          >
            <ArrowRightLeft className="h-4 w-4" />
            <span>Inter-Store Transfers</span>
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-border-main gap-2">
        <button
          onClick={() => setActiveTab("ledger")}
          className={`border-b-2 px-4 py-2 text-xs font-semibold transition-colors ${
            activeTab === "ledger"
              ? "border-accent text-accent"
              : "border-transparent text-text-muted hover:text-text-main"
          }`}
        >
          Audit Ledger ({transactions.length})
        </button>
        <button
          onClick={() => setActiveTab("expiry")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-semibold transition-colors ${
            activeTab === "expiry"
              ? "border-status-warning text-status-warning"
              : "border-transparent text-text-muted hover:text-text-main"
          }`}
        >
          <Calendar className="h-3.5 w-3.5" />
          <span>Near Expiry ({nearExpiryBatches.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("low_stock")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-semibold transition-colors ${
            activeTab === "low_stock"
              ? "border-status-danger text-status-danger"
              : "border-transparent text-text-muted hover:text-text-main"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>Low Stock Alerts ({lowStockProducts.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("negative_stock")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-semibold transition-colors ${
            activeTab === "negative_stock"
              ? "border-status-warning text-status-warning"
              : "border-transparent text-text-muted hover:text-text-main"
          }`}
        >
          <span className="inline-block w-2 h-2 rounded-full bg-status-warning" />
          <span>Negative Stock ({negativeStockBatches.length})</span>
        </button>
      </div>

      {/* Tab 1: Double-Entry Transactions Audit Ledger */}
      {activeTab === "ledger" && (
        <div className="rounded-card border border-border-main bg-surface shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-canvas border-b border-border-main text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Event Type</th>
                  <th className="px-4 py-3">Batch</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3 text-right">Delta Units</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-main">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-text-muted">
                      <Package className="mx-auto h-8 w-8 text-text-muted/40 mb-1" />
                      <p className="font-medium">No stock transactions recorded yet</p>
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-canvas/50 transition-colors">
                      <td className="px-4 py-3 text-text-muted font-mono text-[11px] tabular-nums">
                        {new Date(tx.created_at || Date.now()).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                            tx.qty_delta >= 0
                              ? "bg-accent-soft text-accent"
                              : "bg-status-danger/10 text-status-danger"
                          }`}
                        >
                          {tx.event_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-text-main tabular-nums">{tx.batch_id || "-"}</td>
                      <td className="px-4 py-3 text-text-main font-medium">{tx.reference_id || tx.reference_type || "-"}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                        <span className={tx.qty_delta >= 0 ? "text-accent" : "text-status-danger"}>
                          {tx.qty_delta >= 0 ? `+${tx.qty_delta}` : tx.qty_delta}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-muted text-[11px]">{tx.notes || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Near Expiry Batches */}
      {activeTab === "expiry" && (
        <div className="rounded-card border border-border-main bg-surface shadow-xs overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-canvas border-b border-border-main text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-4 py-3">Batch No</th>
                <th className="px-4 py-3">Expiry Date</th>
                <th className="px-4 py-3 text-right">Available Stock</th>
                <th className="px-4 py-3 text-right">MRP (₹)</th>
                <th className="px-4 py-3 text-center">Urgency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-main">
              {nearExpiryBatches.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-text-muted">
                    <CheckCircle className="mx-auto h-8 w-8 text-accent mb-1" />
                    <p className="font-medium">No batches expiring within 60 days</p>
                  </td>
                </tr>
              ) : (
                nearExpiryBatches.map((b) => (
                  <tr key={b.id} className="hover:bg-status-warning/5 transition-colors bg-status-warning/5">
                    <td className="px-4 py-3 font-mono font-semibold text-text-main tabular-nums">{b.batch_no}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-status-warning tabular-nums">{b.expiry_date}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-text-main tabular-nums">{b.stock_qty}</td>
                    <td className="px-4 py-3 text-right font-mono text-text-main tabular-nums">₹ {Number(b.mrp || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded-full bg-status-warning/15 px-2.5 py-0.5 text-[10px] font-semibold text-status-warning">
                        EXPIRING SOON
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 3: Low Stock Reorder Alerts */}
      {activeTab === "low_stock" && (
        <div className="rounded-card border border-border-main bg-surface shadow-xs overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-canvas border-b border-border-main text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3">Barcode</th>
                <th className="px-4 py-3 text-right">Current Stock</th>
                <th className="px-4 py-3 text-right">Reorder Level</th>
                <th className="px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-main">
              {lowStockProducts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-text-muted">
                    <CheckCircle className="mx-auto h-8 w-8 text-accent mb-1" />
                    <p className="font-medium">All items are sufficiently stocked</p>
                  </td>
                </tr>
              ) : (
                lowStockProducts.map((p) => (
                  <tr key={p.id} className="hover:bg-status-warning/5 transition-colors bg-status-warning/5">
                    <td className="px-4 py-3 font-semibold text-text-main">{p.name}</td>
                    <td className="px-4 py-3 font-mono text-text-muted tabular-nums">{p.barcode}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-status-warning tabular-nums">{p.current_stock || 0}</td>
                    <td className="px-4 py-3 text-right font-mono text-text-main tabular-nums">{p.reorder_level}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded-full bg-status-warning/15 px-2.5 py-0.5 text-[10px] font-semibold text-status-warning">
                        REORDER
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 4: Negative Stock (Shortages / Oversold Batches) */}
      {activeTab === "negative_stock" && (
        <div className="rounded-card border border-border-main bg-surface shadow-xs overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-canvas border-b border-border-main text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-4 py-3">Batch No</th>
                <th className="px-4 py-3">Expiry Date</th>
                <th className="px-4 py-3 text-right">Stock on Hand</th>
                <th className="px-4 py-3 text-right">Deficit (Shortage)</th>
                <th className="px-4 py-3 text-right">Selling Rate (₹)</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-main">
              {negativeStockBatches.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-text-muted">
                    <CheckCircle className="mx-auto h-8 w-8 text-accent mb-1" />
                    <p className="font-medium">No negative stock batches found</p>
                    <p className="text-[11px] text-text-muted mt-0.5">All batches have non-negative balances on hand</p>
                  </td>
                </tr>
              ) : (
                negativeStockBatches.map((b) => (
                  <tr key={b.id} className="hover:bg-status-danger/5 transition-colors bg-status-danger/5">
                    <td className="px-4 py-3 font-mono font-semibold text-text-main tabular-nums">{b.batch_no}</td>
                    <td className="px-4 py-3 font-mono text-text-muted tabular-nums">{b.expiry_date}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-status-danger tabular-nums">{b.stock_qty}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-status-danger tabular-nums">
                      {Math.abs(b.stock_qty || 0)} units short
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-text-main tabular-nums">
                      ₹ {Number(b.selling_rate || b.mrp || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded-full bg-status-danger/10 border border-status-danger/20 px-2.5 py-0.5 text-[10px] font-bold text-status-danger">
                        OVERSOLD
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {isAdjustmentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-card bg-surface shadow-modal overflow-hidden border border-border-main">
            <div className="flex items-center justify-between border-b border-border-main px-5 py-3.5 bg-canvas">
              <h3 className="text-sm font-bold text-text-main">Record Stock Adjustment</h3>
              <button onClick={() => setIsAdjustmentModalOpen(false)} className="text-text-muted hover:text-text-main">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-text-main block mb-1">Select Batch *</label>
                <select
                  value={adjBatchId}
                  onChange={(e) => setAdjBatchId(e.target.value)}
                  className="w-full rounded-btn border border-border-main bg-surface px-2.5 py-2 text-xs text-text-main focus:border-accent focus:outline-none"
                >
                  <option value="">-- Choose Batch --</option>
                  {allBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batch_no} (Stock: {b.stock_qty}, Exp: {b.expiry_date})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-text-main block mb-1">
                  Quantity Delta (Negative for write-off, Positive for found) *
                </label>
                <input
                  type="number"
                  value={adjQty}
                  onChange={(e) => setAdjQty(Number(e.target.value) || 0)}
                  className="w-full rounded-btn border border-border-main bg-surface px-2.5 py-2 text-xs text-text-main focus:border-accent focus:outline-none font-mono font-bold tabular-nums"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-text-main block mb-1">Adjustment Reason *</label>
                <select
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value as any)}
                  className="w-full rounded-btn border border-border-main bg-surface px-2.5 py-2 text-xs text-text-main focus:border-accent focus:outline-none"
                >
                  <option value="Damaged">Damaged Goods</option>
                  <option value="Expired">Expired</option>
                  <option value="Breakage">Breakage</option>
                  <option value="Theft">Theft / Pilferage</option>
                  <option value="Found Stock">Found Stock (Surplus)</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-text-main block mb-1">Notes / Explanation</label>
                <input
                  type="text"
                  value={adjNotes}
                  onChange={(e) => setAdjNotes(e.target.value)}
                  placeholder="e.g. Broken during shelf reorganization"
                  className="w-full rounded-btn border border-border-main bg-surface px-2.5 py-2 text-xs text-text-main focus:border-accent focus:outline-none"
                />
              </div>
            </div>

            <div className="border-t border-border-main bg-canvas px-5 py-3.5 flex justify-end gap-2">
              <button
                onClick={() => setIsAdjustmentModalOpen(false)}
                className="rounded-btn border border-border-main bg-surface px-3.5 py-2 text-xs font-medium text-text-main hover:bg-canvas transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRecordAdjustment}
                className="rounded-btn bg-status-warning px-4 py-2 text-xs font-semibold text-white shadow-xs hover:opacity-90 transition-opacity"
              >
                Post Adjustment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inter-Store Transfer Modal */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-card bg-surface shadow-modal overflow-hidden border border-border-main">
            <div className="flex items-center justify-between border-b border-border-main px-5 py-3.5 bg-canvas">
              <h3 className="text-sm font-bold text-text-main">Dispatch Inter-Store Transfer</h3>
              <button onClick={() => setIsTransferModalOpen(false)} className="text-text-muted hover:text-text-main">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-text-main block mb-1">Destination Branch Store *</label>
                <input
                  type="text"
                  value={trDestStore}
                  onChange={(e) => setTrDestStore(e.target.value)}
                  className="w-full rounded-btn border border-border-main bg-surface px-2.5 py-2 text-xs text-text-main focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-text-main block mb-1">Batch to Transfer *</label>
                <select
                  value={trBatchId}
                  onChange={(e) => setTrBatchId(e.target.value)}
                  className="w-full rounded-btn border border-border-main bg-surface px-2.5 py-2 text-xs text-text-main focus:border-accent focus:outline-none"
                >
                  <option value="">-- Choose Batch --</option>
                  {allBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batch_no} (Available: {b.stock_qty})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-text-main block mb-1">Transfer Quantity *</label>
                <input
                  type="number"
                  value={trQty}
                  onChange={(e) => setTrQty(Number(e.target.value) || 1)}
                  className="w-full rounded-btn border border-border-main bg-surface px-2.5 py-2 text-xs text-text-main focus:border-accent focus:outline-none font-mono font-bold tabular-nums"
                />
              </div>
            </div>

            <div className="border-t border-border-main bg-canvas px-5 py-3.5 flex justify-end gap-2">
              <button
                onClick={() => setIsTransferModalOpen(false)}
                className="rounded-btn border border-border-main bg-surface px-3.5 py-2 text-xs font-medium text-text-main hover:bg-canvas transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDispatchTransfer}
                className="rounded-btn bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent/90 transition-opacity"
              >
                Dispatch Transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

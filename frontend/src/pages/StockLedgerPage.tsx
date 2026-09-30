import React, { useState, useEffect } from "react";
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

export const StockLedgerPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"ledger" | "adjustments" | "expiry" | "low_stock">("ledger");
  const [transactions, setTransactions] = useState<any[]>([]);
  const [nearExpiryBatches, setNearExpiryBatches] = useState<ProductBatch[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<ProductItem[]>([]);
  const [allBatches, setAllBatches] = useState<ProductBatch[]>([]);
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Modals State
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);

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
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-xs font-semibold text-white shadow-lg ${
            notification.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {notification.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Stock & Inventory Ledger</h2>
          <p className="text-xs text-slate-500">
            Double-entry stock movements, write-off adjustments, inter-store transfers, and FEFO expiry tracking.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsAdjustmentModalOpen(true)}
            className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RotateCcw className="h-4 w-4 text-amber-600" />
            <span>Stock Adjustment</span>
          </button>
          <button
            onClick={() => setIsTransferModalOpen(true)}
            className="flex items-center gap-2 rounded bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <ArrowRightLeft className="h-4 w-4" />
            <span>Inter-Store Transfer</span>
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          onClick={() => setActiveTab("ledger")}
          className={`border-b-2 px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === "ledger"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Audit Ledger ({transactions.length})
        </button>
        <button
          onClick={() => setActiveTab("expiry")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === "expiry"
              ? "border-amber-600 text-amber-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Calendar className="h-3.5 w-3.5" />
          <span>Near Expiry ({nearExpiryBatches.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("low_stock")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === "low_stock"
              ? "border-red-600 text-red-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>Low Stock Alerts ({lowStockProducts.length})</span>
        </button>
      </div>

      {/* Tab 1: Double-Entry Transactions Audit Ledger */}
      {activeTab === "ledger" && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Time</th>
                  <th className="px-4 py-2.5 font-semibold">Event Type</th>
                  <th className="px-4 py-2.5 font-semibold">Batch</th>
                  <th className="px-4 py-2.5 font-semibold">Reference</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Delta Units</th>
                  <th className="px-4 py-2.5 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <Package className="mx-auto h-8 w-8 text-slate-300 mb-1" />
                      <p className="font-medium">No stock transactions recorded yet</p>
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-500 font-mono text-[11px]">
                        {new Date(tx.created_at || Date.now()).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            tx.qty_delta >= 0
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {tx.event_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">{tx.batch_id || "-"}</td>
                      <td className="px-4 py-2.5 text-slate-700 font-medium">{tx.reference_id || tx.reference_type || "-"}</td>
                      <td className="px-4 py-2.5 text-right font-bold">
                        <span className={tx.qty_delta >= 0 ? "text-emerald-600" : "text-red-600"}>
                          {tx.qty_delta >= 0 ? `+${tx.qty_delta}` : tx.qty_delta}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-[11px]">{tx.notes || "-"}</td>
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
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Batch No</th>
                <th className="px-4 py-2.5 font-semibold">Expiry Date</th>
                <th className="px-4 py-2.5 font-semibold text-right">Available Stock</th>
                <th className="px-4 py-2.5 font-semibold text-right">MRP (₹)</th>
                <th className="px-4 py-2.5 font-semibold text-center">Urgency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {nearExpiryBatches.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <CheckCircle className="mx-auto h-8 w-8 text-emerald-300 mb-1" />
                    <p className="font-medium">No batches expiring within 60 days</p>
                  </td>
                </tr>
              ) : (
                nearExpiryBatches.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono font-bold text-slate-800">{b.batch_no}</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-amber-600">{b.expiry_date}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-slate-800">{b.stock_qty}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">₹ {Number(b.mrp || 0).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
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
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Product Name</th>
                <th className="px-4 py-2.5 font-semibold">Barcode</th>
                <th className="px-4 py-2.5 font-semibold text-right">Current Stock</th>
                <th className="px-4 py-2.5 font-semibold text-right">Reorder Level</th>
                <th className="px-4 py-2.5 font-semibold text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lowStockProducts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <CheckCircle className="mx-auto h-8 w-8 text-emerald-300 mb-1" />
                    <p className="font-medium">All items are sufficiently stocked</p>
                  </td>
                </tr>
              ) : (
                lowStockProducts.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-bold text-slate-800">{p.name}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-500">{p.barcode}</td>
                    <td className="px-4 py-2.5 text-right font-black text-red-600">{p.current_stock || 0}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{p.reorder_level}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
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

      {/* Stock Adjustment Modal */}
      {isAdjustmentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl overflow-hidden border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50">
              <h3 className="text-sm font-bold text-slate-800">Record Stock Adjustment</h3>
              <button onClick={() => setIsAdjustmentModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Select Batch *</label>
                <select
                  value={adjBatchId}
                  onChange={(e) => setAdjBatchId(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
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
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Quantity Delta (Negative for write-off, Positive for found) *
                </label>
                <input
                  type="number"
                  value={adjQty}
                  onChange={(e) => setAdjQty(Number(e.target.value) || 0)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none font-bold"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Adjustment Reason *</label>
                <select
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value as any)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
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
                <label className="text-xs font-semibold text-slate-700 block mb-1">Notes / Explanation</label>
                <input
                  type="text"
                  value={adjNotes}
                  onChange={(e) => setAdjNotes(e.target.value)}
                  placeholder="e.g. Broken during shelf reorganization"
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3.5 flex justify-end gap-2">
              <button
                onClick={() => setIsAdjustmentModalOpen(false)}
                className="rounded border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleRecordAdjustment}
                className="rounded bg-amber-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-amber-700"
              >
                Post Adjustment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inter-Store Transfer Modal */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl overflow-hidden border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50">
              <h3 className="text-sm font-bold text-slate-800">Dispatch Inter-Store Transfer</h3>
              <button onClick={() => setIsTransferModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Destination Branch Store *</label>
                <input
                  type="text"
                  value={trDestStore}
                  onChange={(e) => setTrDestStore(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Batch to Transfer *</label>
                <select
                  value={trBatchId}
                  onChange={(e) => setTrBatchId(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
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
                <label className="text-xs font-semibold text-slate-700 block mb-1">Transfer Quantity *</label>
                <input
                  type="number"
                  value={trQty}
                  onChange={(e) => setTrQty(Number(e.target.value) || 1)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none font-bold"
                />
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3.5 flex justify-end gap-2">
              <button
                onClick={() => setIsTransferModalOpen(false)}
                className="rounded border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleDispatchTransfer}
                className="rounded bg-blue-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
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

import React, { useState, useEffect, useRef } from "react";
import { X, Package, Calendar, Tag, Check, Database, AlertCircle } from "lucide-react";
import type { PosCartLine } from "../lib/billing/posCartService";
import type { ProductItem, ProductBatch } from "../lib/masters/productsStore";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

interface QuickProductBatchEditModalProps {
  isOpen: boolean;
  line: PosCartLine | null;
  onClose: () => void;
  onSave: (
    lineId: string,
    productUpdates: Partial<ProductItem>,
    batchUpdates: Partial<ProductBatch>,
    persistToMaster: boolean
  ) => Promise<void> | void;
}

export const QuickProductBatchEditModal: React.FC<QuickProductBatchEditModalProps> = ({
  isOpen,
  line,
  onClose,
  onSave,
}) => {
  useModalEscape(isOpen && Boolean(line), onClose);

  // Product fields
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [hsnSacCode, setHsnSacCode] = useState("");
  const [gstPercent, setGstPercent] = useState<number>(18);

  // Batch fields
  const [batchNo, setBatchNo] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [mrp, setMrp] = useState<string>("");
  const [sellingRate, setSellingRate] = useState<string>("");
  const [stockQty, setStockQty] = useState<string>("");

  // Persistence toggle
  const [persistToMaster, setPersistToMaster] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && line) {
      setName(line.product.name || "");
      setBarcode(line.product.barcode || "");
      setHsnSacCode(line.product.hsn_sac_code || "30049099");
      setGstPercent(line.product.gst_percent ?? 18);

      setBatchNo(line.selectedBatch.batch_no || "OPENING");
      setExpiryDate(line.selectedBatch.expiry_date || "2028-12-31");
      setMrp(
        (line.selectedBatch.mrp ?? line.product.mrp ?? 0).toString()
      );
      setSellingRate(
        (line.selectedBatch.selling_rate ?? line.unit_price ?? line.product.sel_rate ?? 0).toString()
      );
      setStockQty(
        (line.selectedBatch.stock_qty ?? line.product.current_stock ?? 0).toString()
      );

      setPersistToMaster(true);
      setErrorMsg("");

      setTimeout(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      }, 50);
    }
  }, [isOpen, line]);

  if (!isOpen || !line) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg("Product name cannot be empty.");
      return;
    }
    if (!batchNo.trim()) {
      setErrorMsg("Batch number cannot be empty.");
      return;
    }
    if (!expiryDate.trim()) {
      setErrorMsg("Expiry date cannot be empty (YYYY-MM or YYYY-MM-DD).");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg("");

      const numMrp = Math.max(0, parseFloat(mrp) || 0);
      const numRate = Math.max(0, parseFloat(sellingRate) || 0);
      const numGst = Math.max(0, Number(gstPercent) || 0);
      const numStock = Math.max(0, parseFloat(stockQty) || 0);

      const productUpdates: Partial<ProductItem> = {
        name: name.trim(),
        print_name: name.trim(),
        barcode: barcode.trim(),
        hsn_sac_code: hsnSacCode.trim(),
        gst_percent: numGst,
        mrp: numMrp,
        sel_rate: numRate,
      };

      const batchUpdates: Partial<ProductBatch> = {
        batch_no: batchNo.trim().toUpperCase(),
        expiry_date: expiryDate.trim(),
        mrp: numMrp,
        selling_rate: numRate,
        stock_qty: numStock,
      };

      await onSave(line.id, productUpdates, batchUpdates, persistToMaster);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save product and batch updates.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 select-none font-sans animate-in fade-in duration-100">
      <div className="w-full max-w-lg rounded-card bg-surface shadow-modal border border-border-main overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border-main flex items-center justify-between bg-canvas">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-btn bg-accent-soft text-accent">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-main flex items-center gap-2">
                Quick Edit Product & Batch
                <kbd className="px-1.5 py-0.5 rounded-btn bg-surface border border-border-main text-[10px] font-mono text-text-muted">
                  F4
                </kbd>
              </h3>
              <p className="text-[11px] text-text-muted">
                Edit product catalog data and batch pricing directly from the billing screen
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-main rounded-btn hover:bg-surface transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 text-xs">
          {errorMsg && (
            <div className="flex items-center gap-2 p-2.5 rounded-btn bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] border border-[var(--color-danger-border)]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Section 1: Product Information */}
          <div className="space-y-3 bg-canvas/50 p-3 rounded-card border border-border-main">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              1. Product Master Details
            </span>

            <div>
              <label className="block text-[11px] font-semibold text-text-main mb-1">
                Product Name *
              </label>
              <input
                ref={nameInputRef}
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Product / Medicine Name"
                className="w-full px-3 py-2 bg-surface border border-border-main rounded-btn text-xs font-semibold text-text-main focus:border-accent focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[10px] font-semibold text-text-muted mb-1">
                  Barcode
                </label>
                <input
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Barcode / EAN"
                  className="w-full px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-xs font-mono text-text-main focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-text-muted mb-1">
                  HSN / SAC Code
                </label>
                <input
                  type="text"
                  value={hsnSacCode}
                  onChange={(e) => setHsnSacCode(e.target.value)}
                  placeholder="HSN Code"
                  className="w-full px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-xs font-mono text-text-main focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-text-muted mb-1">
                  GST Rate %
                </label>
                <select
                  value={gstPercent}
                  onChange={(e) => setGstPercent(Number(e.target.value))}
                  className="w-full px-2 py-1.5 bg-surface border border-border-main rounded-btn text-xs font-mono text-text-main focus:border-accent focus:outline-none"
                >
                  <option value={0}>0% (Exempt)</option>
                  <option value={5}>5%</option>
                  <option value={12}>12%</option>
                  <option value={18}>18%</option>
                  <option value={28}>28%</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Batch & Pricing Details */}
          <div className="space-y-3 bg-canvas/50 p-3 rounded-card border border-border-main">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              2. Batch, Expiry & Pricing
            </span>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-text-main mb-1">
                  Batch Number *
                </label>
                <input
                  type="text"
                  required
                  value={batchNo}
                  onChange={(e) => setBatchNo(e.target.value.toUpperCase())}
                  placeholder="e.g. B2024-X"
                  className="w-full px-3 py-2 bg-surface border border-border-main rounded-btn text-xs font-mono font-bold text-text-main focus:border-accent focus:outline-none uppercase"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-text-main mb-1 flex items-center justify-between">
                  <span>Expiry Date *</span>
                  <span className="text-[10px] text-text-muted font-mono font-normal">YYYY-MM-DD</span>
                </label>
                <input
                  type="text"
                  required
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  placeholder="YYYY-MM-DD or YYYY-MM"
                  className="w-full px-3 py-2 bg-surface border border-border-main rounded-btn text-xs font-mono text-text-main focus:border-accent focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[10px] font-semibold text-text-muted mb-1">
                  MRP (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={mrp}
                  onChange={(e) => setMrp(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-xs font-mono text-text-main focus:border-accent focus:outline-none text-right"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-text-muted mb-1">
                  Selling Rate (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={sellingRate}
                  onChange={(e) => setSellingRate(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-xs font-mono font-bold text-accent focus:border-accent focus:outline-none text-right"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-text-muted mb-1">
                  Stock Qty
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={stockQty}
                  onChange={(e) => setStockQty(e.target.value)}
                  placeholder="0"
                  className="w-full px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-xs font-mono text-text-main focus:border-accent focus:outline-none text-right"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Persistence Scope */}
          <div className="p-3 rounded-card bg-surface border border-border-main flex items-start gap-3">
            <input
              type="checkbox"
              id="persistToMaster"
              checked={persistToMaster}
              onChange={(e) => setPersistToMaster(e.target.checked)}
              className="mt-0.5 rounded text-accent focus:ring-accent"
            />
            <label htmlFor="persistToMaster" className="cursor-pointer">
              <span className="block text-xs font-semibold text-text-main flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-accent" />
                Update Product Master & Batch in Database
              </span>
              <span className="block text-[11px] text-text-muted mt-0.5">
                When checked, saves changes to the local product catalog so future scans use this batch, MRP, and selling rate. Uncheck to update only this active invoice line.
              </span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-main">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-btn border border-border-main text-xs font-semibold text-text-muted hover:bg-canvas hover:text-text-main transition-colors cursor-pointer"
            >
              Cancel (Esc)
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-btn bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isSubmitting ? "Saving..." : "Apply & Save (Enter)"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

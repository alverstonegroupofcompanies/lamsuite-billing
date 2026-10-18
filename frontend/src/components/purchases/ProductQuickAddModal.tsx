import React, { useState } from "react";
import { Package, X, AlertCircle, Check } from "lucide-react";
import { productsStore, type ProductItem } from "../../lib/masters/productsStore";

interface ProductQuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProductCreated: (product: ProductItem) => void;
  initialName?: string;
}

export const ProductQuickAddModal: React.FC<ProductQuickAddModalProps> = ({
  isOpen,
  onClose,
  onProductCreated,
  initialName = "",
}) => {
  const [name, setName] = useState(initialName);
  const [genericName, setGenericName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [hsnSacCode, setHsnSacCode] = useState("30049099");
  const [mrp, setMrp] = useState("");
  const [purchaseRate, setPurchaseRate] = useState("");
  const [selRate, setSelRate] = useState("");
  const [gstRate, setGstRate] = useState("12");
  const [unit, setUnit] = useState("STRIP");
  const [packSize, setPackSize] = useState("10");
  const [isScheduleH, setIsScheduleH] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Product name is required");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const id = `prod_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
      const cleanBarcode = barcode.trim() || `890${Math.floor(100000000 + Math.random() * 900000000)}`;

      const numMrp = Number(mrp) || 0;
      const numPurchaseRate = Number(purchaseRate) || 0;
      const numSelRate = Number(selRate) || (numMrp > 0 ? numMrp : numPurchaseRate * 1.2);

      const newProduct: ProductItem = {
        id,
        name: name.trim(),
        print_name: name.trim(),
        generic_name: genericName.trim() || undefined,
        barcode: cleanBarcode,
        hsn_sac_code: hsnSacCode.trim().replace(/\D/g, "") || "30049099",
        mrp: numMrp,
        ptr: numPurchaseRate,
        sel_rate: numSelRate,
        gst_percent: Number(gstRate) || 12,
        unit_name: unit.trim().toUpperCase() || "STRIP",
        units_per_pack: Number(packSize) || 1,
        loose_selling_rate: (Number(packSize) || 1) > 1 ? numSelRate / (Number(packSize) || 1) : numSelRate,
        schedule_type: isScheduleH ? "H" : "NONE",
        is_active: true,
      };

      await productsStore.upsertProduct(newProduct, true);
      onProductCreated(newProduct);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create product");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-800">Quick Add Product / Medicine</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-2.5 text-red-700 border border-red-200">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Product / Brand Name *</label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Augmentin 625 Duo Tablet"
              className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Generic / Composition</label>
              <input
                type="text"
                value={genericName}
                onChange={(e) => setGenericName(e.target.value)}
                placeholder="e.g. Amoxicillin + Clavulanic Acid"
                className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Barcode / SKU (Optional)</label>
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Auto-generated if empty"
                className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">HSN Code</label>
              <input
                type="text"
                value={hsnSacCode}
                onChange={(e) => setHsnSacCode(e.target.value)}
                placeholder="30049099"
                className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none font-mono"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">GST Slab (%)</label>
              <select
                value={gstRate}
                onChange={(e) => setGstRate(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
              >
                <option value="0">0% (Nil)</option>
                <option value="5">5% (Essential)</option>
                <option value="12">12% (Standard Pharma)</option>
                <option value="18">18% (Supplements/Devices)</option>
                <option value="28">28% (Luxury)</option>
              </select>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Pack Size (Loose Qty)</label>
              <input
                type="number"
                min="1"
                value={packSize}
                onChange={(e) => setPackSize(e.target.value)}
                placeholder="10"
                className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Purchase Rate (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={purchaseRate}
                onChange={(e) => setPurchaseRate(e.target.value)}
                placeholder="0.00"
                className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Selling Rate (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={selRate}
                onChange={(e) => setSelRate(e.target.value)}
                placeholder="0.00"
                className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">MRP (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={mrp}
                onChange={(e) => setMrp(e.target.value)}
                placeholder="0.00"
                className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="quickAddScheduleH"
              checked={isScheduleH}
              onChange={(e) => setIsScheduleH(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="quickAddScheduleH" className="font-medium text-slate-700 cursor-pointer">
              Schedule H / H1 Drug (Requires Doctor Prescription & Register Entry)
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              <span>{isSubmitting ? "Creating..." : "Save Product"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

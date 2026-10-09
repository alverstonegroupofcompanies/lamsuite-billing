import React, { useState, useEffect } from "react";
import { X, Plus, Trash2, CheckCircle, FileText, Building2, ShoppingBag } from "lucide-react";
import { purchaseOrderService, type POLineItemInput } from "../../lib/purchases/purchaseOrderService";
import { supplierLedgerService, type SupplierMaster } from "../../lib/purchases/supplierLedgerService";
import { sqliteStorage } from "../../lib/db/sqliteStorage";
import { type ProductItem } from "../../lib/masters/productsStore";

interface PurchaseOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  moduleKey?: "po" | "pr";
  onCreated: () => void;
}

export const PurchaseOrderModal: React.FC<PurchaseOrderModalProps> = ({
  isOpen,
  onClose,
  moduleKey = "po",
  onCreated,
}) => {
  const [suppliers, setSuppliers] = useState<SupplierMaster[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [allProducts, setAllProducts] = useState<ProductItem[]>([]);
  const [lines, setLines] = useState<POLineItemInput[]>([
    {
      product_id: "",
      product_name: "",
      ordered_qty: 10,
      purchase_rate: 0,
      gst_percent: 12,
    },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    const sups = await supplierLedgerService.getAllSuppliers();
    setSuppliers(sups);
    if (sups.length > 0 && !supplierId) setSupplierId(sups[0].id);

    const prods = await sqliteStorage.findAll<ProductItem>("products");
    setAllProducts(prods);
  };

  if (!isOpen) return null;

  const addLine = () => {
    setLines([
      ...lines,
      {
        product_id: "",
        product_name: "",
        ordered_qty: 10,
        purchase_rate: 0,
        gst_percent: 12,
      },
    ]);
  };

  const updateLine = (idx: number, updates: Partial<POLineItemInput>) => {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], ...updates };
    setLines(updated);
  };

  const removeLine = (idx: number) => {
    if (lines.length > 1) {
      setLines(lines.filter((_, i) => i !== idx));
    }
  };

  const handleProductSelect = (idx: number, prodId: string) => {
    const p = allProducts.find((it) => it.id === prodId);
    if (p) {
      updateLine(idx, {
        product_id: p.id,
        product_name: p.name,
        hsn_code: p.hsn_sac_code,
        purchase_rate: p.ptr || 0,
        gst_percent: p.gst_percent || 12,
      });
    }
  };

  const computeTotals = () => {
    let subtotal = 0;
    let tax = 0;
    for (const l of lines) {
      const taxable = (l.ordered_qty || 0) * (l.purchase_rate || 0);
      const taxAmt = (taxable * (l.gst_percent || 0)) / 100;
      subtotal += taxable;
      tax += taxAmt;
    }
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      total: Math.round((subtotal + tax) * 100) / 100,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) {
      setError("Please select a supplier");
      return;
    }
    const validLines = lines.filter((l) => l.product_name.trim().length > 0 && l.ordered_qty > 0);
    if (validLines.length === 0) {
      setError("Please add at least one line item with valid quantity");
      return;
    }

    const selectedSup = suppliers.find((s) => s.id === supplierId);

    try {
      setIsSubmitting(true);
      setError(null);
      await purchaseOrderService.createPO({
        module_key: moduleKey,
        supplier_id: supplierId,
        supplier_name: selectedSup?.name || "Supplier",
        po_date: poDate,
        expected_delivery_date: expectedDate || undefined,
        items: validLines,
        notes: notes.trim() || undefined,
      });

      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create PO");
    } finally {
      setIsSubmitting(false);
    }
  };

  const totals = computeTotals();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-800">
              {moduleKey === "pr" ? "New Purchase Requisition (PR)" : "New Purchase Order (PO)"}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="rounded-lg bg-red-50 p-2.5 text-red-700 border border-red-200">
              {error}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Supplier *</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:border-blue-600 focus:outline-none"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">PO Date</label>
              <input
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Expected Delivery Date</label>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Grid */}
          <div className="rounded border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="px-2.5 py-2">Product Description</th>
                  <th className="px-2 py-2 w-20 text-center">Qty</th>
                  <th className="px-2 py-2 w-24 text-right">Est Rate (₹)</th>
                  <th className="px-2 py-2 w-20 text-center">GST %</th>
                  <th className="px-2.5 py-2 w-28 text-right">Line Total (₹)</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l, idx) => {
                  const taxable = (l.ordered_qty || 0) * (l.purchase_rate || 0);
                  const total = taxable + (taxable * (l.gst_percent || 0)) / 100;

                  return (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-2.5 py-1.5">
                        <select
                          value={l.product_id}
                          onChange={(e) => handleProductSelect(idx, e.target.value)}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs bg-white focus:border-blue-600 focus:outline-none"
                        >
                          <option value="">-- Choose Product --</option>
                          {allProducts.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} (PTR: ₹{p.ptr || 0})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="number"
                          min="1"
                          value={l.ordered_qty}
                          onChange={(e) => updateLine(idx, { ordered_qty: Number(e.target.value) || 0 })}
                          className="w-16 rounded border border-slate-300 px-1 py-1 text-center font-bold text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={l.purchase_rate}
                          onChange={(e) => updateLine(idx, { purchase_rate: Number(e.target.value) || 0 })}
                          className="w-20 rounded border border-slate-300 px-1.5 py-1 text-right text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <select
                          value={l.gst_percent}
                          onChange={(e) => updateLine(idx, { gst_percent: Number(e.target.value) || 0 })}
                          className="rounded border border-slate-200 px-1 py-1 text-xs"
                        >
                          <option value={0}>0%</option>
                          <option value={5}>5%</option>
                          <option value={12}>12%</option>
                          <option value={18}>18%</option>
                          <option value={28}>28%</option>
                        </select>
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-bold text-slate-800">
                        ₹ {total.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button onClick={() => removeLine(idx)} className="p-1 text-slate-400 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={addLine}
              className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Item</span>
            </button>

            <div className="flex items-center gap-4 text-xs font-semibold text-slate-700">
              <div>Subtotal: ₹{totals.subtotal.toFixed(2)}</div>
              <div>Tax: ₹{totals.tax.toFixed(2)}</div>
              <div className="text-sm font-black text-blue-700">Est Total: ₹{totals.total.toFixed(2)}</div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 bg-white px-3.5 py-1.5 font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded bg-blue-600 px-5 py-1.5 font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              <CheckCircle className="h-4 w-4" />
              <span>Create {moduleKey.toUpperCase()}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

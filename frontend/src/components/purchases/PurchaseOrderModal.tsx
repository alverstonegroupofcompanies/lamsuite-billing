import React, { useState, useEffect } from "react";
import { X, Plus, Trash2, CheckCircle, FileText, Building2, ShoppingBag } from "lucide-react";
import { purchaseOrderService, type POLineItemInput } from "../../lib/purchases/purchaseOrderService";
import { supplierLedgerService, type SupplierMaster } from "../../lib/purchases/supplierLedgerService";
import { sqliteStorage } from "../../lib/db/sqliteStorage";
import { type ProductItem } from "../../lib/masters/productsStore";
import { useModalEscape } from "../../lib/ui/modalEscapeManager";

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
  useModalEscape(isOpen, onClose);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 font-sans">
      <div className="w-full max-w-3xl rounded-[14px] bg-[var(--color-surface)] shadow-modal border border-[var(--color-border)] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3.5 bg-[var(--color-surface)]">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-[var(--color-accent)]" />
            <h3 className="text-sm font-bold text-[var(--color-text)]">
              {moduleKey === "pr" ? "New Purchase Requisition (PR)" : "New Purchase Order (PO)"}
            </h3>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="rounded-[10px] bg-[var(--color-danger-bg)] p-2.5 text-[var(--color-danger-text)] border border-[var(--color-danger-border)]">
              {error}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-semibold text-[var(--color-text)] block mb-1">Supplier *</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full rounded-[10px] border border-[var(--color-border)] px-2.5 py-1.5 text-xs bg-[var(--color-surface)] text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-semibold text-[var(--color-text)] block mb-1">PO Date</label>
              <input
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
                className="w-full rounded-[10px] border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)] font-mono"
              />
            </div>

            <div>
              <label className="font-semibold text-[var(--color-text)] block mb-1">Expected Delivery Date</label>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full rounded-[10px] border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)] font-mono"
              />
            </div>
          </div>

          {/* Grid */}
          <div className="rounded-[10px] border border-[var(--color-border)] overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--color-canvas)] text-[var(--color-text-muted)] font-bold uppercase tracking-wider text-[11px] border-b border-[var(--color-border)]">
                <tr>
                  <th className="px-2.5 py-2">Product Description</th>
                  <th className="px-2 py-2 w-20 text-center">Qty</th>
                  <th className="px-2 py-2 w-24 text-right">Est Rate (₹)</th>
                  <th className="px-2 py-2 w-20 text-center">GST %</th>
                  <th className="px-2.5 py-2 w-28 text-right">Line Total (₹)</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {lines.map((l, idx) => {
                  const taxable = (l.ordered_qty || 0) * (l.purchase_rate || 0);
                  const total = taxable + (taxable * (l.gst_percent || 0)) / 100;

                  return (
                    <tr key={idx} className="hover:bg-[var(--color-surface-hover)]">
                      <td className="px-2.5 py-1.5">
                        <select
                          value={l.product_id}
                          onChange={(e) => handleProductSelect(idx, e.target.value)}
                          className="w-full rounded-[6px] border border-[var(--color-border)] px-2 py-1 text-xs bg-[var(--color-surface)] text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
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
                          className="w-16 rounded-[6px] border border-[var(--color-border)] px-1 py-1 text-center font-bold font-mono text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)] text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={l.purchase_rate}
                          onChange={(e) => updateLine(idx, { purchase_rate: Number(e.target.value) || 0 })}
                          className="w-20 rounded-[6px] border border-[var(--color-border)] px-1.5 py-1 text-right font-mono text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)] text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <select
                          value={l.gst_percent}
                          onChange={(e) => updateLine(idx, { gst_percent: Number(e.target.value) || 0 })}
                          className="rounded-[6px] border border-[var(--color-border)] px-1 py-1 text-xs font-mono bg-[var(--color-surface)] text-[var(--color-text)]"
                        >
                          <option value={0}>0%</option>
                          <option value={5}>5%</option>
                          <option value={12}>12%</option>
                          <option value={18}>18%</option>
                          <option value={28}>28%</option>
                        </select>
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-bold font-mono text-[var(--color-text)] tabular-nums">
                        ₹ {total.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button onClick={() => removeLine(idx)} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger-text)] cursor-pointer">
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
              className="flex items-center gap-1.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] shadow-2xs cursor-pointer transition-colors"
            >
              <Plus className="h-3.5 w-3.5 text-[var(--color-accent)]" />
              <span>Add Item</span>
            </button>

            <div className="flex items-center gap-4 text-xs font-semibold text-[var(--color-text-muted)]">
              <div>Subtotal: <span className="font-mono text-[var(--color-text)] tabular-nums">₹{totals.subtotal.toFixed(2)}</span></div>
              <div>Tax: <span className="font-mono text-[var(--color-text)] tabular-nums">₹{totals.tax.toFixed(2)}</span></div>
              <div className="text-sm font-black text-[var(--color-accent)]">Est Total: <span className="font-mono tabular-nums">₹{totals.total.toFixed(2)}</span></div>
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] pt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-accent)] px-5 py-1.5 font-bold text-white shadow-2xs hover:bg-[var(--color-accent-hover)] disabled:opacity-50 cursor-pointer transition-colors"
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

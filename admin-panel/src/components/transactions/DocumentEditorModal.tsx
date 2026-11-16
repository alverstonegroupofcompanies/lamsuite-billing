import React, { useEffect, useMemo, useState } from "react";
import { X, Plus, Trash2, FileText, FileCheck2, Loader2 } from "lucide-react";
import { api } from "../../services/api";
import { formatINR } from "../../utils/formatters";

export type DocumentKind = "quotation" | "purchase_order";

interface PartyOption {
  id: number;
  name: string;
  phone?: string;
  gstin?: string;
  current_balance?: number;
}

interface EditableLine {
  product_name: string;
  hsn_code: string;
  qty: string;
  rate: string;
  gst_percent: string;
}

interface DocumentEditorModalProps {
  kind: DocumentKind;
  storeId?: number | string;
  storeStateCode?: string;
  doc?: any | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const todayValue = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const dateValue = (value: unknown): string => {
  if (!value) return "";
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw.slice(0, 10);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const blankLine = (): EditableLine => ({ product_name: "", hsn_code: "", qty: "1", rate: "", gst_percent: "18" });

export const DocumentEditorModal: React.FC<DocumentEditorModalProps> = ({
  kind,
  storeId,
  storeStateCode,
  doc,
  onClose,
  onSaved,
}) => {
  const isQuotation = kind === "quotation";

  const [partyId, setPartyId] = useState<string>(doc?.customer_id || doc?.supplier_id || "");
  const [partyName, setPartyName] = useState<string>(doc?.customer_name || doc?.supplier_name || "");
  const [partyGstin, setPartyGstin] = useState<string>(doc?.customer_gstin || doc?.supplier_gstin || "");
  const [placeOfSupply, setPlaceOfSupply] = useState<string>(doc?.place_of_supply || storeStateCode || "");
  const [docDate, setDocDate] = useState<string>(dateValue(doc?.invoice_date) || todayValue());
  const [validUntil, setValidUntil] = useState<string>(dateValue(doc?.due_date));
  const [expectedDelivery, setExpectedDelivery] = useState<string>(dateValue(doc?.expected_delivery_date));
  const [moduleKey, setModuleKey] = useState<"po" | "pr">(
    doc?.module_key === "order" ? "pr" : "po"
  );
  const [notes, setNotes] = useState<string>(doc?.notes || "");
  const [lines, setLines] = useState<EditableLine[]>(
    Array.isArray(doc?.items) && doc.items.length > 0
      ? doc.items.map((item: any) => ({
          product_name: item.product_name || "",
          hsn_code: item.hsn_code || "",
          qty: String(item.qty ?? item.ordered_qty ?? 1),
          rate: String(item.purchase_rate ?? item.unit_price ?? ""),
          gst_percent: String(item.gst_percent ?? 0),
        }))
      : [blankLine(), blankLine()]
  );

  const [partyOptions, setPartyOptions] = useState<PartyOption[]>([]);
  const [isLoadingParties, setIsLoadingParties] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!storeId) return;
      setIsLoadingParties(true);
      try {
        const res = await api.get<{ data: PartyOption[] }>("/admin/parties", {
          active_store_id: storeId,
          type: isQuotation ? "customer" : "supplier",
          per_page: 500,
          export: "true",
        });
        if (!cancelled) setPartyOptions(res.data || []);
      } catch (err) {
        console.error("Failed to load parties", err);
      } finally {
        if (!cancelled) setIsLoadingParties(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [storeId, isQuotation]);

  const totals = useMemo(() => {
    let taxable = 0;
    let tax = 0;
    for (const line of lines) {
      const qty = Number(line.qty) || 0;
      const rate = Number(line.rate) || 0;
      const gst = Number(line.gst_percent) || 0;
      const lineTaxable = qty * rate;
      taxable += lineTaxable;
      tax += (lineTaxable * gst) / 100;
    }
    return {
      taxable: Math.round(taxable * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      grand: Math.round((taxable + tax) * 100) / 100,
    };
  }, [lines]);

  const updateLine = (index: number, patch: Partial<EditableLine>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const selectParty = (value: string) => {
    setPartyId(value);
    const found = partyOptions.find((p) => String(p.id) === value);
    if (found) {
      setPartyName(found.name);
      setPartyGstin(found.gstin || "");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const cleanLines = lines
      .filter((line) => line.product_name.trim() && Number(line.qty) > 0)
      .map((line) => ({
        product_name: line.product_name.trim(),
        hsn_code: line.hsn_code.trim() || undefined,
        qty: Number(line.qty),
        ...(isQuotation
          ? { unit_price: Number(line.rate) || 0 }
          : { purchase_rate: Number(line.rate) || 0 }),
        gst_percent: Number(line.gst_percent) || 0,
      }));

    if (cleanLines.length === 0) {
      setError("Add at least one line item with a name and quantity.");
      return;
    }
    if (!isQuotation && !partyName.trim()) {
      setError("Supplier name is required on a purchase order.");
      return;
    }

    const payload = isQuotation
      ? {
          store_id: storeId,
          customer_id: partyId ? Number(partyId) : undefined,
          customer_name: partyName.trim() || "Walk-in Customer",
          customer_gstin: partyGstin.trim() || undefined,
          place_of_supply: placeOfSupply.trim() || undefined,
          invoice_date: docDate,
          valid_until: validUntil || undefined,
          items: cleanLines,
        }
      : {
          store_id: storeId,
          module_key: moduleKey,
          supplier_id: partyId ? Number(partyId) : undefined,
          supplier_name: partyName.trim(),
          supplier_gstin: partyGstin.trim() || undefined,
          invoice_date: docDate,
          expected_delivery_date: expectedDelivery || undefined,
          notes: notes.trim() || undefined,
          items: cleanLines,
        };

    setIsSaving(true);
    try {
      const base = isQuotation ? "/admin/quotations" : "/admin/purchase-orders";
      if (doc?.id) {
        await api.put(`${base}/${doc.id}`, payload);
      } else {
        await api.post(base, payload);
      }
      onSaved(`${isQuotation ? "Quotation" : "Purchase order"} ${doc?.id ? "updated" : "created"}.`);
    } catch (err: any) {
      setError(err?.message || "Save failed. Check the fields and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const Icon = isQuotation ? FileText : FileCheck2;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-4xl w-full max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10">
          <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
            <Icon className="w-4 h-4 text-brand-600" />
            <span>
              {doc?.id ? "Edit" : "New"} {isQuotation ? "Quotation / Estimate" : "Purchase Order"}
              {doc?.invoice_number ? ` · ${doc.invoice_number}` : ""}
            </span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" type="button">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {isQuotation ? "Customer" : "Supplier"} {isQuotation ? "" : "*"}
              </label>
              <select
                value={partyId}
                onChange={(e) => selectParty(e.target.value)}
                disabled={isLoadingParties}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
              >
                <option value="">
                  {isLoadingParties ? "Loading…" : isQuotation ? "Walk-in / unregistered customer" : "-- Choose supplier --"}
                </option>
                {partyOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {!isQuotation && p.current_balance !== undefined ? ` (Balance: ${formatINR(p.current_balance)})` : ""}
                  </option>
                ))}
              </select>
              {isQuotation && (
                <input
                  type="text"
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  placeholder="Customer name (required for conversion)"
                  className="mt-2 w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              )}
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">GSTIN</label>
              <input
                type="text"
                value={partyGstin}
                onChange={(e) => setPartyGstin(e.target.value.toUpperCase())}
                maxLength={15}
                placeholder="32AAAAA0000A1Z5"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {isQuotation ? "Quotation Date" : "Order Date"} *
              </label>
              <input
                type="date"
                required
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>

            {isQuotation ? (
              <>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Valid Until</label>
                  <input
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Place of Supply</label>
                  <input
                    type="text"
                    value={placeOfSupply}
                    onChange={(e) => setPlaceOfSupply(e.target.value)}
                    maxLength={2}
                    placeholder={storeStateCode || "32"}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Order Type</label>
                  <select
                    value={moduleKey}
                    onChange={(e) => setModuleKey(e.target.value as "po" | "pr")}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  >
                    <option value="po">Purchase Order (PO)</option>
                    <option value="pr">Purchase Requisition (PR)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Expected Delivery</label>
                  <input
                    type="date"
                    value={expectedDelivery}
                    onChange={(e) => setExpectedDelivery(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
              </>
            )}
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase text-[10px] font-semibold">
                <tr>
                  <th className="px-3 py-2 text-left">Item Name</th>
                  <th className="px-3 py-2 text-left w-24">HSN</th>
                  <th className="px-3 py-2 text-right w-24">Qty</th>
                  <th className="px-3 py-2 text-right w-28">{isQuotation ? "Rate" : "Purchase Rate"}</th>
                  <th className="px-3 py-2 text-right w-20">GST %</th>
                  <th className="px-3 py-2 text-right w-28">Amount</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {lines.map((line, index) => {
                  const amount =
                    (Number(line.qty) || 0) *
                    (Number(line.rate) || 0) *
                    (1 + (Number(line.gst_percent) || 0) / 100);
                  return (
                    <tr key={index}>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={line.product_name}
                          onChange={(e) => updateLine(index, { product_name: e.target.value })}
                          placeholder="Product / item"
                          className="w-full px-2 py-1.5 bg-transparent border border-transparent focus:border-slate-300 dark:focus:border-slate-600 rounded-lg"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={line.hsn_code}
                          onChange={(e) => updateLine(index, { hsn_code: e.target.value })}
                          className="w-full px-2 py-1.5 bg-transparent border border-transparent focus:border-slate-300 dark:focus:border-slate-600 rounded-lg font-mono"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={line.qty}
                          onChange={(e) => updateLine(index, { qty: e.target.value })}
                          className="w-full px-2 py-1.5 bg-transparent border border-transparent focus:border-slate-300 dark:focus:border-slate-600 rounded-lg text-right font-mono"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.rate}
                          onChange={(e) => updateLine(index, { rate: e.target.value })}
                          className="w-full px-2 py-1.5 bg-transparent border border-transparent focus:border-slate-300 dark:focus:border-slate-600 rounded-lg text-right font-mono"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          max="50"
                          step="0.01"
                          value={line.gst_percent}
                          onChange={(e) => updateLine(index, { gst_percent: e.target.value })}
                          className="w-full px-2 py-1.5 bg-transparent border border-transparent focus:border-slate-300 dark:focus:border-slate-600 rounded-lg text-right font-mono"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold text-slate-700 dark:text-slate-200">
                        {formatINR(amount)}
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))}
                          className="text-slate-300 hover:text-rose-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, blankLine()])}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:text-brand-500"
              >
                <Plus className="w-3.5 h-3.5" /> Add line
              </button>
              <div className="flex items-center gap-4 text-[11px] text-slate-500">
                <span>Taxable <b className="font-mono text-slate-800 dark:text-slate-200">{formatINR(totals.taxable)}</b></span>
                <span>Tax <b className="font-mono text-slate-800 dark:text-slate-200">{formatINR(totals.tax)}</b></span>
                <span>
                  Total <b className="font-mono text-sm text-slate-900 dark:text-white">{formatINR(totals.grand)}</b>
                </span>
              </div>
            </div>
          </div>

          {!isQuotation && (
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Delivery Notes</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Delivery instructions, payment terms…"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white font-bold rounded-xl"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {doc?.id ? "Save Changes" : isQuotation ? "Create Quotation" : "Create Purchase Order"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

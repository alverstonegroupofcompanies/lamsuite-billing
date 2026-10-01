import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Truck,
  Plus,
  FileSpreadsheet,
  ScanText,
  Trash2,
  CheckCircle,
  AlertCircle,
  X,
  FileText,
  RotateCcw,
  ArrowUpFromLine,
} from "lucide-react";
import {
  purchaseService,
  type PurchaseLineItemInput,
  type PurchaseDocumentInput,
} from "../lib/purchases/purchaseService";
import { purchaseImportService } from "../lib/purchases/purchaseImportService";
import { productsStore, type ProductItem } from "../lib/masters/productsStore";
import { sqliteStorage } from "../lib/db/sqliteStorage";

export const PurchasesPage: React.FC = () => {
  const navigate = useNavigate();
  const [purchasesList, setPurchasesList] = useState<any[]>([]);
  const [isNewBillOpen, setIsNewBillOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"csv" | "ocr">("csv");
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // New Purchase Bill Form State
  const [supplierName, setSupplierName] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<PurchaseLineItemInput[]>([]);

  // Product helper
  const [products, setProducts] = useState<ProductItem[]>([]);

  useEffect(() => {
    loadPurchases();
    loadProducts();
  }, []);

  const loadProducts = async () => {
    const prods = await sqliteStorage.findAll<ProductItem>("products");
    setProducts(prods);
  };

  const loadPurchases = async () => {
    const docs = await sqliteStorage.findAll<any>("purchase_documents");
    setPurchasesList(docs.sort((a, b) => (b.created_at || 0) - (a.created_at || 0)));
  };

  const showNotification = (message: string, type: "success" | "error" = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const addLine = () => {
    setLines([
      ...lines,
      {
        product_id: `prod_${Date.now()}`,
        product_name: "",
        batch_no: "",
        expiry_date: "",
        qty: 1,
        free_qty: 0,
        units_per_pack: 1,
        purchase_rate: 0,
        mrp: 0,
        gst_percent: 12,
      },
    ]);
  };

  const updateLine = (idx: number, updates: Partial<PurchaseLineItemInput>) => {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], ...updates };
    setLines(updated);
  };

  const removeLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx));
  };

  const computeDocumentTotals = () => {
    let taxable = 0;
    let tax = 0;
    let total = 0;

    for (const l of lines) {
      const calc = purchaseService.calculateLineTotals(l);
      taxable += calc.taxable_amount;
      tax += calc.total_tax;
      total += calc.total_amount;
    }

    return {
      taxable: Math.round(taxable * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      total: Math.round(total * 100) / 100,
    };
  };

  const handleSavePurchase = async () => {
    if (!supplierName.trim() || !supplierInvoiceNo.trim()) {
      showNotification("Please provide supplier name and invoice number", "error");
      return;
    }
    if (lines.length === 0) {
      showNotification("Please add at least one line item", "error");
      return;
    }

    try {
      const purchaseNo = `PB-${Date.now().toString().slice(-6)}`;
      const input: PurchaseDocumentInput = {
        purchase_number: purchaseNo,
        supplier_id: `sup_${Date.now().toString().slice(-4)}`,
        supplier_name: supplierName,
        supplier_invoice_no: supplierInvoiceNo,
        purchase_date: purchaseDate,
        lines,
      };

      const res = await purchaseService.recordInwardPurchaseBill(input);
      if (res.success) {
        showNotification(`Inward Bill ${purchaseNo} recorded successfully!`);
        setIsNewBillOpen(false);
        setSupplierName("");
        setSupplierInvoiceNo("");
        setLines([]);
        loadPurchases();
      }
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Error saving purchase bill", "error");
    }
  };

  const handleParseImport = () => {
    if (!importText.trim()) return;

    if (importMode === "csv") {
      const result = purchaseImportService.parseDelimitedTable(importText);
      const parsedLines: PurchaseLineItemInput[] = result.records.map((r: Record<string, string>, i: number) => ({
        product_id: `prod_imp_${i}_${Date.now()}`,
        product_name: String(r.product_name || r.item_name || r.name || "Imported Item"),
        batch_no: String(r.batch_no || r.batch || "BATCH-01"),
        expiry_date: String(r.expiry_date || r.expiry || "2027-12-31"),
        qty: Number(r.qty || r.quantity || 1),
        free_qty: Number(r.free_qty || 0),
        units_per_pack: Number(r.units_per_pack || 1),
        purchase_rate: Number(r.purchase_rate || r.rate || r.price || 0),
        mrp: Number(r.mrp || 0),
        gst_percent: Number(r.gst_percent || r.gst || 12),
      }));

      setLines([...lines, ...parsedLines]);
      setIsImportModalOpen(false);
      showNotification(`Imported ${parsedLines.length} line items`);
    } else {
      const ocr = purchaseImportService.extractInvoiceFromOcrText(importText);
      if (ocr.invoice_number) setSupplierInvoiceNo(ocr.invoice_number);
      if (ocr.supplier_name) setSupplierName(ocr.supplier_name);
      if (ocr.invoice_date) setPurchaseDate(ocr.invoice_date);

      const parsedLines: PurchaseLineItemInput[] = ocr.lines.map((l: any, i: number) => ({
        product_id: `prod_ocr_${i}_${Date.now()}`,
        product_name: l.product_name,
        batch_no: l.batch_no || "OCR-B1",
        expiry_date: l.expiry_date || "2027-12-31",
        qty: l.qty,
        free_qty: l.free_qty || 0,
        units_per_pack: 1,
        purchase_rate: l.purchase_rate,
        gst_percent: l.gst_percent || 12,
      }));

      setLines([...lines, ...parsedLines]);
      setIsImportModalOpen(false);
      showNotification(`Extracted supplier invoice and ${parsedLines.length} items`);
    }
  };

  const totals = computeDocumentTotals();

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

      {/* Action Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Purchase Management</h2>
          <p className="text-xs text-slate-500">
            Inward supplier bills, free goods calculations, batch stock receipts, and tabular import.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <span>Import CSV / OCR</span>
          </button>
          <button
            onClick={() => {
              setIsNewBillOpen(true);
              if (lines.length === 0) addLine();
            }}
            className="flex items-center gap-2 rounded bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            <span>New Inward Bill (F2)</span>
          </button>
        </div>
      </div>

      {/* Inward Purchases History */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 bg-slate-50">
          <h3 className="text-xs font-bold text-slate-800">Inward Purchase Bills</h3>
          <span className="text-[11px] text-slate-500">{purchasesList.length} Records</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-100/70 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Bill No</th>
                <th className="px-4 py-2.5 font-semibold">Supplier</th>
                <th className="px-4 py-2.5 font-semibold">Supplier Inv #</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold text-right">Taxable</th>
                <th className="px-4 py-2.5 font-semibold text-right">GST</th>
                <th className="px-4 py-2.5 font-semibold text-right font-bold">Total Amount</th>
                <th className="px-4 py-2.5 font-semibold text-center">Status</th>
                <th className="px-4 py-2.5 font-semibold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {purchasesList.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <Truck className="mx-auto h-8 w-8 text-slate-300 mb-1" />
                    <p className="font-medium">No inward purchase bills recorded yet</p>
                    <p className="text-[11px] text-slate-400">Click "New Inward Bill" to record stock receipts</p>
                  </td>
                </tr>
              ) : (
                purchasesList.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-bold text-blue-600">{p.purchase_number}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{p.supplier_name}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{p.supplier_invoice_no}</td>
                    <td className="px-4 py-3 text-slate-500">{p.purchase_date}</td>
                    <td className="px-4 py-3 text-right text-slate-700">₹ {Number(p.subtotal || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">₹ {Number(p.tax_total || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      ₹ {Number(p.grand_total || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        RECEIVED
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => navigate(`/returns/purchases?purchaseId=${p.id}`)}
                        className="flex items-center gap-1 rounded bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 hover:bg-orange-100"
                        title="Issue debit note / return to supplier"
                      >
                        <ArrowUpFromLine className="h-3 w-3" />
                        Return
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Inward Bill Full Modal */}
      {isNewBillOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl overflow-hidden border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50">
              <div>
                <h3 className="text-sm font-bold text-slate-800">New Inward Purchase Bill</h3>
                <p className="text-[11px] text-slate-500">Record stock receipt, batches, and supplier GST</p>
              </div>
              <button onClick={() => setIsNewBillOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Header Fields */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Supplier Name *</label>
                  <input
                    type="text"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="e.g. Apex Healthcare Dist"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Supplier Invoice No *</label>
                  <input
                    type="text"
                    value={supplierInvoiceNo}
                    onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                    placeholder="e.g. SUP-INV-9901"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Invoice Date</label>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              {/* Items Grid */}
              <div className="rounded border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                    <tr>
                      <th className="px-2 py-2">Item Name</th>
                      <th className="px-2 py-2 w-28">Batch No</th>
                      <th className="px-2 py-2 w-24">Expiry</th>
                      <th className="px-2 py-2 w-16 text-center">Qty</th>
                      <th className="px-2 py-2 w-16 text-center">Free</th>
                      <th className="px-2 py-2 w-20 text-right">Rate (₹)</th>
                      <th className="px-2 py-2 w-16 text-center">GST %</th>
                      <th className="px-2 py-2 w-24 text-right font-semibold">Total (₹)</th>
                      <th className="px-2 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((l, idx) => {
                      const calc = purchaseService.calculateLineTotals(l);
                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={l.product_name}
                              onChange={(e) => updateLine(idx, { product_name: e.target.value })}
                              placeholder="Product Name"
                              className="w-full rounded border border-slate-200 px-1.5 py-1 text-xs"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={l.batch_no}
                              onChange={(e) => updateLine(idx, { batch_no: e.target.value })}
                              placeholder="Batch #"
                              className="w-full rounded border border-slate-200 px-1.5 py-1 text-xs font-mono"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={l.expiry_date}
                              onChange={(e) => updateLine(idx, { expiry_date: e.target.value })}
                              placeholder="YYYY-MM-DD"
                              className="w-full rounded border border-slate-200 px-1.5 py-1 text-xs font-mono"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <input
                              type="number"
                              value={l.qty}
                              onChange={(e) => updateLine(idx, { qty: Number(e.target.value) || 0 })}
                              className="w-14 rounded border border-slate-200 px-1 py-1 text-xs text-center"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <input
                              type="number"
                              value={l.free_qty || 0}
                              onChange={(e) => updateLine(idx, { free_qty: Number(e.target.value) || 0 })}
                              className="w-14 rounded border border-slate-200 px-1 py-1 text-xs text-center"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <input
                              type="number"
                              value={l.purchase_rate}
                              onChange={(e) => updateLine(idx, { purchase_rate: Number(e.target.value) || 0 })}
                              className="w-20 rounded border border-slate-200 px-1 py-1 text-xs text-right"
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
                          <td className="px-2 py-1.5 text-right font-bold text-slate-800">
                            ₹ {calc.total_amount.toFixed(2)}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <button onClick={() => removeLine(idx)} className="text-slate-400 hover:text-red-600">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center">
                <button
                  onClick={addLine}
                  className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Line</span>
                </button>

                <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
                  <div>
                    <span>Taxable Subtotal: </span>
                    <span className="font-bold text-slate-800">₹ {totals.taxable.toFixed(2)}</span>
                  </div>
                  <div>
                    <span>GST Tax: </span>
                    <span className="font-bold text-slate-800">₹ {totals.tax.toFixed(2)}</span>
                  </div>
                  <div>
                    <span>Grand Total: </span>
                    <span className="text-sm font-black text-blue-700">₹ {totals.total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3.5 flex justify-end gap-2">
              <button
                onClick={() => setIsNewBillOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePurchase}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-md hover:bg-blue-700"
              >
                <CheckCircle className="h-4 w-4" />
                <span>Save Inward Bill</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import CSV / OCR Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl overflow-hidden border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50">
              <h3 className="text-sm font-bold text-slate-800">Import Supplier Invoice</h3>
              <button onClick={() => setIsImportModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="flex gap-2 border-b border-slate-200 pb-2">
                <button
                  onClick={() => setImportMode("csv")}
                  className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold ${
                    importMode === "csv" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>CSV / TSV Spreadsheet</span>
                </button>
                <button
                  onClick={() => setImportMode("ocr")}
                  className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold ${
                    importMode === "ocr" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <ScanText className="h-3.5 w-3.5" />
                  <span>OCR / AI Text Extractor</span>
                </button>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  {importMode === "csv"
                    ? "Paste CSV or Tab-Separated Values (with headers):"
                    : "Paste Raw OCR text from supplier invoice scan:"}
                </label>
                <textarea
                  rows={8}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={
                    importMode === "csv"
                      ? "product_name,batch_no,expiry_date,qty,purchase_rate,gst_percent\nAmoxicillin,AMX-101,2027-12-31,10,100,12"
                      : "TAX INVOICE: SUP-9988\nSupplier: Apex Pharma\nDate: 2026-09-30\nAmoxicillin 500mg BATCH: B-101 EXP: 2027-10-31 10 strips @ 100.00"
                  }
                  className="w-full rounded border border-slate-300 p-2 text-xs font-mono text-slate-800 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3.5 flex justify-end gap-2">
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="rounded border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleParseImport}
                className="rounded bg-blue-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
              >
                Parse & Load Items
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

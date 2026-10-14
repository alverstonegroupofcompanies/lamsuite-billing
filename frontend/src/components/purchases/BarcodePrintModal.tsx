import React, { useState } from "react";
import { X, Printer, Barcode, SlidersHorizontal } from "lucide-react";
import {
  barcodeLabelService,
  type BarcodeLabelItem,
  type LabelTemplate,
  type LabelPrintConfig,
} from "../../lib/purchases/barcodeLabelService";
import { PrintPreviewModal } from "../PrintPreviewModal";
import { useModalEscape } from "../../lib/ui/modalEscapeManager";

interface BarcodePrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: Array<{
    product_id: string;
    product_name: string;
    batch_no: string;
    expiry_date?: string;
    total_units: number;
    mrp?: number;
    selling_rate?: number;
  }>;
}

export const BarcodePrintModal: React.FC<BarcodePrintModalProps> = ({
  isOpen,
  onClose,
  items,
}) => {
  useModalEscape(isOpen, onClose);

  const [labelItems, setLabelItems] = useState<BarcodeLabelItem[]>(
    items.map((it) => ({
      product_id: it.product_id,
      product_name: it.product_name,
      barcode: `${it.product_id.replace(/\D/g, "").slice(0, 8) || "890123"}${it.batch_no.replace(/\D/g, "").slice(0, 4)}`,
      batch_no: it.batch_no,
      expiry_date: it.expiry_date,
      mrp: it.mrp,
      selling_rate: it.selling_rate,
      quantity_to_print: Math.min(100, Math.max(1, Math.round(it.total_units || 1))),
    }))
  );

  const [template, setTemplate] = useState<LabelTemplate>("thermal_50x25");
  const [storeName, setStoreName] = useState("MEDPLUS PHARMACY");
  const [showStoreName, setShowStoreName] = useState(true);
  const [showMrp, setShowMrp] = useState(true);
  const [showSellingRate, setShowSellingRate] = useState(true);
  const [showExpiry, setShowExpiry] = useState(true);
  const [showBatch, setShowBatch] = useState(true);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  if (!isOpen) return null;

  const updateItemQty = (idx: number, qty: number) => {
    const updated = [...labelItems];
    updated[idx].quantity_to_print = Math.max(0, qty);
    setLabelItems(updated);
  };

  const totalLabels = labelItems.reduce((acc, it) => acc + (it.quantity_to_print || 0), 0);

  const config: LabelPrintConfig = {
    template,
    storeName,
    showStoreName,
    showMrp,
    showSellingRate,
    showExpiry,
    showBatch,
  };

  const generatedHtml = barcodeLabelService.generatePrintHtml(labelItems, config);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
        <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50">
            <div className="flex items-center gap-2">
              <Barcode className="h-5 w-5 text-blue-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">Print Barcode & Price Labels</h3>
                <p className="text-[11px] text-slate-500">{totalLabels} Total Labels to generate</p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
            {/* Template & Options */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-3">
              <div className="flex items-center gap-1.5 font-bold text-slate-800">
                <SlidersHorizontal className="h-4 w-4 text-slate-600" />
                <span>Label Configuration</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Sticker / Page Template</label>
                  <select
                    value={template}
                    onChange={(e) => setTemplate(e.target.value as LabelTemplate)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:border-blue-600 focus:outline-none"
                  >
                    <option value="thermal_50x25">Thermal Roll (50mm x 25mm 1-Across)</option>
                    <option value="thermal_38x25_dual">Thermal Roll (38mm x 25mm 2-Across)</option>
                    <option value="a4_24up">A4 Sheet (24-Up: 3 Cols x 8 Rows)</option>
                    <option value="a4_65up">A4 Sheet (65-Up: 5 Cols x 13 Rows)</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Header Store Name</label>
                  <input
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 pt-1 text-[11px] font-medium text-slate-700">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showStoreName} onChange={(e) => setShowStoreName(e.target.checked)} />
                  <span>Store Name</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showMrp} onChange={(e) => setShowMrp(e.target.checked)} />
                  <span>MRP</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showSellingRate} onChange={(e) => setShowSellingRate(e.target.checked)} />
                  <span>Our Price</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showBatch} onChange={(e) => setShowBatch(e.target.checked)} />
                  <span>Batch #</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showExpiry} onChange={(e) => setShowExpiry(e.target.checked)} />
                  <span>Expiry Date</span>
                </label>
              </div>
            </div>

            {/* Item-wise label count */}
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2">Product Name</th>
                    <th className="px-3 py-2 w-24">Batch</th>
                    <th className="px-3 py-2 w-20">Expiry</th>
                    <th className="px-3 py-2 w-20 text-right">MRP</th>
                    <th className="px-3 py-2 w-20 text-right">Our Price</th>
                    <th className="px-3 py-2 w-24 text-center">Label Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {labelItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800">{item.product_name}</td>
                      <td className="px-3 py-2 font-mono text-slate-600">{item.batch_no}</td>
                      <td className="px-3 py-2 text-slate-500">{item.expiry_date?.slice(0, 7) || "-"}</td>
                      <td className="px-3 py-2 text-right text-slate-600">₹{item.mrp?.toFixed(2) || "-"}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-900">₹{item.selling_rate?.toFixed(2) || "-"}</td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="number"
                          min="0"
                          value={item.quantity_to_print}
                          onChange={(e) => updateItemQty(idx, parseInt(e.target.value, 10) || 0)}
                          className="w-16 rounded border border-slate-200 px-1.5 py-1 text-center text-xs font-bold focus:border-blue-600 focus:outline-none"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-slate-50 px-5 py-3.5 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded border border-slate-300 bg-white px-3.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const printFrame = document.createElement("iframe");
                printFrame.style.position = "fixed";
                printFrame.style.right = "0";
                printFrame.style.bottom = "0";
                printFrame.style.width = "0";
                printFrame.style.height = "0";
                printFrame.style.border = "0";
                document.body.appendChild(printFrame);
                const frameDoc = printFrame.contentWindow?.document;
                if (frameDoc) {
                  frameDoc.open();
                  frameDoc.write(generatedHtml);
                  frameDoc.close();
                  printFrame.contentWindow?.focus();
                  printFrame.contentWindow?.print();
                  setTimeout(() => {
                    document.body.removeChild(printFrame);
                  }, 2000);
                }
              }}
              disabled={totalLabels === 0}
              className="flex items-center gap-1.5 rounded bg-purple-600 px-4 py-1.5 font-bold text-white shadow-sm hover:bg-purple-700 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              <span>Print Labels ({totalLabels})</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

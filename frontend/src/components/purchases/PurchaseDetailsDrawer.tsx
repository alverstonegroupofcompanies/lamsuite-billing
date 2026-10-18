import React, { useState, useEffect } from "react";
import {
  X,
  Printer,
  Barcode,
  CreditCard,
  RotateCcw,
  Ban,
  FileText,
  AlertTriangle,
  Building2,
  Calendar,
  Layers,
  CheckCircle2,
} from "lucide-react";
import {
  purchaseService,
  type PurchaseDocumentRecord,
  type PurchaseItemRecord,
} from "../../lib/purchases/purchaseService";
import { BarcodePrintModal } from "./BarcodePrintModal";
import { SupplierPaymentModal } from "./SupplierPaymentModal";
import { PrintPreviewModal } from "../PrintPreviewModal";
import { useNavigate } from "react-router-dom";
import { useModalEscape } from "../../lib/ui/modalEscapeManager";

interface PurchaseDetailsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  purchaseId: string | null;
  onPurchaseUpdated: () => void;
}

export const PurchaseDetailsDrawer: React.FC<PurchaseDetailsDrawerProps> = ({
  isOpen,
  onClose,
  purchaseId,
  onPurchaseUpdated,
}) => {
  const navigate = useNavigate();
  useModalEscape(isOpen, onClose);

  const [doc, setDoc] = useState<PurchaseDocumentRecord | null>(null);
  const [items, setItems] = useState<PurchaseItemRecord[]>([]);
  const [isBarcodeOpen, setIsBarcodeOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  useModalEscape(isCancelConfirmOpen, () => setIsCancelConfirmOpen(false));
  const [cancelReason, setCancelReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && purchaseId) {
      loadDetails();
    }
  }, [isOpen, purchaseId]);

  const loadDetails = async () => {
    if (!purchaseId) return;
    const res = await purchaseService.getPurchaseBillById(purchaseId);
    if (res) {
      setDoc(res.document);
      setItems(res.items);
    }
  };

  if (!isOpen || !doc) return null;

  const handleCancel = async () => {
    if (!cancelReason.trim()) {
      setCancelError("Please provide a cancellation reason");
      return;
    }
    try {
      setIsCancelling(true);
      setCancelError(null);
      await purchaseService.cancelPurchaseBill(doc.id, cancelReason.trim());
      setIsCancelConfirmOpen(false);
      onPurchaseUpdated();
      onClose();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Failed to cancel purchase");
    } finally {
      setIsCancelling(false);
    }
  };

  const generateGRNHtml = () => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Goods Receipt Note - ${doc.purchase_number}</title>
        <style>
          * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11px; }
          body { padding: 20px; color: #1e293b; }
          .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 15px; }
          .header h1 { margin: 0; font-size: 18px; text-transform: uppercase; }
          .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
          th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
          th { background: #f8fafc; font-weight: bold; }
          .text-right { text-align: right; }
          .totals-table { width: 40%; margin-left: auto; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>GOODS RECEIPT NOTE (INWARD PURCHASE)</h1>
          <p>Bill Ref: <b>${doc.purchase_number}</b> | Date: ${doc.purchase_date}</p>
        </div>
        <div class="meta-grid">
          <div>
            <strong>Supplier:</strong> ${doc.supplier_name}<br/>
            <strong>GSTIN:</strong> ${doc.supplier_gstin || "N/A"}<br/>
            <strong>Place of Supply:</strong> ${doc.place_of_supply || "State"}
          </div>
          <div>
            <strong>Supplier Inv #:</strong> ${doc.supplier_invoice_no || "N/A"}<br/>
            <strong>Status:</strong> ${(doc.status || "received").toUpperCase()}<br/>
            <strong>Payment Status:</strong> ${(doc.payment_status || "unpaid").toUpperCase()}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Product Description</th>
              <th>HSN</th>
              <th>Batch</th>
              <th>Exp</th>
              <th class="text-right">Packs</th>
              <th class="text-right">Free</th>
              <th class="text-right">Total Units</th>
              <th class="text-right">Rate</th>
              <th class="text-right">Disc</th>
              <th class="text-right">GST %</th>
              <th class="text-right">Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map(
                (it, idx) => `
              <tr>
                <td>${idx + 1}</td>
                <td><b>${it.product_name}</b></td>
                <td>${it.hsn_code || "-"}</td>
                <td>${it.batch_no}</td>
                <td>${it.expiry_date ? it.expiry_date.slice(0, 7) : "-"}</td>
                <td class="text-right">${it.pack_qty}</td>
                <td class="text-right">${it.free_qty || 0}</td>
                <td class="text-right"><b>${it.total_units}</b></td>
                <td class="text-right">₹${it.purchase_rate.toFixed(2)}</td>
                <td class="text-right">₹${it.discount_amount.toFixed(2)}</td>
                <td class="text-right">${it.gst_percent}%</td>
                <td class="text-right"><b>₹${it.total_amount.toFixed(2)}</b></td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
        <table class="totals-table">
          <tr><td>Taxable Subtotal:</td><td class="text-right">₹${Number(doc.subtotal || 0).toFixed(2)}</td></tr>
          <tr><td>GST Tax:</td><td class="text-right">₹${Number(doc.tax_total || 0).toFixed(2)}</td></tr>
          <tr><td>Round Off:</td><td class="text-right">₹${Number(doc.round_off || 0).toFixed(2)}</td></tr>
          <tr><td><strong>Grand Total:</strong></td><td class="text-right"><strong>₹${Number(doc.grand_total || 0).toFixed(2)}</strong></td></tr>
          <tr><td>Paid Amount:</td><td class="text-right">₹${Number(doc.paid_amount || 0).toFixed(2)}</td></tr>
          <tr><td><strong>Balance Due:</strong></td><td class="text-right"><strong>₹${Math.max(0, Number(doc.grand_total || 0) - Number(doc.paid_amount || 0)).toFixed(2)}</strong></td></tr>
        </table>
      </body>
      </html>
    `;
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
        <div className="w-full max-w-2xl bg-[var(--color-surface)] shadow-modal flex flex-col h-full overflow-hidden border-l border-[var(--color-border)] font-sans">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4 bg-[var(--color-surface)]">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold font-mono text-[var(--color-text)]">{doc.purchase_number}</h3>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                    doc.status === "received"
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent-soft)]"
                      : "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] border border-[var(--color-danger-border)]"
                  }`}
                >
                  {(doc.status || "received").toUpperCase()}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    (doc.payment_status || "unpaid") === "paid"
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent-soft)]"
                      : (doc.payment_status || "unpaid") === "partial"
                      ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
                      : "bg-[var(--color-canvas)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
                  }`}
                >
                  {(doc.payment_status || "unpaid").toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5 font-mono">Supplier Inv #: {doc.supplier_invoice_no}</p>
            </div>

            <button onClick={onClose} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded-[6px] cursor-pointer">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-5 py-2.5 bg-[var(--color-canvas)] overflow-x-auto">
            <button
              onClick={() => setIsPrintOpen(true)}
              className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] border border-[var(--color-border)] shadow-2xs hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
            >
              <Printer className="h-3.5 w-3.5 text-[var(--color-accent)]" />
              <span>Print GRN</span>
            </button>

            <button
              onClick={() => setIsBarcodeOpen(true)}
              className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] border border-[var(--color-border)] shadow-2xs hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
            >
              <Barcode className="h-3.5 w-3.5 text-[var(--color-accent)]" />
              <span>Barcodes</span>
            </button>

            {doc.status !== "cancelled" && (doc.payment_status || "unpaid") !== "paid" && (
              <button
                onClick={() => setIsPaymentOpen(true)}
                className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-accent)] px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-[var(--color-accent-hover)] cursor-pointer transition-colors"
              >
                <CreditCard className="h-3.5 w-3.5" />
                <span>Pay Supplier</span>
              </button>
            )}

            {doc.status !== "cancelled" && (
              <button
                onClick={() => navigate(`/returns/purchases?purchaseId=${doc.id}`)}
                className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-warning-text)] border border-[var(--color-warning-border)] shadow-2xs hover:bg-[var(--color-warning-bg)] cursor-pointer transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5 text-[var(--color-warning-text)]" />
                <span>Return / Debit Note</span>
              </button>
            )}

            {doc.status !== "cancelled" && (
              <button
                onClick={() => setIsCancelConfirmOpen(true)}
                className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-danger-text)] border border-[var(--color-danger-border)] shadow-2xs hover:bg-[var(--color-danger-bg)] ml-auto cursor-pointer transition-colors"
              >
                <Ban className="h-3.5 w-3.5" />
                <span>Cancel Bill</span>
              </button>
            )}
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
            {/* Metadata Box */}
            <div className="grid grid-cols-2 gap-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)] p-3.5">
              <div>
                <div className="text-[11px] text-[var(--color-text-muted)] font-medium uppercase tracking-wider">Supplier Details</div>
                <div className="font-bold text-[var(--color-text)] text-sm mt-0.5">{doc.supplier_name}</div>
                {doc.supplier_gstin && <div className="font-mono text-[var(--color-text-muted)]">GSTIN: {doc.supplier_gstin}</div>}
                <div className="text-[var(--color-text-muted)]">POS: {doc.place_of_supply || "State"}</div>
              </div>

              <div>
                <div className="text-[11px] text-[var(--color-text-muted)] font-medium uppercase tracking-wider">Dates & Status</div>
                <div className="mt-0.5 text-[var(--color-text)]"><b>Invoice Date:</b> <span className="font-mono">{doc.purchase_date}</span></div>
                {doc.due_date && <div className="text-[var(--color-text)]"><b>Due Date:</b> <span className="font-mono">{doc.due_date}</span></div>}
                <div className="text-[var(--color-text)]"><b>ITC:</b> {doc.itc_eligibility?.toUpperCase() || "ELIGIBLE"}</div>
                {doc.is_interstate === 1 && <div className="font-semibold text-[var(--color-accent)]">Interstate IGST</div>}
              </div>
            </div>

            {/* Line Items Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-[var(--color-text)]">Item Inward Grid ({items.length} Lines)</h4>
              </div>

              <div className="rounded-[10px] border border-[var(--color-border)] overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--color-canvas)] text-[var(--color-text-muted)] font-bold uppercase tracking-wider text-[11px] border-b border-[var(--color-border)]">
                    <tr>
                      <th className="px-3 py-2">Item / Batch</th>
                      <th className="px-2 py-2 text-center">Packs</th>
                      <th className="px-2 py-2 text-center">Free</th>
                      <th className="px-2 py-2 text-center">Total Units</th>
                      <th className="px-2 py-2 text-right">Rate</th>
                      <th className="px-2 py-2 text-center">GST</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {items.map((it, idx) => (
                      <tr key={idx} className="hover:bg-[var(--color-surface-hover)]">
                        <td className="px-3 py-2">
                          <div className="font-bold text-[var(--color-text)]">{it.product_name}</div>
                          <div className="text-[11px] text-[var(--color-text-muted)] font-mono">
                            Batch: {it.batch_no} | Exp: {it.expiry_date?.slice(0, 7) || "-"}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center font-mono font-medium">{it.pack_qty}</td>
                        <td className="px-2 py-2 text-center text-[var(--color-text-muted)] font-mono">{it.free_qty || 0}</td>
                        <td className="px-2 py-2 text-center font-bold font-mono text-[var(--color-accent)]">{it.total_units}</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">₹{it.purchase_rate.toFixed(2)}</td>
                        <td className="px-2 py-2 text-center font-mono">{it.gst_percent}%</td>
                        <td className="px-3 py-2 text-right font-bold font-mono text-[var(--color-text)] tabular-nums">
                          ₹{it.total_amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Financial Summary */}
            <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)] p-3.5 space-y-1.5 ml-auto w-72 text-xs">
              <div className="flex justify-between text-[var(--color-text-muted)]">
                <span>Taxable Subtotal:</span>
                <span className="font-mono tabular-nums text-[var(--color-text)]">₹ {Number(doc.subtotal || 0).toFixed(2)}</span>
              </div>
              {Number(doc.discount_total || 0) > 0 && (
                <div className="flex justify-between text-[var(--color-accent)]">
                  <span>Discounts:</span>
                  <span className="font-mono tabular-nums">- ₹ {Number(doc.discount_total || 0).toFixed(2)}</span>
                </div>
              )}
              {doc.is_interstate === 1 ? (
                <div className="flex justify-between text-[var(--color-text-muted)]">
                  <span>IGST Tax:</span>
                  <span className="font-mono tabular-nums text-[var(--color-text)]">₹ {Number(doc.igst_total || 0).toFixed(2)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-[var(--color-text-muted)]">
                    <span>CGST:</span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">₹ {Number(doc.cgst_total || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[var(--color-text-muted)]">
                    <span>SGST:</span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">₹ {Number(doc.sgst_total || 0).toFixed(2)}</span>
                  </div>
                </>
              )}
              {Number(doc.round_off || 0) !== 0 && (
                <div className="flex justify-between text-[var(--color-text-muted)]">
                  <span>Round Off:</span>
                  <span className="font-mono tabular-nums text-[var(--color-text)]">₹ {Number(doc.round_off || 0).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-[var(--color-text)] text-sm border-t border-[var(--color-border)] pt-1.5">
                <span>Grand Total:</span>
                <span className="text-[var(--color-accent)] font-mono tabular-nums">₹ {Number(doc.grand_total || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[var(--color-text-muted)] border-t border-[var(--color-border)] pt-1">
                <span>Paid Amount:</span>
                <span className="font-semibold font-mono text-[var(--color-accent)] tabular-nums">₹ {Number(doc.paid_amount || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-[var(--color-text)]">
                <span>Balance Due:</span>
                <span className="text-[var(--color-danger-text)] font-mono tabular-nums">
                  ₹ {Math.max(0, Number(doc.grand_total || 0) - Number(doc.paid_amount || 0)).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      {isCancelConfirmOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[14px] bg-[var(--color-surface)] p-5 shadow-modal border border-[var(--color-border)] space-y-3 font-sans">
            <div className="flex items-center gap-2 text-[var(--color-danger-text)] font-bold text-sm">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span>Cancel Purchase Bill {doc.purchase_number}?</span>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Cancelling will revert batch stock and deduct the invoice credit from the supplier ledger. Stock cannot be reverted if units have already been sold.
            </p>

            {cancelError && (
              <div className="rounded-[10px] bg-[var(--color-danger-bg)] p-2 text-xs text-[var(--color-danger-text)] border border-[var(--color-danger-border)]">
                {cancelError}
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-[var(--color-text)] block mb-1">Reason for cancellation *</label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Inward data entry error / Supplier invoice revised"
                className="w-full rounded-[10px] border border-[var(--color-border)] p-2 text-xs text-[var(--color-text)] focus:border-[var(--color-danger-text)] focus:outline-none bg-[var(--color-surface)]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsCancelConfirmOpen(false)}
                className="rounded-[10px] border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={handleCancel}
                disabled={isCancelling}
                className="rounded-[10px] bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-1.5 text-xs font-bold text-[var(--color-danger-text)] shadow-2xs hover:bg-red-700 hover:text-white disabled:opacity-50 cursor-pointer transition-colors"
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Print Modal */}
      {isBarcodeOpen && (
        <BarcodePrintModal
          isOpen={isBarcodeOpen}
          onClose={() => setIsBarcodeOpen(false)}
          items={items.map((it) => ({
            product_id: it.product_id,
            product_name: it.product_name,
            batch_no: it.batch_no,
            expiry_date: it.expiry_date,
            total_units: it.total_units,
            mrp: it.mrp,
            selling_rate: it.selling_rate,
          }))}
        />
      )}

      {/* Payment Modal */}
      {isPaymentOpen && (
        <SupplierPaymentModal
          isOpen={isPaymentOpen}
          onClose={() => setIsPaymentOpen(false)}
          defaultSupplierId={doc.supplier_id}
          defaultPurchaseId={doc.id}
          defaultAmount={Math.max(0, doc.grand_total - (doc.paid_amount || 0))}
          onPaymentRecorded={() => {
            loadDetails();
            onPurchaseUpdated();
          }}
        />
      )}

      {/* Print Preview */}
      {isPrintOpen && (
        <PrintPreviewModal
          isOpen={isPrintOpen}
          onClose={() => setIsPrintOpen(false)}
          title={`Inward Goods Receipt Note - ${doc.purchase_number}`}
          docType="tax_invoice"
          initialFormat="a4"
          data={{
            invoice_number: doc.purchase_number,
            invoice_date: doc.purchase_date,
            store_name: "LamStone Pharmacy",
            place_of_supply: doc.place_of_supply || "State",
            customer_name: doc.supplier_name,
            customer_gstin: doc.supplier_gstin,
            subtotal: doc.subtotal,
            tax_total: doc.tax_total,
            cgst_total: doc.cgst_total,
            sgst_total: doc.sgst_total,
            igst_total: doc.igst_total,
            round_off: doc.round_off,
            grand_total: doc.grand_total,
            lines: items.map((it) => ({
              description: it.product_name,
              hsn_code: it.hsn_code,
              batch_no: it.batch_no,
              expiry_date: it.expiry_date,
              qty: it.pack_qty,
              loose_qty: it.loose_qty,
              rate: it.purchase_rate,
              discount_amount: it.discount_amount,
              taxable_amount: it.total_amount - it.tax_amount,
              gst_percent: it.gst_percent,
              amount: it.total_amount,
            })),
          }}
        />
      )}
    </>
  );
};

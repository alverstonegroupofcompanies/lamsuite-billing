import React, { useState, useEffect } from "react";
import {
  X,
  CheckCircle2,
  AlertTriangle,
  PackageCheck,
  RotateCcw,
  Truck,
  Check,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import {
  type InterStoreTransfer,
  type TransferReceiptLineInput,
} from "../lib/stock/interStoreTransferService";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

interface TransferReceiptModalProps {
  isOpen: boolean;
  transfer: InterStoreTransfer | null;
  onClose: () => void;
  onConfirmReceipt: (receiptLines: TransferReceiptLineInput[]) => void;
}

export const TransferReceiptModal: React.FC<TransferReceiptModalProps> = ({
  isOpen,
  transfer,
  onClose,
  onConfirmReceipt,
}) => {
  useModalEscape(isOpen && Boolean(transfer), onClose);

  const [receiptRows, setReceiptRows] = useState<
    Array<{
      line_id: string;
      product_name: string;
      batch_no: string;
      expiry_date: string;
      units_per_pack: number;
      dispatched_packs: number;
      dispatched_loose: number;
      dispatched_total_qty: number;
      received_packs: number;
      received_loose: number;
      damaged_packs: number;
      damaged_loose: number;
      variance_reason: string;
      variance_action: "return_source" | "write_off_damage" | "pending_approval";
      receipt_notes: string;
    }>
  >([]);

  useEffect(() => {
    if (transfer && isOpen) {
      setReceiptRows(
        transfer.lines.map((l) => ({
          line_id: l.id,
          product_name: l.product_name,
          batch_no: l.batch_no,
          expiry_date: l.expiry_date,
          units_per_pack: l.units_per_pack,
          dispatched_packs: l.transfer_packs,
          dispatched_loose: l.transfer_loose,
          dispatched_total_qty: l.transfer_total_qty,
          received_packs: l.transfer_packs, // Default to 100% received for rapid confirmation
          received_loose: l.transfer_loose,
          damaged_packs: 0,
          damaged_loose: 0,
          variance_reason: "Short delivery",
          variance_action: "return_source",
          receipt_notes: "",
        }))
      );
    }
  }, [transfer, isOpen]);

  if (!isOpen || !transfer) return null;

  const handleUpdateRow = (
    index: number,
    field: "received_packs" | "received_loose" | "damaged_packs" | "damaged_loose" | "variance_reason" | "variance_action" | "receipt_notes",
    val: any
  ) => {
    setReceiptRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  };

  const handleAcceptAllInFull = () => {
    setReceiptRows((prev) =>
      prev.map((r) => ({
        ...r,
        received_packs: r.dispatched_packs,
        received_loose: r.dispatched_loose,
        damaged_packs: 0,
        damaged_loose: 0,
      }))
    );
  };

  const handleApplyReceipt = () => {
    const linesInput: TransferReceiptLineInput[] = receiptRows.map((r) => ({
      line_id: r.line_id,
      received_packs: Number(r.received_packs) || 0,
      received_loose: Number(r.received_loose) || 0,
      damaged_packs: Number(r.damaged_packs) || 0,
      damaged_loose: Number(r.damaged_loose) || 0,
      variance_reason: r.variance_reason,
      variance_action: r.variance_action,
      receipt_notes: r.receipt_notes,
    }));

    onConfirmReceipt(linesInput);
    onClose();
  };

  // Compute live variance stats
  let totalDispatched = 0;
  let totalAccepted = 0;
  let totalShort = 0;
  let totalDamaged = 0;

  for (const r of receiptRows) {
    const upp = Math.max(1, r.units_per_pack || 1);
    const dispUnits = r.dispatched_packs * upp + r.dispatched_loose;
    const recvUnits = (Number(r.received_packs) || 0) * upp + (Number(r.received_loose) || 0);
    const dmgUnits = (Number(r.damaged_packs) || 0) * upp + (Number(r.damaged_loose) || 0);
    const accUnits = Math.max(0, recvUnits - dmgUnits);
    const shortUnits = Math.max(0, dispUnits - recvUnits);

    totalDispatched += dispUnits;
    totalAccepted += accUnits;
    totalShort += shortUnits;
    totalDamaged += dmgUnits;
  }

  const hasVariances = totalShort > 0 || totalDamaged > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 select-none font-sans animate-in fade-in duration-100">
      <div className="w-full max-w-5xl rounded-card bg-surface shadow-modal border border-border-main overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-main px-6 py-4 bg-canvas">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-btn bg-accent-soft text-accent">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-text-main">
                Receive & Verify Store Transfer: <span className="font-mono text-accent">{transfer.transfer_no}</span>
              </h3>
              <p className="text-xs text-text-muted">
                From <strong className="text-text-main">{transfer.source_store_name}</strong> to{" "}
                <strong className="text-text-main">{transfer.destination_store_name}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleAcceptAllInFull}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-canvas text-accent font-bold text-xs rounded-btn border border-border-main shadow-xs transition-colors cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              <span>1-Click Accept All in Full</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-text-muted hover:text-text-main rounded-btn hover:bg-canvas transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Transport & Details Ribbon */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-4 text-slate-600">
            <div className="flex items-center gap-1.5 font-medium">
              <Truck className="h-3.5 w-3.5 text-slate-500" />
              <span>Vehicle: {transfer.transport_details.vehicle_number || "Direct Delivery"}</span>
            </div>
            {transfer.transport_details.transporter_name && (
              <span>Transporter: {transfer.transport_details.transporter_name}</span>
            )}
            {transfer.transport_details.lr_number && (
              <span className="font-mono">LR: {transfer.transport_details.lr_number}</span>
            )}
          </div>

          {/* Variance Summary Badges */}
          <div className="flex items-center gap-3 font-bold">
            <span className="text-slate-600">Dispatched: {totalDispatched} units</span>
            <span className="text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">Accepted: {totalAccepted} units</span>
            {totalShort > 0 && (
              <span className="text-amber-800 bg-amber-100 px-2 py-0.5 rounded">Short: {totalShort} units</span>
            )}
            {totalDamaged > 0 && (
              <span className="text-red-800 bg-red-100 px-2 py-0.5 rounded">Damaged: {totalDamaged} units</span>
            )}
          </div>
        </div>

        {/* Lines Verification Table */}
        <div className="p-6 overflow-y-auto flex-1">
          <div className="rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3 w-10">#</th>
                  <th className="p-3">Product Name & Batch</th>
                  <th className="p-3 text-center">Dispatched</th>
                  <th className="p-3 text-center bg-emerald-50 text-emerald-900 border-x border-emerald-100">
                    Received (Packs / Loose)
                  </th>
                  <th className="p-3 text-center bg-red-50 text-red-900 border-r border-red-100">
                    Damaged (Packs / Loose)
                  </th>
                  <th className="p-3 text-center">Status / Variance</th>
                  <th className="p-3">Variance Reason & Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {receiptRows.map((row, idx) => {
                  const upp = Math.max(1, row.units_per_pack || 1);
                  const dispUnits = row.dispatched_packs * upp + row.dispatched_loose;
                  const recvUnits = (Number(row.received_packs) || 0) * upp + (Number(row.received_loose) || 0);
                  const dmgUnits = (Number(row.damaged_packs) || 0) * upp + (Number(row.damaged_loose) || 0);
                  const accUnits = Math.max(0, recvUnits - dmgUnits);
                  const shortUnits = Math.max(0, dispUnits - recvUnits);
                  const isLineVariance = shortUnits > 0 || dmgUnits > 0;

                  return (
                    <tr key={row.line_id} className={`hover:bg-slate-50 ${isLineVariance ? "bg-amber-50/20" : ""}`}>
                      <td className="p-3 text-slate-400 font-mono">{idx + 1}</td>
                      <td className="p-3">
                        <div className="font-bold text-slate-800">{row.product_name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          Batch: <span className="font-bold text-slate-700">{row.batch_no}</span> (Exp: {row.expiry_date})
                        </div>
                      </td>
                      <td className="p-3 text-center font-bold text-slate-700">
                        {row.dispatched_packs > 0 && <span>{row.dispatched_packs} pk </span>}
                        {row.dispatched_loose > 0 && <span>{row.dispatched_loose} pc</span>}
                        {row.dispatched_packs === 0 && row.dispatched_loose === 0 && <span>0</span>}
                      </td>

                      {/* Received inputs */}
                      <td className="p-2.5 text-center bg-emerald-50/40 border-x border-emerald-100">
                        <div className="inline-flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            value={row.received_packs}
                            onChange={(e) => handleUpdateRow(idx, "received_packs", Math.max(0, parseFloat(e.target.value) || 0))}
                            className="w-14 rounded-lg border border-emerald-300 bg-white p-1 text-center font-bold text-xs text-emerald-950 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            placeholder="Packs"
                          />
                          <span className="text-[11px] text-slate-400">pk</span>
                          {upp > 1 && (
                            <>
                              <input
                                type="number"
                                min="0"
                                max={upp - 1}
                                value={row.received_loose}
                                onChange={(e) => handleUpdateRow(idx, "received_loose", Math.max(0, parseFloat(e.target.value) || 0))}
                                className="w-12 rounded-lg border border-emerald-300 bg-white p-1 text-center font-bold text-xs text-emerald-950 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                placeholder="Loose"
                              />
                              <span className="text-[11px] text-slate-400">pc</span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Damaged inputs */}
                      <td className="p-2.5 text-center bg-red-50/40 border-r border-red-100">
                        <div className="inline-flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            value={row.damaged_packs}
                            onChange={(e) => handleUpdateRow(idx, "damaged_packs", Math.max(0, parseFloat(e.target.value) || 0))}
                            className="w-12 rounded-lg border border-red-300 bg-white p-1 text-center font-bold text-xs text-red-950 focus:outline-none focus:ring-1 focus:ring-red-500"
                            placeholder="0"
                          />
                          <span className="text-[11px] text-slate-400">pk</span>
                          {upp > 1 && (
                            <>
                              <input
                                type="number"
                                min="0"
                                max={upp - 1}
                                value={row.damaged_loose}
                                onChange={(e) => handleUpdateRow(idx, "damaged_loose", Math.max(0, parseFloat(e.target.value) || 0))}
                                className="w-12 rounded-lg border border-red-300 bg-white p-1 text-center font-bold text-xs text-red-950 focus:outline-none focus:ring-1 focus:ring-red-500"
                                placeholder="0"
                              />
                              <span className="text-[11px] text-slate-400">pc</span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Status / Live calculation */}
                      <td className="p-3 text-center">
                        {!isLineVariance ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="h-3 w-3" />
                            100% OK
                          </span>
                        ) : (
                          <div className="space-y-0.5 text-[11px] font-bold">
                            {shortUnits > 0 && <span className="block text-amber-700">Short: {shortUnits} units</span>}
                            {dmgUnits > 0 && <span className="block text-red-700">Damaged: {dmgUnits} units</span>}
                          </div>
                        )}
                      </td>

                      {/* Variance reason and action */}
                      <td className="p-2.5">
                        {isLineVariance ? (
                          <div className="space-y-1">
                            <select
                              value={row.variance_reason}
                              onChange={(e) => handleUpdateRow(idx, "variance_reason", e.target.value)}
                              className="w-full rounded border border-amber-300 bg-amber-50/50 p-1 text-[11px] font-medium text-slate-800 focus:outline-none"
                            >
                              <option value="Short packed by dispatch">Short packed by dispatch</option>
                              <option value="Broken / Leaked in transit">Broken / Leaked in transit</option>
                              <option value="Wrong batch or product">Wrong batch or product</option>
                              <option value="Physical carton damaged">Physical carton damaged</option>
                              <option value="Expired / Near-expiry delivered">Expired / Near-expiry delivered</option>
                              <option value="Other">Other</option>
                            </select>
                            <select
                              value={row.variance_action}
                              onChange={(e) => handleUpdateRow(idx, "variance_action", e.target.value as any)}
                              className="w-full rounded border border-slate-300 p-1 text-[11px] font-medium text-slate-700 focus:outline-none"
                            >
                              <option value="return_source">Return shortage to Source Store</option>
                              <option value="write_off_damage">Write-Off as Damage Loss</option>
                              <option value="pending_approval">Dispute / Pending Approval</option>
                            </select>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">No variance</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-border-main bg-canvas px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="rounded-btn border border-border-main bg-surface px-4 py-2 text-xs font-semibold text-text-muted hover:text-text-main transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <div className="flex items-center gap-3">
            {hasVariances && (
              <span className="text-xs text-status-warning font-semibold flex items-center gap-1.5 bg-status-warning/10 px-3 py-1.5 rounded-btn border border-status-warning/30">
                <AlertTriangle className="h-4 w-4 text-status-warning shrink-0" />
                Variances detected will be auto-reconciled and posted to ledger
              </span>
            )}
            <button
              type="button"
              onClick={handleApplyReceipt}
              className="rounded-btn bg-accent hover:opacity-90 px-6 py-2 text-xs font-bold text-white shadow-xs transition-colors inline-flex items-center gap-2 cursor-pointer"
            >
              <Check className="h-4 w-4" />
              <span>Confirm & Post Stock Receipt</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

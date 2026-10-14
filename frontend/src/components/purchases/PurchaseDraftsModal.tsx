import React, { useEffect, useState } from "react";
import { X, FileClock, Trash2, ArrowRight, RefreshCw } from "lucide-react";
import { purchaseDraftService, type PurchaseDraftItem } from "../../lib/purchases/purchaseDraftService";
import { useModalEscape } from "../../lib/ui/modalEscapeManager";

interface PurchaseDraftsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDraft: (draft: PurchaseDraftItem) => void;
}

export const PurchaseDraftsModal: React.FC<PurchaseDraftsModalProps> = ({
  isOpen,
  onClose,
  onSelectDraft,
}) => {
  useModalEscape(isOpen, onClose);

  const [drafts, setDrafts] = useState<PurchaseDraftItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadDrafts();
    }
  }, [isOpen]);

  const loadDrafts = async () => {
    setIsLoading(true);
    const res = await purchaseDraftService.getAllDrafts();
    setDrafts(res);
    setIsLoading(false);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await purchaseDraftService.deleteDraft(id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50">
          <div className="flex items-center gap-2">
            <FileClock className="h-5 w-5 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-800">Saved Purchase Drafts</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-4 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-slate-400 text-xs">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              <span>Loading drafts...</span>
            </div>
          ) : drafts.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <FileClock className="mx-auto h-8 w-8 text-slate-300 mb-1" />
              <p className="text-xs font-semibold">No saved drafts found</p>
              <p className="text-[11px] text-slate-400">Save a draft anytime using F4 while creating a purchase bill</p>
            </div>
          ) : (
            drafts.map((d) => (
              <div
                key={d.id}
                onClick={() => {
                  onSelectDraft(d);
                  onClose();
                }}
                className="group flex items-center justify-between rounded-lg border border-slate-200 p-3 hover:border-blue-500 hover:bg-blue-50/50 cursor-pointer transition-all"
              >
                <div>
                  <div className="font-bold text-xs text-slate-800 group-hover:text-blue-600">
                    {d.title}
                  </div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-3 mt-1">
                    <span>{d.item_count} Items</span>
                    {d.total_estimate > 0 && <span>Est: ₹ {d.total_estimate.toFixed(2)}</span>}
                    <span>{new Date(d.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => handleDelete(d.id, e)}
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50"
                    title="Delete Draft"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <span className="flex items-center gap-1 text-xs font-semibold text-blue-600 bg-blue-100 px-2.5 py-1 rounded">
                    Load <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

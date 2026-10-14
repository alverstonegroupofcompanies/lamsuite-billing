import React from "react";
import { X, Check, RotateCcw, Columns } from "lucide-react";
import type { ReportColumn } from "../types";
import { useModalEscape } from "../../lib/ui/modalEscapeManager";

interface ReportColumnManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ReportColumn[];
  visibleColumnIds: string[];
  onChangeVisibleColumns: (ids: string[]) => void;
  onResetDefaults: () => void;
}

export const ReportColumnManagerModal: React.FC<ReportColumnManagerModalProps> = ({
  isOpen,
  onClose,
  columns,
  visibleColumnIds,
  onChangeVisibleColumns,
  onResetDefaults,
}) => {
  useModalEscape(isOpen, onClose);

  if (!isOpen) return null;

  const toggleColumn = (id: string, canHide: boolean = true) => {
    if (!canHide) return; // mandatory column
    if (visibleColumnIds.includes(id)) {
      onChangeVisibleColumns(visibleColumnIds.filter((c) => c !== id));
    } else {
      onChangeVisibleColumns([...visibleColumnIds, id]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-2xs p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-gray-200 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
          <div className="flex items-center gap-2">
            <Columns className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-gray-900 text-sm">Customize Report Columns</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Column List */}
        <div className="p-4 overflow-y-auto space-y-2 flex-1">
          <p className="text-xs text-gray-500 mb-3">
            Select the columns you want to display on screen, print, and export:
          </p>
          <div className="space-y-1.5">
            {columns.map((col) => {
              const isChecked = visibleColumnIds.includes(col.id);
              const isMandatory = col.canHide === false;

              return (
                <label
                  key={col.id}
                  className={`flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                    isChecked
                      ? "bg-blue-50/50 border-blue-200 text-gray-900"
                      : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isMandatory}
                      onChange={() => toggleColumn(col.id, !isMandatory)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-gray-300 cursor-pointer disabled:opacity-50"
                    />
                    <span className="font-medium">{col.header}</span>
                  </div>
                  {isMandatory && (
                    <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                      Required
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onResetDefaults}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 font-medium px-2 py-1 rounded hover:bg-gray-200 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Copy, Filter, Edit3, X } from "lucide-react";
import type { ImportPreviewRow, RowAction, EntityDefinition } from "../registry/types";

interface EditablePreviewGridProps {
  rows: ImportPreviewRow[];
  entityDef: EntityDefinition;
  onUpdateRowData: (rowNumber: number, field: string, newValue: any) => void;
  onUpdateRowAction: (rowNumber: number, action: RowAction) => void;
}

export const EditablePreviewGrid: React.FC<EditablePreviewGridProps> = ({
  rows,
  entityDef,
  onUpdateRowData,
  onUpdateRowAction,
}) => {
  const [filterMode, setFilterMode] = useState<"all" | "errors" | "duplicates">("all");
  const [editingCell, setEditingCell] = useState<{ rowNum: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const fields = Object.values(entityDef.fields);

  const filteredRows = rows.filter((r) => {
    if (filterMode === "errors") {
      return r.errors.some((e) => e.severity === "error");
    }
    if (filterMode === "duplicates") {
      return Boolean(r.duplicateMatch);
    }
    return true;
  });

  const handleStartEdit = (rowNum: number, field: string, currentVal: any) => {
    setEditingCell({ rowNum, field });
    setEditValue(currentVal !== undefined && currentVal !== null ? String(currentVal) : "");
  };

  const handleCommitEdit = () => {
    if (editingCell) {
      onUpdateRowData(editingCell.rowNum, editingCell.field, editValue);
      setEditingCell(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleCommitEdit();
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Filter and summary bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100 rounded-lg text-xs border border-slate-200">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-semibold text-slate-600">Filter Preview:</span>
          <button
            onClick={() => setFilterMode("all")}
            className={`px-2 py-0.5 rounded font-medium transition-colors ${
              filterMode === "all" ? "bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-slate-200"
            }`}
          >
            All ({rows.length})
          </button>
          <button
            onClick={() => setFilterMode("errors")}
            className={`px-2 py-0.5 rounded font-medium transition-colors ${
              filterMode === "errors" ? "bg-rose-600 text-white" : "bg-white text-rose-700 hover:bg-rose-50"
            }`}
          >
            Errors ({rows.filter((r) => r.errors.some((e) => e.severity === "error")).length})
          </button>
          <button
            onClick={() => setFilterMode("duplicates")}
            className={`px-2 py-0.5 rounded font-medium transition-colors ${
              filterMode === "duplicates" ? "bg-amber-600 text-white" : "bg-white text-amber-700 hover:bg-amber-50"
            }`}
          >
            Duplicates ({rows.filter((r) => Boolean(r.duplicateMatch)).length})
          </button>
        </div>
        <div className="text-slate-500 text-[11px] italic">
          💡 Click any cell to edit inline and re-validate
        </div>
      </div>

      {/* Grid Container */}
      <div className="flex-1 overflow-auto border border-slate-200 rounded-lg bg-white shadow-inner max-h-[360px]">
        <table className="w-full border-collapse text-xs text-left">
          <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200">
            <tr>
              <th className="px-2.5 py-2 w-12 text-center font-bold text-slate-600 border-r border-slate-200">
                #
              </th>
              <th className="px-2.5 py-2 w-28 font-bold text-slate-600 border-r border-slate-200">
                Status / Action
              </th>
              {fields.map((f) => (
                <th key={f.key} className="px-3 py-2 font-semibold text-slate-700 border-r border-slate-200 whitespace-nowrap">
                  {f.label} {f.required && <span className="text-rose-500">*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-sans">
            {filteredRows.map((row) => {
              const hasErrors = row.errors.some((e) => e.severity === "error");
              const hasWarnings = row.errors.some((e) => e.severity === "warning");
              const isDuplicate = Boolean(row.duplicateMatch);

              return (
                <tr
                  key={row.rowNumber}
                  className={`hover:bg-slate-50/80 transition-colors ${
                    hasErrors ? "bg-rose-50/40" : isDuplicate ? "bg-amber-50/30" : ""
                  }`}
                >
                  {/* Row Number */}
                  <td className="px-2.5 py-1.5 text-center font-mono text-[11px] text-slate-500 border-r border-slate-200">
                    {row.rowNumber}
                  </td>

                  {/* Status & Action Selector */}
                  <td className="px-2 py-1.5 border-r border-slate-200 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {hasErrors ? (
                        <div title={row.errors.map((e) => e.message).join("\n")}>
                          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                        </div>
                      ) : hasWarnings ? (
                        <div title={row.errors.map((e) => e.message).join("\n")}>
                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                        </div>
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      )}

                      <select
                        value={row.action}
                        onChange={(e) => onUpdateRowAction(row.rowNumber, e.target.value as RowAction)}
                        className={`text-[11px] font-semibold rounded px-1.5 py-0.5 border focus:outline-none ${
                          row.action === "create"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                            : row.action === "update"
                            ? "bg-blue-50 text-blue-700 border-blue-300"
                            : row.action === "merge"
                            ? "bg-purple-50 text-purple-700 border-purple-300"
                            : row.action === "skip"
                            ? "bg-slate-100 text-slate-600 border-slate-300"
                            : "bg-rose-50 text-rose-700 border-rose-300"
                        }`}
                      >
                        <option value="create">Create</option>
                        <option value="update">Update</option>
                        <option value="merge">Merge</option>
                        <option value="skip">Skip</option>
                      </select>
                    </div>
                    {isDuplicate && (
                      <div className="text-[10px] text-amber-700 font-medium truncate max-w-[110px]" title={row.duplicateMatch?.existingSummary}>
                        Dup: {row.duplicateMatch?.existingSummary}
                      </div>
                    )}
                  </td>

                  {/* Data Cells */}
                  {fields.map((f) => {
                    const cellVal = row.data[f.key];
                    const isEditing = editingCell?.rowNum === row.rowNumber && editingCell?.field === f.key;
                    const fieldError = row.errors.find((e) => e.field === f.key);

                    return (
                      <td
                        key={f.key}
                        onClick={() => handleStartEdit(row.rowNumber, f.key, cellVal)}
                        className={`px-3 py-1.5 border-r border-slate-200 cursor-pointer relative group ${
                          fieldError?.severity === "error"
                            ? "bg-rose-100/70 text-rose-900 font-semibold"
                            : fieldError?.severity === "warning"
                            ? "bg-amber-100/60 text-amber-900"
                            : "text-slate-800"
                        }`}
                        title={fieldError ? fieldError.message : "Click to edit"}
                      >
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={handleCommitEdit}
                              onKeyDown={handleKeyDown}
                              className="w-full text-xs bg-white border border-blue-500 rounded px-1.5 py-0.5 focus:outline-none shadow-xs"
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingCell(null);
                              }}
                              className="text-slate-400 hover:text-slate-600"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate max-w-[180px]">
                              {cellVal !== undefined && cellVal !== null && cellVal !== ""
                                ? String(cellVal)
                                : <span className="text-slate-300 italic">empty</span>}
                            </span>
                            <Edit3 className="h-2.5 w-2.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

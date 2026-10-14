import React from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import type { ReportColumn, ReportSortState } from "../types";

interface ReportTableGridProps<TRow = any> {
  columns: ReportColumn<TRow>[];
  rows: TRow[];
  visibleColumnIds: string[];
  sort?: ReportSortState;
  onSortChange?: (columnId: string) => void;
  summary?: Record<string, any>;
  isLoading?: boolean;
  emptyMessage?: string;

  // Pagination
  page?: number;
  pageSize?: number;
  totalCount?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}

export const ReportTableGrid: React.FC<ReportTableGridProps> = ({
  columns,
  rows,
  visibleColumnIds,
  sort,
  onSortChange,
  summary,
  isLoading = false,
  emptyMessage = "No records found matching the active criteria.",
  page = 1,
  pageSize = 25,
  totalCount = 0,
  onPageChange,
  onPageSizeChange,
}) => {
  const activeColumns = columns.filter((c) => visibleColumnIds.includes(c.id));

  const formatCellValue = (col: ReportColumn, val: any, row: any) => {
    if (col.renderCell) {
      return col.renderCell(row, val);
    }

    if (val === null || val === undefined || val === "") {
      return <span className="text-gray-300">-</span>;
    }

    if (col.format === "currency") {
      const n = Number(val) || 0;
      return (
        <span className="font-mono tabular-nums text-gray-900 font-medium">
          ₹{n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      );
    }

    if (col.format === "percentage") {
      const n = Number(val) || 0;
      return <span className="font-mono tabular-nums text-gray-700">{n.toFixed(1)}%</span>;
    }

    if (col.format === "number") {
      const n = Number(val) || 0;
      return <span className="font-mono tabular-nums text-gray-800">{n.toLocaleString("en-IN")}</span>;
    }

    if (col.format === "badge") {
      const style = col.badgeStyle ? col.badgeStyle(val, row) : "neutral";
      const styleClasses = {
        success: "bg-emerald-50 text-emerald-700 border-emerald-200",
        warning: "bg-amber-50 text-amber-700 border-amber-200",
        danger: "bg-rose-50 text-rose-700 border-rose-200",
        info: "bg-blue-50 text-blue-700 border-blue-200",
        neutral: "bg-gray-100 text-gray-700 border-gray-200",
      }[style];

      return (
        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${styleClasses}`}>
          {String(val)}
        </span>
      );
    }

    return String(val);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-white">
      {/* Table Area */}
      <div className="flex-1 overflow-auto border-b border-gray-200">
        <table className="w-full text-left border-collapse min-w-[700px]">
          <thead className="bg-gray-50/90 sticky top-0 z-10 backdrop-blur-2xs border-b border-gray-200">
            <tr>
              {activeColumns.map((col) => {
                const isSorted = sort?.column === col.id;
                const isAsc = isSorted && sort?.direction === "asc";

                return (
                  <th
                    key={col.id}
                    onClick={() => col.canSort && onSortChange && onSortChange(col.id)}
                    style={{ width: col.width }}
                    className={`px-3 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wider select-none ${
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                        ? "text-center"
                        : "text-left"
                    } ${col.canSort ? "cursor-pointer hover:bg-gray-100/80 transition-colors" : ""}`}
                  >
                    <div
                      className={`flex items-center gap-1.5 ${
                        col.align === "right"
                          ? "justify-end"
                          : col.align === "center"
                          ? "justify-center"
                          : "justify-start"
                      }`}
                    >
                      <span>{col.header}</span>
                      {col.canSort && (
                        <span className="text-gray-400">
                          {isSorted ? (
                            isAsc ? (
                              <ArrowUp className="w-3.5 h-3.5 text-blue-600" />
                            ) : (
                              <ArrowDown className="w-3.5 h-3.5 text-blue-600" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-gray-300" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100 text-xs">
            {isLoading ? (
              <tr>
                <td colSpan={activeColumns.length} className="py-12 text-center text-gray-500">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
                  <p className="mt-2 text-xs font-medium text-gray-600">Executing database report query...</p>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={activeColumns.length} className="py-16 text-center text-gray-400">
                  <Inbox className="w-10 h-10 mx-auto text-gray-300 mb-2" />
                  <p className="text-sm font-medium text-gray-600">{emptyMessage}</p>
                  <p className="text-xs text-gray-400 mt-1">Try adjusting your date range or filters above.</p>
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr
                  key={idx}
                  className="hover:bg-blue-50/40 transition-colors duration-75 group"
                >
                  {activeColumns.map((col) => {
                    const val = col.accessor(row);
                    return (
                      <td
                        key={col.id}
                        className={`px-3 py-2 text-gray-700 ${
                          col.align === "right"
                            ? "text-right"
                            : col.align === "center"
                            ? "text-center"
                            : "text-left"
                        }`}
                      >
                        {formatCellValue(col, val, row)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>

          {/* Sticky Totals Footer */}
          {summary && rows.length > 0 && (
            <tfoot className="bg-gray-100/90 sticky bottom-0 z-10 border-t-2 border-gray-300 font-semibold text-xs text-gray-900 shadow-xs">
              <tr>
                {activeColumns.map((col, idx) => {
                  const summaryVal = summary[col.id];
                  if (summaryVal !== undefined) {
                    return (
                      <td
                        key={col.id}
                        className={`px-3 py-2.5 ${
                          col.align === "right"
                            ? "text-right font-mono"
                            : col.align === "center"
                            ? "text-center"
                            : "text-left"
                        }`}
                      >
                        {col.format === "currency"
                          ? `₹${Number(summaryVal).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                          : summaryVal}
                      </td>
                    );
                  }

                  if (idx === 0) {
                    return (
                      <td key={col.id} className="px-3 py-2.5 text-gray-900 font-bold uppercase tracking-wider">
                        TOTALS
                      </td>
                    );
                  }

                  return <td key={col.id} className="px-3 py-2.5" />;
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination Bar */}
      {totalCount > 0 && onPageChange && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600 select-none">
          <div className="flex items-center gap-3">
            <span>
              Showing <strong className="text-gray-900">{Math.min((page - 1) * pageSize + 1, totalCount)}</strong> to{" "}
              <strong className="text-gray-900">{Math.min(page * pageSize, totalCount)}</strong> of{" "}
              <strong className="text-gray-900">{totalCount.toLocaleString("en-IN")}</strong> records
            </span>
            {onPageSizeChange && (
              <div className="flex items-center gap-1.5 ml-4">
                <span className="text-gray-500">Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  className="bg-white border border-gray-300 rounded px-1.5 py-0.5 text-xs text-gray-800 font-medium"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={250}>250</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || isLoading}
              className="p-1 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-gray-600" />
            </button>
            <span className="text-xs font-medium text-gray-700">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages || isLoading}
              className="p-1 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

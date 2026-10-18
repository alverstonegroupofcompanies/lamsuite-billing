import React from "react";
import { Calendar, Filter, RefreshCw } from "lucide-react";
import type { ReportFilterDef } from "../types";

interface ReportFilterBarProps {
  filterDefs: ReportFilterDef[];
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
  onRefresh: () => void;
  isLoading?: boolean;
}

export const ReportFilterBar: React.FC<ReportFilterBarProps> = ({
  filterDefs,
  values,
  onChange,
  onRefresh,
  isLoading = false,
}) => {
  const handleDatePreset = (preset: "today" | "yesterday" | "this_week" | "this_month" | "last_month") => {
    const now = new Date();
    const format = (d: Date) => d.toISOString().slice(0, 10);
    const todayStr = format(now);

    let start = todayStr;
    let end = todayStr;

    if (preset === "yesterday") {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      start = format(y);
      end = format(y);
    } else if (preset === "this_week") {
      const d = new Date(now);
      const day = d.getDay();
      const diff = day === 0 ? 6 : day - 1; // monday as start
      d.setDate(d.getDate() - diff);
      start = format(d);
      end = todayStr;
    } else if (preset === "this_month") {
      start = `${todayStr.slice(0, 7)}-01`;
      end = todayStr;
    } else if (preset === "last_month") {
      const prevMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      end = format(prevMonthLastDay);
      start = `${end.slice(0, 7)}-01`;
    }

    onChange("date_range", { startDate: start, endDate: end });
    onChange("startDate", start);
    onChange("endDate", end);
  };

  return (
    <div className="bg-surface border-b border-border-main px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
      <div className="flex flex-wrap items-center gap-3">
        {filterDefs.map((def) => {
          if (def.type === "date-range") {
            const range = values[def.id] || values.date_range || {
              startDate: values.startDate || new Date().toISOString().slice(0, 10),
              endDate: values.endDate || new Date().toISOString().slice(0, 10),
            };

            return (
              <div key={def.id} className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-text-muted" />
                  {def.label}:
                </span>
                <div className="flex items-center gap-1.5 bg-canvas border border-border-main rounded-btn p-1 shadow-2xs">
                  <input
                    type="date"
                    value={range.startDate || ""}
                    onChange={(e) => {
                      const newRange = { ...range, startDate: e.target.value };
                      onChange(def.id, newRange);
                      onChange("startDate", e.target.value);
                    }}
                    className="text-xs bg-transparent border-0 text-text-main font-mono font-medium focus:ring-0 px-1 py-0.5 tabular-nums"
                  />
                  <span className="text-xs text-text-muted">to</span>
                  <input
                    type="date"
                    value={range.endDate || ""}
                    onChange={(e) => {
                      const newRange = { ...range, endDate: e.target.value };
                      onChange(def.id, newRange);
                      onChange("endDate", e.target.value);
                    }}
                    className="text-xs bg-transparent border-0 text-text-main font-mono font-medium focus:ring-0 px-1 py-0.5 tabular-nums"
                  />
                </div>

                {/* Quick Presets */}
                <div className="hidden sm:flex items-center gap-1 bg-canvas border border-border-main rounded-btn p-0.5">
                  <button
                    type="button"
                    onClick={() => handleDatePreset("today")}
                    className="text-[11px] px-2 py-0.5 font-medium rounded-btn text-text-muted hover:text-text-main hover:bg-surface transition-colors"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDatePreset("yesterday")}
                    className="text-[11px] px-2 py-0.5 font-medium rounded-btn text-text-muted hover:text-text-main hover:bg-surface transition-colors"
                  >
                    Yesterday
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDatePreset("this_week")}
                    className="text-[11px] px-2 py-0.5 font-medium rounded-btn text-text-muted hover:text-text-main hover:bg-surface transition-colors"
                  >
                    Week
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDatePreset("this_month")}
                    className="text-[11px] px-2 py-0.5 font-medium rounded-btn text-text-muted hover:text-text-main hover:bg-surface transition-colors"
                  >
                    This Month
                  </button>
                </div>
              </div>
            );
          }

          if (def.type === "date") {
            const dateVal = values[def.id] || def.defaultValue || "";
            return (
              <div key={def.id} className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                  {def.label}:
                </span>
                <input
                  type="date"
                  value={dateVal}
                  onChange={(e) => onChange(def.id, e.target.value)}
                  className="text-xs border border-border-main rounded-btn px-2 py-1 bg-surface text-text-main shadow-xs font-mono font-medium tabular-nums"
                />
              </div>
            );
          }

          if (def.type === "select" && def.options) {
            const currentVal = values[def.id] ?? def.defaultValue;
            return (
              <div key={def.id} className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                  {def.label}:
                </span>
                <select
                  value={currentVal}
                  onChange={(e) => onChange(def.id, e.target.value)}
                  className="text-xs border border-border-main rounded-btn px-2.5 py-1 bg-surface text-text-main shadow-xs font-medium cursor-pointer focus:border-accent focus:outline-none"
                >
                  {def.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          return null;
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-accent-soft text-accent hover:bg-accent-soft/80 border border-accent/20 text-xs font-semibold rounded-btn shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Run / Refresh
        </button>
      </div>
    </div>
  );
};

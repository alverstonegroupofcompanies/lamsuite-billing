import React, { useState, useEffect } from "react";
import {
  X,
  Sliders,
  Check,
  RotateCcw,
  Sparkles,
  Columns,
  Layers,
  Save,
  Trash2,
  Lock,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  companySettingsService,
  type ColumnSetting,
  type HeaderFieldSetting,
  type BillingScreenPreset,
  DEFAULT_COLUMNS,
  DEFAULT_HEADER_FIELDS,
} from "../lib/settings/companySettingsService";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

interface BillingColumnsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLayoutChange?: (columns: ColumnSetting[], headerFields: HeaderFieldSetting[]) => void;
}

export const BillingColumnsModal: React.FC<BillingColumnsModalProps> = ({
  isOpen,
  onClose,
  onLayoutChange,
}) => {
  useModalEscape(isOpen, onClose);

  const [activeTab, setActiveTab] = useState<"columns" | "header" | "presets">("columns");
  const [columns, setColumns] = useState<ColumnSetting[]>([]);
  const [headerFields, setHeaderFields] = useState<HeaderFieldSetting[]>([]);
  const [presets, setPresets] = useState<BillingScreenPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>("pharmacy");
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetDesc, setNewPresetDesc] = useState("");
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [saveAsStoreDefault, setSaveAsStoreDefault] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadCurrentLayout();
    }
  }, [isOpen]);

  const loadCurrentLayout = () => {
    const cols = companySettingsService.getBillingColumns();
    const headers = companySettingsService.getHeaderFields();
    const allPresets = companySettingsService.getBillingPresets();
    const settings = companySettingsService.getSettings();

    setColumns([...cols]);
    setHeaderFields([...headers]);
    setPresets(allPresets);
    setActivePresetId(settings.active_billing_preset || "pharmacy");
  };

  const showFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  if (!isOpen) return null;

  const handleToggleColumn = (id: string) => {
    const updated = columns.map((col) => {
      if (col.id === id) {
        if (col.required) return col; // Cannot toggle required columns
        return { ...col, visible: !col.visible };
      }
      return col;
    });
    setColumns(updated);
  };

  const handleToggleHeader = (id: string) => {
    const updated = headerFields.map((f) => {
      if (f.id === id) {
        if (f.required) return f;
        return { ...f, visible: !f.visible };
      }
      return f;
    });
    setHeaderFields(updated);
  };

  const handleMoveColumn = (index: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= columns.length) return;

    const newCols = [...columns];
    const [moved] = newCols.splice(index, 1);
    newCols.splice(targetIdx, 0, moved);
    newCols.forEach((c, i) => (c.order = i + 1));
    setColumns(newCols);
  };

  const handleApplyPreset = async (presetId: string) => {
    const res = await companySettingsService.applyBillingPreset(presetId, saveAsStoreDefault);
    setColumns([...res.columns]);
    setHeaderFields([...res.headerFields]);
    setActivePresetId(presetId);
    showFeedback(`Switched to ${presetId.toUpperCase()} preset!`);
    if (onLayoutChange) {
      onLayoutChange(res.columns, res.headerFields);
    }
  };

  const handleSaveAndApply = async () => {
    await companySettingsService.setBillingColumns(columns, saveAsStoreDefault);
    await companySettingsService.setHeaderFields(headerFields, saveAsStoreDefault);
    showFeedback("Layout applied successfully!");
    if (onLayoutChange) {
      onLayoutChange(columns, headerFields);
    }
    setTimeout(() => {
      onClose();
    }, 400);
  };

  const handleSaveCustomPreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;

    const created = await companySettingsService.saveCustomBillingPreset(
      newPresetName.trim(),
      newPresetDesc.trim() || "Custom counter preset",
      columns,
      headerFields
    );

    setPresets(companySettingsService.getBillingPresets());
    setActivePresetId(created.id);
    setIsSavingPreset(false);
    setNewPresetName("");
    setNewPresetDesc("");
    showFeedback(`Preset "${created.name}" saved!`);
  };

  const handleDeletePreset = async (presetId: string) => {
    await companySettingsService.deleteCustomBillingPreset(presetId);
    setPresets(companySettingsService.getBillingPresets());
    showFeedback("Preset deleted.");
  };

  const handleResetToDefault = async () => {
    const res = await companySettingsService.resetBillingLayoutToDefault();
    setColumns([...res.columns]);
    setHeaderFields([...res.headerFields]);
    setActivePresetId("pharmacy");
    showFeedback("Reset to default pharmacy layout.");
    if (onLayoutChange) {
      onLayoutChange(res.columns, res.headerFields);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 font-sans select-none animate-in fade-in duration-100"
    >
      <div className="w-full max-w-2xl rounded-card bg-surface shadow-modal border border-border-main overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-main px-5 py-3.5 bg-canvas">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-btn bg-accent-soft text-accent">
              <Sliders className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-main">Customize Billing Screen & Fields</h3>
              <p className="text-[11px] text-text-muted">
                Show/hide table columns, header metadata, or switch presets (Ctrl+Shift+C)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-main rounded-btn p-1 transition-colors hover:bg-surface cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-border-main bg-canvas px-5 pt-2 gap-2 text-xs font-semibold">
          <button
            onClick={() => setActiveTab("columns")}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === "columns"
                ? "border-accent text-accent font-bold bg-surface rounded-t-btn"
                : "border-transparent text-text-muted hover:text-text-main"
            }`}
          >
            <Columns className="h-3.5 w-3.5" />
            <span>Grid Columns ({columns.filter((c) => c.visible).length}/{columns.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("header")}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === "header"
                ? "border-accent text-accent font-bold bg-surface rounded-t-btn"
                : "border-transparent text-text-muted hover:text-text-main"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Header Fields ({headerFields.filter((h) => h.visible).length}/{headerFields.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("presets")}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === "presets"
                ? "border-accent text-accent font-bold bg-surface rounded-t-btn"
                : "border-transparent text-text-muted hover:text-text-main"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span>Presets & Modes</span>
          </button>
        </div>

        {/* Feedback message */}
        {feedbackMsg && (
          <div className="bg-emerald-50 text-emerald-800 border-b border-emerald-200 px-5 py-1.5 text-xs font-semibold flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-emerald-600" />
            <span>{feedbackMsg}</span>
          </div>
        )}

        {/* Tab 1: Grid Columns */}
        {activeTab === "columns" && (
          <div className="flex-1 overflow-y-auto p-5 divide-y divide-slate-100 space-y-1">
            <div className="text-[11px] text-slate-500 mb-2">
              Toggle columns to show or hide them from the POS billing grid. Mandatory columns like Product and Total cannot be hidden.
            </div>
            {columns.map((col, idx) => (
              <div
                key={col.id}
                className="flex items-center justify-between py-2.5 hover:bg-slate-50 px-2 rounded-lg transition-colors text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-slate-400 text-[11px] w-5 text-right">{idx + 1}.</span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-800">{col.label}</span>
                      {col.required && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-medium text-slate-600">
                          <Lock className="h-2.5 w-2.5 text-slate-400" />
                          Required
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">ID: {col.id}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMoveColumn(idx, "up")}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded hover:bg-slate-100"
                      title="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === columns.length - 1}
                      onClick={() => handleMoveColumn(idx, "down")}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded hover:bg-slate-100"
                      title="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={col.visible}
                      disabled={col.required}
                      onChange={() => handleToggleColumn(col.id)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-60"></div>
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab 2: Header Fields */}
        {activeTab === "header" && (
          <div className="flex-1 overflow-y-auto p-5 divide-y divide-slate-100 space-y-1">
            <div className="text-[11px] text-slate-500 mb-2">
              Configure patient metadata, customer details, and doctor headers visible above the billing table.
            </div>
            {headerFields.map((field, idx) => (
              <div
                key={field.id}
                className="flex items-center justify-between py-2.5 hover:bg-slate-50 px-2 rounded-lg transition-colors text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-slate-400 text-[11px] w-5 text-right">{idx + 1}.</span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-800">{field.label}</span>
                      {field.required && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-medium text-slate-600">
                          <Lock className="h-2.5 w-2.5 text-slate-400" />
                          Required
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">ID: {field.id}</span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={field.visible}
                    disabled={field.required}
                    onChange={() => handleToggleHeader(field.id)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-60"></div>
                </label>
              </div>
            ))}
          </div>
        )}

        {/* Tab 3: Presets & Modes */}
        {activeTab === "presets" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {presets.map((preset) => {
                const isActive = preset.id === activePresetId;
                return (
                  <div
                    key={preset.id}
                    className={`rounded-xl border p-3.5 flex flex-col justify-between transition-all ${
                      isActive
                        ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20 shadow-xs"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-slate-900">{preset.name}</span>
                        {preset.isBuiltin && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[9px] font-semibold text-slate-600">
                            Built-in
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 leading-snug">{preset.description}</p>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => handleApplyPreset(preset.id)}
                        className={`text-xs font-bold px-2.5 py-1 rounded transition-colors ${
                          isActive
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        {isActive ? "Active Preset" : "Apply Preset"}
                      </button>

                      {!preset.isBuiltin && (
                        <button
                          type="button"
                          onClick={() => handleDeletePreset(preset.id)}
                          className="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50"
                          title="Delete custom preset"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Custom Preset Creator */}
            <div className="border-t border-slate-200 pt-4">
              {!isSavingPreset ? (
                <button
                  type="button"
                  onClick={() => setIsSavingPreset(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Save Current Configuration as New Preset...</span>
                </button>
              ) : (
                <form onSubmit={handleSaveCustomPreset} className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-3">
                  <h4 className="font-bold text-slate-800 text-xs">Save Current Layout as Preset</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">Preset Name *</label>
                      <input
                        type="text"
                        required
                        value={newPresetName}
                        onChange={(e) => setNewPresetName(e.target.value)}
                        placeholder="e.g., Night Shift Minimal"
                        className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">Description</label>
                      <input
                        type="text"
                        value={newPresetDesc}
                        onChange={(e) => setNewPresetDesc(e.target.value)}
                        placeholder="Short description of this layout"
                        className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setIsSavingPreset(false)}
                      className="px-2.5 py-1 text-slate-600 hover:bg-slate-200 rounded text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded text-xs shadow-xs"
                    >
                      Save Preset
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="border-t border-border-main px-5 py-3 bg-canvas flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleResetToDefault}
              className="flex items-center gap-1.5 text-text-muted hover:text-text-main font-medium cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5 text-text-muted" />
              <span>Reset to Defaults</span>
            </button>

            <label className="flex items-center gap-1.5 text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={saveAsStoreDefault}
                onChange={(e) => setSaveAsStoreDefault(e.target.checked)}
                className="rounded border-border-main text-accent focus:ring-accent"
              />
              <span className="text-[11px]">Save as Store-wide default (Admin)</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-btn px-3.5 py-1.5 border border-border-main text-text-muted hover:text-text-main hover:bg-surface text-xs font-semibold cursor-pointer"
            >
              Cancel (Esc)
            </button>
            <button
              type="button"
              onClick={handleSaveAndApply}
              className="rounded-btn bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:opacity-90 transition-colors cursor-pointer"
            >
              Apply Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

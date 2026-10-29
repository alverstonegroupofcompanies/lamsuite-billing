import React, { useState, useEffect } from "react";
import { Building2, Check, AlertTriangle, X, Clock, Monitor, Plus } from "lucide-react";
import {
  storeRegistryService,
  type RegisteredStoreRecord,
  STORE_PRESET_COLORS,
} from "../lib/auth/storeRegistryService";
import { posCartService } from "../lib/billing/posCartService";

interface StoreSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStoreSwitched: (store: RegisteredStoreRecord) => void;
  onAddNewStore?: () => void;
  onOpenGateway?: () => void;
}

export const StoreSwitcherModal: React.FC<StoreSwitcherModalProps> = ({
  isOpen,
  onClose,
  onStoreSwitched,
  onAddNewStore,
  onOpenGateway,
}) => {
  const [stores, setStores] = useState<RegisteredStoreRecord[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<RegisteredStoreRecord | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const reg = storeRegistryService.getRegistry();
      setStores(reg.stores);
      setActiveStoreId(reg.active_store_id);
      setWarningMsg(null);
      setPendingTarget(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectStore = async (target: RegisteredStoreRecord) => {
    if (target.id === activeStoreId) {
      onClose();
      return;
    }

    // Check unsaved cart items
    if (posCartService.hasUnsavedItems()) {
      setPendingTarget(target);
      setWarningMsg(
        "You currently have unsaved items in your billing cart. Switching stores will discard or clear this cart unless you hold the bill first."
      );
      return;
    }

    await performSwitch(target);
  };

  const performSwitch = async (target: RegisteredStoreRecord, force = false) => {
    setIsSwitching(true);
    try {
      const switched = await storeRegistryService.switchActiveStore(target.id, force);
      onStoreSwitched(switched);
      onClose();
    } catch (err: any) {
      setWarningMsg(err?.message || "Failed to switch store");
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-surface border border-border-main rounded-card p-5 max-w-lg w-full shadow-lg">
        {/* Header */}
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-accent/10 flex items-center justify-center text-accent">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-main">Switch Company / Store</h3>
              <p className="text-[11px] text-text-muted">Instant Tally-Style Company Switch (Alt + S)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-text-muted hover:text-text-main hover:bg-canvas"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Warning if cart has items */}
        {warningMsg && pendingTarget && (
          <div className="mb-4 bg-status-warning/10 border border-status-warning/30 rounded-btn p-3 text-xs text-text-main">
            <div className="flex items-start gap-2 text-status-warning font-semibold mb-1">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Unsaved Bill Warning</span>
            </div>
            <p className="text-[11px] text-text-muted mb-3">{warningMsg}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setWarningMsg(null);
                  setPendingTarget(null);
                }}
                className="px-2.5 py-1 rounded-btn border border-border-main bg-surface text-xs"
              >
                Back to POS (Hold Bill)
              </button>
              <button
                type="button"
                onClick={() => performSwitch(pendingTarget, true)}
                className="px-3 py-1 rounded-btn bg-status-warning text-slate-900 font-semibold text-xs"
              >
                Discard Cart & Switch
              </button>
            </div>
          </div>
        )}

        {/* Stores list */}
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {stores.map((s) => {
            const isActive = s.id === activeStoreId;
            const colorPreset =
              STORE_PRESET_COLORS.find((c) => c.badge === s.color_badge || c.hex === s.color) ||
              STORE_PRESET_COLORS[0];

            return (
              <button
                key={s.id}
                type="button"
                disabled={isSwitching}
                onClick={() => handleSelectStore(s)}
                className={`w-full text-left p-3 rounded-card border transition-all flex items-center justify-between ${
                  isActive
                    ? "bg-accent-soft border-accent/40 shadow-xs ring-1 ring-accent/30"
                    : "bg-surface border-border-main hover:bg-canvas text-text-main"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0"
                    style={{ backgroundColor: s.color || colorPreset.hex }}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-text-main">
                        {s.alias || s.name}
                      </span>
                      <span className="text-[10px] font-mono uppercase font-bold text-text-muted bg-canvas px-1.5 py-0.5 rounded border border-border-main">
                        {s.code}
                      </span>
                      <span className="text-[10px] font-mono text-text-muted">
                        (Store ID: {s.id})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-text-muted mt-0.5">
                      <Monitor className="w-3 h-3 text-text-muted" />
                      <span>{s.counter_name}</span>
                      {s.is_hub && <span className="text-accent font-semibold">• Hub</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isActive ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-accent">
                      <Check className="w-3.5 h-3.5" />
                      Active Store
                    </span>
                  ) : (
                    <span className="text-[10px] text-text-muted font-mono">
                      {s.last_opened_at
                        ? new Date(s.last_opened_at).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                          })
                        : "Never"}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Action Buttons to Add Store or open Gateway */}
        <div className="mt-3 pt-3 border-t border-border-main flex items-center justify-between gap-2">
          {onOpenGateway && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenGateway();
              }}
              className="px-2.5 py-1.5 rounded-btn border border-border-main hover:bg-canvas text-xs font-semibold text-text-main flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Building2 className="w-3.5 h-3.5 text-text-muted" />
              Manage Stores / Gateway
            </button>
          )}

          {onAddNewStore && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onAddNewStore();
              }}
              className="px-3 py-1.5 rounded-btn bg-accent text-white hover:bg-accent-hover text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ml-auto shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              + Add Company / Store
            </button>
          )}
        </div>

        <div className="mt-2.5 pt-2 border-t border-border-main/60 flex justify-between items-center text-[11px] text-text-muted">
          <span>Keyboard shortcut: <kbd className="px-1.5 py-0.5 bg-canvas border rounded text-text-main font-semibold">Alt + S</kbd></span>
          <span>Switch executes in &lt;1 second</span>
        </div>
      </div>
    </div>
  );
};

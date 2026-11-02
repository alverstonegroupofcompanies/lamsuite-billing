import React, { useState, useEffect } from "react";
import {
  Building2,
  Plus,
  RefreshCw,
  LogOut,
  Palette,
  Edit2,
  Check,
  X,
  AlertTriangle,
  Monitor,
  CheckCircle2,
  Clock,
  ArrowRight,
  ShieldAlert,
  ChevronDown,
  Lock,
} from "lucide-react";
import {
  storeRegistryService,
  type RegisteredStoreRecord,
  STORE_PRESET_COLORS,
} from "../lib/auth/storeRegistryService";
import { backupService } from "../lib/backup/backupService";

interface StoreGatewayPageProps {
  onSelectStore: (store: RegisteredStoreRecord) => void;
  onAddNewStore: () => void;
}

export const StoreGatewayPage: React.FC<StoreGatewayPageProps> = ({
  onSelectStore,
  onAddNewStore,
}) => {
  const [stores, setStores] = useState<RegisteredStoreRecord[]>([]);
  const [autoOpenLast, setAutoOpenLast] = useState<boolean>(true);
  const [editingStore, setEditingStore] = useState<RegisteredStoreRecord | null>(null);
  const [aliasInput, setAliasInput] = useState("");
  const [colorInput, setColorInput] = useState("emerald");

  // Disconnect modal state
  const [disconnectingStore, setDisconnectingStore] = useState<RegisteredStoreRecord | null>(null);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [deleteLocalData, setDeleteLocalData] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isSwitching, setIsSwitching] = useState(false);

  const loadData = async () => {
    const reg = await storeRegistryService.loadRegistry();
    setStores(reg.stores);
    setAutoOpenLast(reg.auto_open_last);
  };

  useEffect(() => {
    loadData();
    const unsub = storeRegistryService.onRegistryChange((reg) => {
      setStores(reg.stores);
      setAutoOpenLast(reg.auto_open_last);
    });
    return unsub;
  }, []);

  const handleToggleAutoOpen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setAutoOpenLast(checked);
    await storeRegistryService.setAutoOpenLast(checked);
  };

  const handleOpenStore = async (store: RegisteredStoreRecord) => {
    if (store.sync_status === "revoked" || store.is_active === false) {
      setErrorMsg(`Store "${store.name}" access is revoked or disabled. Only historical inspection is permitted.`);
    }
    setIsSwitching(true);
    try {
      const active = await storeRegistryService.switchActiveStore(store.id, true);
      onSelectStore(active);
    } catch (err: any) {
      console.error("Switch store error:", err);
      const detail = typeof err === "string" ? err : err?.message || JSON.stringify(err);
      setErrorMsg(`Failed to switch store database: ${detail}`);
      setIsSwitching(false);
    }
  };

  const handleStartEdit = (store: RegisteredStoreRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingStore(store);
    setAliasInput(store.alias || store.name);
    setColorInput(store.color_badge || "emerald");
  };

  const handleSaveEdit = async () => {
    if (!editingStore) return;
    try {
      await storeRegistryService.updateStoreMeta(editingStore.id, {
        alias: aliasInput.trim() || editingStore.name,
        color_badge: colorInput,
      });
      setEditingStore(null);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to update store metadata.");
    }
  };

  const handleStartDisconnect = (store: RegisteredStoreRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    setDisconnectingStore(store);
    setConfirmPhrase("");
    setDeleteLocalData(false);
    setBackupSuccess(false);
    setErrorMsg("");
  };

  const handleDownloadBackup = async () => {
    if (!disconnectingStore) return;
    setIsBackingUp(true);
    try {
      const pkg = await backupService.createBackupSnapshot("2.0.0");
      const jsonStr = backupService.serializeBackup(pkg);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lamsuite_backup_${disconnectingStore.id}_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupSuccess(true);
    } catch (err) {
      setErrorMsg("Failed to generate backup before disconnect.");
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    if (!disconnectingStore) return;
    if (confirmPhrase.trim().toUpperCase() !== "DISCONNECT") {
      setErrorMsg("Please type DISCONNECT to confirm removing this store.");
      return;
    }

    try {
      await storeRegistryService.disconnectStore(disconnectingStore.id, deleteLocalData);
      setDisconnectingStore(null);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to disconnect store.");
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-between p-6 font-sans text-text-main select-none">
      {/* Top Header */}
      <header className="max-w-5xl mx-auto w-full flex justify-between items-center py-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-btn bg-accent flex items-center justify-center text-white shadow-xs">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-text-main leading-tight flex items-center gap-2">
              LamSuite Billing • Select Company / Store
            </h1>
            <p className="text-xs text-text-muted">
              Multi-Store Workspace ({stores.length} Registered Stores on this Workstation)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onAddNewStore}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-btn bg-accent text-white hover:bg-accent-hover text-xs font-semibold shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add Store / Branch</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-5xl mx-auto w-full my-auto py-4">
        {errorMsg && (
          <div className="mb-4 bg-status-danger/10 border border-status-danger/20 rounded-btn p-3 text-xs text-status-danger flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg("")}
              className="text-text-muted hover:text-text-main"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Store Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stores.map((s, index) => {
            const colorPreset =
              STORE_PRESET_COLORS.find((c) => c.badge === s.color_badge || c.hex === s.color) ||
              STORE_PRESET_COLORS[0];

            const isRevoked = s.sync_status === "revoked" || s.is_active === false;

            return (
              <div
                key={s.id}
                onClick={() => !isSwitching && handleOpenStore(s)}
                className={`relative bg-surface border rounded-card p-4 transition-all hover:shadow-md cursor-pointer group flex flex-col justify-between ${
                  colorPreset.border
                } hover:border-accent`}
              >
                {/* Store Top Badge */}
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: s.color || colorPreset.hex }}
                      />
                      <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-text-muted">
                        {s.code || `STORE-${index + 1}`}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => handleStartEdit(s, e)}
                        title="Edit Alias or Color"
                        className="p-1 rounded hover:bg-canvas text-text-muted hover:text-text-main"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleStartDisconnect(s, e)}
                        title="Disconnect Store"
                        className="p-1 rounded hover:bg-canvas text-status-danger hover:opacity-80"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Title & Alias */}
                  <h3 className="text-sm font-bold text-text-main leading-snug line-clamp-1">
                    {s.alias || s.name}
                  </h3>
                  {s.alias && s.alias !== s.name && (
                    <p className="text-[11px] text-text-muted line-clamp-1 mt-0.5">{s.name}</p>
                  )}

                  {/* Counter details */}
                  <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
                    <Monitor className="w-3.5 h-3.5 text-text-muted" />
                    <span>{s.counter_name}</span>
                    <span className="text-[10px] bg-canvas px-1.5 py-0.5 rounded border border-border-main font-mono">
                      {s.counter_code}
                    </span>
                    {s.is_hub && (
                      <span className="text-[10px] text-accent font-semibold">Store Hub</span>
                    )}
                  </div>
                </div>

                {/* Footer status bar */}
                <div className="mt-4 pt-3 border-t border-border-main flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5">
                    {isRevoked ? (
                      <span className="flex items-center gap-1 text-status-danger font-medium">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Disabled
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-status-success font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Ready
                      </span>
                    )}
                    {s.pending_sync_count > 0 && (
                      <span className="text-status-warning font-mono">
                        ({s.pending_sync_count} pending)
                      </span>
                    )}
                  </div>

                  <span className="text-text-muted flex items-center gap-1 font-mono text-[10px]">
                    <Clock className="w-3 h-3" />
                    {s.last_opened_at
                      ? new Date(s.last_opened_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Never"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Options */}
        <div className="mt-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-text-muted">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoOpenLast}
              onChange={handleToggleAutoOpen}
              className="rounded border-border-main text-accent focus:ring-accent w-4 h-4"
            />
            <span>Open last accessed store automatically on application launch</span>
          </label>

          <span className="text-[11px] font-mono text-text-muted">
            Tip: Press <kbd className="px-1.5 py-0.5 bg-canvas border rounded text-text-main font-semibold">Alt + S</kbd> anytime inside billing to switch stores instantly
          </span>
        </div>
      </main>

      {/* Edit Store Modal */}
      {editingStore && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface border border-border-main rounded-card p-5 max-w-md w-full shadow-lg">
            <h3 className="text-sm font-bold text-text-main mb-1">Rename or Customize Store</h3>
            <p className="text-xs text-text-muted mb-4">{editingStore.name}</p>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-text-main mb-1">Display Alias / Nickname</label>
                <input
                  type="text"
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  placeholder="e.g. Main Street Express"
                  className="w-full px-3 py-2 rounded-btn border border-border-main bg-canvas text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block font-medium text-text-main mb-2">Color Identification Tag</label>
                <div className="grid grid-cols-3 gap-2">
                  {STORE_PRESET_COLORS.map((c) => (
                    <button
                      key={c.badge}
                      type="button"
                      onClick={() => setColorInput(c.badge)}
                      className={`flex items-center gap-2 p-2 rounded-btn border text-left transition-all ${
                        colorInput === c.badge
                          ? "border-accent bg-accent-soft ring-1 ring-accent"
                          : "border-border-main bg-canvas hover:bg-surface"
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.hex }} />
                      <span className="text-[11px] font-medium truncate">{c.label.split(" ")[0]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingStore(null)}
                className="px-3 py-1.5 rounded-btn border border-border-main bg-surface hover:bg-canvas text-xs text-text-main"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-3.5 py-1.5 rounded-btn bg-accent text-white hover:bg-accent-hover text-xs font-semibold"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect Store Modal */}
      {disconnectingStore && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface border border-status-danger/40 rounded-card p-5 max-w-md w-full shadow-lg">
            <div className="flex items-center gap-2 text-status-danger mb-2 font-bold text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>Disconnect Store from Workstation</span>
            </div>
            <p className="text-xs text-text-main mb-2">
              Are you sure you want to disconnect <strong>{disconnectingStore.name}</strong> ({disconnectingStore.counter_name})?
            </p>
            <p className="text-[11px] text-text-muted mb-4">
              Disconnecting will remove the active station credentials for this store from this device.
            </p>

            {/* Offer Backup */}
            <div className="mb-4 bg-canvas border border-border-main rounded-btn p-3 text-xs flex justify-between items-center">
              <div>
                <span className="font-semibold block text-text-main">Export Safety Backup</span>
                <span className="text-[10px] text-text-muted">Recommended before disconnecting</span>
              </div>
              <button
                type="button"
                disabled={isBackingUp || backupSuccess}
                onClick={handleDownloadBackup}
                className="px-2.5 py-1.5 rounded-btn bg-surface border border-border-main text-xs font-semibold hover:bg-canvas text-text-main flex items-center gap-1.5"
              >
                {backupSuccess ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-status-success" />
                    <span>Downloaded</span>
                  </>
                ) : isBackingUp ? (
                  <span>Generating...</span>
                ) : (
                  <span>Export Backup</span>
                )}
              </button>
            </div>

            {/* Local Data Deletion checkbox */}
            <div className="mb-4">
              <label className="flex items-start gap-2 cursor-pointer text-xs text-text-main">
                <input
                  type="checkbox"
                  checked={deleteLocalData}
                  onChange={(e) => setDeleteLocalData(e.target.checked)}
                  className="rounded border-border-main text-status-danger focus:ring-status-danger w-4 h-4 mt-0.5"
                />
                <div>
                  <span className="font-semibold block text-status-danger">
                    Permanently delete local transactions and database for this store
                  </span>
                  <span className="text-[10px] text-text-muted">
                    If unchecked, local data stays preserved on disk for future reconnection.
                  </span>
                </div>
              </label>
            </div>

            {/* Confirmation Phrase */}
            <div className="mb-4">
              <label className="block text-[11px] font-medium text-text-muted mb-1">
                Type <strong>DISCONNECT</strong> to confirm:
              </label>
              <input
                type="text"
                value={confirmPhrase}
                onChange={(e) => setConfirmPhrase(e.target.value)}
                placeholder="DISCONNECT"
                className="w-full px-3 py-2 rounded-btn border border-border-main bg-canvas text-text-main uppercase font-mono text-xs focus:outline-none focus:ring-1 focus:ring-status-danger"
              />
            </div>

            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setDisconnectingStore(null)}
                className="px-3 py-1.5 rounded-btn border border-border-main bg-surface hover:bg-canvas text-text-main"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDisconnect}
                disabled={confirmPhrase.trim().toUpperCase() !== "DISCONNECT"}
                className="px-3.5 py-1.5 rounded-btn bg-status-danger text-white hover:opacity-90 font-semibold disabled:opacity-40"
              >
                Disconnect Store
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer copyright */}
      <footer className="text-center text-[11px] text-text-muted py-2 border-t border-border-main">
        LamSuite Billing v2.0 • Multi-Store Retail Engine
      </footer>
    </div>
  );
};

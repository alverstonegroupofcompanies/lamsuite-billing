import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Wifi,
  WifiOff,
  Languages,
  Clock,
  Search,
  Maximize,
  Minimize,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { companySettingsService } from "../lib/settings/companySettingsService";
import { syncQueueService } from "../lib/sync/syncQueueService";
import { onlineTransactionService, type NetworkHealth } from "../lib/sync/onlineTransactionService";
import { CommandPalette } from "./CommandPalette";
import { TopNav } from "./TopNav";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { storeDeviceService } from "../lib/auth/storeDeviceService";
import { counterLockingService } from "../lib/auth/counterLockingService";
import { LockOverlay } from "./LockOverlay";
import { counterSessionService, type CounterSessionState } from "../lib/auth/counterSessionService";
import { StoreSwitcherModal } from "./StoreSwitcherModal";
import { storeRegistryService, type RegisteredStoreRecord, STORE_PRESET_COLORS } from "../lib/auth/storeRegistryService";
import { Lock, Users, Building2 } from "lucide-react";
import { CounterIdentityChip } from "./CounterIdentityChip";
import type { ServerRenumbering } from "../lib/billing/documentIdentity";
import { APP_FULL_VERSION } from "../config/version";
import { shortcutDispatcher } from "../lib/keyboard/shortcutDispatcher";
import { requestKeyboardNavigation } from "../lib/keyboard/navigationGuard";
import { useI18n } from "../lib/i18n/I18nContext";

interface LayoutProps {
  children: React.ReactNode;
  onOpenGateway?: () => void;
  onAddNewStore?: () => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, onOpenGateway, onAddNewStore }) => {
  const { t, locale, toggleLocale } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [time, setTime] = useState<string>(new Date().toLocaleTimeString());
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isCmdPaletteOpen, setIsCmdPaletteOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isStoreSwitcherOpen, setIsStoreSwitcherOpen] = useState(false);
  const [activeStore, setActiveStore] = useState<RegisteredStoreRecord | null>(storeRegistryService.getActiveStore());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isStoreDisabled, setIsStoreDisabled] = useState(false);
  const [counter, setCounter] = useState<CounterSessionState>(() => counterSessionService.state());
  const [syncState, setSyncState] = useState<{ pendingCount: number; unsentCount: number; isProcessing: boolean }>({
    pendingCount: 0,
    unsentCount: 0,
    isProcessing: false,
  });
  const [renumberNotice, setRenumberNotice] = useState<ServerRenumbering[]>([]);
  const dismissedRenumberSignature = useRef("");
  const [networkHealth, setNetworkHealth] = useState<NetworkHealth>({
    state: "online",
    latencyMs: 40,
    lastOnlineTimestamp: Date.now(),
    timeSinceLastOnlineMs: 0,
    pendingQueueCount: 0,
    isLeaseBlockLow: false,
    remainingLeaseCount: 50,
  });
  const [enabledMenus, setEnabledMenus] = useState<string[]>([
    "dashboard",
    "pos",
    "bills",
    "sales_returns",
    "customer_debit_notes",
    "purchases",
    "purchase_returns",
    "expenses",
    "stock",
    "stock_transfers",
    "reports",
    "masters",
    "import_export",
    "migration",
    "settings",
    "counters",
  ]);

  useEffect(() => {
    const unsubCounter = counterSessionService.subscribe(setCounter);
    const unsubSync = syncQueueService.subscribe((s) => {
      setSyncState({
        pendingCount: s.pendingCount,
        unsentCount: s.unsentCount,
        isProcessing: s.isProcessing,
      });
      if (s.renumbered?.length) {
        const signature = s.renumbered
          .map((entry) => `${entry.external_id ?? ""}|${entry.from ?? ""}|${entry.to}`)
          .join(",");
        if (signature !== dismissedRenumberSignature.current) {
          setRenumberNotice(s.renumbered);
        }
      }
    });
    const unsubReg = storeRegistryService.onRegistryChange((reg) => {
      const cur = storeRegistryService.getActiveStore();
      setActiveStore(cur);
      if (cur && cur.is_active === false) {
        setIsStoreDisabled(true);
      } else if (cur && cur.is_active) {
        setIsStoreDisabled(false);
      }
    });
    const unsubHealth = onlineTransactionService.subscribe(setNetworkHealth);

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (networkHealth.pendingQueueCount > 0) {
        e.preventDefault();
        e.returnValue = "You have unsynced items in your queue. Are you sure you want to exit?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      unsubCounter();
      unsubSync();
      unsubReg();
      unsubHealth();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const isTyping = (event: KeyboardEvent) =>
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement;

    const nav = (path: string) => () => {
      if (requestKeyboardNavigation(path)) navigate(path);
      return true;
    };

    const uninstallDispatcher = shortcutDispatcher.install();
    const unregisterGlobal = shortcutDispatcher.register({
      id: "global-shell",
      scope: "global",
      handlers: {
        switchStore: () => {
          setIsStoreSwitcherOpen((prev) => !prev);
          return true;
        },
        lockTerminal: () => {
          counterLockingService.lock();
          return true;
        },
        commandPalette: () => {
          setIsCmdPaletteOpen((prev) => !prev);
          return true;
        },
        navPos: nav("/pos"),
        navPurchases: nav("/purchases"),
        navPurchaseReturns: nav("/returns/purchases"),
        navStock: nav("/stock"),
        navTransfers: nav("/stock/transfers"),
        navReports: nav("/reports"),
        navMasters: nav("/masters"),
        navBills: nav("/bills"),
        navSalesReturns: nav("/returns/sales"),
        navDebitNotes: nav("/returns/debit-notes"),
        navCounters: nav("/counters"),
        navImportExport: nav("/import-export"),
        navSettings: nav("/settings"),
        toggleFullscreen: () => {
          toggleFullscreen();
          return true;
        },
        navDashboard: (event) => {
          if (isTyping(event as KeyboardEvent)) return false;
          if (requestKeyboardNavigation("/dashboard")) navigate("/dashboard");
          return true;
        },
      },
    });

    return () => {
      clearInterval(timer);
      unregisterGlobal();
      uninstallDispatcher();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [navigate, location.pathname]);

  // The counter's idle lock: the owner's minutes for this counter, counted here.
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;

    // What this counter's owner set is read back before anything is counted, so
    // a till that rebooted while the store server was out of reach still locks
    // on its owner's clock rather than the till's own default.
    counterLockingService
      .hydrate()
      .catch(() => null)
      .finally(() => {
        if (cancelled) return;
        stop = counterLockingService.startIdleWatch();
        counterLockingService.refresh().catch(() => {});
      });

    return () => {
      cancelled = true;
      if (stop) stop();
    };
  }, []);

  useEffect(() => {
    companySettingsService.loadSettings().then((cfg) => {
      if (cfg) {
        if (cfg.enabled_menu_items) {
          setEnabledMenus(cfg.enabled_menu_items);
        }
      }
      const curStore = storeRegistryService.getActiveStore();
      if ((curStore && curStore.is_active === false) || (cfg && cfg.is_active === false)) {
        setIsStoreDisabled(true);
      } else {
        setIsStoreDisabled(false);
      }
    });
  }, [location.pathname]);

  const toggleFullscreen = () => {
    const docEl = document.documentElement as any;
    const doc = document as any;

    const requestFs =
      docEl.requestFullscreen ||
      docEl.webkitRequestFullscreen ||
      docEl.mozRequestFullScreen ||
      docEl.msRequestFullscreen;

    const exitFs =
      doc.exitFullscreen ||
      doc.webkitExitFullscreen ||
      doc.mozCancelFullScreen ||
      doc.msExitFullscreen;

    const isFs =
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement;

    if (!isFs) {
      if (typeof requestFs === "function") {
        try {
          const res = requestFs.call(docEl);
          if (res && typeof res.then === "function") {
            res.then(() => setIsFullscreen(true)).catch(() => {});
          } else {
            setIsFullscreen(true);
          }
        } catch {
          // ignore fullscreen error if unsupported or blocked
        }
      }
    } else {
      if (typeof exitFs === "function") {
        try {
          const res = exitFs.call(doc);
          if (res && typeof res.then === "function") {
            res.then(() => setIsFullscreen(false)).catch(() => {});
          } else {
            setIsFullscreen(false);
          }
        } catch {
          // ignore exit fullscreen error
        }
      }
    }
  };

  if (isStoreDisabled || (activeStore && activeStore.is_active === false)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-900 text-white p-6 font-sans">
        <div className="max-w-md w-full text-center space-y-4 bg-slate-800 p-8 rounded-2xl border border-red-500/30 shadow-2xl">
          <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-400 mx-auto flex items-center justify-center">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-red-400">Store disabled</h2>
          <p className="text-sm text-slate-300">
            {activeStore ? `Store "${activeStore.name}" (${activeStore.code})` : "This store"} has been disabled in the central Admin Panel. Connected workstations and billing terminals cannot process transactions while the store is disabled.
          </p>
          <div className="rounded-lg bg-slate-950/60 p-3 text-xs text-slate-400 font-mono">
            Status: Store disabled | Contact your system administrator.
          </div>
          {onOpenGateway && (
            <button
              onClick={onOpenGateway}
              className="mt-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Switch Store (Ctrl+Alt+S)
            </button>
          )}
        </div>
      </div>
    );
  }

  const storeColorHex = activeStore?.color || "#059669";

  return (
    <div className="flex h-screen flex-col bg-[var(--color-canvas)] font-sans select-none overflow-hidden">
      {/* Visual Identity Color Strip across the top window border */}
      <div className="h-1 w-full shrink-0" style={{ backgroundColor: storeColorHex }} />

      {/* Top Header Bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-xs">
        <div className="flex items-center gap-3 shrink-0">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 hover:opacity-90 transition-opacity cursor-pointer text-inherit no-underline shrink-0"
            title="Go to Dashboard (Home / Ctrl+D)"
          >
            <img
              src="/app-icon.png"
              alt="LamSuite Logo"
              className="h-8 w-8 rounded-[8px] object-cover border border-[var(--color-border)] bg-[var(--color-surface)] shrink-0"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-bold text-[var(--color-text)] leading-tight whitespace-nowrap">LamSuite Billing</h1>
                <span className="rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)] px-1.5 py-0.2 text-[10px] font-mono font-bold text-[var(--color-accent)] shadow-2xs">
                  {APP_FULL_VERSION}
                </span>
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)] font-medium whitespace-nowrap">{t("layout.brand_subtitle")}</p>
            </div>
          </Link>

          {/* Active Store Switcher Pill (Tally-Style Company Pill) */}
          <button
            type="button"
            onClick={() => setIsStoreSwitcherOpen(true)}
            title={`Active Store: ${activeStore?.name || "Main Store"} (Store ID: ${activeStore?.id || "1"}, Code: ${activeStore?.code || "STORE-01"}). Press Ctrl + Alt + S to switch.`}
            className="flex items-center gap-2 px-2.5 py-1 rounded-btn bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-xs font-semibold cursor-pointer transition-colors shadow-2xs"
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: storeColorHex }}
            />
            <span className="font-bold text-[var(--color-text)] max-w-[130px] truncate">
              {activeStore?.alias || activeStore?.name || "Main Store"}
            </span>
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]">
              {activeStore?.code || `STORE-${String(activeStore?.id || "01").padStart(2, "0")}`}
            </span>
            <span className="text-[9px] text-[var(--color-text-muted)] font-mono font-medium">
              ID:{activeStore?.id || "1"}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)] font-mono px-1 rounded bg-[var(--color-canvas)] border border-[var(--color-border)]">
              Ctrl+Alt+S
            </span>
          </button>
        </div>

        {/* Center: Command Palette Trigger Button */}
        <div className="flex-1 max-w-md mx-4">
          <button
            onClick={() => setIsCmdPaletteOpen(true)}
            className="flex w-full items-center justify-between rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface)] transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-[var(--color-text-faint)]" />
              <span className="truncate">{t("layout.search_placeholder")}</span>
            </div>
            <kbd className="rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-text-muted)] shadow-2xs shrink-0">
              Ctrl+K
            </kbd>
          </button>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-3 text-xs font-medium text-[var(--color-text-muted)] shrink-0">
          <button
            onClick={toggleLocale}
            title={t("layout.language")}
            className="flex items-center gap-1 rounded-[8px] px-1.5 py-1 text-[10px] font-bold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer"
          >
            <Languages className="h-4 w-4" />
            <span>{locale === "en" ? "ML" : "EN"}</span>
          </button>

          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen (F11)"
            className="rounded-[8px] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer"
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>

          {/* The counter is the identity here — no person signs in at the till. */}
          <CounterIdentityChip
            counterName={counter.counterName}
            counterCode={counter.counterCode}
            fallbackName={t("layout.counter")}
          />

          <button
            onClick={() => counterLockingService.lock()}
            title="Lock Terminal (Ctrl+L)"
            className="rounded-[8px] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer"
          >
            <Lock className="h-4 w-4 text-[var(--color-text-muted)]" />
          </button>

          <div
            onClick={() => {
              if (networkHealth.state !== "offline" && !syncState.isProcessing) {
                syncQueueService.processQueue().catch(() => {});
              }
            }}
            title={
              networkHealth.state === "offline"
                ? `Offline Mode: ${networkHealth.pendingQueueCount} items queued for sync. Last online: ${Math.floor(networkHealth.timeSinceLastOnlineMs / 60000)}m ago.`
                : networkHealth.state === "slow"
                ? `Slow Connection (${networkHealth.latencyMs}ms). Operating in live cloud mode.`
                : syncState.isProcessing
                ? "Syncing data to cloud..."
                : syncState.unsentCount > 0
                ? `${syncState.unsentCount} bill(s)/change(s) waiting to be sent. Click to push now.`
                : `Live connected to backend cloud (${networkHealth.latencyMs}ms latency)`
            }
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs cursor-pointer transition-colors shadow-2xs ${
              networkHealth.state === "offline"
                ? "bg-red-50 text-red-700 border border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800"
                : networkHealth.state === "slow"
                ? "bg-amber-50 text-amber-700 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
                : syncState.isProcessing
                ? "bg-accent-soft text-accent border border-accent/30"
                : syncState.unsentCount > 0
                ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
                : "bg-accent-soft text-accent border border-accent/20"
            }`}
          >
            {networkHealth.state === "offline" ? (
              <>
                <WifiOff className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0 animate-pulse" />
                <span className="whitespace-nowrap font-semibold">Offline Mode</span>
                {networkHealth.pendingQueueCount > 0 && (
                  <span className="bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-200 rounded-full px-1.5 py-0.2 text-[10px] font-bold font-mono">
                    {networkHealth.pendingQueueCount}
                  </span>
                )}
                {networkHealth.timeSinceLastOnlineMs > 60000 && (
                  <span className="text-[10px] opacity-75 font-mono">
                    {Math.floor(networkHealth.timeSinceLastOnlineMs / 60000)}m
                  </span>
                )}
              </>
            ) : networkHealth.state === "slow" ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="whitespace-nowrap font-semibold">Slow Connection</span>
                <span className="text-[10px] opacity-75 font-mono">{networkHealth.latencyMs}ms</span>
              </>
            ) : syncState.isProcessing ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 text-[var(--color-accent)] animate-spin shrink-0" />
                <span className="whitespace-nowrap font-semibold">Syncing...</span>
              </>
            ) : syncState.unsentCount > 0 ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 text-[var(--color-warning-text)] shrink-0" />
                <span className="whitespace-nowrap font-semibold">Waiting to send</span>
                <span className="bg-[var(--color-warning-border)] text-[var(--color-warning-text)] rounded-full px-1.5 py-0.2 text-[10px] font-bold font-mono">
                  {syncState.unsentCount}
                </span>
              </>
            ) : (
              <>
                <Wifi className="h-3.5 w-3.5 text-[var(--color-accent)] shrink-0" />
                <span className="whitespace-nowrap font-semibold">Live Synced</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[var(--color-text-muted)] font-mono text-[11px] tabular-nums">
            <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
            <span className="whitespace-nowrap">{time}</span>
          </div>
        </div>
      </header>

      {/* A bill saved offline was filed under the store's own number when it synced. */}
      {renumberNotice.length > 0 && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-1.5 text-[11px] font-medium text-[var(--color-warning-text)]"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              {renumberNotice.length === 1 ? (
                <>
                  {renumberNotice[0].from ? `Offline number ${renumberNotice[0].from} was` : "A bill saved offline was"}{" "}
                  given the store's number <strong className="font-mono">{renumberNotice[0].to}</strong> when it synced.
                </>
              ) : (
                <>
                  {renumberNotice.length} bills saved offline were given the store's own numbers when they synced.
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => navigate("/bills")}
              className="rounded px-1.5 py-0.5 font-semibold underline decoration-dotted cursor-pointer"
            >
              View bills
            </button>
            <button
              type="button"
              onClick={() => {
                dismissedRenumberSignature.current = renumberNotice
                  .map((entry) => `${entry.external_id ?? ""}|${entry.from ?? ""}|${entry.to}`)
                  .join(",");
                setRenumberNotice([]);
              }}
              className="rounded px-1.5 py-0.5 font-semibold hover:bg-[var(--color-warning-border)] cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Redesigned Navigation Sub-Header */}
      <TopNav
        enabledMenus={enabledMenus}
        onOpenShortcutsHelp={() => setIsShortcutsModalOpen(true)}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 overflow-auto p-4">{children}</main>

      {/* MARG-Style Command Palette Modal */}
      <CommandPalette isOpen={isCmdPaletteOpen} onClose={() => setIsCmdPaletteOpen(false)} />

      {/* Keyboard Shortcuts Cheatsheet Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      {/* The counter's idle lock sits over the screens, which stay mounted. */}
      <LockOverlay />

      {/* Tally-Style Store Switcher Modal */}
      <StoreSwitcherModal
        isOpen={isStoreSwitcherOpen}
        onClose={() => setIsStoreSwitcherOpen(false)}
        onStoreSwitched={(switched) => setActiveStore(switched)}
        onAddNewStore={onAddNewStore}
        onOpenGateway={onOpenGateway}
      />
    </div>
  );
};

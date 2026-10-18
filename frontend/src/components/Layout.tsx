import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Wifi,
  WifiOff,
  User,
  Clock,
  Search,
  Maximize,
  Minimize,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { companySettingsService } from "../lib/settings/companySettingsService";
import { syncQueueService } from "../lib/sync/syncQueueService";
import { CommandPalette } from "./CommandPalette";
import { TopNav } from "./TopNav";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { staffAuthService, type ActiveStaffSession } from "../lib/auth/staffAuthService";
import { storeDeviceService } from "../lib/auth/storeDeviceService";
import { LockOverlay } from "./LockOverlay";
import { AccountSwitcherModal } from "./AccountSwitcherModal";
import { Lock, Users } from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [time, setTime] = useState<string>(new Date().toLocaleTimeString());
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isCmdPaletteOpen, setIsCmdPaletteOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isStoreDisabled, setIsStoreDisabled] = useState(false);
  const [session, setSession] = useState<ActiveStaffSession | null>(staffAuthService.getCurrentSession());
  const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState(false);
  const [syncState, setSyncState] = useState<{ pendingCount: number; isProcessing: boolean }>({
    pendingCount: 0,
    isProcessing: false,
  });
  const [enabledMenus, setEnabledMenus] = useState<string[]>([
    "dashboard",
    "pos",
    "bills",
    "sales_returns",
    "customer_debit_notes",
    "purchases",
    "purchase_returns",
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
    const unsubStaff = staffAuthService.onSessionChange(setSession);
    const unsubSync = syncQueueService.subscribe((s) => {
      setSyncState({
        pendingCount: s.pendingCount,
        isProcessing: s.isProcessing,
      });
    });
    return () => {
      unsubStaff();
      unsubSync();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Global keyboard navigation shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // If event was already handled or prevented, ignore
      if (e.defaultPrevented) return;

      const isPosPage = location.pathname === "/pos" || location.pathname.startsWith("/pos");

      // Manual Lock Terminal (Ctrl+L)
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "l" || e.code === "KeyL")) {
        e.preventDefault();
        staffAuthService.lockCurrentSession();
        return;
      }

      // Quick Account Switcher (F12)
      if (e.key === "F12" && !isPosPage) {
        e.preventDefault();
        setIsAccountSwitcherOpen(true);
        return;
      }

      // Command Palette (Ctrl+K / Cmd+K)
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "k" || e.code === "KeyK")) {
        e.preventDefault();
        setIsCmdPaletteOpen((prev) => !prev);
        return;
      }

      // Ignore text input fields for standard navigation letters
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;

      if (e.key === "Home" && !isInput) {
        e.preventDefault();
        navigate("/dashboard");
        return;
      }

      // On POS page, let POS Billing handle F1, F2, F3, F6, F9, Ctrl+D, Shift+F2, Alt+R, etc.
      if (isPosPage) {
        if (
          e.key === "F1" ||
          e.key === "F2" ||
          e.key === "F3" ||
          e.key === "F6" ||
          e.key === "F9" ||
          ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "d" || e.code === "KeyD"))
        ) {
          return;
        }
      }

      // Function key navigation shortcuts for other pages
      if (e.key === "F1") {
        e.preventDefault();
        navigate("/pos");
      } else if (e.key === "F2") {
        e.preventDefault();
        if (e.shiftKey) {
          navigate("/returns/purchases");
        } else {
          navigate("/purchases");
        }
      } else if (e.key === "F3") {
        e.preventDefault();
        if (e.shiftKey) {
          navigate("/stock/transfers");
        } else {
          navigate("/stock");
        }
      } else if (e.key === "F4") {
        e.preventDefault();
        navigate("/reports");
      } else if (e.key === "F5") {
        e.preventDefault();
        navigate("/masters");
      } else if (e.key === "F6") {
        e.preventDefault();
        navigate("/bills");
      } else if (e.key === "F7") {
        e.preventDefault();
        if (e.shiftKey) {
          navigate("/returns/debit-notes");
        } else {
          navigate("/returns/sales");
        }
      } else if (e.key === "F8") {
        e.preventDefault();
        navigate("/counters");
      } else if (e.key === "F9") {
        e.preventDefault();
        navigate("/import-export");
      } else if (e.key === "F10") {
        e.preventDefault();
        navigate("/settings");
      } else if (e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearInterval(timer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [navigate, location.pathname]);

  // Idle auto-lock watcher
  useEffect(() => {
    let idleTimer: NodeJS.Timeout;
    const resetIdle = () => {
      staffAuthService.recordActivity();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        staffAuthService.lockCurrentSession();
      }, staffAuthService.getIdleTimeoutMs());
    };

    window.addEventListener("mousemove", resetIdle);
    window.addEventListener("keydown", resetIdle);
    window.addEventListener("click", resetIdle);
    resetIdle();

    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener("mousemove", resetIdle);
      window.removeEventListener("keydown", resetIdle);
      window.removeEventListener("click", resetIdle);
    };
  }, []);

  useEffect(() => {
    companySettingsService.loadSettings().then((cfg) => {
      if (cfg) {
        if (cfg.enabled_menu_items) {
          setEnabledMenus(cfg.enabled_menu_items);
        }
        if (cfg.is_active === false) {
          setIsStoreDisabled(true);
        } else {
          setIsStoreDisabled(false);
        }
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

  if (isStoreDisabled) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-900 text-white p-6 font-sans">
        <div className="max-w-md w-full text-center space-y-4 bg-slate-800 p-8 rounded-2xl border border-red-500/30 shadow-2xl">
          <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-400 mx-auto flex items-center justify-center">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-red-400">Store disabled</h2>
          <p className="text-sm text-slate-300">
            This store has been disabled in the central Admin Panel. Connected workstations and billing terminals cannot process transactions while the store is disabled.
          </p>
          <div className="rounded-lg bg-slate-950/60 p-3 text-xs text-slate-400 font-mono">
            Status: Store disabled | Contact your system administrator.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--color-canvas)] font-sans select-none overflow-hidden">
      {/* Top Header Bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-xs">
        <Link
          to="/dashboard"
          className="flex items-center gap-2.5 hover:opacity-90 transition-opacity cursor-pointer text-inherit no-underline shrink-0"
          title="Go to Dashboard (Home / Ctrl+D)"
        >
          <img
            src="/app-icon.png"
            alt="LamSuite Logo"
            className="h-8 w-8 rounded-[8px] object-cover border border-[var(--color-border)] bg-[var(--color-surface)] shrink-0"
          />
          <div>
            <h1 className="text-sm font-bold text-[var(--color-text)] leading-tight whitespace-nowrap">LamSuite Billing</h1>
            <p className="text-[11px] text-[var(--color-text-muted)] font-medium whitespace-nowrap">Retail & Pharmacy POS</p>
          </div>
        </Link>

        {/* Center: Command Palette Trigger Button */}
        <div className="flex-1 max-w-md mx-4">
          <button
            onClick={() => setIsCmdPaletteOpen(true)}
            className="flex w-full items-center justify-between rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface)] transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-[var(--color-text-faint)]" />
              <span className="truncate">Search actions, modules, or tools...</span>
            </div>
            <kbd className="rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-text-muted)] shadow-2xs shrink-0">
              Ctrl+K
            </kbd>
          </button>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-3 text-xs font-medium text-[var(--color-text-muted)] shrink-0">
          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen (F11)"
            className="rounded-[8px] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer"
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>

          <div
            onClick={() => setIsAccountSwitcherOpen(true)}
            title="Click to Switch Cashier (F12)"
            className="flex items-center gap-1.5 rounded-full bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] px-3 py-1 cursor-pointer transition-colors shadow-2xs"
          >
            <User className="h-3.5 w-3.5 text-[var(--color-accent)]" />
            <span className="whitespace-nowrap font-bold text-[var(--color-text)]">
              {session?.user.full_name || "Cashier"}
            </span>
            <span className="text-[10px] font-mono bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-bold px-1.5 py-0.2 rounded-full uppercase">
              {session?.counterCode || "C01"}
            </span>
          </div>

          <button
            onClick={() => staffAuthService.lockCurrentSession()}
            title="Lock Terminal (Ctrl+L)"
            className="rounded-[8px] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer"
          >
            <Lock className="h-4 w-4 text-[var(--color-text-muted)]" />
          </button>

          <div
            onClick={() => {
              if (isOnline && !syncState.isProcessing) {
                syncQueueService.processQueue().catch(() => {});
              }
            }}
            title={
              !isOnline
                ? "Offline: Queued changes will automatically sync once internet is connected"
                : syncState.isProcessing
                ? "Syncing data to cloud..."
                : syncState.pendingCount > 0
                ? `${syncState.pendingCount} change(s) queued for sync. Click to push now.`
                : "All data synced to backend cloud"
            }
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs cursor-pointer transition-colors shadow-2xs ${
              !isOnline
                ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
                : syncState.isProcessing
                ? "bg-accent-soft text-accent border border-accent/30"
                : syncState.pendingCount > 0
                ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
                : "bg-accent-soft text-accent border border-accent/20"
            }`}
          >
            {!isOnline ? (
              <>
                <WifiOff className="h-3.5 w-3.5 text-[var(--color-warning-text)] shrink-0" />
                <span className="whitespace-nowrap font-semibold">Offline Active</span>
                {syncState.pendingCount > 0 && (
                  <span className="bg-[var(--color-warning-border)] text-[var(--color-warning-text)] rounded-full px-1.5 py-0.2 text-[10px] font-bold font-mono">
                    {syncState.pendingCount}
                  </span>
                )}
              </>
            ) : syncState.isProcessing ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 text-[var(--color-accent)] animate-spin shrink-0" />
                <span className="whitespace-nowrap font-semibold">Syncing...</span>
              </>
            ) : syncState.pendingCount > 0 ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 text-[var(--color-warning-text)] shrink-0" />
                <span className="whitespace-nowrap font-semibold">Syncing</span>
                <span className="bg-[var(--color-warning-border)] text-[var(--color-warning-text)] rounded-full px-1.5 py-0.2 text-[10px] font-bold font-mono">
                  {syncState.pendingCount}
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

      {/* Security Lock Overlay */}
      {session?.isLocked && (
        <LockOverlay
          session={session}
          onSwitchUser={() => setIsAccountSwitcherOpen(true)}
        />
      )}

      {/* Account Switcher Modal */}
      <AccountSwitcherModal
        isOpen={isAccountSwitcherOpen}
        onClose={() => setIsAccountSwitcherOpen(false)}
        onSwitched={() => setSession(staffAuthService.getCurrentSession())}
      />
    </div>
  );
};

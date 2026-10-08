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
} from "lucide-react";
import { companySettingsService } from "../lib/settings/companySettingsService";
import { CommandPalette } from "./CommandPalette";
import { TopNav } from "./TopNav";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";

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
    "settings",
  ]);

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

      // On POS page, let POS Billing handle F1, F2, F3, F6, F8, F9, F12, Ctrl+D, Shift+F2, Alt+R, etc.
      if (isPosPage) {
        if (
          e.key === "F1" ||
          e.key === "F2" ||
          e.key === "F3" ||
          e.key === "F6" ||
          e.key === "F8" ||
          e.key === "F9" ||
          e.key === "F12" ||
          ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "d" || e.code === "KeyD"))
        ) {
          // Let POS billing component handle these
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
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
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
    <div className="flex h-screen flex-col bg-slate-100 font-sans select-none overflow-hidden">
      {/* Top Header Bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-xs">
        <Link
          to="/dashboard"
          className="flex items-center gap-2.5 hover:opacity-85 transition-opacity cursor-pointer text-inherit no-underline shrink-0"
          title="Go to Dashboard (Home / Ctrl+D)"
        >
          <img
            src="/app-icon.png"
            alt="LamSuite Logo"
            className="h-8 w-8 rounded-lg shadow-xs object-cover border border-slate-200/80 bg-white shrink-0"
          />
          <div>
            <h1 className="text-sm font-bold text-slate-800 leading-tight whitespace-nowrap">LamSuite Billing</h1>
            <p className="text-[10px] text-slate-500 font-medium whitespace-nowrap">Retail & Pharmacy POS</p>
          </div>
        </Link>

        {/* Center: Command Palette Trigger Button */}
        <div className="flex-1 max-w-md mx-4">
          <button
            onClick={() => setIsCmdPaletteOpen(true)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500 hover:border-slate-300 hover:bg-slate-100 transition-colors shadow-inner cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <span className="truncate">Search actions, modules, or tools...</span>
            </div>
            <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-slate-500 shadow-xs shrink-0">
              Ctrl+K
            </kbd>
          </button>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-3 text-xs font-medium text-slate-600 shrink-0">
          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen (F11)"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>

          <div className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1">
            <User className="h-3.5 w-3.5 text-slate-500" />
            <span className="whitespace-nowrap">Counter 01</span>
          </div>

          <div
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
              isOnline ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {isOnline ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span className="whitespace-nowrap">LAN / Cloud Sync</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span className="whitespace-nowrap">Offline Active</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-slate-500 font-mono text-[11px]">
            <Clock className="h-3.5 w-3.5 shrink-0" />
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
    </div>
  );
};

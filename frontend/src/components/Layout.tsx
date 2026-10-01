import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ShoppingCart,
  Truck,
  Package,
  FileBarChart,
  Database,
  Settings,
  Wifi,
  WifiOff,
  User,
  Clock,
  Search,
  Maximize,
  Minimize,
  Sliders,
  Layers,
  FileText,
} from "lucide-react";
import { companySettingsService } from "../lib/settings/companySettingsService";
import { CommandPalette } from "./CommandPalette";

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [time, setTime] = useState<string>(new Date().toLocaleTimeString());
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isCmdPaletteOpen, setIsCmdPaletteOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [enabledMenus, setEnabledMenus] = useState<string[]>([
    "pos",
    "bills",
    "purchases",
    "stock",
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

    // Global keyboard navigation shortcuts (F1-F6, F10, F11, Ctrl+K / Cmd+K)
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCmdPaletteOpen((prev) => !prev);
      } else if (e.key === "F1") {
        e.preventDefault();
        navigate("/pos");
      } else if (e.key === "F2") {
        e.preventDefault();
        navigate("/purchases");
      } else if (e.key === "F3") {
        e.preventDefault();
        navigate("/stock");
      } else if (e.key === "F4") {
        e.preventDefault();
        navigate("/reports");
      } else if (e.key === "F5") {
        e.preventDefault();
        navigate("/masters");
      } else if (e.key === "F6") {
        e.preventDefault();
        navigate("/bills");
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
  }, [navigate]);

  useEffect(() => {
    companySettingsService.loadSettings().then((cfg) => {
      if (cfg && cfg.enabled_menu_items) {
        setEnabledMenus(cfg.enabled_menu_items);
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

  const allNavItems = [
    { id: "pos", name: "POS Billing", path: "/pos", key: "F1", icon: ShoppingCart, group: "Sales & Billing" },
    { id: "bills", name: "Bills", path: "/bills", key: "F6", icon: FileText, group: "Sales & Billing" },
    { id: "purchases", name: "Purchases", path: "/purchases", key: "F2", icon: Truck, group: "Purchase" },
    { id: "stock", name: "Stock Ledger", path: "/stock", key: "F3", icon: Package, group: "Inventory" },
    { id: "reports", name: "Reports & GST", path: "/reports", key: "F4", icon: FileBarChart, group: "Reports" },
    { id: "masters", name: "Master Data", path: "/masters", key: "F5", icon: Database, group: "Master" },
    { id: "settings", name: "Settings", path: "/settings", key: "F10", icon: Settings, group: "Administration" },
  ];

  const navItems = allNavItems.filter((item) => enabledMenus.includes(item.id));

  return (
    <div className="flex h-screen flex-col bg-slate-100 font-sans select-none">
      {/* Top Header Bar */}
      <header className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 font-bold text-white shadow-sm">
            LS
          </span>
          <div>
            <h1 className="text-sm font-bold text-slate-800 leading-tight">LamSuite Billing</h1>
            <p className="text-[10px] text-slate-500 font-medium">Retail & Pharmacy POS (Offline-First)</p>
          </div>
        </div>

        {/* Center: Command Palette Trigger Button */}
        <div className="flex-1 max-w-md mx-4">
          <button
            onClick={() => setIsCmdPaletteOpen(true)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500 hover:border-slate-300 hover:bg-slate-100 transition-colors shadow-inner"
          >
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <span>Search actions, modules, or tools...</span>
            </div>
            <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-slate-500 shadow-xs">
              Ctrl+K
            </kbd>
          </button>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-3 text-xs font-medium text-slate-600">
          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen (F11)"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>

          <div className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1">
            <User className="h-3.5 w-3.5 text-slate-500" />
            <span>Counter 01</span>
          </div>

          <div
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
              isOnline ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {isOnline ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                <span>LAN / Cloud Sync</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-amber-600" />
                <span>Offline Active</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-slate-500 font-mono text-[11px]">
            <Clock className="h-3.5 w-3.5" />
            <span>{time}</span>
          </div>
        </div>
      </header>

      {/* Navigation Sub-Header */}
      <nav className="flex h-11 items-center justify-between border-b border-slate-200 bg-slate-800 px-3 text-white">
        <div className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive ? "bg-blue-600 text-white shadow" : "text-slate-300 hover:bg-slate-700 hover:text-white"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.name}</span>
                <span className="rounded bg-black/25 px-1 py-0.5 text-[10px] text-slate-300">{item.key}</span>
              </Link>
            );
          })}
        </div>

        {/* Right Nav Shortcut Help */}
        <div className="flex items-center gap-2 text-[11px] text-slate-400 pr-2">
          <span>MARG Keyboard Navigation:</span>
          <span className="font-mono text-slate-300">F1-F5</span>
          <span>•</span>
          <span className="font-mono text-slate-300">F11 Full</span>
        </div>
      </nav>

      {/* Main Content Viewport */}
      <main className="flex-1 overflow-auto p-4">{children}</main>

      {/* MARG-Style Command Palette Modal */}
      <CommandPalette isOpen={isCmdPaletteOpen} onClose={() => setIsCmdPaletteOpen(false)} />
    </div>
  );
};

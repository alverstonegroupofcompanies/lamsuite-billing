import React, { useEffect } from "react";
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
} from "lucide-react";
import { companySettingsService } from "../lib/settings/companySettingsService";

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [time, setTime] = React.useState<string>(new Date().toLocaleTimeString());
  const [isOnline, setIsOnline] = React.useState<boolean>(navigator.onLine);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Global keyboard navigation shortcuts (F1: POS, F2: Purchases, F3: Stock, F4: Reports)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F1") {
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

  const [enabledMenus, setEnabledMenus] = React.useState<string[]>([
    "pos",
    "purchases",
    "stock",
    "reports",
    "masters",
    "settings",
  ]);

  useEffect(() => {
    companySettingsService.loadSettings().then((cfg) => {
      if (cfg && cfg.enabled_menu_items) {
        setEnabledMenus(cfg.enabled_menu_items);
      }
    });
  }, [location.pathname]);

  const allNavItems = [
    { id: "pos", name: "POS Billing", path: "/pos", key: "F1", icon: ShoppingCart },
    { id: "purchases", name: "Purchases", path: "/purchases", key: "F2", icon: Truck },
    { id: "stock", name: "Stock Ledger", path: "/stock", key: "F3", icon: Package },
    { id: "reports", name: "Reports & GST", path: "/reports", key: "F4", icon: FileBarChart },
    { id: "masters", name: "Master Data", path: "/masters", key: "F5", icon: Database },
    { id: "settings", name: "Settings", path: "/settings", key: "F10", icon: Settings },
  ];

  const navItems = allNavItems.filter((item) => enabledMenus.includes(item.id));

  return (
    <div className="flex h-screen flex-col bg-slate-100 font-sans">
      {/* Top Header Bar */}
      <header className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-blue-600 font-bold text-white shadow-sm">
            LS
          </span>
          <div>
            <h1 className="text-sm font-bold text-slate-800 leading-tight">LamSuite Billing</h1>
            <p className="text-[11px] text-slate-500">Retail & Medical POS (Offline-First)</p>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
          <div className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1">
            <User className="h-3.5 w-3.5 text-slate-500" />
            <span>Counter 01 (Admin)</span>
          </div>

          <div
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
              isOnline ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {isOnline ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                <span>Cloud Synced</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-amber-600" />
                <span>Offline Mode</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            <span>{time}</span>
          </div>
        </div>
      </header>

      {/* Navigation Sub-Header */}
      <nav className="flex h-11 items-center border-b border-slate-200 bg-slate-800 px-3 text-white">
        <div className="flex gap-1">
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
      </nav>

      {/* Main Content Viewport */}
      <main className="flex-1 overflow-auto p-4">{children}</main>
    </div>
  );
};

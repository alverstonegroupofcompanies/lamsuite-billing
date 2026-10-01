import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  LayoutDashboard,
  Store,
  Cpu,
  ToggleLeft,
  Users,
  Database,
  Receipt,
  Boxes,
  FileBarChart2,
  RefreshCw,
  Settings,
  ShieldCheck,
  Building2,
} from "lucide-react";

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen = false, onClose }) => {
  const location = useLocation();
  const { user, hasPermission } = useAuth();

  const navSections = [
    {
      title: "Overview",
      items: [
        {
          id: "dashboard",
          name: "Dashboard",
          path: "/",
          icon: LayoutDashboard,
          shortcut: "Alt+1",
          visible: hasPermission("dashboard", "view"),
        },
      ],
    },
    {
      title: "Stores & Fleet",
      items: [
        {
          id: "stores",
          name: "Stores",
          path: "/stores",
          icon: Store,
          shortcut: "Alt+2",
          visible: hasPermission("stores", "view"),
        },
        {
          id: "devices",
          name: "Devices / Counters",
          path: "/devices",
          icon: Cpu,
          shortcut: "Alt+3",
          visible: hasPermission("devices", "view"),
        },
        {
          id: "features",
          name: "Menu & Feature Control",
          path: "/features",
          icon: ToggleLeft,
          shortcut: "Alt+4",
          visible: hasPermission("features", "view"),
        },
      ],
    },
    {
      title: "Identity & Staff",
      items: [
        {
          id: "users",
          name: "Users & Roles",
          path: "/users",
          icon: Users,
          shortcut: "Alt+5",
          visible: hasPermission("users", "view"),
        },
      ],
    },
    {
      title: "Catalog & Operations",
      items: [
        {
          id: "masters",
          name: "Master Data",
          path: "/masters",
          icon: Database,
          shortcut: "Alt+6",
          visible: hasPermission("masters", "view"),
        },
        {
          id: "transactions",
          name: "Transactions",
          path: "/transactions",
          icon: Receipt,
          shortcut: "Alt+7",
          visible: hasPermission("transactions", "view"),
        },
        {
          id: "inventory",
          name: "Inventory & Stock",
          path: "/inventory",
          icon: Boxes,
          shortcut: "Alt+8",
          visible: hasPermission("inventory", "view"),
        },
      ],
    },
    {
      title: "Statutory & Analytics",
      items: [
        {
          id: "reports",
          name: "Reports & GST",
          path: "/reports",
          icon: FileBarChart2,
          shortcut: "Alt+9",
          visible: hasPermission("reports", "view"),
        },
        {
          id: "sync",
          name: "Sync Center",
          path: "/sync",
          icon: RefreshCw,
          shortcut: "Alt+S",
          visible: hasPermission("sync", "view"),
        },
      ],
    },
    {
      title: "System & Governance",
      items: [
        {
          id: "settings",
          name: "Company Settings",
          path: "/settings",
          icon: Settings,
          shortcut: "Alt+C",
          visible: hasPermission("settings", "view"),
        },
        {
          id: "audit",
          name: "Audit Log",
          path: "/audit",
          icon: ShieldCheck,
          shortcut: "Alt+A",
          visible: hasPermission("audit", "view"),
        },
      ],
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/50 z-40 md:hidden animate-in fade-in"
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 transition-transform duration-200 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Brand Logo Header */}
        <div className="h-14 border-b border-slate-800 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-linear-to-br from-brand-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <div className="font-bold text-white text-sm tracking-tight leading-tight">
                LamSuite Admin
              </div>
              <div className="text-[10px] text-slate-400 font-medium">Cloud Central Hub</div>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {navSections.map((section) => {
            const visibleItems = section.items.filter((item) => item.visible);
            if (visibleItems.length === 0) return null;

            return (
              <div key={section.title} className="space-y-1">
                <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {section.title}
                </div>
                {visibleItems.map((item) => {
                  const isActive =
                    item.path === "/"
                      ? location.pathname === "/"
                      : location.pathname.startsWith(item.path);
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.id}
                      to={item.path}
                      onClick={onClose}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                        isActive
                          ? "bg-brand-600 text-white shadow-sm"
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className={`w-4 h-4 ${isActive ? "text-white" : "text-slate-400"}`} />
                        <span>{item.name}</span>
                      </div>
                      <span className="text-[10px] opacity-40 font-mono hidden lg:inline">
                        {item.shortcut}
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer Role indicator */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-[11px] text-slate-400 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="truncate max-w-[120px]">{user?.email}</span>
          </div>
          <span className="bg-slate-800 px-2 py-0.5 rounded text-[10px] font-mono text-slate-300">
            v2.0
          </span>
        </div>
      </aside>
    </>
  );
};

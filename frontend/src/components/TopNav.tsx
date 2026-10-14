import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  LayoutDashboard,
  ShoppingCart,
  FileText,
  Undo2,
  Building2,
  Truck,
  ArrowUpFromLine,
  ArrowRightLeft,
  Package,
  FileBarChart,
  Database,
  Settings,
  Monitor,
  Keyboard,
  X,
  LucideIcon,
  Layers,
} from "lucide-react";

export interface NavChildItem {
  id: string;
  name: string;
  path: string;
  key: string;
  icon: LucideIcon;
  description?: string;
}

export interface NavGroupItem {
  id: string;
  name: string;
  icon: LucideIcon;
  children: NavChildItem[];
}

export interface NavDirectItem {
  id: string;
  name: string;
  path: string;
  key: string;
  icon: LucideIcon;
}

export type NavItemConfig = NavDirectItem | NavGroupItem;

export function isNavGroup(item: NavItemConfig): item is NavGroupItem {
  return "children" in item && Array.isArray((item as NavGroupItem).children);
}

interface TopNavProps {
  enabledMenus: string[];
  onOpenShortcutsHelp: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({ enabledMenus, onOpenShortcutsHelp }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [focusedChildIndex, setFocusedChildIndex] = useState<number>(-1);
  const buttonRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const navHierarchy: NavItemConfig[] = [
    {
      id: "dashboard",
      name: "Dashboard",
      path: "/dashboard",
      key: "Home",
      icon: LayoutDashboard,
    },
    {
      id: "pos",
      name: "POS Billing",
      path: "/pos",
      key: "F1",
      icon: ShoppingCart,
    },
    {
      id: "sales_group",
      name: "Sales & Bills",
      icon: FileText,
      children: [
        {
          id: "bills",
          name: "Past Bills & Invoices",
          path: "/bills",
          key: "F6",
          icon: FileText,
          description: "Search, reprint, and manage sales invoices",
        },
        {
          id: "sales_returns",
          name: "Sales Returns & Credit Notes",
          path: "/returns/sales",
          key: "F7",
          icon: Undo2,
          description: "Customer returns, batch restock & refunds",
        },
        {
          id: "customer_debit_notes",
          name: "Customer Debit Notes (B2B)",
          path: "/returns/debit-notes",
          key: "Shift+F7",
          icon: Building2,
          description: "Multi-invoice reconciliation & GST credit notes",
        },
      ],
    },
    {
      id: "purchases_group",
      name: "Purchases",
      icon: Truck,
      children: [
        {
          id: "purchases",
          name: "Inward Purchases",
          path: "/purchases",
          key: "F2",
          icon: Truck,
          description: "Supplier invoices, batch entry & ITC",
        },
        {
          id: "purchase_returns",
          name: "Purchase Returns (Debit Notes)",
          path: "/returns/purchases",
          key: "Shift+F2",
          icon: ArrowUpFromLine,
          description: "Stock debit notes & supplier return notes",
        },
      ],
    },
    {
      id: "stock_group",
      name: "Inventory",
      icon: Package,
      children: [
        {
          id: "stock",
          name: "Stock Ledger & Adjustments",
          path: "/stock",
          key: "F3",
          icon: Package,
          description: "Audit ledger, write-offs, reconciliation & near-expiry",
        },
        {
          id: "stock_transfers",
          name: "Inter-Store Transfers",
          path: "/stock/transfers",
          key: "Shift+F3",
          icon: ArrowRightLeft,
          description: "Multi-item branch dispatch, receipt & delivery challan",
        },
      ],
    },
    {
      id: "reports",
      name: "Reports",
      path: "/reports",
      key: "F4",
      icon: FileBarChart,
    },
    {
      id: "masters",
      name: "Masters",
      path: "/masters",
      key: "F5",
      icon: Database,
    },
    {
      id: "import_export",
      name: "Import / Export",
      path: "/import-export",
      key: "F9",
      icon: Layers,
    },
    {
      id: "migration",
      name: "Data Migration",
      path: "/migration",
      key: "Shift+F9",
      icon: Database,
    },
    {
      id: "settings",
      name: "Settings",
      path: "/settings",
      key: "F10",
      icon: Settings,
    },
    {
      id: "counters",
      name: "Counters",
      path: "/counters",
      key: "F8",
      icon: Monitor,
    },
  ];

  // Filter items according to enabledMenus
  const visibleNavItems = navHierarchy
    .map((item) => {
      if (isNavGroup(item)) {
        const filteredChildren = item.children.filter((child) => enabledMenus.includes(child.id));
        if (filteredChildren.length === 0) return null;
        return {
          ...item,
          children: filteredChildren,
        };
      }
      return item.id === "migration" || enabledMenus.includes(item.id) ? item : null;
    })
    .filter((item): item is NavItemConfig => item !== null);

  // Close dropdown on outside click or scroll
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !Object.values(buttonRefs.current).some((btn) => btn?.contains(e.target as Node))
      ) {
        setOpenDropdownId(null);
      }
    };

    const handleWindowResize = () => setOpenDropdownId(null);

    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("resize", handleWindowResize);
    window.addEventListener("scroll", handleWindowResize, true);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("resize", handleWindowResize);
      window.removeEventListener("scroll", handleWindowResize, true);
    };
  }, []);

  // Close dropdown on route change
  useEffect(() => {
    setOpenDropdownId(null);
  }, [location.pathname]);

  const handleToggleDropdown = (groupId: string, btnElement: HTMLButtonElement | null) => {
    if (openDropdownId === groupId) {
      setOpenDropdownId(null);
      setFocusedChildIndex(-1);
    } else {
      if (btnElement) {
        const rect = btnElement.getBoundingClientRect();
        // Compute position clamping within screen bounds
        const left = Math.min(Math.max(12, rect.left), window.innerWidth - 320);
        setDropdownPos({
          top: rect.bottom + 4,
          left,
        });
      }
      setOpenDropdownId(groupId);
      setFocusedChildIndex(0);
    }
  };

  const currentOpenGroup = visibleNavItems.find(
    (item): item is NavGroupItem => isNavGroup(item) && item.id === openDropdownId
  );

  const handleGroupKeyDown = (e: React.KeyboardEvent, group: NavGroupItem) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const btn = buttonRefs.current[group.id];
      handleToggleDropdown(group.id, btn);
    }
  };

  const handleDropdownKeyDown = (e: React.KeyboardEvent) => {
    if (!currentOpenGroup) return;

    if (e.key === "Escape") {
      e.preventDefault();
      setOpenDropdownId(null);
      buttonRefs.current[currentOpenGroup.id]?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedChildIndex((prev) => (prev + 1) % currentOpenGroup.children.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedChildIndex((prev) => (prev - 1 + currentOpenGroup.children.length) % currentOpenGroup.children.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (focusedChildIndex >= 0 && focusedChildIndex < currentOpenGroup.children.length) {
        const target = currentOpenGroup.children[focusedChildIndex];
        navigate(target.path);
        setOpenDropdownId(null);
      }
    }
  };

  return (
    <nav
      className="flex h-11 items-center justify-between border-b border-slate-900 bg-slate-900 px-3 text-white select-none z-30"
      role="menubar"
      aria-label="Main Navigation"
    >
      {/* Left: Navigation Items */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
        {visibleNavItems.map((item) => {
          if (isNavGroup(item)) {
            const isChildActive = item.children.some((c) =>
              c.path === "/dashboard"
                ? location.pathname === "/dashboard" || location.pathname === "/"
                : location.pathname.startsWith(c.path)
            );
            const isOpen = openDropdownId === item.id;
            const Icon = item.icon;

            return (
              <div key={item.id} className="relative inline-block">
                <button
                  ref={(el) => {
                    buttonRefs.current[item.id] = el;
                  }}
                  onClick={(e) => handleToggleDropdown(item.id, e.currentTarget)}
                  onKeyDown={(e) => handleGroupKeyDown(e, item)}
                  aria-haspopup="true"
                  aria-expanded={isOpen}
                  role="menuitem"
                  className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold tracking-tight transition-all duration-150 cursor-pointer ${
                    isChildActive
                      ? "bg-blue-600 text-white shadow-xs font-bold"
                      : isOpen
                      ? "bg-slate-700 text-white"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" />
                  <span>{item.name}</span>
                  <ChevronDown
                    className={`h-3 w-3 shrink-0 text-slate-400 transition-transform duration-200 ${
                      isOpen ? "rotate-180 text-white" : ""
                    }`}
                  />
                </button>
              </div>
            );
          }

          // Direct Link Item
          const isDashboard = item.path === "/dashboard";
          const isActive = isDashboard
            ? location.pathname === "/dashboard" || location.pathname === "/"
            : location.pathname.startsWith(item.path);
          const Icon = item.icon;

          return (
            <Link
              key={item.id}
              to={item.path}
              role="menuitem"
              className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold tracking-tight transition-all duration-150 ${
                isActive
                  ? "bg-blue-600 text-white shadow-xs font-bold"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" />
              <span>{item.name}</span>
              {item.key && (
                <kbd className="ml-0.5 rounded bg-black/35 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-300 shadow-inner">
                  {item.key}
                </kbd>
              )}
            </Link>
          );
        })}
      </div>

      {/* Right: Help & Shortcuts Trigger */}
      <div className="flex items-center gap-2 pl-2">
        <button
          onClick={onOpenShortcutsHelp}
          title="View Keyboard Shortcuts & Cheatsheet"
          className="flex h-7 items-center gap-1.5 rounded bg-slate-800/80 px-2 text-[11px] font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors border border-slate-700/60"
        >
          <Keyboard className="h-3.5 w-3.5 text-slate-400" />
          <span className="hidden sm:inline">Shortcuts</span>
        </button>
      </div>

      {/* Portal Dropdown Menu */}
      {openDropdownId && currentOpenGroup && dropdownPos && (
        createPortal(
          <div
            ref={dropdownRef}
            tabIndex={0}
            onKeyDown={handleDropdownKeyDown}
            style={{
              top: `${dropdownPos.top}px`,
              left: `${dropdownPos.left}px`,
            }}
            className="fixed z-[9999] w-72 rounded-lg border border-slate-700 bg-slate-800 p-1.5 shadow-2xl ring-1 ring-black/20 outline-none animate-in fade-in zoom-in-95 duration-100"
            role="menu"
            aria-label={currentOpenGroup.name}
          >
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-700/60 mb-1">
              {currentOpenGroup.name}
            </div>
            <div className="space-y-0.5">
              {currentOpenGroup.children.map((child, idx) => {
                const isChildActive = location.pathname.startsWith(child.path);
                const isFocused = idx === focusedChildIndex;
                const ChildIcon = child.icon;

                return (
                  <Link
                    key={child.id}
                    to={child.path}
                    role="menuitem"
                    onClick={() => setOpenDropdownId(null)}
                    onMouseEnter={() => setFocusedChildIndex(idx)}
                    className={`flex items-center justify-between rounded-md px-2.5 py-2 text-xs transition-colors ${
                      isChildActive
                        ? "bg-blue-600 text-white font-medium shadow-xs"
                        : isFocused
                        ? "bg-slate-700 text-white"
                        : "text-slate-200 hover:bg-slate-700/80 hover:text-white"
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0 pr-2">
                      <ChildIcon className={`mt-0.5 h-4 w-4 shrink-0 ${isChildActive ? "text-white" : "text-blue-400"}`} />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate font-semibold text-slate-100">{child.name}</span>
                        {child.description && (
                          <span className={`text-[10px] leading-tight truncate ${isChildActive ? "text-blue-100" : "text-slate-400"}`}>
                            {child.description}
                          </span>
                        )}
                      </div>
                    </div>
                    {child.key && (
                      <kbd className="shrink-0 rounded bg-slate-900/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-300 border border-slate-700/80 shadow-xs">
                        {child.key}
                      </kbd>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>,
          document.body
        )
      )}
    </nav>
  );
};

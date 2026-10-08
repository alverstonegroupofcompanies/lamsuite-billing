import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  LayoutDashboard,
  ShoppingCart,
  Truck,
  Package,
  FileBarChart,
  Database,
  Settings,
  PlusCircle,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
  ArrowRight,
  Shield,
  FileText,
  Undo2,
  ArrowUpFromLine,
  ArrowRightLeft,
  Building2,
} from "lucide-react";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  category: "Navigation" | "Billing & POS" | "Inventory" | "Reports" | "System";
  title: string;
  subtitle: string;
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const commands: CommandItem[] = [
    {
      id: "nav_dashboard",
      category: "Navigation",
      title: "Go to Dashboard",
      subtitle: "View live sales metrics, daily collection breakdown, and store health",
      shortcut: "Home",
      icon: LayoutDashboard,
      action: () => { navigate("/dashboard"); onClose(); },
    },
    {
      id: "nav_pos",
      category: "Billing & POS",
      title: "New Retail Sale (POS)",
      subtitle: "Open keyboard-first sales counter and barcode billing",
      shortcut: "F1",
      icon: ShoppingCart,
      action: () => { navigate("/pos"); onClose(); },
    },
    {
      id: "nav_bills",
      category: "Billing & POS",
      title: "Find & Manage Past Bills",
      subtitle: "Search, reprint, edit, or cancel customer invoices",
      shortcut: "F6",
      icon: FileText,
      action: () => { navigate("/bills"); onClose(); },
    },
    {
      id: "nav_sales_returns",
      category: "Billing & POS",
      title: "Sales Returns / Credit Notes",
      subtitle: "Process customer returns, issue credit notes, restore batch stock",
      shortcut: "F7",
      icon: Undo2,
      action: () => { navigate("/returns/sales"); onClose(); },
    },
    {
      id: "nav_customer_debit_notes",
      category: "Billing & POS",
      title: "Customer Debit Notes (B2B Multi-Invoice)",
      subtitle: "Reconcile received customer debit notes, auto-match invoices, and issue GST Credit Notes",
      shortcut: "Shift+F7",
      icon: Building2,
      action: () => { navigate("/returns/debit-notes"); onClose(); },
    },
    {
      id: "nav_purchase_returns",
      category: "Navigation",
      title: "Purchase Returns / Debit Notes",
      subtitle: "Return stock to supplier, issue debit notes, reverse input GST",
      shortcut: "Shift+F2",
      icon: ArrowUpFromLine,
      action: () => { navigate("/returns/purchases"); onClose(); },
    },
    {
      id: "nav_purchases",
      category: "Navigation",
      title: "Inward Purchase Register",
      subtitle: "Record supplier inward invoices and batch stocks",
      shortcut: "F2",
      icon: Truck,
      action: () => { navigate("/purchases"); onClose(); },
    },
    {
      id: "nav_stock",
      category: "Inventory",
      title: "Stock & Inventory Ledger",
      subtitle: "Audit double-entry movement, adjustments, and expiry",
      shortcut: "F3",
      icon: Package,
      action: () => { navigate("/stock"); onClose(); },
    },
    {
      id: "nav_inter_store_transfers",
      category: "Inventory",
      title: "Inter-Store Stock Transfers",
      subtitle: "Multi-product branch dispatch, in-transit tracking, and delivery challans",
      shortcut: "Shift+F3",
      icon: ArrowRightLeft,
      action: () => { navigate("/stock/transfers"); onClose(); },
    },
    {
      id: "nav_reports",
      category: "Reports",
      title: "Statutory Reports & GSTR-1",
      subtitle: "View B2B, B2C, HSN tax summary, and daily collections",
      shortcut: "F4",
      icon: FileBarChart,
      action: () => { navigate("/reports"); onClose(); },
    },
    {
      id: "nav_masters",
      category: "Navigation",
      title: "Master Data Management",
      subtitle: "Manage products, barcodes, parties, and discount schemas",
      shortcut: "F5",
      icon: Database,
      action: () => { navigate("/masters"); onClose(); },
    },
    {
      id: "pos_columns_config",
      category: "Billing & POS",
      title: "Configure Billing Columns & Header Fields",
      subtitle: "Show/hide table columns, metadata, and adjust counter layout",
      shortcut: "Ctrl+Shift+C",
      icon: Settings,
      action: () => {
        navigate("/pos?openColumns=true");
        window.dispatchEvent(new CustomEvent("open-billing-columns-modal"));
        onClose();
      },
    },
    {
      id: "pos_preset_pharmacy",
      category: "Billing & POS",
      title: "Switch Billing Preset: Pharmacy",
      subtitle: "Show Batch, Expiry, Pack+Loose units, Doctor and Patient details",
      icon: Settings,
      action: () => {
        window.dispatchEvent(new CustomEvent("apply-billing-preset", { detail: { presetId: "pharmacy" } }));
        onClose();
      },
    },
    {
      id: "pos_preset_retail",
      category: "Billing & POS",
      title: "Switch Billing Preset: Retail",
      subtitle: "Streamlined retail layout with Product, Qty, MRP, Rate, and Discount",
      icon: Settings,
      action: () => {
        window.dispatchEvent(new CustomEvent("apply-billing-preset", { detail: { presetId: "retail" } }));
        onClose();
      },
    },
    {
      id: "pos_preset_fast_counter",
      category: "Billing & POS",
      title: "Switch Billing Preset: Fast Counter (Minimal)",
      subtitle: "Ultra-fast minimalist counter showing only Product, Qty, Rate, and Total",
      icon: Settings,
      action: () => {
        window.dispatchEvent(new CustomEvent("apply-billing-preset", { detail: { presetId: "fast_counter" } }));
        onClose();
      },
    },
    {
      id: "nav_settings",
      category: "System",
      title: "Terminal & Store Settings",
      subtitle: "Configure GSTIN, printer profiles, drug licenses, and LAN",
      shortcut: "F10",
      icon: Settings,
      action: () => { navigate("/settings"); onClose(); },
    },
    {
      id: "action_fullscreen",
      category: "System",
      title: "Toggle Full-Screen Mode",
      subtitle: "Maximize POS terminal for distraction-free billing",
      shortcut: "F11",
      icon: Maximize2,
      action: () => { toggleFullscreen(); onClose(); },
    },
  ];

  const filtered = commands.filter((cmd) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      cmd.title.toLowerCase().includes(q) ||
      cmd.subtitle.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q)
    );
  });

  const handleKeyDownInInput = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-20 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 text-white shadow-2xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100">
        {/* Search Input Bar */}
        <div className="flex items-center border-b border-slate-800 px-4 py-3">
          <Search className="h-5 w-5 text-slate-400 mr-3" />
          <input
            type="text"
            autoFocus
            placeholder="Type a command or jump to module (e.g. 'sale', 'gst', 'stock')..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDownInInput}
            className="w-full bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Command Results */}
        <div className="max-h-80 overflow-y-auto p-2 divide-y divide-slate-800/50">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              No matching commands found for "{query}"
            </div>
          ) : (
            filtered.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              const Icon = cmd.icon;
              return (
                <div
                  key={cmd.id}
                  onClick={cmd.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex cursor-pointer items-center justify-between rounded-lg p-2.5 transition-colors ${
                    isSelected ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800/70"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-md ${
                        isSelected ? "bg-white/20 text-white" : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold">{cmd.title}</div>
                      <div
                        className={`text-[11px] ${
                          isSelected ? "text-blue-100" : "text-slate-500"
                        }`}
                      >
                        {cmd.subtitle}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {cmd.shortcut && (
                      <kbd
                        className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-medium ${
                          isSelected ? "bg-white/25 text-white" : "bg-slate-800 text-slate-400 border border-slate-700"
                        }`}
                      >
                        {cmd.shortcut}
                      </kbd>
                    )}
                    <ArrowRight className={`h-3.5 w-3.5 opacity-60 ${isSelected ? "text-white" : "text-slate-500"}`} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Shortcut Helper */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/70 px-4 py-2 text-[11px] text-slate-500">
          <div className="flex gap-3">
            <span><kbd className="font-mono text-slate-400">↑↓</kbd> Navigate</span>
            <span><kbd className="font-mono text-slate-400">Enter</kbd> Select</span>
            <span><kbd className="font-mono text-slate-400">Esc</kbd> Close</span>
          </div>
          <span className="font-semibold text-slate-400">MARG Command Palette</span>
        </div>
      </div>
    </div>
  );
};

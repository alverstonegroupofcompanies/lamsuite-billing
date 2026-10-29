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
  UploadCloud,
  FileSpreadsheet,
  Layers,
} from "lucide-react";
import { reportRegistry } from "../reports/registry";
import { useModalEscape } from "../lib/ui/modalEscapeManager";
import { companySettingsService } from "../lib/settings/companySettingsService";
import { operatorAuthService } from "../lib/auth/operatorAuthService";
import { storeRegistryService } from "../lib/auth/storeRegistryService";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  category: "Navigation" | "Billing & POS" | "Inventory" | "Reports" | "System" | "Multi-Store Workspace" | "Registered Stores" | string;
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

  // Handle ESC key to close modal safely without exiting fullscreen
  useModalEscape(isOpen, onClose);

  if (!isOpen) return null;

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
          if (res && typeof res.catch === "function") res.catch(() => {});
        } catch {}
      }
    } else {
      if (typeof exitFs === "function") {
        try {
          const res = exitFs.call(doc);
          if (res && typeof res.catch === "function") res.catch(() => {});
        } catch {}
      }
    }
  };

  const userRole = operatorAuthService.getSession()?.user?.role || "admin";
  const enabledMenus = companySettingsService.getSettings()?.enabled_menu_items || ["reports"];
  const isReportsAllowed = enabledMenus.includes("reports");
  const accessibleReports = isReportsAllowed
    ? reportRegistry.getAccessibleReports(userRole, enabledMenus)
    : [];

  const registeredStores = storeRegistryService.getStores();
  const activeStoreId = storeRegistryService.getActiveStore()?.id;

  const commands: CommandItem[] = [
    {
      id: "action_switch_store_dialog",
      category: "Multi-Store Workspace",
      title: "Switch Company / Store...",
      subtitle: "Open Tally-style company switcher to select another store or branch",
      shortcut: "Alt+S",
      icon: Building2,
      action: () => {
        onClose();
        // Trigger key event for Alt+S to open modal
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", altKey: true }));
      },
    },
    ...registeredStores.map((s) => ({
      id: `switch_store_${s.id}`,
      category: "Registered Stores",
      title: `Switch to: ${s.alias || s.name}`,
      subtitle: `${s.code} • ${s.counter_name}${s.id === activeStoreId ? " (Currently Active)" : ""}`,
      shortcut: s.id === activeStoreId ? "Active" : "Alt+S",
      icon: Building2,
      action: async () => {
        onClose();
        if (s.id !== activeStoreId) {
          try {
            await storeRegistryService.switchActiveStore(s.id);
            window.location.reload();
          } catch (e: any) {
            alert(e?.message || "Failed to switch store");
          }
        }
      },
    })),
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
    ...(isReportsAllowed
      ? [
          {
            id: "nav_reports",
            category: "Reports" as const,
            title: "Statutory Reports & GSTR-1 Hub",
            subtitle: "Browse all accessible financial, GST, and stock reports",
            shortcut: "F4",
            icon: FileBarChart,
            action: () => { navigate("/reports"); onClose(); },
          },
          ...accessibleReports.map((r) => ({
            id: `nav_rep_${r.id}`,
            category: "Reports" as const,
            title: r.title,
            subtitle: r.description,
            icon: FileBarChart,
            action: () => { navigate(`/reports?report=${r.id}`); onClose(); },
          })),
        ]
      : []),
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
      id: "nav_import_export",
      category: "Navigation",
      title: "Universal Import & Export Hub",
      subtitle: "Pluggable Excel/CSV data exchange, templates, and full store backup",
      shortcut: "F9",
      icon: Layers,
      action: () => { navigate("/import-export"); onClose(); },
    },
    {
      id: "nav_counters",
      category: "Navigation",
      title: "Store Counters & Fleet Topology",
      subtitle: "Monitor active cash counters, shifts, drawer balances, and failover status",
      shortcut: "F8",
      icon: Settings,
      action: () => { navigate("/counters"); onClose(); },
    },
    {
      id: "action_import_wizard_items",
      category: "Navigation",
      title: "Import Wizard: Products & Items",
      subtitle: "Upload Excel/CSV product catalog with Marg/Busy/Tally column auto-mapping",
      icon: UploadCloud,
      action: () => { navigate("/import-export?type=items"); onClose(); },
    },
    {
      id: "action_import_wizard_batches",
      category: "Navigation",
      title: "Import Wizard: Batches & Opening Stock",
      subtitle: "Upload batch numbers, expiry dates, and opening inventory balances",
      icon: UploadCloud,
      action: () => { navigate("/import-export?type=batches"); onClose(); },
    },
    {
      id: "action_import_wizard_parties",
      category: "Navigation",
      title: "Import Wizard: Customers & Suppliers",
      subtitle: "Bulk upload parties with GSTIN validation and contact details",
      icon: UploadCloud,
      action: () => { navigate("/import-export?type=customers"); onClose(); },
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
      subtitle: "Configure GSTIN, printer profiles, drug licenses, and logged-in devices",
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-20 p-4">
      <div className="w-full max-w-xl rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-modal overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100">
        {/* Search Input Bar */}
        <div className="flex items-center border-b border-[var(--color-border)] px-4 py-3 bg-[var(--color-surface)]">
          <Search className="h-5 w-5 text-[var(--color-text-faint)] mr-3" />
          <input
            type="text"
            autoFocus
            placeholder="Type a command or jump to module (e.g. 'sale', 'gst', 'stock')..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDownInInput}
            className="w-full bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none"
          />
          <button
            onClick={onClose}
            className="rounded-[8px] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Command Results */}
        <div className="max-h-80 overflow-y-auto p-2 divide-y divide-[var(--color-border-subtle)]">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--color-text-muted)]">
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
                  className={`flex cursor-pointer items-center justify-between rounded-[10px] p-2.5 transition-colors ${
                    isSelected ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-[8px] ${
                        isSelected ? "bg-white/20 text-white" : "bg-[var(--color-surface-subtle)] text-[var(--color-accent)]"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold">{cmd.title}</div>
                      <div
                        className={`text-[11px] ${
                          isSelected ? "text-white/80" : "text-[var(--color-text-muted)]"
                        }`}
                      >
                        {cmd.subtitle}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {cmd.shortcut && (
                      <kbd
                        className={`rounded-[6px] px-1.5 py-0.5 text-[10px] font-mono font-medium ${
                          isSelected ? "bg-white/25 text-white" : "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
                        }`}
                      >
                        {cmd.shortcut}
                      </kbd>
                    )}
                    <ArrowRight className={`h-3.5 w-3.5 opacity-60 ${isSelected ? "text-white" : "text-[var(--color-text-muted)]"}`} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Shortcut Helper */}
        <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-2 text-[11px] text-[var(--color-text-muted)]">
          <div className="flex gap-3">
            <span><kbd className="font-mono text-[var(--color-text)]">↑↓</kbd> Navigate</span>
            <span><kbd className="font-mono text-[var(--color-text)]">Enter</kbd> Select</span>
            <span><kbd className="font-mono text-[var(--color-text)]">Esc</kbd> Close</span>
          </div>
          <span className="font-semibold text-[var(--color-text-muted)]">LamSuite Quick Jump</span>
        </div>
      </div>
    </div>
  );
};

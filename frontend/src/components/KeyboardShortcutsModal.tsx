import React from "react";
import { X, Keyboard, Command } from "lucide-react";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  category: string;
  shortcuts: { key: string; description: string }[];
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ isOpen, onClose }) => {
  useModalEscape(isOpen, onClose);

  if (!isOpen) return null;

  const shortcutGroups: ShortcutGroup[] = [
    {
      category: "Purchase Inward & Goods Receipt",
      shortcuts: [
        { key: "Alt+S / B / D / T", description: "Jump to Supplier / Bill No / Date / Purchase Type" },
        { key: "F1 or /", description: "Jump to Product Entry Row (permanent + row)" },
        { key: "MMYY / MM/YY", description: "Expiry date mask with auto-validation" },
        { key: "2+5 or 10+2", description: "Quantity shorthand (Pack + Loose or Pack + Free)" },
        { key: "Ctrl+N", description: "Quick Add New Product inline in popover" },
        { key: "Ctrl+Shift+N", description: "Start a New Purchase Bill" },
        { key: "Alt+F / Alt+I / Alt+R", description: "Freight / Supplier Bill Total / Round-Off" },
        { key: "F6 / F8 / F9", description: "Find Bill / Save Draft / Recall Draft" },
        { key: "Ctrl+Shift+C", description: "Configure Inward Grid Columns & Presets" },
        { key: "F12 / Shift+F12", description: "Post Purchase Bill / Post & Print Labels" },
      ],
    },
    {
      category: "POS Counter & Billing",
      shortcuts: [
        { key: "F1 or /", description: "Focus Product Entry Row / Barcode" },
        { key: "3*<name/code>", description: "Quantity prefix multiplier (e.g. 3*Paracetamol)" },
        { key: "F12 or Ctrl+Enter", description: "Open Settlement / Checkout" },
        { key: "Ctrl+F2 or Shift+F2", description: "Overall Bill Discount (% or ₹)" },
        { key: "Alt+R", description: "Edit Round-Off / Net Payable Amount" },
        { key: "Alt+C / M / D / P", description: "Focus Customer / Mobile / Doctor / Patient" },
        { key: "F6 / F8 / F9", description: "Past Bills / Hold Bill / Recall Bill" },
        { key: "Ctrl+N / Ctrl+Bksp", description: "New Bill / Clear Current Cart" },
        { key: "Ctrl+Shift+C", description: "Configure Visible Columns & Layout" },
      ],
    },
    {
      category: "Cart Grid & Line Actions",
      shortcuts: [
        { key: "↑ (from entry row)", description: "Jump to last cart line" },
        { key: "↓ (from last line)", description: "Return to product entry row" },
        { key: "↑ / ↓", description: "Navigate between items in grid" },
        { key: "Tab or +", description: "Jump between Pack & Loose quantity" },
        { key: "Enter (in Qty)", description: "Confirm line & focus entry row for next item" },
        { key: "Esc (in Qty)", description: "Remove freshly added line & return to entry row" },
        { key: "F2", description: "Quick Edit Item Discount (% or ₹)" },
        { key: "F3", description: "Quick Edit Selling Price" },
        { key: "F4 or Ctrl+M", description: "Quick Edit Product Name, Batch, Expiry & Tax" },
        { key: "Ctrl+B / Ctrl+U", description: "Change Batch / Toggle Unit Rate" },
        { key: "Ctrl+E", description: "Edit Packaging & Unit Conversion" },
        { key: "Delete or Ctrl+D", description: "Delete selected line (Ctrl+Z to Undo)" },
        { key: "Alt+↑ / Alt+↓", description: "Move line Up / Down" },
      ],
    },
    {
      category: "Navigation & Global",
      shortcuts: [
        { key: "Alt + S / Alt + F3", description: "Switch Company / Store (Instant Tally Switch)" },
        { key: "Home or Ctrl+D", description: "Go to Dashboard" },
        { key: "Ctrl + K", description: "Open Command Palette / Fast Search" },
        { key: "F2 / Shift+F2", description: "Purchase Register / Purchase Returns" },
        { key: "F3 / Shift+F3", description: "Stock Ledger / Inter-Store Transfers" },
        { key: "F4 / F5", description: "Reports & GST Hub / Master Data" },
        { key: "F8 / F9 / F10", description: "Store Counters / Import-Export Hub / Settings" },
        { key: "?", description: "Open Keyboard Shortcuts Help" },
        { key: "Esc", description: "Cancel / Close modal or dropdown" },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4 select-none font-sans">
      <div className="flex w-full max-w-2xl flex-col rounded-card border border-border-main bg-surface text-text-main shadow-modal overflow-hidden animate-in fade-in duration-100">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border-main px-6 py-4 bg-canvas">
          <div className="flex items-center gap-2.5">
            <div className="rounded-btn bg-accent-soft p-2 text-accent">
              <Keyboard className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-main">Keyboard Shortcuts & Cheatsheet</h2>
              <p className="text-xs text-text-muted">Keyboard-first workflow for rapid retail counter billing</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-btn p-1.5 text-text-muted hover:bg-canvas hover:text-text-main transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6 max-h-[70vh] overflow-y-auto">
          {shortcutGroups.map((group) => (
            <div key={group.category} className="space-y-2 rounded-card border border-border-main bg-canvas p-3.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-accent border-b border-border-main pb-1.5">
                {group.category}
              </h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((s) => (
                  <div key={s.key} className="flex items-center justify-between text-xs py-0.5">
                    <span className="text-text-main pr-2">{s.description}</span>
                    <kbd className="shrink-0 rounded-md bg-surface px-2 py-0.5 font-mono text-[11px] font-semibold text-text-main border border-border-main shadow-xs">
                      {s.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-border-main bg-canvas px-6 py-3 text-xs text-text-muted">
          <div className="flex items-center gap-1.5">
            <Command className="h-3.5 w-3.5 text-text-muted" />
            <span>Press <strong className="text-text-main font-mono">Esc</strong> to exit anytime</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-btn bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

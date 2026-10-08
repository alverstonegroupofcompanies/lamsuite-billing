import React, { useEffect } from "react";
import { X, Keyboard, Command } from "lucide-react";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  category: string;
  shortcuts: { key: string; description: string }[];
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const shortcutGroups: ShortcutGroup[] = [
    {
      category: "POS Counter & Billing",
      shortcuts: [
        { key: "F1 or /", description: "Focus Product Search / Barcode" },
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
        { key: "Ctrl+↓ or ↓ (empty search)", description: "Enter Cart Grid Navigation" },
        { key: "↑ / ↓", description: "Navigate between items in grid" },
        { key: "Tab or +", description: "Jump between Pack & Loose quantity" },
        { key: "Enter (in Qty)", description: "Confirm line & jump back to Search" },
        { key: "F2", description: "Quick Edit Item Discount (% or ₹)" },
        { key: "F3", description: "Quick Edit Selling Price" },
        { key: "Ctrl+B / Ctrl+U", description: "Change Batch / Toggle Unit Rate" },
        { key: "Ctrl+E", description: "Edit Packaging & Unit Conversion" },
        { key: "Delete or Ctrl+D", description: "Delete selected line (Ctrl+Z to Undo)" },
        { key: "Alt+↑ / Alt+↓", description: "Move line Up / Down" },
      ],
    },
    {
      category: "Navigation & Global",
      shortcuts: [
        { key: "Home or Ctrl+D", description: "Go to Dashboard" },
        { key: "Ctrl + K", description: "Open Command Palette / Fast Search" },
        { key: "F2 / Shift+F2", description: "Purchase Register / Purchase Returns" },
        { key: "F3 / Shift+F3", description: "Stock Ledger / Inter-Store Transfers" },
        { key: "F4 / F5 / F10", description: "Reports / Masters / Settings" },
        { key: "?", description: "Open Keyboard Shortcuts Help" },
        { key: "Esc", description: "Cancel / Close modal or dropdown" },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs select-none">
      <div className="flex w-full max-w-2xl flex-col rounded-xl border border-slate-700 bg-slate-900 text-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-blue-500/20 p-2 text-blue-400">
              <Keyboard className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Keyboard Shortcuts & Cheatsheet</h2>
              <p className="text-xs text-slate-400">Keyboard-first workflow for rapid retail counter billing</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6 max-h-[70vh] overflow-y-auto">
          {shortcutGroups.map((group) => (
            <div key={group.category} className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-blue-400 border-b border-slate-800/80 pb-1.5">
                {group.category}
              </h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((s) => (
                  <div key={s.key} className="flex items-center justify-between text-xs py-0.5">
                    <span className="text-slate-300 pr-2">{s.description}</span>
                    <kbd className="shrink-0 rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-200 border border-slate-700 shadow-xs">
                      {s.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-6 py-3 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <Command className="h-3.5 w-3.5 text-slate-500" />
            <span>Press <strong className="text-slate-300">Esc</strong> to exit anytime</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

import React from "react";
import { X, Keyboard, Command } from "lucide-react";
import { APP_FULL_VERSION } from "../config/version";
import { useModalEscape } from "../lib/ui/modalEscapeManager";
import { formatChord, shortcutsForScope } from "../lib/keyboard/centralKeyMap";

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

  const toShortcuts = (scope: Parameters<typeof shortcutsForScope>[0]) =>
    shortcutsForScope(scope).map((s) => ({
      key: s.keys.map(formatChord).join(" / "),
      description: s.label,
    }));

  const shortcutGroups: ShortcutGroup[] = [
    { category: "POS Counter & Billing", shortcuts: toShortcuts("pos") },
    { category: "Bills Register", shortcuts: toShortcuts("bills") },
    { category: "Invoice Edit", shortcuts: toShortcuts("edit") },
    { category: "Purchase Inward & Goods Receipt", shortcuts: toShortcuts("purchase") },
    { category: "Sales Returns & Credit Notes", shortcuts: toShortcuts("salesReturns") },
    { category: "Supplier Bill Charges (Alt+F)", shortcuts: toShortcuts("modal") },
    { category: "Stock Adjustment", shortcuts: toShortcuts("stock") },
    { category: "Navigation & Global", shortcuts: toShortcuts("global") },
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
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Command className="h-3.5 w-3.5 text-text-muted" />
              <span>Press <strong className="text-text-main font-mono">Esc</strong> to exit anytime</span>
            </div>
            <span className="font-mono text-[10px] text-text-muted/60">
              LamSuite Billing {APP_FULL_VERSION}
            </span>
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

import React from "react";
import { Keyboard, HelpCircle } from "lucide-react";

export type PosFocusContext = "search" | "grid" | "cell_edit" | "modal";

interface PosShortcutHintBarProps {
  context: PosFocusContext;
  onOpenShortcutsModal: () => void;
  onFocusSearch?: () => void;
  onCheckout?: () => void;
  onHold?: () => void;
  onRecall?: () => void;
  onNewBill?: () => void;
  onColumnsConfig?: () => void;
  className?: string;
}

interface Hint {
  key: string;
  label: string;
  onClick?: () => void;
  highlight?: boolean;
}

export const PosShortcutHintBar: React.FC<PosShortcutHintBarProps> = ({
  context,
  onOpenShortcutsModal,
  onFocusSearch,
  onCheckout,
  onHold,
  onRecall,
  onNewBill,
  onColumnsConfig,
  className = "",
}) => {
  let hints: Hint[] = [];

  switch (context) {
    case "search":
      hints = [
        { key: "Enter", label: "Select / Add Product" },
        { key: "↓", label: "Go to Grid" },
        { key: "Alt+C", label: "Customer" },
        { key: "Ctrl+F2", label: "Bill Disc" },
        { key: "Alt+R", label: "Round-off" },
        { key: "F12", label: "Checkout", highlight: true, onClick: onCheckout },
        { key: "F8", label: "Hold Bill", onClick: onHold },
        { key: "F9", label: "Recall", onClick: onRecall },
        { key: "Ctrl+N", label: "New Bill", onClick: onNewBill },
        { key: "Ctrl+Shift+C", label: "Columns", onClick: onColumnsConfig },
      ];
      break;

    case "grid":
      hints = [
        { key: "↑ / ↓", label: "Select Row" },
        { key: "Enter", label: "Edit Qty" },
        { key: "F2", label: "Item Disc" },
        { key: "Ctrl+F2", label: "Bill Disc" },
        { key: "Alt+R", label: "Round-off" },
        { key: "Del / Ctrl+D", label: "Delete Line" },
        { key: "Ctrl+Z", label: "Undo Delete" },
        { key: "Ctrl+B", label: "Batch" },
        { key: "Ctrl+U", label: "Toggle Rate" },
        { key: "F3", label: "Price" },
        { key: "Ctrl+E", label: "Packaging" },
        { key: "Alt+↑/↓", label: "Reorder" },
        { key: "F1", label: "Back to Search", onClick: onFocusSearch },
        { key: "F12", label: "Checkout", highlight: true, onClick: onCheckout },
      ];
      break;

    case "cell_edit":
      hints = [
        { key: "Enter", label: "Confirm & Next Item" },
        { key: "Tab / +", label: "Loose Qty" },
        { key: "Esc", label: "Cancel Edit" },
        { key: "↑ / ↓", label: "Adjust Step" },
        { key: "F12", label: "Quick Checkout", highlight: true, onClick: onCheckout },
      ];
      break;

    case "modal":
      hints = [
        { key: "1 - 5", label: "Pick Pay Mode (1=Cash, 2=UPI, 3=Card, 4=Credit, 5=Split)" },
        { key: "Enter", label: "Confirm & Print", highlight: true },
        { key: "Esc", label: "Close / Cancel" },
      ];
      break;
  }

  return (
    <div
      className={`flex items-center justify-between gap-2 border-t border-slate-200/80 bg-slate-900 text-slate-200 px-3 py-1.5 text-xs select-none shadow-inner ${className}`}
      role="region"
      aria-label="Keyboard Shortcuts Bar"
    >
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1.5 shrink-0">
          <Keyboard className="h-3.5 w-3.5 text-blue-400" />
          <span className="hidden sm:inline">Keys:</span>
        </div>

        {hints.map((hint, idx) => (
          <button
            key={idx}
            type="button"
            tabIndex={-1}
            onClick={hint.onClick}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap transition-colors shrink-0 ${
              hint.highlight
                ? "bg-blue-600 text-white font-bold hover:bg-blue-500 shadow-2xs"
                : hint.onClick
                ? "bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-700/60"
                : "bg-slate-800/80 text-slate-300 border border-slate-700/40"
            }`}
          >
            <kbd className={`font-mono text-[10px] font-bold px-1 py-0.2 rounded shadow-2xs ${
              hint.highlight ? "bg-blue-700 text-white" : "bg-slate-950 text-amber-400"
            }`}>
              {hint.key}
            </kbd>
            <span>{hint.label}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        tabIndex={-1}
        onClick={onOpenShortcutsModal}
        className="flex items-center gap-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2 py-0.5 text-[11px] font-bold text-slate-300 hover:text-white shrink-0 transition-colors cursor-pointer"
        title="View All Keyboard Shortcuts (?)"
      >
        <HelpCircle className="h-3.5 w-3.5 text-amber-400" />
        <span className="hidden md:inline">Shortcuts</span>
        <kbd className="font-mono text-[10px] bg-slate-950 text-amber-400 px-1 py-0.2 rounded font-bold">?</kbd>
      </button>
    </div>
  );
};

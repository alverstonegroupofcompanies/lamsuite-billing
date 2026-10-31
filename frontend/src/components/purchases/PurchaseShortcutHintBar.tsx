import React from "react";
import { Keyboard, HelpCircle } from "lucide-react";

export type PurchaseFocusContext = "header" | "entry_row" | "grid" | "modal";

interface PurchaseShortcutHintBarProps {
  context: PurchaseFocusContext;
  onOpenShortcutsModal: () => void;
  onFocusEntryRow?: () => void;
  onPost?: () => void;
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

export const PurchaseShortcutHintBar: React.FC<PurchaseShortcutHintBarProps> = ({
  context,
  onOpenShortcutsModal,
  onFocusEntryRow,
  onPost,
  onHold,
  onRecall,
  onNewBill,
  onColumnsConfig,
  className = "",
}) => {
  let hints: Hint[] = [];

  switch (context) {
    case "header":
      hints = [
        { key: "Enter", label: "Next Field / Grid" },
        { key: "Alt+S", label: "Supplier" },
        { key: "Alt+B", label: "Bill No" },
        { key: "Alt+D", label: "Date" },
        { key: "Alt+T", label: "Type (Cash/Credit)" },
        { key: "F1", label: "Entry Row", onClick: onFocusEntryRow },
        { key: "Ctrl+Shift+C", label: "Columns", onClick: onColumnsConfig },
        { key: "F6", label: "Find Bill" },
        { key: "F8", label: "Save Draft", onClick: onHold },
        { key: "F9", label: "Recall Draft", onClick: onRecall },
        { key: "F12", label: "Post Purchase", highlight: true, onClick: onPost },
      ];
      break;

    case "entry_row":
      hints = [
        { key: "F1", label: "Product Entry", onClick: onFocusEntryRow },
        { key: "Enter", label: "Next Field / Confirm" },
        { key: "MMYY", label: "Expiry Mask" },
        { key: "2+5 / 10+2", label: "Loose / Free Qty" },
        { key: "Ctrl+N", label: "New Product" },
        { key: "Esc", label: "Clear Draft" },
        { key: "↑", label: "Grid Lines" },
        { key: "Alt+F", label: "Freight" },
        { key: "Alt+I", label: "Vendor Total" },
        { key: "Alt+R", label: "Round-off" },
        { key: "F12", label: "Post Purchase", highlight: true, onClick: onPost },
      ];
      break;

    case "grid":
      hints = [
        { key: "↑ / ↓", label: "Select Line" },
        { key: "↓ (last)", label: "Entry Row" },
        { key: "Enter", label: "Edit Cell" },
        { key: "Del / Ctrl+D", label: "Delete Line" },
        { key: "Ctrl+Z", label: "Undo Delete" },
        { key: "Ctrl+B", label: "Batch" },
        { key: "Ctrl+U", label: "Pack / Unit" },
        { key: "F4", label: "Packaging" },
        { key: "Ctrl+F2", label: "Bill Disc" },
        { key: "Alt+R", label: "Round-off" },
        { key: "F1", label: "Entry Row", onClick: onFocusEntryRow },
        { key: "F12", label: "Post Purchase", highlight: true, onClick: onPost },
      ];
      break;

    case "modal":
      hints = [
        { key: "Enter", label: "Confirm / Post", highlight: true },
        { key: "Esc", label: "Cancel / Close" },
      ];
      break;
  }

  return (
    <div
      className={`flex items-center justify-between gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] px-3 py-1.5 text-xs select-none shadow-2xs ${className}`}
      role="region"
      aria-label="Keyboard Shortcuts Bar"
    >
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
        <Keyboard className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0 mr-1 hidden sm:inline" />
        {hints.map((hint, idx) => (
          <button
            key={idx}
            type="button"
            tabIndex={-1}
            onClick={hint.onClick}
            disabled={!hint.onClick}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-[6px] px-2 py-0.5 text-[11px] font-medium transition-colors ${
              hint.highlight
                ? "bg-[var(--color-accent)] font-bold text-white shadow-2xs hover:bg-[var(--color-accent-hover)] cursor-pointer"
                : hint.onClick
                ? "bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
                : "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] cursor-default"
            }`}
          >
            <kbd className={`font-mono text-[10px] font-bold ${hint.highlight ? "text-white" : "text-[var(--color-accent)]"}`}>
              {hint.key}
            </kbd>
            <span>{hint.label}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          tabIndex={-1}
          onClick={onOpenShortcutsModal}
          className="inline-flex items-center gap-1 rounded-[6px] bg-[var(--color-surface-subtle)] border border-[var(--color-border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
          title="Open Complete Keyboard Shortcuts Reference (?)"
        >
          <HelpCircle className="h-3.5 w-3.5 text-[var(--color-accent)]" />
          <span className="hidden sm:inline">Shortcuts</span>
          <kbd className="font-mono text-[10px] font-bold text-[var(--color-accent)]">?</kbd>
        </button>
      </div>
    </div>
  );
};

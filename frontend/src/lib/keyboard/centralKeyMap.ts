// Centralized keyboard shortcut map for the LamSuite Billing app
// All shortcuts are defined in one place so they can be displayed in the hint bar,
// the shortcuts panel, and used for conflict detection.

export type ShortcutTarget =
  | 'hold'
  | 'recall'
  | 'batchEdit'
  | 'discount'
  | 'focusCustomer'
  | 'focusPatient'
  | 'newBill'
  | 'checkout'
  | 'columns'
  | 'quantityEdit'
  | 'gridNavigation'
  | 'modalClose'
  | 'periodNext'
  | 'periodPrev'
  | 'filterPayment'
  | 'filterStatus'
  | 'cancelEdit';

export interface ShortcutDefinition {
  key: string; // e.g. "Alt+H", "F8", "Ctrl+N"
  label: string; // description shown to user
  action: ShortcutTarget;
  // optional scoping – if defined, shortcut only active on these routes/pages
  scope?: string[]; // e.g. ['/pos']
}

// Helper to detect duplicate keys (returns list of colliding definitions)
export function findConflicts(map: ShortcutDefinition[]): ShortcutDefinition[][] {
  const groups: Record<string, ShortcutDefinition[]> = {};
  for (const def of map) {
    groups[def.key] = groups[def.key] ?? [];
    groups[def.key].push(def);
  }
  return Object.values(groups).filter((arr) => arr.length > 1);
}

export const centralKeyMap: ShortcutDefinition[] = [
  // POS Billing shortcuts
  { key: 'Alt+H', label: 'Hold Bill', action: 'hold' },
  { key: 'Alt+L', label: 'Recall Draft', action: 'recall' },
  { key: 'Alt+E', label: 'Batch / Expiry', action: 'batchEdit' },
  { key: 'Alt+%', label: 'Line Discount', action: 'discount' },
  { key: 'Alt+C', label: 'Customer', action: 'focusCustomer' },
  { key: 'Alt+P', label: 'Patient (pharmacy)', action: 'focusPatient', scope: ['/pos'] },
  { key: 'Ctrl+N', label: 'New Bill', action: 'newBill' },
  { key: 'F12', label: 'Checkout', action: 'checkout' },
  { key: 'Ctrl+Shift+C', label: 'Columns', action: 'columns' },
  // Global navigation shortcuts
  { key: 'Alt+Right', label: 'Next Period', action: 'periodNext' },
  { key: 'Alt+Left', label: 'Previous Period', action: 'periodPrev' },
  // Use Shift+Alt+P for payment filter to avoid conflict with patient focus
  { key: 'Alt+Shift+P', label: 'Cycle Payment Filter', action: 'filterPayment' },
  { key: 'Alt+S', label: 'Cycle Status Filter', action: 'filterStatus' },
  // Modal / generic shortcuts
  { key: 'Esc', label: 'Close Modal / Cancel Edit', action: 'modalClose' },
  { key: 'Ctrl+Q', label: 'Cancel Edit (Invoice)', action: 'cancelEdit' },
];

// Single source of truth for every keyboard shortcut in LamSuite Billing.
// The hint strip, Shortcuts panel, button labels and QA checks all read this map.
// Screen scopes always win over the global scope; same-scope duplicates are errors.

export type ShortcutScope =
  | "global"
  | "pos"
  | "bills"
  | "purchase"
  | "salesReturns"
  | "stock"
  | "edit"
  | "modal"
  | "preview"
  | "login";

export type ShortcutAction =
  // global
  | "switchStore"
  | "lockTerminal"
  | "commandPalette"
  | "navPos"
  | "navPurchases"
  | "navPurchaseReturns"
  | "navStock"
  | "navTransfers"
  | "navReports"
  | "navMasters"
  | "navBills"
  | "navSalesReturns"
  | "navDebitNotes"
  | "navCounters"
  | "navImportExport"
  | "navSettings"
  | "toggleFullscreen"
  | "navDashboard"
  | "openHelp"
  // POS
  | "holdBill"
  | "recallBill"
  | "newBill"
  | "checkout"
  | "columns"
  | "focusCustomer"
  | "focusSalesperson"
  | "focusMobile"
  | "focusDoctor"
  | "focusPatient"
  | "billDiscount"
  | "lineDiscount"
  | "roundOff"
  | "batchEdit"
  | "rateEdit"
  | "clearCart"
  | "deleteLine"
  | "undo"
  | "moveLineUp"
  | "moveLineDown"
  | "batchPicker"
  | "toggleUnitRate"
  | "packaging"
  | "focusEntry"
  // bills
  | "periodNext"
  | "periodPrev"
  | "filterPayment"
  | "filterStatus"
  // edit mode
  | "cancelEdit"
  // purchase
  | "purchaseFocusEntry"
  | "focusSupplier"
  | "focusBillNo"
  | "focusBillDate"
  | "focusPurchaseType"
  | "toggleCharges"
  | "focusBillTotal"
  | "purchaseRoundOff"
  | "toggleDiscountType"
  | "quickAddProduct"
  | "newPurchase"
  | "findPurchase"
  | "saveDraft"
  | "recallDraft"
  | "postPurchase"
  | "postPurchasePrint"
  // sales returns
  | "newSalesReturn"
  // stock
  | "newStockAdjustment"
  | "addAdjustmentLine"
  | "removeAdjustmentLine"
  | "toggleAdjustmentMode"
  | "postStockAdjustment"
  | "importAdjustmentCsv"
  | "undoAdjustmentDelete"
  // generic
  | "modalClose"
  // Alt+F charges grid (PUR-007)
  | "chargeAddRow"
  | "chargeDeleteRow"
  | "chargeUndoDelete"
  | "chargeMoveUp"
  | "chargeMoveDown"
  | "chargeMoveLeft"
  | "chargeMoveRight"
  | "chargeCycleCell"
  | "chargeEditCell"
  | "chargeApply";

export interface ShortcutDefinition {
  action: ShortcutAction;
  keys: string[];
  label: string;
  scope: ShortcutScope;
  /** Hint strip group this belongs to. */
  group?: string;
  /** Hidden shortcuts stay functional but are not advertised. */
  hidden?: boolean;
}

const def = (
  action: ShortcutAction,
  keys: string[],
  label: string,
  scope: ShortcutScope,
  group?: string,
  hidden?: boolean
): ShortcutDefinition => ({ action, keys, label, scope, group, hidden });

export const centralKeyMap: ShortcutDefinition[] = [
  // --- Global -------------------------------------------------------------
  def("switchStore", ["Ctrl+Alt+S"], "Switch Store", "global", "Global"),
  def("lockTerminal", ["Ctrl+L"], "Lock Terminal", "global", "Global"),
  def("commandPalette", ["Ctrl+K"], "Command Palette", "global", "Global"),
  def("navPos", ["F1"], "POS Billing", "global", "Navigation"),
  def("navPurchases", ["F2"], "Purchases", "global", "Navigation"),
  def("navPurchaseReturns", ["Shift+F2"], "Purchase Returns", "global", "Navigation"),
  def("navStock", ["F3"], "Stock Ledger", "global", "Navigation"),
  def("navTransfers", ["Shift+F3"], "Inter-Store Transfers", "global", "Navigation"),
  def("navReports", ["F4"], "Reports & GST", "global", "Navigation"),
  def("navMasters", ["F5"], "Masters", "global", "Navigation"),
  def("navBills", ["F6"], "Past Bills", "global", "Navigation"),
  def("navSalesReturns", ["F7"], "Sales Returns", "global", "Navigation"),
  def("navDebitNotes", ["Shift+F7"], "Customer Debit Notes", "global", "Navigation"),
  def("navCounters", ["F8"], "Store Counters", "global", "Navigation"),
  def("navImportExport", ["F9"], "Import / Export", "global", "Navigation"),
  def("navSettings", ["F10"], "Settings", "global", "Navigation"),
  def("toggleFullscreen", ["F11"], "Toggle Fullscreen", "global", "Navigation"),
  def("navDashboard", ["Home"], "Dashboard", "global", "Navigation"),
  def("openHelp", ["Shift+/"], "Keyboard Shortcuts", "global", "Navigation"),

  // --- POS ----------------------------------------------------------------
  def("holdBill", ["Alt+H"], "Hold Bill", "pos", "Billing"),
  def("recallBill", ["Alt+L"], "Recall Held Bill", "pos", "Billing"),
  def("newBill", ["Ctrl+N"], "New Bill", "pos", "Billing"),
  def("checkout", ["F12"], "Checkout / Settle", "pos", "Billing"),
  def("columns", ["Ctrl+Shift+C"], "Columns & Layout", "pos", "Billing"),
  def("focusEntry", ["F1"], "Product Entry Row", "pos", "Billing"),
  def("focusCustomer", ["Alt+C"], "Customer", "pos", "Billing"),
  def("focusSalesperson", ["Alt+S"], "Salesperson", "pos", "Billing"),
  def("focusMobile", ["Alt+M"], "Customer Mobile", "pos", "Billing"),
  def("focusDoctor", ["Alt+D"], "Doctor (pharmacy)", "pos", "Billing"),
  def("focusPatient", ["Alt+P"], "Patient (pharmacy)", "pos", "Billing"),
  def("billDiscount", ["Alt+F2"], "Bill Discount", "pos", "Billing"),
  def("lineDiscount", ["Alt+I"], "Line Discount", "pos", "Billing"),
  def("roundOff", ["Alt+R"], "Round-Off", "pos", "Billing"),
  def("batchEdit", ["Alt+E"], "Batch / Expiry", "pos", "Billing"),
  def("rateEdit", ["F3"], "Selling Price", "pos", "Billing"),
  def("clearCart", ["Ctrl+Bksp"], "Clear Cart", "pos", "Billing"),
  def("deleteLine", ["Delete", "Ctrl+D"], "Delete Line", "pos", "Grid"),
  def("undo", ["Ctrl+Z"], "Undo Delete", "pos", "Grid"),
  def("moveLineUp", ["Alt+Up"], "Move Line Up", "pos", "Grid"),
  def("moveLineDown", ["Alt+Down"], "Move Line Down", "pos", "Grid"),
  def("batchPicker", ["Ctrl+B"], "Pick Batch", "pos", "Grid"),
  def("toggleUnitRate", ["Ctrl+U"], "Toggle Unit Rate", "pos", "Grid"),
  def("packaging", ["Ctrl+E"], "Packaging / Unit Conversion", "pos", "Grid"),

  // --- Bills --------------------------------------------------------------
  def("periodNext", ["Alt+Right"], "Next Period", "bills", "Bills"),
  def("periodPrev", ["Alt+Left"], "Previous Period", "bills", "Bills"),
  def("filterPayment", ["Alt+Shift+P"], "Cycle Payment Filter", "bills", "Bills"),
  def("filterStatus", ["Alt+S"], "Cycle Status Filter", "bills", "Bills"),

  // --- Invoice edit -------------------------------------------------------
  def("cancelEdit", ["Ctrl+Q"], "Cancel Invoice Edit", "edit", "Edit"),

  // --- Purchase -----------------------------------------------------------
  def("purchaseFocusEntry", ["F1"], "Entry Row", "purchase", "Purchase"),
  def("focusSupplier", ["Alt+S"], "Supplier", "purchase", "Purchase"),
  def("focusBillNo", ["Alt+B"], "Bill No", "purchase", "Purchase"),
  def("focusBillDate", ["Alt+D"], "Bill Date", "purchase", "Purchase"),
  def("focusPurchaseType", ["Alt+T"], "Purchase Type", "purchase", "Purchase"),
  def("toggleCharges", ["Alt+F"], "Bill Charges", "purchase", "Purchase"),
  def("focusBillTotal", ["Alt+I"], "Supplier Bill Total", "purchase", "Purchase"),
  def("purchaseRoundOff", ["Alt+R"], "Round-Off", "purchase", "Purchase"),
  def("toggleDiscountType", ["Alt+Y"], "Toggle Discount % / Amount", "purchase", "Purchase"),
  def("quickAddProduct", ["Ctrl+N"], "Quick Add Product", "purchase", "Purchase"),
  def("newPurchase", ["Ctrl+Shift+N", "F2"], "New Purchase Bill", "purchase", "Purchase"),
  def("findPurchase", ["F6"], "Find Purchase Bill", "purchase", "Purchase"),
  def("saveDraft", ["F8"], "Save Draft", "purchase", "Purchase"),
  def("recallDraft", ["F9"], "Recall Draft", "purchase", "Purchase"),
  def("postPurchase", ["F12"], "Post Purchase", "purchase", "Purchase"),
  def("postPurchasePrint", ["Shift+F12"], "Post & Print Labels", "purchase", "Purchase"),

  // --- Sales returns ------------------------------------------------------
  def("newSalesReturn", ["F7"], "New Sales Return", "salesReturns", "Sales Returns"),

  // --- Stock --------------------------------------------------------------
  def("newStockAdjustment", ["Alt+A"], "New Stock Adjustment", "stock", "Stock"),
  def("addAdjustmentLine", ["Insert"], "Add Adjustment Line", "stock", "Stock"),
  def("removeAdjustmentLine", ["Delete"], "Remove Adjustment Line", "stock", "Stock"),
  def("undoAdjustmentDelete", ["Ctrl+Z"], "Undo Line Delete", "stock", "Stock"),
  def("toggleAdjustmentMode", ["Ctrl+M"], "Toggle Adjustment / Physical Count", "stock", "Stock"),
  def("importAdjustmentCsv", ["Ctrl+I"], "Import Adjustment CSV", "stock", "Stock"),
  def("postStockAdjustment", ["Ctrl+Enter"], "Post Stock Adjustment", "stock", "Stock"),

  // --- Modal / preview / login -------------------------------------------
  def("modalClose", ["Esc"], "Close Modal", "modal", "Modal", true),

  // --- Alt+F supplier bill charges grid (PUR-007) ------------------------
  // These live in the modal scope so the grid owns plain keys like Enter and Delete
  // while it is open, and every other screen keeps them.
  def("chargeAddRow", ["Insert"], "Add Charge Row", "modal", "Charges"),
  def("chargeDeleteRow", ["Delete"], "Delete Charge Row", "modal", "Charges"),
  def("chargeUndoDelete", ["Ctrl+Z"], "Undo Charge Row Delete", "modal", "Charges"),
  def("chargeMoveUp", ["Up"], "Previous Charge Row", "modal", "Charges"),
  def("chargeMoveDown", ["Down"], "Next Charge Row", "modal", "Charges"),
  def("chargeMoveLeft", ["Left"], "Previous Charge Column", "modal", "Charges"),
  def("chargeMoveRight", ["Right"], "Next Charge Column", "modal", "Charges"),
  def("chargeCycleCell", ["Space", "Shift+Space"], "Cycle Charge Preset", "modal", "Charges"),
  def("chargeEditCell", ["Enter"], "Edit Charge Amount", "modal", "Charges"),
  def("chargeApply", ["Ctrl+Enter"], "Apply Charges To Bill", "modal", "Charges"),
];

// ---------------------------------------------------------------------------
// Chord helpers
// ---------------------------------------------------------------------------

export interface Chord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

const KEY_ALIASES: Record<string, string> = {
  escape: "esc",
  esc: "esc",
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
  " ": "space",
  spacebar: "space",
  backspace: "bksp",
  delete: "delete",
  del: "delete",
  enter: "enter",
  return: "enter",
  tab: "tab",
  "+": "plus",
  "?": "/",
};

export function normaliseKey(key: string): string {
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

export function parseChord(chord: string): Chord {
  const parts = chord.split("+").map((p) => p.trim()).filter(Boolean);
  const parsed: Chord = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control" || lower === "cmdorctrl") parsed.ctrl = true;
    else if (lower === "meta" || lower === "cmd" || lower === "command") parsed.meta = true;
    else if (lower === "alt" || lower === "option") parsed.alt = true;
    else if (lower === "shift") parsed.shift = true;
    else parsed.key = normaliseKey(part);
  }
  return parsed;
}

export interface KeyEventLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export function matchesChord(event: KeyEventLike, chord: string): boolean {
  const parsed = parseChord(chord);
  const eventKey = normaliseKey(event.key);
  if (eventKey !== parsed.key) {
    // Fall back to physical code for layout-independent letters/digits.
    const code = event.code ?? "";
    if (parsed.key.length === 1 && code.toLowerCase() === `key${parsed.key}`.toLowerCase()) {
      // ok
    } else if (parsed.key.length === 1 && /^[0-9]$/.test(parsed.key) && code === `Digit${parsed.key}`) {
      // ok
    } else {
      return false;
    }
  }
  const ctrl = Boolean(event.ctrlKey || event.metaKey);
  if (ctrl !== (parsed.ctrl || parsed.meta)) return false;
  if (Boolean(event.altKey) !== parsed.alt) return false;
  if (Boolean(event.shiftKey) !== parsed.shift) return false;
  return true;
}

export function formatChord(chord: string): string {
  return chord
    .replace(/\bCtrl\b/i, "Ctrl")
    .replace(/\bAlt\b/i, "Alt")
    .replace(/\bShift\b/i, "Shift")
    .replace(/\bLeft\b/i, "←")
    .replace(/\bRight\b/i, "→")
    .replace(/\bUp\b/i, "↑")
    .replace(/\bDown\b/i, "↓");
}

/** First chord for an action, formatted for display. */
export function shortcutLabel(action: ShortcutAction, scope?: ShortcutScope): string {
  const entry = centralKeyMap.find((s) => s.action === action && (!scope || s.scope === scope));
  return entry ? formatChord(entry.keys[0]) : "";
}

export function shortcutsForScope(scope: ShortcutScope): ShortcutDefinition[] {
  return centralKeyMap.filter((s) => s.scope === scope && !s.hidden);
}

/** Same-scope duplicate chords. Different scopes may intentionally override. */
export function findConflicts(map: ShortcutDefinition[] = centralKeyMap): ShortcutDefinition[][] {
  const groups = new Map<string, ShortcutDefinition[]>();
  for (const entry of map) {
    for (const chord of entry.keys) {
      const key = `${entry.scope}:${parseChord(chord).ctrl}|${parseChord(chord).alt}|${parseChord(chord).shift}|${parseChord(chord).meta}|${parseChord(chord).key}`;
      const bucket = groups.get(key) ?? [];
      bucket.push(entry);
      groups.set(key, bucket);
    }
  }
  return Array.from(groups.values()).filter((arr) => arr.length > 1);
}

/** Informational: screen chords that shadow a global chord. */
export function findScopeOverrides(map: ShortcutDefinition[] = centralKeyMap): Array<{ chord: string; global: ShortcutDefinition; screen: ShortcutDefinition }> {
  const result: Array<{ chord: string; global: ShortcutDefinition; screen: ShortcutDefinition }> = [];
  const globals = map.filter((s) => s.scope === "global");
  for (const screen of map.filter((s) => s.scope !== "global" && s.scope !== "modal")) {
    for (const chord of screen.keys) {
      const global = globals.find((g) => g.keys.some((c) => sameChord(c, chord)));
      if (global) result.push({ chord, global, screen });
    }
  }
  return result;
}

function sameChord(a: string, b: string): boolean {
  const pa = parseChord(a);
  const pb = parseChord(b);
  return pa.ctrl === pb.ctrl && pa.alt === pb.alt && pa.shift === pb.shift && pa.meta === pb.meta && pa.key === pb.key;
}

export function findShortcut(action: ShortcutAction, scope?: ShortcutScope): ShortcutDefinition | undefined {
  return centralKeyMap.find((s) => s.action === action && (!scope || s.scope === scope));
}

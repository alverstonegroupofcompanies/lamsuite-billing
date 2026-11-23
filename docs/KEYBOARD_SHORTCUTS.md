# Keyboard shortcut map

Published from `frontend/src/lib/keyboard/centralKeyMap.ts` on 2026-11-22 (app 2.1.1).

`specs/keyboard-shortcuts.json` is the machine-readable copy; `frontend/src/lib/keyboard/publishedKeyMap.test.ts` fails if the two drift.
After editing the key map, regenerate it with `cd frontend && npm run keys:publish` and update the tables in this file.

## Rules

- One binding table feeds the buttons, the POS hint strip and the Shortcuts panel.
- A screen scope always wins over the global scope.
- Same-scope duplicates are forbidden; the current map has **0 conflicts**.
- Scope precedence: modal > preview > edit > pos > bills > purchase > salesReturns > stock > login > global.

## Shortcuts by scope

### Global (application-wide)

| Keys | Action | Group |
| --- | --- | --- |
| `Ctrl+Alt+S` | Switch Store | Global |
| `Ctrl+L` | Lock Terminal | Global |
| `Ctrl+K` | Command Palette | Global |
| `F1` | POS Billing | Navigation |
| `F2` | Purchases | Navigation |
| `Shift+F2` | Purchase Returns | Navigation |
| `F3` | Stock Ledger | Navigation |
| `Shift+F3` | Inter-Store Transfers | Navigation |
| `F4` | Reports & GST | Navigation |
| `F5` | Masters | Navigation |
| `F6` | Past Bills | Navigation |
| `F7` | Sales Returns | Navigation |
| `Shift+F7` | Customer Debit Notes | Navigation |
| `F8` | Store Counters | Navigation |
| `F9` | Import / Export | Navigation |
| `F10` | Settings | Navigation |
| `F11` | Toggle Fullscreen | Navigation |
| `Home` | Dashboard | Navigation |
| `Shift+/` | Keyboard Shortcuts | Navigation |

### POS Billing

| Keys | Action | Group |
| --- | --- | --- |
| `Alt+H` | Hold Bill | Billing |
| `Alt+L` | Recall Held Bill | Billing |
| `Ctrl+N` | New Bill | Billing |
| `F12` | Checkout / Settle | Billing |
| `Ctrl+Shift+C` | Columns & Layout | Billing |
| `F1` | Product Entry Row | Billing |
| `Alt+C` | Customer | Billing |
| `Alt+M` | Customer Mobile | Billing |
| `Alt+D` | Doctor (pharmacy) | Billing |
| `Alt+P` | Patient (pharmacy) | Billing |
| `Alt+F2` | Bill Discount | Billing |
| `Alt+I` | Line Discount | Billing |
| `Alt+R` | Round-Off | Billing |
| `Alt+E` | Batch / Expiry | Billing |
| `F3` | Selling Price | Billing |
| `Ctrl+Bksp` | Clear Cart | Billing |
| `Delete` / `Ctrl+D` | Delete Line | Grid |
| `Ctrl+Z` | Undo Delete | Grid |
| `Alt+Up` | Move Line Up | Grid |
| `Alt+Down` | Move Line Down | Grid |
| `Ctrl+B` | Pick Batch | Grid |
| `Ctrl+U` | Toggle Unit Rate | Grid |
| `Ctrl+E` | Packaging / Unit Conversion | Grid |

### Past Bills register

| Keys | Action | Group |
| --- | --- | --- |
| `Alt+Right` | Next Period | Bills |
| `Alt+Left` | Previous Period | Bills |
| `Alt+Shift+P` | Cycle Payment Filter | Bills |
| `Alt+S` | Cycle Status Filter | Bills |

### Invoice edit mode

| Keys | Action | Group |
| --- | --- | --- |
| `Ctrl+Q` | Cancel Invoice Edit | Edit |

### Purchase inward

| Keys | Action | Group |
| --- | --- | --- |
| `Alt+S` | Supplier | Purchase |
| `Alt+B` | Bill No | Purchase |
| `Alt+D` | Bill Date | Purchase |
| `Alt+T` | Purchase Type | Purchase |
| `Alt+F` | Bill Charges (opens the charges grid) | Purchase |
| `Alt+I` | Supplier Bill Total | Purchase |
| `Alt+R` | Round-Off | Purchase |
| `Alt+Y` | Toggle Discount % / Amount | Purchase |
| `Ctrl+N` | Quick Add Product | Purchase |
| `Ctrl+Shift+N` / `F2` | New Purchase Bill | Purchase |
| `F1` | Entry Row | Purchase |
| `F6` | Find Purchase Bill | Purchase |
| `F8` | Save Draft | Purchase |
| `F9` | Recall Draft | Purchase |
| `F12` | Post Purchase | Purchase |
| `Shift+F12` | Post & Print Labels | Purchase |

### Sales returns

| Keys | Action | Group |
| --- | --- | --- |
| `F7` | New Sales Return | Sales Returns |

### Supplier bill charges grid (`Alt+F`)

Opened from the purchase screen. These bindings are in the modal scope, so they own plain keys only
while the grid has the screen; closing it hands every one of them back.

| Keys | Action | Group |
| --- | --- | --- |
| `Insert` | Add Charge Row | Charges |
| `Delete` | Delete Charge Row | Charges |
| `Ctrl+Z` | Undo Charge Row Delete | Charges |
| `Up` / `Down` | Previous / Next Charge Row | Charges |
| `Left` / `Right` | Previous / Next Charge Column | Charges |
| `Space` / `Shift+Space` | Cycle Charge Preset (head, GST slab, treatment, spread, ITC, RCM, paid separately) | Charges |
| `Enter` | Edit Charge Amount (typed cells only) | Charges |
| `Ctrl+Enter` | Apply Charges To Bill | Charges |
| `Esc` | Cancel the edit, then close the grid | Modal |

A cell is either cycled or typed, never both: `Space` on Head walks this store's own charge heads and
re-prices the row from that head's presets, leaving any cell the operator already set by hand alone.

### Stock adjustment

| Keys | Action | Group |
| --- | --- | --- |
| `Alt+A` | New Stock Adjustment | Stock |
| `Insert` | Add Adjustment Line | Stock |
| `Delete` | Remove Adjustment Line | Stock |
| `Ctrl+Z` | Undo Line Delete | Stock |
| `Ctrl+M` | Toggle Adjustment / Physical Count | Stock |
| `Ctrl+I` | Import Adjustment CSV | Stock |
| `Ctrl+Enter` | Post Stock Adjustment | Stock |

### Hidden bindings

- `Esc` — Close Modal (not advertised, still active)

## Intentional screen overrides of global keys

These are not conflicts: inside the listed screen the local action wins. Outside it, the global action applies.

| Chord | Global action | Screen action | Screen |
| --- | --- | --- | --- |
| `F1` | navPos | focusEntry | pos |
| `F3` | navStock | rateEdit | pos |
| `F1` | navPos | purchaseFocusEntry | purchase |
| `F2` | navPurchases | newPurchase | purchase |
| `F6` | navBills | findPurchase | purchase |
| `F7` | navSalesReturns | newSalesReturn | salesReturns |
| `F8` | navCounters | saveDraft | purchase |
| `F9` | navImportExport | recallDraft | purchase |

## Changed in this release

- An open purchase bill owns `F1`, `F2`, `F6`, `F8`, `F9` and `F12`: `F1` returns to the entry row, `F2` starts a fresh bill after a discard confirm, `F6` closes to the list after a discard confirm, and `F8`/`F9` stay on drafts. Every global navigation chord asks the bill before it leaves, so an unsaved bill is never discarded silently.
- Purchases list: `F2` and `Ctrl+Shift+N` open a New Inward Bill, as the button says.
- Sales returns: `F7` opens a New Return without re-navigating; invoice and customer results are listboxes — `↑`/`↓` move, `Enter` selects, `Esc` dismisses the results and leaves the return open.
- POS arrival focuses the entry row the current layout shows (inline row by default), so `F1` from another screen lands ready to type.
- Settlement: digit keys follow the tender buttons' own numbers and this store's enabled modes; `Option`+digit works on macOS because the physical key is read. The stale `1=Cash … 5=Split` hint is gone — the buttons are the mode map.
- Switch Store moved from `Alt+S` to `Ctrl+Alt+S`; `Alt+S` now focuses the supplier on purchase and cycles status on bills.
- Hold = `Alt+H`, Recall = `Alt+L`; all POS `F8`/`F9` aliases removed so global Counters (`F8`) and Import/Export (`F9`) are never shadowed from POS.
- POS grid: `Alt+E` batch/expiry, `Alt+I` line discount, `Alt+D` doctor and `Alt+P` patient (pharmacy only).
- Bills register: `Alt+←`/`Alt+→` period, `Alt+Shift+P` payment filter, `Alt+S` status filter.
- Invoice edit mode: `Ctrl+Q` cancels an edit session.
- Stock adjustment: `Alt+A` new, `Insert` line, `Ctrl+M` mode, `Ctrl+I` import, `Ctrl+Enter` post, `Ctrl+Z` undo line delete.
- Purchase: `Alt+F` no longer focuses a Freight field — it opens the supplier bill charges grid (CR-C, PUR-007). Freight is one charge row there, and the grid's own keys are listed above.
- Global `F12` (Switch Account) is retired: nothing signs in at the till, so `F12` belongs to the screen it is pressed on — Checkout in POS, Post Purchase on the purchase screen.

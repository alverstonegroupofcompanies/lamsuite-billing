# Keyboard shortcut map

Published from `frontend/src/lib/keyboard/centralKeyMap.ts` on 2026-11-14 (app 2.0.39).

`specs/keyboard-shortcuts.json` is the machine-readable copy; `frontend/src/lib/keyboard/publishedKeyMap.test.ts` fails if the two drift.

## Rules

- One binding table feeds the buttons, the POS hint strip and the Shortcuts panel.
- A screen scope always wins over the global scope.
- Same-scope duplicates are forbidden; the current map has **0 conflicts**.
- Scope precedence: modal > preview > edit > pos > bills > purchase > stock > login > global.

## Shortcuts by scope

### Global (application-wide)

| Keys | Action | Group |
| --- | --- | --- |
| `Ctrl+Alt+S` | Switch Store | Global |
| `Ctrl+L` | Lock Terminal | Global |
| `Ctrl+K` | Command Palette | Global |
| `F12` | Switch Account | Global |
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
| `Alt+F` | Freight | Purchase |
| `Alt+I` | Supplier Bill Total | Purchase |
| `Alt+R` | Round-Off | Purchase |
| `Alt+Y` | Toggle Discount % / Amount | Purchase |
| `Ctrl+N` | Quick Add Product | Purchase |
| `Ctrl+Shift+N` | New Purchase Bill | Purchase |
| `F6` | Find Purchase Bill | Purchase |
| `F8` | Save Draft | Purchase |
| `F9` | Recall Draft | Purchase |
| `F12` | Post Purchase | Purchase |
| `Shift+F12` | Post & Print Labels | Purchase |

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
| `F12` | accountSwitcher | checkout | pos |
| `F1` | navPos | focusEntry | pos |
| `F3` | navStock | rateEdit | pos |
| `F6` | navBills | findPurchase | purchase |
| `F8` | navCounters | saveDraft | purchase |
| `F9` | navImportExport | recallDraft | purchase |
| `F12` | accountSwitcher | postPurchase | purchase |

## Changed in this release

- Switch Store moved from `Alt+S` to `Ctrl+Alt+S`; `Alt+S` now focuses the supplier on purchase and cycles status on bills.
- Hold = `Alt+H`, Recall = `Alt+L`; all POS `F8`/`F9` aliases removed so global Counters (`F8`) and Import/Export (`F9`) are never shadowed from POS.
- POS grid: `Alt+E` batch/expiry, `Alt+I` line discount, `Alt+D` doctor and `Alt+P` patient (pharmacy only).
- Bills register: `Alt+←`/`Alt+→` period, `Alt+Shift+P` payment filter, `Alt+S` status filter.
- Invoice edit mode: `Ctrl+Q` cancels an edit session.
- Stock adjustment: `Alt+A` new, `Insert` line, `Ctrl+M` mode, `Ctrl+I` import, `Ctrl+Enter` post, `Ctrl+Z` undo line delete.

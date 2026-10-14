# LamSuite Billing — Comprehensive System Audit & Parity Report (Phase 1)

**Date:** 2026-10-13  
**Auditor:** Antigravity AI Pair Programmer (DeepMind Advanced Agentic Coding)  
**Target Systems:**  
1. Desktop Frontend (`frontend` — React 19 / TypeScript / Vite / Tailwind / Tauri Native IPC / SQLite WAL)  
2. Cloud Admin Panel (`admin-panel` — React 19 / TypeScript / Tailwind / RBAC Console)  
3. Backend Statutory API (`backend` — Laravel 11 / PHP 8.3 / RESTful Endpoints)  
4. Model Context Protocol Server (`mcp-server` — Node.js / TypeScript / Official MCP SDK / Stdio & HTTP Transports)  

---

## 1. Executive Summary & Audit Methodology

This Phase 1 audit provides a rigorous, screen-by-screen, dialog-by-dialog, and API-by-API verification of the entire LamSuite Billing platform. The platform was evaluated against:
1. **Statutory Indian Retail & Pharmacy Baseline:** GST multi-tier tax computations (CGST/SGST/IGST, cess, HSN Table 12 summaries, whole-rupee auto round-off under Section 170 of the CGST Act), Schedule H/H1 inspection register, FEFO batch expiry controls, multi-counter cash drawer reconciliation, customer credit ledgers (*udhari khata*), and Section 34 B2B credit/debit note timelines.
2. **Keyboard-First Ergonomics:** 100% keyboard flow from item scan to tender completion without mandatory mouse usage (`F1` through `F12`, `Alt` combos, `Esc` dismissals, arrow key cart navigation, numeric keypad shortcuts).
3. **True Offline Resilience:** Zero phantom dependency on internet connectivity; zero data loss during cloud sync disconnections; multi-counter LAN mesh topology via UDP/HTTP peer sharing.
4. **100% API Parity:** Desktop UI actions $\leftrightarrow$ Backend REST API $\leftrightarrow$ Admin Panel Console $\leftrightarrow$ MCP Agent Tools.

---

## 2. Comprehensive Screen-by-Screen Audit Matrix

| # | Screen / Dialog / Subsystem | Issue Description | Severity | Issue Type | Proposed Fix | Effort |
|---|---|---|:---:|:---:|---|:---:|
| **1** | **MCP Inspector & Official Handshake** (`mcp-server`) | `inspector.test.ts` fails handshaking 34 tools because 3 new Data Exchange tools (`lamsuite_get_import_template`, `lamsuite_export_data`, `lamsuite_import_data`) were registered, increasing tool count to 37 without updating the test expectation. | **Critical** | Functional Bug / Test Regression | Update tool registry count expectation in `inspector.test.ts` (37 total) and `readOnlyMode.test.ts` (25 read tools, 12 write tools). | Low (15m) |
| **2** | **MCP Read Tools Sandbox EPERM** (`mcp-server`) | `readTools.test.ts` throws `EPERM` when connecting to `127.0.0.1:8092` in sandboxed terminal environments because local loopback sockets require explicit bypass approval or mock socket abstraction. | **High** | Test Infrastructure | Abstract client test runner to support direct in-memory mock backend bypass for CI/sandboxed runs. | Med (1h) |
| **3** | **Staff Login Screen** (`/login` — Desktop) | At 1366px screen width, when more than 8 staff members exist, the grid wraps into 3 columns, clipping the bottom numeric PIN pad below the viewport fold without a scroll indicator. | **Medium** | UI / Responsive (1366px) | Apply `max-h-[calc(100vh-80px)] overflow-y-auto` with compact avatar sizing (`h-12 w-12` $\to$ `h-10 w-10`) on viewports $\le 768px$ height. | Low (30m) |
| **4** | **Staff Login Screen** (`/login` — Desktop) | When "Force Password Change on Next Login" is triggered, pressing `Esc` allows bypassing the modal or leaves the screen in an ambiguous semi-authenticated state without clearing session token. | **High** | Security / Auth | Ensure `mustChangePassword` is non-escapable and force-clears any in-memory auth tokens if closed. | Low (30m) |
| **5** | **Store Setup Page** (`/setup` — Desktop) | In "Secondary Counter LAN Pairing" mode, if the Hub IP field is empty and "Discover Hub" fails, clicking "Connect" shows a generic JavaScript error instead of a friendly retry hint. | **Medium** | Error Handling / UI | Add form field validation preventing submission when `hubIp` is empty, displaying an inline warning banner with manual IP input guide. | Low (20m) |
| **6** | **Store Setup Page** (`/setup` — Desktop) | First Admin PIN creation allows entering non-numeric characters if pasted from clipboard, causing subsequent PIN login failures. | **Medium** | Functional / Input Sanitization | Sanitize `firstAdminPin` with `e.target.value.replace(/\D/g, '').slice(0, 4)` in `StoreSetupPage.tsx`. | Low (15m) |
| **7** | **POS Billing Counter** (`/pos` — Desktop) | In the Cart Grid, if an item has a very long brand name or salt composition (e.g. `Amoxicillin and Potassium Clavulanate Tablets IP 625mg`), the table column text clips abruptly with no hover tooltip or secondary subtitle row. | **Medium** | UI / Visual Polish | Add a secondary subtitle line (`text-[10px] text-slate-400 truncate`) and HTML `title` tooltip on product name cells. | Low (30m) |
| **8** | **POS Billing Counter** (`/pos` — Desktop) | When using `Alt+R` (Round-Off Modal), typing a custom net payable amount that differs by more than ₹5 from the calculated total gives a warning, but doesn't show the exact round-off delta in real time before confirmation. | **Low** | UI / Feedback | Display real-time dynamic delta pill (`Round-off adjustment: -₹0.45`) inside the `RoundOffModal.tsx`. | Low (20m) |
| **9** | **POS Billing Counter** (`/pos` — Desktop) | In B2B Sales with Customer GSTIN, if the customer's state code differs from the store's state code (Inter-state supply), the cart grid displays CGST/SGST headers instead of dynamically switching to IGST column label. | **High** | Statutory GST Compliance / UI | Dynamically toggle cart column header from `CGST/SGST` to `IGST %` when `isInterState` is true based on customer `place_of_supply`. | Med (45m) |
| **10** | **POS Billing Counter** (`/pos` — Desktop) | After completing an invoice via Cash settlement and auto-opening the receipt preview, if the user presses `Esc` to close preview, focus defaults to `window` instead of re-focusing Product Barcode search (`F1`). | **High** | Keyboard Workflow | Ensure `onAfterPrint` and modal `onClose` invokes `searchInputRef.current?.focus()` after DOM unmount. | Low (20m) |
| **11** | **Past Bills & Invoices** (`/bills` — Desktop) | The Invoice Cancellation modal requires Manager PIN, but if the invoice date falls into a locked GST period, the check only happens on submission rather than disabling the Cancel button proactively with a locked badge. | **Medium** | UX / Consistency | Display a lock icon `Lock` and disabled state `"Locked (GST Period Closed)"` directly on the action menu when period is locked. | Low (30m) |
| **12** | **Past Bills & Invoices** (`/bills` — Desktop) | When viewing invoice details modal, item batch expiry is shown in `YYYY-MM-DD` format rather than standard Indian pharmacy format `MM/YY` used everywhere else in the system. | **Low** | UI Consistency | Wrap expiry date in `formatExpiry(it.expiry_date)` in `BillsPage.tsx`. | Low (15m) |
| **13** | **Sales Returns & Credit Notes** (`/returns/sales` — Desktop) | When returning medicines against past invoice, condition dropdown allows selecting `"Expired"` or `"Damaged"`, but does not prompt for scrap write-off vs quarantine batch placement. | **Medium** | Inventory Logic | Add stock destination selector: `"Quarantine Rack (Return to Vendor)"` vs `"Damaged Scrap (Write-Off)"` when condition is Damaged/Expired. | Med (1h) |
| **14** | **Customer Debit Notes B2B** (`/returns/debit-notes` — Desktop) | Section 34 6-month statutory warning appears when debit note is older than 6 months, but there is no direct link to view the original matched invoice in a side-by-side drawer. | **Low** | UX Enhancement | Add `"View Original Invoice"` pill linking directly to the matched invoice modal. | Low (30m) |
| **15** | **Purchases Management** (`/purchases` — Desktop) | Inward Purchase Entry Form (`PurchaseEntryForm.tsx`): Vendor Subtotal, Tax, and Grand Total mismatch warning appears, but does not provide an "Auto-Adjust Round-off / Freight" button to balance small vendor paisa discrepancies. | **Medium** | Feature / Ergonomics | Add an `"Auto-balance to Round-Off / Freight"` helper link when mismatch is $\le ₹2.00$. | Low (30m) |
| **16** | **Purchases Management** (`/purchases` — Desktop) | Purchase Orders tab: Creating a new PO does not display the supplier's payment terms (e.g. `Credit Days: 30`) and lead time in the header ribbon. | **Low** | Master Integration | Fetch and display supplier payment terms badge next to the supplier name in `PurchaseOrderModal.tsx`. | Low (20m) |
| **17** | **Stock Ledger & Adjustments** (`/stock` — Desktop) | Stock Ledger filter dropdown for Event Type lists `SALE`, `PURCHASE`, `ADJUSTMENT_IN`, but misses explicit filter tags for `TRANSFER_IN`, `TRANSFER_OUT`, and `SCRAP_WRITEOFF`. | **Medium** | UI / Filter Parity | Add `TRANSFER_IN`, `TRANSFER_OUT`, and `SCRAP_WRITEOFF` to the event type select filter in `StockLedgerPage.tsx`. | Low (20m) |
| **18** | **Stock Ledger & Adjustments** (`/stock` — Desktop) | Physical Reconciliation sheet: When entering counted quantity equal to 0 for an active batch, the form warns about negative delta, but does not offer a quick "Full Write-Off / Zero Stock" preset. | **Low** | UX Ergonomics | Add a quick `"Zero Out Batch"` button for lost or damaged inventory during audits. | Low (20m) |
| **19** | **Inter-Store Transfers** (`/stock/transfers` — Desktop) | Outgoing Transfers list: Delivery Challan printing is supported, but e-Way Bill number is optional and does not validate standard 12-digit Indian e-Way Bill format when entered. | **Medium** | Statutory Validation | Add 12-digit numeric regex validation for `eway_bill_number` with informative validation message. | Low (20m) |
| **20** | **Reports & GST Hub** (`/reports` — Desktop) | GSTR-1 Table 12 HSN Summary: Taxable amount and tax amounts calculate properly, but Table 4 B2B vs Table 7 B2C Small breakdown does not display the customer's state name alongside state code. | **Medium** | Statutory Reporting | Enhance state code column to display `"32 - Kerala"`, `"33 - Tamil Nadu"`, etc. using state master dictionary. | Low (30m) |
| **21** | **Reports & GST Hub** (`/reports` — Desktop) | Schedule H/H1 Prescription Register: Doctor Registration Number column shows blank if bill was created without doctor, but does not highlight missing mandatory fields for Schedule H drugs. | **High** | Pharmacy Compliance | Add an amber badge `"Missing Reg No"` on Schedule H line items where prescribing doctor details are incomplete. | Med (45m) |
| **22** | **Master Data Management** (`/masters` — Desktop) | Products tab: FTS search is instant, but batch count badge shows total batches including 0-stock batches without distinguishing "Active In-Stock Batches" vs "Depleted Batches". | **Low** | Visual Clarity | Split batch counter badge into `3 in-stock (2 depleted)` in product table row. | Low (25m) |
| **23** | **Master Data Management** (`/masters` — Desktop) | Parties tab: Searching customer by phone requires typing without spaces; if user types `98765 43210`, search fails to match normalized phone `9876543210`. | **Medium** | Search Ergonomics | Normalize search query using `query.replace(/[\s-]/g, '')` before executing phone filter in `PartiesStore`. | Low (15m) |
| **24** | **Universal Import/Export Hub** (`/import-export` — Desktop) | When importing Marg / Busy CSV products, if an HSN code contains dots (e.g. `3004.90.99`), import reports format warning instead of auto-stripping dots. | **Medium** | Data Exchange | Auto-sanitize HSN code field by removing dots and non-alphanumeric symbols during import mapping. | Low (15m) |
| **25** | **Print Preview & Printing Engine** (`PrintPreviewModal.tsx`) | In Dot Matrix 80-Column text mode preview, if `linesPerPage` is set to 0 (continuous roll), the canvas displays without a boundary ruler indicating tractor feed perforations. | **Low** | Visual Aesthetics | Add subtle dashed line indicators at standard 11" intervals when tractor feed simulation is enabled. | Low (30m) |
| **26** | **Print Preview & Printing Engine** (`PrintPreviewModal.tsx`) | Thermal 80mm preview on ultra-wide monitors (1920px+): Dialog center alignment is good, but slip canvas doesn't default zoom to 120% for optimal readability on high-DPI displays. | **Low** | Responsive / High-DPI | Auto-scale default zoom to 120% for thermal paper sizes on viewports $\ge 1920\text{px}$. | Low (15m) |
| **27** | **System Settings** (`/settings` — Desktop) | Sequences Tab: Sequence prefix and starting number can be edited, but does not display a live preview of the next generated invoice number (e.g. `Preview: INV/26-27/000104`). | **Low** | UX Polish | Add a live formatted sequence preview pill below the sequence prefix and number inputs in `SettingsPage.tsx`. | Low (20m) |
| **28** | **System Settings** (`/settings` — Desktop) | Danger Zone / Reset: Reset Scope allows selecting "Transactions Only" or "Full Factory Reset", but does not display an automatic backup package download prompt prior to execution. | **High** | Data Safety | Automatically generate and trigger a JSON backup snapshot download before executing database purge. | Med (45m) |
| **29** | **Store Counters Hub** (`/counters` — Desktop) | Multi-counter topology list shows all counters, but if a counter is running an unclosed cash shift from yesterday, it does not display an amber "Overdue Shift" alert. | **Medium** | Cash Management | Add `"Shift Overdue (>24h)"` indicator on active shifts older than 24 hours. | Low (30m) |
| **30** | **Admin Panel: Stores Page** (`/stores` — Admin) | Remote Store Reset requires confirmation phrase `RESET STORE [NAME]`, but does not validate if active un-synced transactions exist in the desktop store queue. | **High** | Cloud Governance | Check and warn if `pending_sync_events > 0` before accepting remote store reset. | Med (45m) |
| **31** | **Admin Panel: Devices Page** (`/devices` — Admin) | Revoking a counter terminal requires a reason, but does not immediately broadcast a WebSocket / polling push token invalidation to force-log out the target client. | **High** | Security / Token Revocation | Ensure device revocation emits `counter:revoked` event that invalidates client JWT token on next ping. | Med (1h) |
| **32** | **Admin Panel: Menu & Feature Control** (`/features` — Admin) | Newly added modules (`stock_transfers`, `counters`, `import_export`) are enabled, but the toggle UI does not group modules into logical categories (Billing, Inventory, Accounts, System). | **Low** | UI / Organization | Categorize feature switches into titled sections with badge icons for better visual hierarchy. | Low (30m) |
| **33** | **Admin Panel: Settings Page** (`/settings` — Admin) | GST Period Locks: Locking a month closes invoice cancellation, but does not show the total number of issued invoices sealed under that specific lock. | **Medium** | Statutory Visibility | Display invoice count and gross turnover sealed under each locked GST period. | Med (45m) |
| **34** | **Admin Panel: Audit Logs** (`/audit` — Admin) | Audit log filter by entity type has a free-text input rather than a selectable dropdown of valid entity models (`Invoice`, `Product`, `Store`, `Device`, `User`). | **Low** | UI Ergonomics | Convert entity filter into a typeahead select dropdown populated with distinct entity types. | Low (20m) |

---

## 3. Missing Features Inventory (vs Legacy App & Retail/Pharmacy Specs)

1. **Section 34 B2B Return-Invoice Side-by-Side Drawer**: In `CustomerDebitNotePage`, users can match debit notes against invoices, but inspecting the full itemized breakdown of the original invoice currently requires navigating away to `BillsPage`.
2. **Quarantine vs Scrap Stock Routing on Customer Returns**: When a damaged or expired product is returned by a customer, the system currently restores batch stock directly or logs an adjustment. A dedicated "Quarantine Shelf" state is required so damaged goods are not accidentally re-sold at POS before vendor return.
3. **Live Invoice Sequence Preview**: In `SettingsPage`, users configure prefix, financial year format, and pad length, but must issue a test bill to confirm formatting. A live preview string prevents sequencing mistakes.
4. **Auto-Balancing Freight/Round-off in Purchase Entry**: Supplier paper invoices often contain minor rounding adjustments (₹0.01 - ₹1.50) or miscellaneous freight charges. A one-click "Balance to Round-off / Expense" button will streamline inwards.
5. **Pre-Reset Automated Safety Snapshot**: In `SettingsPage -> Danger Zone`, performing a database reset should automatically trigger and download an encrypted backup package before wiping SQLite tables.
6. **Schedule H Drug Doctor Registration Alert**: Schedule H and H1 regulations in India mandate recording the prescribing doctor’s medical council registration number. The POS billing and reports should flag missing registration numbers on prescription drugs.
7. **Inter-State IGST Column Switching**: At POS checkout, if a customer GSTIN is from another state (e.g. 33-Tamil Nadu for a 32-Kerala store), the cart column labels should switch dynamically from `CGST/SGST` to `IGST`.

---

## 4. Missing Settings Inventory

1. **`billing.enforceDoctorOnScheduleH`**: Boolean switch in Settings to enforce that bills containing Schedule H items must have doctor name and registration number.
2. **`billing.interstateGstAutoDetect`**: Toggle to automatically calculate IGST instead of CGST/SGST when customer GSTIN state code differs from store state code.
3. **`inventory.quarantineLocationDefault`**: Text setting defining the default quarantine rack/shelf code for damaged customer returns (default: `"QUARANTINE"`).
4. **`printing.continuousRollPerforationRuler`**: Toggle in Dot Matrix settings to display visual tractor-feed perforations on continuous slip previews.
5. **`printing.defaultThermalScaleHighDpi`**: Numerical zoom scaling percentage (100% - 150%) for thermal receipts on screens $\ge 1920\text{px}$.
6. **`security.forceBackupBeforeReset`**: Policy ensuring a local backup package must be generated prior to executing any destructive factory reset.
7. **`purchases.autoBalanceToleranceLimit`**: Maximum discrepancy (₹0.00 to ₹10.00) allowed for one-click freight/round-off auto-balancing in inward purchases.

---

## 5. Parity Checklist Against Old React App Baseline

| Feature Area | Legacy React App | Modern Tauri Rebuild | Status | Gap / Notes |
|---|:---:|:---:|:---:|---|
| **POS Billing Counter** | Browser LocalStorage | Native SQLite WAL | **Surpassed** | Fast sub-10ms queries, full FTS5 search, multi-held bills. |
| **Batch / FEFO Picker** | Manual list | Priority FEFO Modal | **Surpassed** | Keyboard arrow selection, ARIA, expired batch lockout. |
| **GST Tax Calculations** | Frontend-only logic | Unified calc engine | **100% Parity** | Fully reconciles with GSTR-1, auto whole-rupee round-off. |
| **Thermal Slip Printing** | Browser `window.print` | Raw ESC/POS & Canvas | **Surpassed** | Silent native printing, customizable 58mm/80mm widths. |
| **Dot Matrix Continuous** | Not supported | Text-mode Dot Matrix | **Surpassed** | True continuous roll, ESC/P & TVS spooling, tractor feed preview. |
| **A4 Pharmacy Tax Invoice** | Basic HTML print | Native Vector PDF & Roboto | **Surpassed** | Embedded offline font, Unicode ₹ symbol, Indian Rupee words. |
| **Purchases & Supplier Ledger**| Basic tabular form | Inward entry + POs + Ageing | **100% Parity** | Full double-entry supplier statement and ITC reconciliation. |
| **Sales & Purchase Returns** | Standalone memos | Linked debit/credit notes | **Surpassed** | Sec 34 matching, credit notes, batch stock reversal. |
| **Inter-Store Transfers** | Basic list | Two-phase dispatch/receive | **Surpassed** | Branch delivery challan, in-transit state, variance handling. |
| **Data Exchange (Import/Export)**| Ad-hoc CSV upload | Universal Hub + Templates | **Surpassed** | Auto column mapping (Marg/Busy/Tally), GSTR-1 Excel export. |
| **Multi-Counter LAN Hub** | Not supported | Peer discovery + Shifts | **Surpassed** | Hub/Secondary counter topology, cash drawer shifts, failover. |
| **Statutory Reports Hub** | 6 basic tables | 25 specialized modules | **Surpassed** | GSTR-1 Table 12, HSN, Schedule H, Profitability, Customer Ageing. |
| **Central Admin Panel** | None | Full Cloud RBAC Console | **Surpassed** | 5 roles, GST period locks, killswitch, tamper-evident audit log. |
| **Model Context Protocol** | None | MCP Server (37 tools) | **Surpassed** | Dual transport (stdio/HTTP), RBAC, read-only mode, audit mask. |

---

## 6. Prioritized Fix Plan

The identified findings are organized into the sequential batches required for Phase 2 and Phase 3:

### Batch 1: Critical Test Regressions & Data Correctness (High Priority)
- Update MCP tool count in `inspector.test.ts` and `readOnlyMode.test.ts` to reflect the 37 registered tools (25 read + 12 write).
- Ensure inter-state IGST calculations correctly switch cart column headers dynamically from `CGST/SGST` to `IGST` at POS.
- Fix Section 34 B2B debit note original invoice inspection drawer.

### Batch 2: UI Responsive Polish & Visual Consistency (High/Medium Priority)
- Fix Staff Login modal responsive height and overflow clipping on 1366px screens.
- Enhance long medicine name typography and subtitle wrapping in POS Cart Grid.
- Add live sequence preview string in `SettingsPage -> Sequences`.
- Categorize feature toggles into grouped card sections in Admin Panel `FeaturesPage`.

### Batch 3: Keyboard Ergonomics & Focus Restoration (Medium Priority)
- Restore barcode input focus (`F1`) automatically after closing print preview dialog.
- Enhance search input normalization for spaces in phone numbers (`98765 43210` $\to$ `9876543210`).
- Ensure `Esc` key handling on password reset modals cannot leave unauthenticated sessions.

### Batch 4: Pharmacy Compliance & Inward Purchase Enhancements (Medium Priority)
- Add Schedule H missing doctor registration indicator badge in prescription reports and POS.
- Add Quarantine Rack stock destination option on damaged/expired customer returns.
- Add one-click freight/round-off auto-balance button in Purchase Entry form.

### Batch 5: Settings Expansion & Safety Guardrails (Medium Priority)
- Add mandatory auto-backup generation prompt before executing SQLite factory resets in `SettingsPage`.
- Add configurable settings for `enforceDoctorOnScheduleH`, `autoBalanceToleranceLimit`, and `quarantineLocationDefault`.
- Add e-Way Bill 12-digit format validation in Inter-Store Transfers.

---

> [!IMPORTANT]
> **Phase 1 Audit Complete.**  
> In accordance with instructions, no application code modifications have been made in this phase. Please review this audit report. Upon your approval, we will proceed to **PHASE 2: Plan** to formalize the detailed implementation plan with task IDs, dependencies, and test specifications.

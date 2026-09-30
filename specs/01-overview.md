# 01. System Overview & Specification Taxonomy

## 1. Vision & Goals

LamSuite Billing delivers a lightning-fast, offline-first desktop POS and retail/pharmacy management system tailored for Indian retail establishments, medical stores, and multi-counter pharmacies.

### Core Goals
1. **Offline-First Resilience:** 100% of daily operations (Billing, Hold Bills, Purchases, Returns, Stock Ledger, Local Reports, Printing) work uninterrupted without internet connectivity.
2. **Speed & Keyboard Optimization:** Sub-50ms UI response on barcode scanning, product lookup, and tender calculation, designed for high-throughput billing counters.
3. **Statutory Indian Compliance:** Impeccable GST multi-tier tax computations, HSN reporting, GSTR-1 summaries, and drug license compliance.
4. **100% API Parity:** Every user action performed in the desktop UI is mapped to an identical, documented OpenAPI endpoint on the backend.
5. **Decluttered & Maintainable Architecture:** Elimination of non-functional stubs, legacy browser storage workarounds, and redundant menus.

### Non-Goals
- Complex multi-currency or non-Indian tax regimes (the core engine is strictly optimized for INR & Indian GST).
- Legacy browser storage shims (replaced completely by native SQLite).
- Unfinished placeholder tools (no generic stub tables).

---

## 2. Personas & Workflows

| Persona | Key Responsibilities | Primary Interface & Permissions |
|---|---|---|
| **Cashier / Operator** | High-speed retail billing, barcode scanning, split payments, issuing receipts, bill returns. | Keyboard-only POS screen, held bills, reprint receipt. Resticted from deleting items or editing master prices. |
| **Pharmacist** | Batch/expiry verification, dispensing prescribed medicines, capturing doctor & patient details, managing drug schedules. | POS with batch picker, pending prescription queue, expiry alerts, patient history. |
| **Store Manager** | Purchase entries, vendor reconciliations, stock adjustments, physical audit, opening/closing cash drawer. | Purchases, inventory dashboard, stock transfer, supplier ledger. |
| **Store Owner** | End-of-day reconciliation, profit analysis, GST tax filing reports, staff management, store preferences. | Full access to business reports, GSTR-1, HSN summary, settings, and cloud sync status. |
| **System Admin** | Multi-store setup, role permissions, device provisioning, database backup & disaster recovery. | System settings, user roles, device pairing, audit logs, backup tools. |

---

## 3. Requirement ID Taxonomy

Every requirement across all modules is assigned a unique, immutable requirement ID:

| Prefix | Module | Scope |
|---|---|---|
| `POS-xxx` | Sales & Billing | POS counter, keyboard shortcuts, barcode scanning, holds, splits, discounts |
| `RET-xxx` | Sales Return & Quotations | Inward returns against bills, standalone returns, quotations |
| `PUR-xxx` | Purchase Entry & Invoices | Supplier bills, OCR/AI parser, purchase returns, purchase requests |
| `STK-xxx` | Inventory & Stock Ledger | Batch tracking, stock movements, physical reconciliation, store transfers |
| `MST-xxx` | Master Data | Products, categories, brands, units, suppliers, customers, doctors, patients |
| `REP-xxx` | Reports & Indian GST | Sales register, GSTR-1, HSN summary, stock reports, customer ledgers |
| `PRN-xxx` | Native Printing & PDF | Thermal ESC/POS, A4 invoice templates, silent printing, PDF generator |
| `SYNC-xxx`| Sync, Offline & LAN | SQLite WAL, sync queue, delta sync, idempotent API ingest, LAN mDNS/UDP |
| `SEC-xxx` | Auth, RBAC & Security | PIN sign-in, role-based access, idle lock, device activation |
| `CFG-xxx` | Settings & Preferences | Store profile, sequences, tax mode, print layout settings |

---

## 4. Non-Functional Requirements (NFR)

- **NFR-PERF-01 (Speed):** Barcode scan to line entry latency must be `< 30ms`. FTS product search across 50,000 items must respond in `< 50ms`.
- **NFR-OFF-01 (Zero Downtime):** Offline transitions must be transparent to the user; local transactions are committed immediately to local SQLite with WAL mode enabled.
- **NFR-DATA-01 (Integrity):** Double-entry stock ledger ensures zero phantom stock discrepancies. Stock transactions are atomic with invoice creation.
- **NFR-COMP-01 (Statutory):** All GST computations must round half-up to 2 decimal places, and round-off adjustment must ensure exact integer grand totals matching Indian commercial law.
- **NFR-OS-01 (OS Compatibility):** Executable must support modern Windows (10/11) natively, with clear compatibility strategies for legacy Windows (7/8) environments.

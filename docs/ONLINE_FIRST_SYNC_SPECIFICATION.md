# LamSuite Billing: Online-First Architecture & Sync Specification

## Overview

LamSuite Billing has transitioned from an offline-first architecture to an **online-first architecture with resilient offline fallback**. 

In this architecture:
1. **Single Source of Truth (Cloud Backend)**: Every enrolled workstation and counter operates live against the central Laravel Cloud Backend.
2. **Local SQLite Database as Read Cache & Safety Net**: Local SQLite provides sub-50ms instant UI responsiveness and acts as a local cache and durable write-ahead safety net.
3. **Strictly Scoped Offline Fallback**: If external internet connectivity drops, counters automatically degrade to offline fallback mode, allowing uninterrupted billing and printing while restricting conflicting administrative changes.
4. **3-Tier Priority Hierarchy**:
   - **Tier 1: Cloud API (Primary)**: Direct live connection with central server.
   - **Tier 2: Shop LAN Hub (Intermediate)**: When WAN is severed but shop local network is active, counters share live stock, held bills, locks, and number blocks through the main station LAN Hub.
   - **Tier 3: Standalone Offline (Fallback)**: When isolated, counters bill using pre-leased document number blocks and local cache.

---

## 1. Online Mode (Normal Operation)

- **Atomic Cloud Transactions**: All sales invoices, sales returns, purchases, stock adjustments, and payments are sent directly to the backend API first in a single ACID database transaction.
- **Server Authority**:
  - Assigns sequential document numbers atomically (`C01-INV-1001`).
  - Checks stock per batch atomically using database row locks (`FOR UPDATE`).
  - Prevents overselling unless the store's `allow_negative_stock` policy is enabled.
  - Enforces GST compliance and rounding rules.
  - Enforces period locks: financial year and GST monthly period locks (`gst_lock_periods`).
  - Checks and validates customer credit limits before approving credit sales.
- **Real-Time Push Synchronization (SSE)**:
  - Counters connect to `/api/sync/stream`.
  - Batch stock changes, held bills, document edit locks, and rate updates are broadcast immediately.
  - When Counter A sells the last unit of Batch X, Counter B receives the delta event within seconds and marks the batch out-of-stock.
  - When Counter A opens a historical invoice for editing, Counter B sees it locked.

---

## 2. Offline Fallback (Degraded Mode)

### 2.1 Health & Connection Detection
- A background heartbeat measures latency every 4 seconds.
- The UI persistent status bar dynamically reflects:
  - 🟢 **Live Synced**: Normal operation with latency in ms.
  - 🟡 **Slow Connection**: Operating live with latency > 800ms.
  - 🔴 **Offline Mode**: Running on local cache. Displays count of pending queue items and duration since last online.

### 2.2 Allowed vs. Blocked Offline Operations

| Operation | Offline Status | Enforcement & Rationale |
| :--- | :--- | :--- |
| **Sales Invoicing** | **Allowed** | Generates bill from pre-leased block, prints receipt, saves to WAL. |
| **Held Bills** | **Allowed** | Parked locally; synced upon reconnection. |
| **Sales Returns** | **Allowed** | Allowed against cached customer invoices. |
| **Quotations** | **Allowed** | Stored locally and printable. |
| **Direct Printing** | **Allowed** | Thermal and A4 vector printing operate locally without network. |
| **Cancel Synced Bill** | **Blocked** | Disabled to prevent ledger conflicts across active counters. |
| **Edit Synced Bill** | **Blocked** | Disabled because multi-counter edit lock requires cloud coordination. |
| **Stock Adjustments** | **Blocked** | Disabled to protect physical stock valuation. |
| **Store Transfers** | **Blocked** | Disabled because destination branch status cannot be confirmed. |
| **Purchase Posting** | **Blocked** | Disabled to prevent supplier ledger divergence. |
| **Master Data Edits** | **Blocked** | Disabled to prevent product/pricing drift across workstations. |
| **Live Reports** | **Watermarked** | Shows cached data watermarked *"Offline Fallback: Figures may be outdated"*. |

---

## 3. Pre-Leased Number Series & Emergency Series

- **Online Pre-Leasing**: While online, each counter leases a block of 50–100 consecutive numbers (e.g. `1001` to `1050`) from the cloud server via `/api/counters/{id}/lease-sequence`.
- **Automatic Top-Up**: When remaining numbers in the leased block fall below 20% (< 10 numbers), the client auto-requests the next block in the background.
- **Emergency Temporary Numbering (`TEMP-C01-XXXX`)**: If a counter operates offline for so long that its pre-leased block is exhausted, the counter switches to an emergency temporary series. On reconnect, the cloud server automatically maps the temporary number to the next canonical sequence number while preserving the printed temporary number in the audit trail.

---

## 4. Durable Write-Ahead Queue (WAL)

- All offline invoices are written to disk in SQLite table `offline_durable_queue` before UI confirmation, preventing data loss during sudden power outages or terminal reboots.
- Automatic safety guards prevent operators from switching stores or quitting the application while uncommitted offline bills are pending synchronization.

---

## 5. Verification & Paisa-Level Reconciliation

- Upon network reconnection, `syncQueueService` synchronizes all queued operations idempotently.
- The cloud backend's `MigrationReconciliationService` and `SyncController` verify that:
  - Total sales value matches to the paisa.
  - Total CGST, SGST, and IGST match to the paisa.
  - Batch stock ledger entries reconcile without discrepancy.

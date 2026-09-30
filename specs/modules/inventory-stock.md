# Module Spec: Stock & Inventory Management (STK)

## 1. Overview
Inventory control maintains perpetual stock levels at the individual batch level. It enforces double-entry stock bookkeeping across all system events (Sales, Purchases, Returns, Adjustments, and Transfers) with FEFO (First-Expiry, First-Out) optimization and physical audit support.

---

## 2. Requirement Specifications & Acceptance Criteria

### [STK-001] Double-Entry Stock Ledger
- **Story:** As a store owner, I want every inventory movement tracked as an immutable stock event so system stock matches physical shelf stock with zero phantom discrepancies.
- **Acceptance Criteria:**
  - **Given** an approved transaction (Sale, Purchase, Return, Adjustment, Transfer),
  - **When** the document is committed,
  - **Then** an immutable row is appended to `stock_transactions` recording:
    `[product_id, batch_id, event_type, qty_delta, unit_cost, reference_doc_type, reference_doc_id, timestamp]`.
  - **When** querying current on-hand stock for a product or batch,
  - **Then** the value is calculated from $\sum \text{qty\_delta}$ or cached balance checked against transaction sum.

### [STK-002] Stock Adjustments (Damage, Breakage, Expiry)
- **Story:** As a store manager, I want to write off damaged, broken, or expired stock with clear adjustment reasons.
- **Acceptance Criteria:**
  - **Given** an existing batch with 25 units on hand,
  - **When** the manager enters a Stock Adjustment of `-5` units with reason "Broken / Damaged in Storage",
  - **Then** a Stock Adjustment (`SA`) document is posted in `POSTED` status, on-hand batch stock is reduced to 20, and the financial write-off is logged.

### [STK-003] Physical Stock Reconciliation & Audit
- **Story:** As a store auditor, I want to enter actual counted quantities per batch and post reconciliation entries for discrepancies.
- **Acceptance Criteria:**
  - **Given** a physical count of shelf stock,
  - **When** the user inputs physical counted quantities into the Reconciliation sheet,
  - **Then** the system calculates variance: $\text{Variance} = \text{Physical Count} - \text{System On-Hand}$.
  - **When** the manager approves the reconciliation,
  - **Then** adjustment entries are posted atomically to align system stock with physical count.

### [STK-004] Inter-Store Stock Transfers
- **Story:** As a multi-store operator, I want to transfer stock from one store to another with dispatch and receive confirmation.
- **Acceptance Criteria:**
  - **Given** Store A has available batch stock,
  - **When** Store A dispatches a Stock Transfer (`ST`) to Store B,
  - **Then** stock in Store A is decremented and marked `IN_TRANSIT`.
  - **When** Store B acknowledges receipt of the transfer,
  - **Then** stock in Store B is credited and transfer status transitions to `RECEIVED`.

### [STK-005] FEFO Batch Allocation & Expiry Tracking
- **Story:** As a cashier, I want the system to automatically pick or suggest the batch closest to expiry with stock available.
- **Acceptance Criteria:**
  - **Given** Product X has Batch A (expiring in 2 months, 10 units) and Batch B (expiring in 10 months, 50 units),
  - **When** Product X is scanned at the POS without manual batch override,
  - **Then** Batch A is allocated first.
  - **When** any batch is within 30/60/90 days of expiry,
  - **Then** an amber or red warning indicator is rendered in the batch picker and on the inventory dashboard.

---

## 3. Offline Behavior & Conflict Rules
- **Autonomous Stocking:** Stock adjustments and reconciliations post directly to local SQLite.
- **Conflict Avoidance:** Inter-store transfers require unique GUIDs and two-phase commit: dispatch decrements locally; receipt increments only upon physical scan or LAN/cloud receipt confirmation.
- **Sync Ingestion:** Stock events are pushed to the backend as an event-log stream. The cloud ingests them in sequence and updates central store ledgers.

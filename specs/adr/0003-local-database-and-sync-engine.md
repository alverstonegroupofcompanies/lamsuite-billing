# ADR 0003: Local SQLite Engine, FTS5 Search & Offline Sync Protocol

## Status
Approved

## Context
Non-Negotiable Requirements 1 and 2 demand true offline-first capability and seamless LAN sharing:
- The POS must never freeze or fail if internet or LAN drops.
- Keystrokes and barcode scanning must remain responsive ($< 30\text{ms}$) even with catalogs of 100,000+ items.
- In-store multi-counter terminals must discover each other and share master snapshots without broadband internet.

## Decision

### 1. Local Storage: SQLite with WAL & FTS5
- **Engine:** SQLite 3 with Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) and `PRAGMA synchronous = NORMAL;`.
- **Full-Text Search:** SQLite `FTS5` virtual table indexing product names, generic names, print names, HSN codes, and barcodes for sub-10ms typeahead across 100,000 SKUs.
- **Zero Browser Limits:** Complete elimination of IndexedDB and 5MB `localStorage` hacks.

### 2. Idempotent Sync Queue Architecture
- Every local mutation (Invoice creation, Purchase receipt, Stock adjustment) inserts:
  1. The business record in its local SQLite table.
  2. A task row into `sync_queue`: `[id, entity_type, entity_id, payload_json, status, retry_count, created_at]`.
- An asynchronous background worker pulls pending queue items and dispatches them to the backend API over HTTPS.
- Requests include an immutable UUID `idempotency_key`. The server tracks processed keys in `sync_ingested_events`, ensuring network retries never produce duplicate transactions.

### 3. In-Store LAN Protocol
- The primary store workstation runs an embedded lightweight HTTP listener (port `18181`).
- Secondary billing stations discover the primary workstation via UDP multicast / mDNS service broadcast (`_lamsuite._tcp.local`).
- Secondary stations pull delta master data directly over LAN when WAN is offline:
  `GET http://<primary-ip>:18181/lan/v1/pull?since=<timestamp>`.

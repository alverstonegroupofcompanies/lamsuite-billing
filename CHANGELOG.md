# Changelog

## 2.0.38 — 2026-11-17

Centralized-billing completion release: payments and settlement, GST compliance,
price lists, sales orders, loyalty, accounting exports, B2B portal, Malayalam
i18n, central backup/restore, day close, shared catalog, GST working papers and
password reset — plus critical route and authentication hardening.

### Security and authentication

1. **Device-authenticated sync** — every sync push endpoint requires the paired workstation token (`X-Device-Token`); revoked, locked and pending devices and suspended stores are rejected, and writes are pinned to the device's own store. Cross-store payloads fail with a tenant-isolation 403.
2. **Offline staff cache** — requires device authentication, derives the store from the device instead of the request, excludes global super-admins, and is served `Cache-Control: no-store, private`.
3. **Admin unlock** — scoped to the device's store, rate-limited to six attempts per minute, audited on failure, and free of account-enumeration differences.
4. **Staff login throttling** — 30 attempts per minute with a dedicated limiter key.
5. **Biometric no-op removed** — the desk login no longer offers a flag-only biometric session without a real credential.
6. **Store switching** — clears the previous store's legacy device token so a push never carries another pharmacy's credential.

### Payments and settlement

7. **Provider-agnostic payment config** with UPI intent QR generation on the POS tender screen.
8. **Settlement import and reconciliation** — batch import, line matching and admin review.
9. **Gift cards and store credit** — ledger-backed issuance, redemption and balance enquiry at tender.

### GST compliance

10. **Compliance data model and service** — e-invoice/e-way bill metadata captured per document, surfaced in POS, print and admin.
11. **Compliance API** — backfill, import/export and admin dashboard.
12. **GST working papers** — GSTR-3B, 2B reconciliation and annual 9/9C summaries.

### Sales

13. **Price lists** — customer- and channel-scoped pricing resolved in the POS cart.
14. **Sales orders and delivery challans** — draft-to-dispatch workflow with Rule 55 challans.
15. **Loyalty points and coupons** — earn/burn ledger, coupon validation and POS redemption.

### Exports and portal

16. **Accounting exports** — Tally, Busy and CSV exports with admin download.
17. **B2B customer portal** — token-scoped portal access with statement and invoice views.
18. **Malayalam i18n groundwork** and staff password reset.

### Operations

19. **Central backup and restore** — scheduled and manual database backups with in-app restore.
20. **Store day close** — cash reconciliation, variance reporting and admin day-close review.
21. **Shared central catalog** — publish catalog snapshots from admin and pull them at the store.
22. **Signed webhook outbox** — retried, signed webhook delivery with an admin log.

## 2.0.37 — 2026-11-16

33-item billing correctness, security and keyboard release, followed by a
desktop QA verification pass. Findings and root causes:
`docs/BUGFIX_2026-11_FINDINGS_AND_PLAN.md`. Published shortcut map:
`docs/KEYBOARD_SHORTCUTS.md` and `specs/keyboard-shortcuts.json`.

### Dashboard

1. **Sales missing / dates shifted** — invoice dates are treated as store-local calendar dates; dashboard "today/week/month" is computed in the store's configured timezone on desktop and in the admin API, and the admin dashboard now returns `timezone`.
2. **Duplicate recent invoices / returns** — all dashboard, bills and report reads de-duplicate with the shared `documentIdentity.dedupeDocuments` helper, so a document cached under local and server ids appears once; returns stay separate entries with negative amounts.
3. **Empty GST Quick View** — slabs are accumulated from document lines through the shared tax engine, with header-level fallback for server-ingested bills, 0/5/12/18/28 slabs pre-seeded and explicit composition / no-tax copy.

### POS billing

4. **Hold / Recall shortcuts** — Hold is `Alt+H`, Recall is `Alt+L`; every POS `F8`/`F9` alias was removed so global Counters (`F8`) and Import/Export (`F9`) are never shadowed.
5. **Quantity accepted letters** — the shared `SmartQtyInput` parser rejects non-numeric and multi-decimal input inline, sanitises paste, never emits text/NaN and mirrors the server quantity contract.
6. **Batch edit shortcut** — `Alt+E` opens the batch/expiry editor for the active line.
7. **Scoped `Alt+D` / `Alt+P`** — doctor and patient shortcuts only fire on pharmacy POS; purchase reuses `Alt+D` for bill date and `Alt+P` is inert elsewhere.
8. **Line discount shortcut** — `Alt+I` opens the line discount editor through the central key map.
9. **Loose-only quantity rejection** — products whose unit does not allow loose sale reject pack+loose quantities in POS, returns and purchase with a structured error instead of silently rounding.

### Invoices and edit approval

10. **Pinned default period** — Past Bills opens on the owner-configured store period (`workspace.billsDefaultPeriod`); a staff-chosen pin overrides it for that user.
11. **Next / previous period keys** — `Alt+→` and `Alt+←` move the register period.
12. **Payment and status filter keys** — `Alt+Shift+P` cycles the payment filter and `Alt+S` cycles the status filter.
13. **Modal stacking** — dialogs render through the shared `ModalStackProvider / ModalLayer`, get correct stacking order, focus trap, focus restore and `Escape` handling; the invalid `z-60` class is gone.
14. **Default PINs removed** — no default or hardcoded PIN/password remains in invoice edit authorization, settings, seeds or database defaults. Seeded accounts must reset; client authorization fails closed.
15. **Admin allow-edit / one-time PIN** — administrators issue a single-use, invoice- and user-bound PIN that expires in minutes, is shown once, stored only as a salted hash and audited on issue, use, failure and revoke. Managers may also approve with their own credentials and permission.
16. **Cancel-edit shortcut** — `Ctrl+Q` cancels the current invoice edit session from edit scope only.

### Sales return

17. **Customer invoices and walk-in search, optional debit note** — returns search the selected customer's invoices and walk-in bills, and a return can produce an optional debit note without forcing one.

### Purchase

18. **Supplier quick-add prefill** — the typed supplier name pre-fills the quick-add form, focus moves to phone/GSTIN, and the new supplier is selected with focus returned to the header.
19. **`Alt+S` supplier vs Switch Store** — Switch Store moved to `Ctrl+Alt+S` everywhere; `Alt+S` focuses the supplier on purchase and cycles status on bills.
20. **Batch combobox** — the purchase grid reuses `BatchCombobox`, scoped to the product, and selecting a batch fills expiry and rates or allows typing a new batch.
21. **Free quantity pack + loose** — free quantity uses the shared pack/loose input and is stored in base units with the same validation as paid quantity.
22. **Percent / amount discount** — line and bill discounts accept `5%` or a flat amount, persist `{type, value}` and toggle with `Alt+Y` per line.
23. **Optional batch/expiry by store type** — `batch_required` defaults to true only for pharmacy, is editable in admin settings, and batchless stock is stored and rendered as `NULL` instead of placeholders.
24. **Manufacturing date** — an optional MM/YY manufacturing date column is captured on purchase lines, validated against expiry and persisted.
25. **Quick-add product prefill + add row** — opening quick-add resets the form with the typed query and exposes an arrow-key-reachable “+ Add new product” row that opens the prefilled modal.
26. **Editable HSN / PTR / PTS / PTSS / discount** — these fields are editable inline on draft and committed rows, PTR/PTS/PTSS follow the store setting, HSN is validated as 4/6/8 digits and all values persist on server, admin and MCP paths.

### Stock

27. **Bulk adjustment** — the stock adjustment document supports multi-line entry and tab/comma paste of product, batch and quantity rows, then posts as one document.
28. **Admin restrictions enforced server-side** — adjustment policy (who may adjust and whether approval is required) is enforced by the backend, not only hidden in the UI, and every policy change is audited.

### Staff login, counters and devices

29. **Offline login** — the offline staff directory verifies Argon2id with a bcrypt fallback, stores only device-bound encrypted hashes in the OS-backed vault, fails closed, locks out local guessing, and queues offline audit events for sync.
30. **Store Switch reappearing** — the store gateway is shown only when the registry is empty, the operator asks for it, or no active store exists; it no longer reappears after a successful sign-in.
31. **Counter-name uniqueness** — counter names are unique per store, case- and whitespace-insensitive, across active, locked and pending counters; enrolment and rename return `422 COUNTER_NAME_TAKEN` with the holder, and auto-registration suffixes duplicates.
32. **One active counter per user** — a second sign-in returns `409 ACTIVE_SESSION_ELSEWHERE` with the active session. Privileged roles may force the old session out; `allow_multi_counter_roles` exempts configured roles. Stale sessions expire after 30 minutes and forced-out sessions lose their tokens.
33. **Device presence in workstations** — heartbeats refresh device, counter, user, version and sync identity, never fabricate or resurrect a session, revoked devices return `403 lock_and_reset`, and the Counters screen plus admin Devices page show live presence with lock, unlock, force-logout and revoke.

### Cross-cutting

- **Keyboard map** — every shortcut lives in `frontend/src/lib/keyboard/centralKeyMap.ts`; buttons, POS hint strip and the Shortcuts panel read from it. Same-scope conflicts fail the test suite; intentional screen-over-global overrides are published. Current map: 71 bindings, 0 conflicts.
- **API parity** — admin panel gains store timezone, security/offline and multi-counter settings, pharmacy batch requirement, RBAC-scoped device-session routes, correct audit action filters and role-gated edit-PIN issuance. MCP tools were aligned to the real API paths, with dashboard, stock-adjustment, device-session and counter tools added.
- **Tests** — new feature tests for counter uniqueness, staff session policy, security-audit sync, admin timezone/access, plus frontend tests for key-map drift, shortcut dispatch, quantity validation, modal stacking, approval PIN, offline login, device heartbeat side effects and session conflicts.

### QA verification pass

- **Navigation at 1280 px** — items compact at `xl`, F-key and version hints collapse below `2xl`; all 11 destinations stay visible without horizontal scroll at 1280×800 and 1440×900.
- **Bill detail integrity** — taxable subtotal, CGST/SGST/IGST, grand total and payment tenders are read from the invoice snapshot; server tender lines are normalized and persisted, and an unpaid balance is never fabricated when no tender exists.
- **GSTR-1** — duplicate documents are de-duplicated and taxable values come from invoice lines, with correct B2B/B2CS classification.
- **Customer GSTIN** — the POS header validates the 15-character format live, the state code flips the cart between CGST/SGST and IGST, and checkout blocks an invalid GSTIN instead of issuing a malformed B2B invoice.
- **Masters** — empty product/batch saves surface their validation toast above the modal, batch expiry accepts `YYYY-MM` and `YYYY-MM-DD`, and expired, expiring-soon and negative-stock rows are visually flagged.
- **Sign-out and device honesty** — forced sign-out clears the credential form, session-conflict and heartbeat noise is reduced, and devices report the real app version (`Version unknown` when absent) instead of a fabricated default.
- **Sync integrity** — product pushes skip rows without an external id or name rather than creating placeholder products.

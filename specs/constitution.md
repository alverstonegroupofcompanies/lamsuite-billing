# LamSuite Billing — Store Scope Constitution

**Status:** Enforced (CI-guarded) since v2.1.0
**Change authority:** Any change that touches product/catalog data flow MUST keep this document true. The tests in `backend/tests/Feature/Constitution/` fail CI when violated.

---

## P-STORE-SCOPE: Products belong to one store only

Every product belongs to exactly one store. Stores do not share products.

A product's **batches, rates, barcodes, groups, brands, manufacturers, images, price-list entries and history** all belong to the same single store as the product. Two stores always have completely separate product lists, even for the identical physical medicine.

### Units are store-scoped (carve-out reversed, 2026-11-19)

**Units are NOT shared.** Every unit in `master_lookups` belongs to exactly one store (`store_id` NOT NULL for units). Each store gets the default unit set seeded at billing app start (and on store creation), can add or remove units, and can reset its unit set to the defaults. A unit that is assigned to products cannot be deleted until its products are reassigned to a replacement unit — the delete is rejected with the referencing products listed, and completes only via an explicit reassign-then-delete. Other generic lookup masters keep the legacy shared rule (`store_id = NULL` rows stay global). Product rows never reference another store's lookups.

### Rules

| # | Rule | Enforcement |
|---|------|-------------|
| R1 | `products.store_id` is NOT NULL and every product row belongs to exactly one store. | Schema test |
| R2 | A barcode is unique **within a store**. The same barcode may exist in two stores as two independent products. Duplicate barcode on create/import/sync → HTTP 422 naming the existing product. | Unique index `(store_id, barcode)` + API tests |
| R3 | A product batch cannot exist in a different store than its product. Cross-store batch rows are impossible at the data layer (trigger / composite FK). | Schema test + runtime insert test |
| R4 | Stock ledger entries, transfer items and price-list rows are store-scoped; transfer items reference the sending store's product. | Schema test |
| R5 | There is **no central catalogue**: no product family linkage (`product_family_id`, `source_product_id` are forbidden columns), no publish/unpublish flow. Sync upserts are keyed by `(store_id, external_id)` — a till can never hijack another store's product. | Schema test + scan test |
| R6 | A product is visible, editable, archivable and deletable only within its own store. Cross-store IDs are 404 for POS/staff endpoints; admin cross-store views always display a store column and are read-only aggregation. | Query-scope scan + API tests |
| R7 | Archives/deletes are per-store and never leak: deactivating a product in store A leaves store B untouched. | API tests |
| R8 | Parties (customers/suppliers/doctors) are governed by their own spec — **not** by this constitution. | Scope note |
| R9 | Rate/tax revisions apply per store. A multi-store price change is N separate previewed jobs. | Copy-tool + revision tests |
| R10 | Imports target exactly one store, confirmed by name on the confirmation step. Exports are store-filtered. | Import tests |
| R11 | Units are store-scoped: every unit row belongs to one store, defaults are seeded per store (store creation, billing app start, first use), and the set can be reset to defaults. An assigned unit cannot be deleted until its products are reassigned to a replacement unit. | `UnitStoreScopeTest` + till dom tests |
| R12 | **Charge heads are store-scoped** (CR-C, 2026-11-19): every `master_lookups` row of type `charge_head` belongs to exactly one store (`store_id NOT NULL`), the defaults (`Freight`, `Packing`, `Loading/Unloading`, `Insurance`, `Other`) are seeded per store, the set can be reset, and a head already referenced by purchase charges cannot be deleted until reassigned. A till's delta pull for `charge_head` returns only its own store's rows — the same branch as units, never the legacy shared+own fallback. Posted charges carry the head **code and name** on the row, so a bill never depends on another store's master. | `ChargeHeadStoreScopeTest` + till tests |

### Flows under P-STORE-SCOPE

- **Copy products to another store** (replaces the removed publish flow): a one-time, audited, reversible admin tool. Copies carry masters (shared lookups referenced; private group/brand copies created) and rates — **never** stock, batches or history — and are fully independent after copy (no link, no further sync).
- **Inter-store transfers**: the receiver matches incoming lines by **barcode, then item code**. Unmatched lines become "create in my store" (prefilled, unlinked) or "map to existing" (mapping remembered per store pair). Ledger entries are written in **both** stores.
- **Consolidated reports** group lines by an admin-chosen matching key per run (barcode → item code → name+unit) and list unmatched lines separately; no merges are stored.
- **Offline tills**: products created offline sit in a "waiting to sync" state and are persisted before any success is shown; conflicts route to the sync centre, never overwrite another store's row.
- **Unit lifecycle per store**: the default unit set (Strip, Tablet, Capsule, Bottle, Box, Kilogram, Litre, …) is seeded when a store is created, when the billing app starts, and on first units read; "Reset to defaults" restores missing defaults, removes unused custom units and keeps assigned ones; deleting a unit that products reference is rejected with the referencing product list and completes only as reassign-then-delete. Till unit deltas pull only their own store's units.
- **Charge-head lifecycle per store** (R12): the default charge-head set is seeded when a store is created and on the first charge-head read from either app; "Reset to defaults" restores missing defaults, removes unreferenced custom heads and keeps referenced ones; deleting a head that posted charges reference is rejected with the referencing bills listed and completes only as reassign-then-delete. Till pull-delta for `charge_head` delivers only that store's rows.

### Shared vs store-scoped reference

| Data | Scope |
|------|-------|
| Units / uom | Store-scoped (carve-out reversed — per-store defaults, reset, reassign-before-delete) |
| Groups, brands, manufacturers | Store-scoped (copies travel with the product on copy) |
| Products, barcodes, rates, images, batches, stock, history | Store-scoped |
| Parties, invoices, purchases, payments | Store-scoped (separate spec) |
| Charge heads (`master_lookups.type = charge_head`) | Store-scoped (R12) — never shared, never NULL-store |
| Users, devices, counters | Per existing IAM spec |

### CI guards

- `ProductStoreScopeSchemaTest` — schema shape (R1–R5) and runtime cross-store insert impossibility (R3).
- `ProductQueryScopeTest` — static scan: any `Product::` query in `app/` must be store-scoped or carry a `@store-scope-ok: <reason>` annotation for reviewed cross-store admin aggregation code (R6).
- `UnitStoreScopeTest` — per-store unit seeding, isolation, reset, delete guard with reassignment, cross-store 404, per-store pull-delta (R11).
- `ChargeHeadStoreScopeTest` — per-store charge-head seeding, isolation, reset to defaults, delete guard with reassignment, cross-store 404, per-store pull-delta branch, and that a posted purchase charge keeps its head code/name when the head is deleted (R12).

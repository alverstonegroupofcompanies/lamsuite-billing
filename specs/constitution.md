# LamSuite Billing — Store Scope Constitution

**Status:** Enforced (CI-guarded) since v2.1.0
**Change authority:** Any change that touches product/catalog data flow MUST keep this document true. The tests in `backend/tests/Feature/Constitution/` fail CI when violated.

---

## P-STORE-SCOPE: Products belong to one store only

Every product belongs to exactly one store. Stores do not share products.

A product's **batches, rates, barcodes, groups, brands, manufacturers, images, price-list entries and history** all belong to the same single store as the product. Two stores always have completely separate product lists, even for the identical physical medicine.

### The one carve-out: common master lookups

**Common master items like units remain shared across stores.** Generic lookup masters in `master_lookups` with `store_id = NULL` are global (units/uom and similar system-wide enumerations). A store may additionally keep its own private lookups (`store_id` set) when it needs a local variant. Product rows never reference another store's private lookups.

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

### Flows under P-STORE-SCOPE

- **Copy products to another store** (replaces the removed publish flow): a one-time, audited, reversible admin tool. Copies carry masters (shared lookups referenced; private group/brand copies created) and rates — **never** stock, batches or history — and are fully independent after copy (no link, no further sync).
- **Inter-store transfers**: the receiver matches incoming lines by **barcode, then item code**. Unmatched lines become "create in my store" (prefilled, unlinked) or "map to existing" (mapping remembered per store pair). Ledger entries are written in **both** stores.
- **Consolidated reports** group lines by an admin-chosen matching key per run (barcode → item code → name+unit) and list unmatched lines separately; no merges are stored.
- **Offline tills**: products created offline sit in a "waiting to sync" state and are persisted before any success is shown; conflicts route to the sync centre, never overwrite another store's row.

### Shared vs store-scoped reference

| Data | Scope |
|------|-------|
| Units / uom and system enumerations | Shared (`master_lookups.store_id IS NULL`) |
| Groups, brands, manufacturers | Store-scoped (copies travel with the product on copy) |
| Products, barcodes, rates, images, batches, stock, history | Store-scoped |
| Parties, invoices, purchases, payments | Store-scoped (separate spec) |
| Users, devices, counters | Per existing IAM spec |

### CI guards

- `ProductStoreScopeSchemaTest` — schema shape (R1–R5) and runtime cross-store insert impossibility (R3).
- `ProductQueryScopeTest` — static scan: any `Product::` query in `app/` must be store-scoped or carry a `@store-scope-ok: <reason>` annotation for reviewed cross-store admin aggregation code (R6).

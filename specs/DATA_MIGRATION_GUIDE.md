# LamSuite Store Data Migration Guide

This document covers the end-to-end procedure for migrating an active store from legacy LamSuite Billing (React/Vite PWA + Laravel backend) to the new desktop Tauri billing workstation and cloud console.

---

## 1. Supported Migration Sources

1. **Direct Legacy Laravel API**:
   - URL: `https://billing-legacy.yourstore.com`
   - Authentication: Sanctum Token or Admin credentials.
   - Paging, retries, and rate limits are handled automatically.
2. **Offline File Bundle (`.json` or `.json.gz`)**:
   - Useful when the old server is unreachable or offline.
   - Generated using the Artisan command in the old backend:
     ```bash
     php artisan lamsuite:export-store {store_id} --output=/path/to/migration_bundle.json.gz --gzip
     ```
3. **Device Local / Unsynced Recovery**:
   - Recovers unsynced offline data residing on specific workstations (held POS bills, uncommitted sync queue, local master drafts).
   - In the old React PWA client, use `downloadDeviceMigrationBundle()` to download the device export JSON and import it into the wizard.

---

## 2. Entity Mapping & Conversion Rules

| Legacy Entity | Target Entity | Mapping & Normalization Rules |
|---|---|---|
| `stores`, `store_settings`, `company_settings` | `stores`, `company_settings` | Tax mode (`inclusive`/`exclusive`), GSTIN, Drug License numbers, FSSAI, invoice prefixes, and menu toggles preserved. |
| `master_groups`, `brands`, `units`, `banks`, `locations`, `departments`, `designations`, `discount_schemas` | `master_lookups` | Normalized into single polymorphic `master_lookups` table. Pack conversions (`units_per_pack`) preserved in `config` JSON. |
| `customers`, `suppliers`, `prescriptions` | `parties` | Unified into `parties` table (`type`: `customer`, `supplier`, `doctor`, `patient`). Opening balance, current balance, credit limits, and registration numbers mapped. |
| `billing_app_users` | `users` | Roles normalized to `store_owner`, `manager`, `accountant`. Existing bcrypt/argon password hashes preserved safely. |
| `products`, `product_batches` | `products`, `product_batches` | Barcodes, HSN/SAC, category/brand/unit FK mappings, rates (`MRP`, `sel_rate`, `PTR`, `PTS`, `tax %`), rack/shelf locations. Batch on-hand quantities reproduced exactly. |
| Negative Stock Batches | `stock_adjustments` | Batches with negative on-hand balance are flagged with automatic audit adjustment note `MIGRATION_NEGATIVE_OPENING_RECONCILED`. |
| `invoices`, `invoice_items` | `invoices`, `invoice_items` | Original document numbers, dates, customer tags, line items, round-offs, payment modes, and cancellations preserved. |
| `purchase_documents` | `purchases`, `purchase_items` | Bills and debit notes preserved with supplier linkages and tax amounts. |
| Device Held Bills | `invoices` (Draft) | Converted into draft invoices tagged with original basket label. |

---

## 3. Step-by-Step Migration Wizard Workflow

1. **Step 1: Choose Source & Scope**:
   - Select Source (File Bundle, Live API, or Device Recovery).
   - Enter credentials or file path, and specify the target Store ID.
2. **Step 2: Pre-Check & Quality Diagnostics**:
   - Automated scans check for duplicate barcodes, missing HSN/GSTIN, negative stock, and orphan batches.
   - Any device with pending unsynced queue items triggers an alert.
3. **Step 3: Entity Mapping Review**:
   - Review auto-mapped fields and transformation rules.
4. **Step 4: Dry-Run Simulation**:
   - Simulates execution within a rolled-back transaction to forecast row counts, execution time, and potential issues without writing any data.
5. **Step 5: Background Live Migration & Reconciliation**:
   - Processes all entities in strict dependency order inside atomic transactions.
   - Automatically cross-checks source vs migrated totals:
     - Record counts per entity.
     - Sales and purchase totals matching to the paisa (`₹0.00` variance).
     - Tax totals grouped by GST slab (0%, 5%, 12%, 18%, 28%).
     - Stock quantity and valuation per batch.
     - Customer and supplier balances.
   - Supports 1-click **Rollback** if any issues are detected.
6. **Step 6: Store Cutover**:
   - Requires typing the exact confirmation phrase `CUTOVER-<STORE_CODE>`.
   - Freezes legacy store, activates counters on the new workstation, and generates the final audit log.

---

## 4. Rollback & Disaster Recovery

- Every migrated record is tracked in `migration_id_maps`.
- Triggering rollback deletes all created records in reverse dependency order (invoices -> purchases -> adjustments -> batches -> products -> parties -> lookups).
- Pre-migration database backup files are created automatically in `storage/app/backups/`.

---

## 5. Troubleshooting & FAQ

- **Q: What happens if an item has a missing or duplicate barcode?**
  - Duplicate barcodes are surfaced during Pre-Check. The pipeline preserves both products and appends the source ID to prevent collision.
- **Q: Will customer and supplier balances match?**
  - Yes. The opening and current balances are preserved and cross-verified during Step 5 reconciliation.
- **Q: Are raw passwords ever exposed?**
  - No. Existing Bcrypt/Argon2 hashes are copied as raw hashes. If a hash uses an unrecognized legacy format, a randomized secure hash is generated and the user is prompted to reset password on first login.

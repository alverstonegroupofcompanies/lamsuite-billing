# LamSuite Billing — Import / Export & Data Exchange Specification

## 1. Executive Summary & Architecture

The LamSuite Data Exchange module provides a unified, offline-first, pluggable data exchange architecture for desktop (Tauri/React), backend API (Laravel), and autonomous AI tooling (Model Context Protocol).

### Key Architectural Pillars
- **Central Pluggable Registry:** Any new entity requires only **one** declarative definition file adhering to `EntityDefinition`. It defines fields, types, statutory validations, default values, duplicate keys, foreign key resolution, and transactional post-import hooks.
- **Universal Multi-Format Parser:** Zero-dependency, stream-tolerant parser for RFC 4180 CSV/TSV with automated delimiter sniffing (`comma`, `tab`, `semicolon`, `pipe`) and Excel 2003+ SpreadsheetML XML worksheets.
- **Fuzzy & Presetted Column Mapping:** Intelligent column matching with built-in presets for standard exports from **Marg ERP 9+**, **Busy Accounting 21+**, **Tally Prime**, and **LamSuite Standard**.
- **Indian Statutory & Retail Validations:** Strict enforcement of 15-character GSTIN checksums, 2/4/6/8-digit HSN codes, Indian date formats (`DD-MM-YYYY`, `DD/MM/YYYY`), Excel date serial conversions (e.g. `45200`), exact 2-4 decimal rounding, and retail checks (e.g. `sel_rate <= mrp`).
- **Transactional Atomic Execution & Rollback:** Imports are executed in transactional batches. Each import snapshot is stored in `import_history`, enabling one-click full rollback/undo while keeping the local audit log and sync queue clean.
- **Non-Blocking Background Processing:** Cooperative time-sliced worker architecture ensures files with 100,000+ rows process smoothly without freezing POS counters or UI rendering.
- **Full API & MCP Parity:** Identical capabilities across the Tauri Desktop UI (`F9` shortcut), Laravel REST API (`/api/v1/data-exchange/*`), and MCP Server tools (`lamsuite_get_import_template`, `lamsuite_export_data`, `lamsuite_import_data`).

---

## 2. Pluggable Entity Definitions (22 Entities)

### 2.1 Catalog & Inventory

#### 1. Items (`items`)
- **Category:** Master Data
- **Storage Table:** `items`
- **Duplicate Keys:** `barcode`, `code`, `name`
- **Field List:**
  | Field | Type | Required | Default | Validation / Notes |
  |---|---|---|---|---|
  | `barcode` | String | Yes | — | Unique primary barcode / SKU |
  | `name` | String | Yes | — | Product description / trade name |
  | `code` | String | No | — | Optional internal alphanumeric code |
  | `hsn_sac_code` | String | No | `"300490"` | 2, 4, 6, or 8 statutory digits |
  | `gst_percent` | Number | No | `12` | GST rate (0, 5, 12, 18, 28) |
  | `cess_percent` | Number | No | `0` | Additional cess percentage |
  | `mrp` | Number | Yes | — | Maximum Retail Price (INR) |
  | `sel_rate` | Number | Yes | — | Selling price (must be <= MRP) |
  | `ptr` | Number | No | — | Price to Retailer (must be <= MRP) |
  | `pts` | Number | No | — | Price to Stockist (must be <= PTR) |
  | `cost_price` | Number | No | — | Baseline purchase cost |
  | `units_per_pack` | Number | No | `1` | Conversion factor (> 0) |
  | `unit_name` | String | No | `"TAB"` | Unit of measurement (Strip, Vial, Box, etc.) |
  | `group_name` | String | No | `"General"` | Item classification group |
  | `brand_name` | String | No | — | Brand / Line |
  | `manufacturer` | String | No | — | Pharmaceutical / FMCG manufacturer |
  | `drug_category` | String | No | `"SCHEDULE_H"` | Narcotic, Schedule H, H1, OTC |
  | `rack_location` | String | No | — | Physical shelf / rack location |
  | `min_stock` | Number | No | `10` | Low-stock alert threshold |
  | `max_stock` | Number | No | `500` | Over-stock ceiling threshold |
- **Sample Row:**
  `"8901234567890","Paracetamol 650mg","PCM650","300490",12,0,32.50,30.00,24.50,22.00,23.00,10,"STRIP","Analgesics","Dolo","Micro Labs","SCHEDULE_H","R1-S2",50,500`

#### 2. Batches & Opening Stock (`batches`)
- **Category:** Master / Inventory
- **Storage Table:** `batches`
- **Duplicate Keys:** Composite `[item_id, batch_no]`
- **Post-Import Hook:** Automatically posts an `OPENING_STOCK` credit transaction to `stock_transactions` and updates item current stock balance.
- **Field List:**
  | Field | Type | Required | Default | Validation / Notes |
  |---|---|---|---|---|
  | `barcode` | String | Yes | — | References existing product barcode |
  | `batch_no` | String | Yes | — | Manufacturer batch number |
  | `expiry_date` | Date | Yes | — | Format: `DD-MM-YYYY` or `MM/YY` |
  | `mfg_date` | Date | No | — | Format: `DD-MM-YYYY` |
  | `mrp` | Number | Yes | — | Batch-specific MRP |
  | `sel_rate` | Number | Yes | — | Batch-specific selling rate |
  | `ptr` | Number | No | — | Batch-specific PTR |
  | `stock_qty` | Number | Yes | `0` | Opening physical quantity in loose units |
- **Sample Row:**
  `"8901234567890","BATCH-2024A","31-12-2026","01-01-2024",32.50,30.00,24.50,150`

#### 3. Groups (`groups`), Brands (`brands`), Manufacturers (`manufacturers`), Units (`units`)
- **Category:** Classification Masters
- **Storage Table:** `master_lookups` (indexed by `type`)
- **Duplicate Keys:** `name` / `code`
- **Field List:**
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `name` | String | Yes | Master name (e.g. "Antibiotics", "Cipla") |
  | `code` | String | No | Short code (e.g. "ANTI", "CIP") |
  | `description` | String | No | Detailed note |

---

### 2.2 Parties & Contacts

#### 1. Customers (`customers`), Patients (`patients`)
- **Category:** Parties
- **Storage Table:** `customers`
- **Duplicate Keys:** `phone`, `gstin`, `code`, `name`
- **Field List:**
  | Field | Type | Required | Default | Validation / Notes |
  |---|---|---|---|---|
  | `name` | String | Yes | — | Full customer / patient name |
  | `phone` | String | No | — | 10-digit Indian mobile number |
  | `email` | String | No | — | Standard email format |
  | `gstin` | String | No | — | Statutory 15-character GSTIN |
  | `pan` | String | No | — | 10-character PAN |
  | `credit_limit` | Number | No | `0` | Max outstanding credit allowed |
  | `address_line1` | String | No | — | Street / Building address |
  | `city` | String | No | — | City / Town |
  | `place_of_supply` | String | No | `"KL"` | 2-digit Indian State code or ISO code |
  | `discount_percent` | Number | No | `0` | Customer-level trade discount % |

#### 2. Suppliers (`suppliers`)
- **Category:** Parties
- **Storage Table:** `suppliers`
- **Duplicate Keys:** `gstin`, `phone`, `name`
- **Field List:**
  | Field | Type | Required | Default | Validation / Notes |
  |---|---|---|---|---|
  | `name` | String | Yes | — | Vendor / Distributor legal name |
  | `gstin` | String | No | — | 15-character GSTIN |
  | `dl_number` | String | No | — | Drug License 20B/21B number |
  | `phone` | String | No | — | Phone / Landline |
  | `email` | String | No | — | Supplier email address |
  | `credit_days` | Number | No | `30` | Payment credit period in days |

#### 3. Doctors (`doctors`)
- **Category:** Medical Masters
- **Storage Table:** `doctors`
- **Duplicate Keys:** `reg_number`, `phone`, `name`
- **Field List:**
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `name` | String | Yes | Doctor full name (e.g. "Dr. K. S. Nair") |
  | `reg_number` | String | No | State Medical Council registration no |
  | `specialization` | String | No | Specialty (e.g. "Cardiology") |
  | `hospital_clinic` | String | No | Hospital or Clinic affiliation |
  | `phone` | String | No | Contact number |

---

### 2.3 Financial & Accounting Masters

#### 1. Discount Schemas (`discount_schemas`)
- **Storage Table:** `discount_rules`
- **Fields:** `schema_name` (Req), `discount_percent` (Req), `min_bill_amount`, `apply_to_group`, `valid_until`

#### 2. Bank Accounts (`bank_accounts`)
- **Storage Table:** `bank_accounts`
- **Fields:** `account_name` (Req), `bank_name` (Req), `account_number` (Req), `ifsc_code` (Req, 11-char IFSC), `branch_name`, `upi_id`

#### 3. Expense Heads (`expense_heads`)
- **Storage Table:** `expense_heads`
- **Fields:** `head_name` (Req), `category` (`DIRECT` or `INDIRECT`), `code`, `tax_deductible`

#### 4. Party Opening Balances (`customer_opening_balances`, `supplier_opening_balances`)
- **Storage Table:** `party_ledgers` / `customers` / `suppliers`
- **Post-Import Hook:** Automatically posts an `OPENING_BALANCE` ledger entry and updates party `current_balance`.
- **Fields:** `party_name` (Req), `phone_or_gstin`, `balance_amount` (Req), `balance_type` (`DR` or `CR`, Req), `as_of_date` (`DD-MM-YYYY`)

---

### 2.4 Transaction Documents

#### 1. Sales Invoices (`sales_invoices`)
- **Storage Table:** `invoices`
- **Duplicate Keys:** `invoice_number`
- **Period Lock Check:** Disallows import into closed financial years or locked GST periods.
- **Fields:** `invoice_number` (Req), `invoice_date` (Req), `customer_name`, `customer_phone`, `place_of_supply`, `payment_mode`, `subtotal`, `taxable_amount`, `cgst_amount`, `sgst_amount`, `igst_amount`, `total_amount` (Req), `notes`

#### 2. Purchases (`purchases`)
- **Storage Table:** `purchases`
- **Duplicate Keys:** Composite `[supplier_name, invoice_number]`
- **Fields:** `supplier_name` (Req), `supplier_gstin`, `invoice_number` (Req), `invoice_date` (Req), `taxable_amount`, `cgst_amount`, `sgst_amount`, `igst_amount`, `total_amount` (Req), `payment_status`

#### 3. Sales Returns (`sales_returns`) & Purchase Returns (`purchase_returns`)
- **Duplicate Keys:** `return_number`
- **Fields:** `return_number` (Req), `original_invoice_no`, `return_date` (Req), `party_name` (Req), `total_amount` (Req), `reason`

#### 4. Quotations (`quotations`)
- **Duplicate Keys:** `quotation_number`
- **Fields:** `quotation_number` (Req), `quotation_date` (Req), `customer_name`, `valid_until`, `total_amount` (Req)

---

### 2.5 Stock Events & Adjustments (`stock_events`)
- **Storage Table:** `stock_transactions`
- **Post-Import Hook:** Adjusts current product inventory ledger immediately.
- **Fields:** `barcode` (Req), `batch_no`, `event_type` (`DAMAGE_WRITE_OFF`, `SPILLAGE`, `FOUND_AUDIT`, `THEFT`, `CORRECTION`), `qty` (Req), `reason`

---

## 3. Statutory Validation Rules

### 3.1 GSTIN Validation (Indian Goods and Services Tax Identification Number)
- **Length:** Exactly 15 characters, uppercase alphanumeric.
- **Regex:** `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`
- **Structure Breakdown:**
  - Digits 1–2: State code (e.g. `32` for Kerala, `27` for Maharashtra, `29` for Karnataka)
  - Digits 3–12: 10-character PAN of the taxpayer (`[A-Z]{5}[0-9]{4}[A-Z]{1}`)
  - Digit 13: Entity number of the same PAN holder in the state (`1-9` or `A-Z`)
  - Digit 14: Default character `'Z'`
  - Digit 15: Checksum digit (`0-9` or `A-Z`)

### 3.2 HSN / SAC Codes
- Must be exactly 2, 4, 6, or 8 digits.
- Regex: `^[0-9]{2}([0-9]{2})?([0-9]{2})?([0-9]{2})?$`
- Standard pharmaceutical HSN: `3004` (medicaments), `300490` (allopathic formulations).

### 3.3 Indian Date & Excel Serial Parsing
- Input accepted:
  1. Indian calendar formats: `DD-MM-YYYY`, `DD/MM/YYYY`, `D-M-YYYY`
  2. ISO formats: `YYYY-MM-DD`, `YYYY/MM/DD`
  3. Short month formats: `DD-MMM-YYYY` (e.g. `15-OCT-2025`)
  4. Excel numeric serials: numbers between `25569` and `90000` (e.g. `45200` converts to `2023-10-01`)
- Out-of-bounds rejection: Any date with month > 12, day > 31, or invalid leap day (e.g. 29-02-2023) is flagged as an error.

### 3.4 Commercial Integrity Rules
- `Selling Rate <= MRP`: Ensures retail compliance with Indian Maximum Retail Price regulations.
- `PTR <= MRP`: Price to Retailer must not exceed MRP.
- `Units per Pack > 0`: Unit conversion factor cannot be zero or negative.

---

## 4. Software Source Presets

The column mapper includes fuzzy header recognition and built-in source presets:

| Software Preset | Source Column Names | Mapped LamSuite Field |
|---|---|---|
| **Marg ERP 9+** | `ITEM_NAME`, `PROD_NAME` | `name` |
| | `BAR_CODE`, `BARCODE` | `barcode` |
| | `BATCH`, `BATCH_NO` | `batch_no` |
| | `EXP_DATE`, `EXPIRY` | `expiry_date` |
| | `S_RATE`, `SRATE` | `sel_rate` |
| | `CONV_PACK`, `PACKING` | `units_per_pack` |
| | `HSN_CODE`, `HSNCODE` | `hsn_sac_code` |
| | `SGST_CGST`, `TAX_PER` | `gst_percent` |
| **Busy 21+** | `Item Name` | `name` |
| | `Alias`, `Item Code` | `barcode` |
| | `Batch` | `batch_no` |
| | `Exp Date` | `expiry_date` |
| | `Sale Price` | `sel_rate` |
| | `Tax %`, `Tax Rate` | `gst_percent` |
| | `HSN/SAC` | `hsn_sac_code` |
| **Tally Prime** | `Item`, `Stock Item` | `name` |
| | `Part No.` | `barcode` |
| | `Billed Qty`, `Actual Qty` | `stock_qty` |
| | `Rate` | `sel_rate` |
| | `HSN` | `hsn_sac_code` |
| | `Tax Rate` | `gst_percent` |
| **LamSuite Standard** | Exact match with LamSuite keys | Direct 100% round-trip symmetry |

---

## 5. Export Engine & Statutory Reports

### 5.1 Supported Formats
- **Excel SpreadsheetML XML (`.xls` / `.xml`):** Formatted XML with XML schema declaration, typed cells (`Number`, `String`, `DateTime`), bold column headers, auto-calculated column widths, and UTF-8 encoding.
- **CSV (`.csv`):** Fully RFC 4180 compliant with leading UTF-8 Byte Order Mark (`\uFEFF`) so Microsoft Excel on Windows renders Devanagari and Indian regional characters without mojibake.
- **PDF Document (`.pdf`):** Landscape or portrait styled tables with pagination, company headers, tax breakdown summaries, and timestamp footers generated client-side via jsPDF.

### 5.2 Statutory GST Reports
- **GSTR-1 B2B / B2CL / B2CS Summary:** Extracts invoice series, customer GSTIN, place of supply, taxable value, CGST, SGST, IGST, and cess.
- **GSTR-2 Purchase Register:** Vendor GSTIN, invoice reference, reverse charge indicator, and input tax credit (ITC) eligibility.
- **HSN / SAC Summary Table:** Consolidated quantity, total turnover, taxable value, and tax breakdown grouped by HSN code.

### 5.3 Full Store Snapshot (Backup & Restore)
- One-click encrypted SQLite export containing all tables (`items`, `batches`, `customers`, `suppliers`, `invoices`, `purchases`, `party_ledgers`, `company_settings`, and `import_history`).
- Safeguarded with an interactive warning modal and confirmation passkey before restoring.

---

## 6. Multi-Platform API Parity

### 6.1 Desktop UI (Tauri / React)
- Accessible via route `/import-export` or keyboard shortcut **`F9`**.
- Features 8-step Import Wizard:
  1. Data Type Selection
  2. File Upload & Format Sniffing
  3. Sheet Selection (SpreadsheetML)
  4. Header & Column Mapping (Auto-Suggest & Presets)
  5. Editable Preview Grid with inline cell editing
  6. Dry Run Validation (Counts of Create, Update, Skip, Errors)
  7. Conflict Policy Picker (`create_missing_masters`, `skip_duplicates`, `update_existing`, `merge`)
  8. Atomic Batch Execution with progress bar and Rollback button.

### 6.2 Laravel Backend API
- `GET  /api/v1/data-exchange/entities` — List registered entities and fields
- `GET  /api/v1/data-exchange/template/{entityType}` — Download CSV or Excel template
- `POST /api/v1/data-exchange/preview` — Parse upload and return dry run validation
- `POST /api/v1/data-exchange/commit` — Atomically commit verified batch
- `GET  /api/v1/data-exchange/export/{entityType}` — Stream export file (CSV, Excel, PDF)
- `GET  /api/v1/data-exchange/history` — Audit trail of all imports and exports
- `POST /api/v1/data-exchange/rollback/{historyId}` — Undo a previous import snapshot

### 6.3 MCP Server Tools
- `lamsuite_get_import_template`: Returns clean CSV / Excel template content or field specifications for any entity.
- `lamsuite_export_data`: Exports entities or statutory reports with filter criteria.
- `lamsuite_import_data`: Dry-runs or commits batches with configurable conflict policies.

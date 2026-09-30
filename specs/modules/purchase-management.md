# Module Spec: Purchase Management (PUR)

## 1. Overview
Purchase Management handles inward goods receipts, supplier bills, batch/expiry creation, purchase returns (vendor debit notes), and automated purchase requests. It also integrates tabular CSV/Excel imports and OCR/AI document extraction.

---

## 2. Requirement Specifications & Acceptance Criteria

### [PUR-001] Inward Purchase Bill Entry
- **Story:** As a store manager, I want to enter supplier purchase invoices with batch numbers, expiry dates, GST rates, and purchase prices so new inventory is received.
- **Acceptance Criteria:**
  - **Given** an authorized supplier,
  - **When** the manager enters Supplier Invoice No, Invoice Date, and adds products with Batch No, Mfg Date, Expiry Date, Purchase Rate (ex-tax), and GST %,
  - **Then** the line taxable value, CGST, SGST, Cess, and total are computed in real time.
  - **When** the purchase bill is saved,
  - **Then** the stock ledger is credited with new batch stock, product master prices (MRP/PTR/PTS/Sel Rate) are updated if modified, and supplier ledger balance is credited.

### [PUR-002] Free Goods & Bonus Scheme Calculation
- **Story:** As a store manager, I want to record free goods received from suppliers (e.g. Buy 10 strips + 2 free) without distorting taxable value.
- **Acceptance Criteria:**
  - **Given** a purchase line with `billed_qty: 10` and `free_qty: 2` at ₹100/unit,
  - **When** the line total is computed,
  - **Then** Taxable Value = $10 \times 100 = ₹1,000$ (free quantity is not billed).
  - **When** the bill is posted to stock,
  - **Then** total on-hand stock credited to that batch is $10 + 2 = 12$ units, and effective unit cost is recorded as $\frac{1000}{12} = ₹83.33$.

### [PUR-003] Purchase Returns (Debit Note to Supplier)
- **Story:** As a store manager, I want to return damaged or expired goods to a supplier with an automatic debit note.
- **Acceptance Criteria:**
  - **Given** inventory batches from supplier "ABC Pharma",
  - **When** the manager creates a Purchase Return selecting specific batch and return quantity,
  - **Then** a Purchase Return (`PR`) document is issued, batch stock is deducted, and supplier ledger is debited by the returned amount including reversed GST.

### [PUR-004] Purchase Requests & Reorder Indents
- **Story:** As a pharmacist or counter operator, I want to create purchase requests for items running low so the purchasing team can order them.
- **Acceptance Criteria:**
  - **Given** catalog items below their configured reorder level,
  - **When** the user clicks "Generate Low Stock Request" or manually enters items,
  - **Then** a Purchase Request (`PRQ`) is generated in `draft` or `submitted` status.
  - **When** received at the store,
  - **Then** the request can be converted into a Purchase Bill with prefilled items and quantities.

### [PUR-005] Tabular File Import (Spreadsheet / CSV)
- **Story:** As a store manager, I want to import supplier bills from Excel or CSV files with interactive column mapping.
- **Acceptance Criteria:**
  - **Given** an uploaded Excel (`.xlsx`) or CSV file,
  - **When** the user maps file columns (Item Name, Batch, Expiry, Qty, Free Qty, Rate, MRP, HSN, GST %),
  - **Then** the preview table displays parsed rows with validation highlights (missing HSN, invalid date, unmapped product).
  - **When** confirmed,
  - **Then** matched catalog items are updated, and new batches are created in one transaction.

### [PUR-006] OCR / AI Supplier Invoice Scanning
- **Story:** As a store manager, I want to upload a photo or PDF of a printed supplier invoice to extract supplier GSTIN, invoice date, lines, and batches automatically.
- **Acceptance Criteria:**
  - **Given** an uploaded PDF or image invoice,
  - **When** the OCR/AI parser processes the document,
  - **Then** Supplier GSTIN, Invoice Number, Invoice Date, and line table (Product description, HSN, Batch, Expiry, Qty, Rate, Tax %) are extracted into a review panel.
  - **When** reviewing,
  - **Then** descriptions are fuzzy-matched against the local product catalog with match confidence scores, allowing the user to confirm or reassign products before saving.

---

## 3. Offline Behavior & Conflict Rules
- **Local Autonomy:** Purchase entries, stock receipts, and returns can be completed 100% offline.
- **Batch Generation:** New batches created offline receive a deterministic unique key: `{product_id}_{batch_no}_{expiry_ymd}`.
- **Supplier Balance:** Supplier transactions sync to the backend sequentially based on document timestamp.

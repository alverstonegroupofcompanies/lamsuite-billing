# Module Spec: POS Billing & Sales (POS / RET)

## 1. Overview
The Point of Sale (POS) is the primary counter interface for retail and medical stores. It is optimized for keyboard-first operation, rapid barcode scanning, accurate multi-rate GST, pharmacy batch selection, and offline checkout.

---

## 2. Requirement Specifications & Acceptance Criteria

### [POS-001] Instant Barcode & Fast Product Lookup
- **Story:** As a cashier, I want to scan a product barcode or type product name/HSN so that the item is instantly added to the bill without touching the mouse.
- **Acceptance Criteria:**
  - **Given** the POS screen is active,
  - **When** a barcode scanner inputs a 13-digit EAN or alphanumeric barcode followed by Enter,
  - **Then** the matching product is resolved from local SQLite and added to the bill in `< 30ms`.
  - **When** multiple batches exist for the scanned item,
  - **Then** the batch picker modal opens focused on the earliest expiring batch that has available stock (`FEFO`: First-Expiry, First-Out).

### [POS-002] Pharmacy Batch & Loose Quantity Selling
- **Story:** As a pharmacist, I want to bill both full strips/packs and cut loose tablets with auto-calculated rates and accurate stock deduction.
- **Acceptance Criteria:**
  - **Given** an item "Paracetamol 500mg" with pack size of 10 tablets and MRP of ₹30/strip,
  - **When** the cashier enters `qty: 4` in loose mode,
  - **Then** the gross amount is calculated as $(4 / 10) \times 30 = ₹12.00$.
  - **When** the bill is finalized,
  - **Then** the stock ledger records a stock deduction of exactly 4 base units for that specific batch.

### [POS-003] Multi-Tier GST Computation (Inclusive & Exclusive)
- **Story:** As a billing operator, I need the system to calculate GST accurately based on item rates and company tax mode.
- **Acceptance Criteria:**
  - **Given** an item with gross value ₹105.00 and GST rate 5%,
  - **When** company sales tax mode is `inclusive`,
  - **Then** Taxable Value = $\frac{105}{1.05} = ₹100.00$, and GST Amount = ₹5.00 (CGST ₹2.50 + SGST ₹2.50 for intra-state).
  - **When** company sales tax mode is `exclusive`,
  - **Then** Taxable Value = ₹105.00, GST Amount = $105 \times 0.05 = ₹5.25$, and Total = ₹110.25.
  - **Given** an item sold at MRP,
  - **Then** the rate is strictly treated as GST-inclusive regardless of global tax mode.

### [POS-004] Statutory Indian Auto Round-Off
- **Story:** As a store owner, I want bills rounded to the nearest rupee to comply with commercial practice and cash handling.
- **Acceptance Criteria:**
  - **Given** an invoice pre-round total of ₹142.40,
  - **When** the bill totals are calculated,
  - **Then** Grand Total is ₹142.00 and Round-Off is recorded as `-0.40`.
  - **Given** an invoice pre-round total of ₹142.50,
  - **When** the bill totals are calculated,
  - **Then** Grand Total is ₹143.00 and Round-Off is recorded as `+0.50`.

### [POS-005] Split Tender & Payment Modes
- **Story:** As a cashier, I want to accept payments split across multiple modes (Cash, UPI QR, Card, Credit).
- **Acceptance Criteria:**
  - **Given** a bill grand total of ₹1,000,
  - **When** customer pays ₹400 in Cash and ₹600 via UPI QR,
  - **Then** two payment records are created: `[mode: Cash, amount: 400]`, `[mode: UPI, amount: 600]`, and the bill status is marked `PAID`.
  - **When** the amount tendered is less than Grand Total and customer is a registered ledger customer,
  - **Then** remaining balance is logged under `credit` and reflected on customer outstanding.

### [POS-006] Hold & Recall Bills
- **Story:** As a cashier, I want to temporarily hold a customer's unfinished cart to attend to the next customer in line.
- **Acceptance Criteria:**
  - **Given** an in-progress bill with 5 line items,
  - **When** the cashier presses `F6` (Hold),
  - **Then** the bill is stored into local SQLite held bills table, and the active grid resets to clean state in `< 50ms`.
  - **When** the cashier opens the Recall drawer,
  - **Then** all held bills are displayed with customer name, item count, total amount, and hold timestamp.

### [POS-007] Clinical & Prescription Metadata
- **Story:** As a pharmacist, I need to record doctor registration number and patient details on prescription drugs (Schedule H/H1/X compliance).
- **Acceptance Criteria:**
  - **Given** a prescription sale,
  - **When** doctor and patient are selected or entered,
  - **Then** Patient Name, Age, Gender, Doctor Name, Doctor Medical Reg No, and Prescription Date are saved with the invoice and rendered in the bill header.

### [RET-001] Sales Returns with Invoice Traceability
- **Story:** As a cashier, I want to process a customer return against an original invoice so items return to inventory and refunds are tracked.
- **Acceptance Criteria:**
  - **Given** an issued invoice `INV-2026-0042`,
  - **When** cashier initiates Sales Return for that invoice,
  - **Then** the original lines, prices, and batches are loaded; cashier enters return quantity $\le$ billed quantity; and a linked `SRN` document is posted.
  - **When** posted,
  - **Then** stock ledger increases the on-hand quantity of returned batches, and customer ledger or cash refund is debited.

### [RET-002] Quotation to Invoice Conversion
- **Story:** As a sales representative, I want to generate price estimates and convert approved quotations into invoices in one click.
- **Acceptance Criteria:**
  - **Given** an active quotation `QUO-1002`,
  - **When** cashier clicks "Convert to Invoice",
  - **Then** the POS loads all quotation lines, checks current stock availability, marks the quotation as `CONVERTED`, and creates a new Draft Invoice.

---

## 3. Offline Behavior & Conflict Rules
- **Local Persistence:** Every invoice is written immediately to local SQLite before triggering print or sync.
- **Sequence Generation:** Device-unique invoice prefix (e.g. `REG01-INV-0001`) prevents number collisions across multiple offline registers.
- **Sync Ingestion:** Invoices are pushed to the backend sync endpoint with an idempotent `external_id` (UUID). The backend accepts and persists without duplicate row generation.

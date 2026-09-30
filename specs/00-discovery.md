# 00. Discovery & Feature Inventory: LamSuite Billing

## 1. Executive Summary & Scope

LamSuite / Alverstone Billing is an offline-first POS and retail/pharmacy ERP system built specifically for Indian compliance (GST, HSN, batch/expiry tracking, drug license printing, doctor/patient prescription workflows).

In this modern rebuild (Tauri desktop app + high-performance backend API), we are **omitting legacy clutter, stubbed screens, and browser-specific hacks** while preserving the core, mission-critical business logic:
1. Fast, keyboard-driven POS billing.
2. Accurate Indian GST calculations (inclusive/exclusive, multi-rate, HSN tax summary, auto round-off).
3. Pharmacy-first batch tracking (batch number, expiry date, rack/shelf position, strip/pack loose quantity).
4. True offline-first operation backed by local SQLite and reliable background synchronization.
5. In-store LAN peer discovery and master data sharing.
6. Native, silent thermal receipt and A4 bill printing.

---

## 2. Core Functional Inventory (Retained & Elevated)

### A. Setup, Access & Security
- **Store & Device Provisioning:** First-time device registration, store profile download, initial data hydration.
- **Operator Authentication:** PIN/password sign-in, fast operator switching, idle timeout auto-lock.
- **Store Status Guard:** Real-time or periodic validation of store active status; graceful lock if store disabled by cloud.
- **Role-Based Permissions:** Granular permissions (`pos_create`, `discount_override`, `reprint_bill`, `cancel_bill`, `view_reports`, `manage_inventory`, `admin`).

### B. Master Data Management
- **Catalog Items (Products):**
  - Item name, print name, barcode (primary + secondary/box barcodes), SKU.
  - Category/Group, Brand, Manufacturer, Unit of Measure.
  - Indian GST metadata: HSN/SAC code, GST % (CGST + SGST or IGST), Cess %.
  - Pricing: MRP, Selling Rate (ex-tax or inc-tax), PTR (Price to Retailer), PTS (Price to Stockist), PTSS.
  - Pharmacy fields: Generic name, strength, rack location, shelf location, pack size / units per pack.
  - Stock levels: Minimum stock level (reorder alert), opening stock.
- **Suppliers:** Name, GSTIN, mobile, address, payment terms, opening balance.
- **Customers:** Name, mobile number, GSTIN, address, customer ledger & credit balance.
- **Clinical Masters:** Doctors (name, medical registration number, clinic, phone), Patients (name, age, gender, phone).
- **Discount Schemas:** Automatic line rules (Buy X Get Y, percentage by category/product, date ranges).

### C. Point of Sale (POS) Billing
- **Keyboard-First Billing Engine:**
  - Instant barcode scan or product typeahead (F1/Enter hotkeys).
  - Batch selector modal with live on-hand quantity, MRP, and expiry date.
  - Loose unit vs full pack selling (conversion ratio calculations).
  - Configurable rate basis (Selling Rate, MRP, PTR, PTS, PTSS).
  - Dynamic line discounts (percent or fixed amount) and overall bill discount.
  - Bill hold/recall (multiple draft tickets held in local memory/SQLite).
  - Quick customer creation without leaving the billing screen.
  - Doctor & patient prescription linking (doctor registration number, prescription date, patient age/gender).
  - Multi-mode split tender (Cash, UPI/QR, Card, Credit/Customer Ledger, Cheque).
- **Sales Return:** Direct return linked to an original invoice or standalone customer return with batch restocking.
- **Quotations / Estimates:** Issue quotations, with one-click conversion to a finalized invoice.

### D. Purchase Management
- **Purchase Bills:** Entry by supplier with invoice number, invoice date, batch numbers, manufacturing dates, expiry dates, purchase price (ex-tax/inc-tax), free quantity, pack size.
- **Purchase Returns:** Return stock to supplier with debit note generation and stock-out.
- **Purchase Requests (Indents):** Low stock or reorder generation to request stock from warehouse/supplier.
- **Purchase Invoice Import:** CSV/Excel tabular purchase import with column mapping and review panel.
- **OCR / AI Invoice Parser:** Upload supplier PDF/image invoice to extract GSTIN, invoice date, line items, and match against catalog products.

### E. Stock & Inventory Control
- **Real-Time Stock Ledger:** Batch-level tracking with double-entry stock transactions (`INVOICE_SALE`, `PURCHASE_RECEIPT`, `SALE_RETURN`, `PURCHASE_RETURN`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `TRANSFER_IN`, `TRANSFER_OUT`).
- **Physical Reconciliation:** Compare physical count vs system count and post stock discrepancy adjustments.
- **Stock Movement Log:** Full audit trail per product and batch.
- **Inter-Store Transfers:** Dispatch and receive stock between registered branch stores.

### F. Reports & Indian Compliance
- **Sales Reports:** Sales Register, Daily Summary, Invoice-wise Sales, Product-wise Sales, Customer Sales, Profit per Product.
- **GST Compliance Reports:**
  - GSTR-1 Summary (B2B, B2C Large, B2C Small).
  - HSN Summary (HSN code, description, UQC, total quantity, total taxable value, CGST, SGST, IGST, total tax).
  - GST Sales Register & GST Purchase Register.
- **Inventory Reports:** Stock Summary, Low Stock Alerts, Near Expiry (30/60/90 days), Out of Stock, Dead Stock.
- **Customer & Supplier Ledgers:** Customer outstanding balance, payment history, supplier dues.

### G. Native Printing & Document Layouts
- **Silent Printing:** Direct printing to system thermal printers (ESC/POS) or standard laser/inkjet printers without browser print dialog.
- **Dual Formats:**
  - Thermal Slip (2-inch / 3-inch, 58mm / 80mm) with dynamic auto-height truncation.
  - Full A4 / A5 Tax Invoice with pharmacy headers, store drug license numbers (DL 20B/21B), FSSAI, GSTIN, and doctor/patient metadata.
- **Invoice QR Code:** Dynamic UPI payment QR or digital invoice validation token.
- **PDF Generation:** Native headless PDF export without third-party browser plugins.

---

## 3. Clutter & Unwanted Logic Omission (Decluttering Decisions)

In accordance with the directive to avoid exact clone bloat and eliminate clutter:

| Feature / Logic | Status in Previous Code | Modern Rebuild Decision | Rationale |
|---|---|---|---|
| **Generic Tool Stubs** (`send-sms`, `item-variant-creator`, `bulk-tax-update`) | Dummy CRUD table with 3 generic text fields | **OMIT** | These were non-functional placeholders that did not perform real actions. Real SMS, variant creation, or tax updates should be first-class when built, not dummy tables. |
| **Hidden Sales Document Screens** (`delivery-note`, `proforma-invoice`, `sales-order`, `credit-note`, `debit-note`) | Configured in routes, hidden in menu | **OMIT from default UI** | Retail and pharmacy stores bill directly via Invoices, Sales Returns, and Quotations. Credit/Debit adjustments are handled directly in Returns. Keep core schema extensible without UI clutter. |
| **Hidden Purchase Documents** (`purchase-order`, `credit-note`, `debit-note`) | Hidden in core menu | **OMIT from default UI** | Standard purchase workflow uses Purchase Bills, Purchase Returns, and Purchase Requests. |
| **Browser LocalStorage 5MB Hack** | Complex fallback splitting data across `localStorage` and `IndexedDB` (`alverstone-browser-kv`) | **REPLACE with Native SQLite** | Desktop app has unrestricted, zero-overhead SQLite access with ACID transactions, indexing, and WAL mode. |
| **JSPrintManager WebSocket Client** | Required users to install a paid third-party tray utility (JSPrintManager) for silent printing | **REPLACE with Native OS Printing** | Tauri / Rust native printing directly sends ESC/POS raster/raw data to Windows Spooler / CUPS silently. |
| **Dummy WhatsApp / Email Buttons** | `window.alert("Sharing via WhatsApp is not configured yet.")` | **FINISH with Native Handlers** | Replace stub with OS deep link (`https://wa.me/?text=...`) or disable until backend SMTP/WhatsApp API credentials are configured. |
| **WebAuthn Biometric PWA Auth** | Browser WebAuthn requiring browser-level security credentials | **REPLACE with OS Biometrics / Fast PIN** | Fast 4-digit Cashier PIN with optional Windows Hello integration on supported OS. |

---

## 4. Ground Truth: Core Calculations & Business Rules

### Rule 1: Indian GST Calculation Modes
- **GST-Inclusive Calculation (Retail / Consumer default):**
  $$\text{Taxable Amount} = \frac{\text{Net Amount}}{1 + \frac{\text{Combined GST Rate}}{100}}$$
  $$\text{Tax Amount} = \text{Net Amount} - \text{Taxable Amount}$$
  $$\text{CGST} = \frac{\text{Tax Amount}}{2}, \quad \text{SGST} = \frac{\text{Tax Amount}}{2} \quad (\text{Intra-State})$$
  $$\text{IGST} = \text{Tax Amount} \quad (\text{Inter-State})$$
- **GST-Exclusive Calculation (Wholesale / B2B default):**
  $$\text{Taxable Amount} = \text{Net Amount}$$
  $$\text{Tax Amount} = \text{Taxable Amount} \times \frac{\text{Combined GST Rate}}{100}$$
  $$\text{Total Amount} = \text{Taxable Amount} + \text{Tax Amount}$$
- **Rate Overrides:**
  - MRP is strictly **GST-Inclusive**.
  - PTR, PTS, and PTSS are strictly **GST-Exclusive**.
  - Selling Rate follows company sales tax mode (`inclusive` vs `exclusive`).

### Rule 2: Multi-Tier Discounts
- Line discount can be specified as a percentage (%) or fixed currency amount (₹).
- Overall Bill Discount applies proportionally across taxable line items so individual tax brackets (0%, 5%, 12%, 18%, 28%) are accurately adjusted before GST computation.

### Rule 3: Statutory Auto Round-Off
- Indian invoices must be payable in whole rupees:
  $$\text{Grand Total} = \text{Round}(\text{Net Before Round})$$
  $$\text{Round Off} = \text{Grand Total} - \text{Net Before Round}$$
- Round off is strictly recorded as a distinct adjustment line item on the invoice to preserve tax accounting integrity.

### Rule 4: Pharmacy Batch & Unit Conversion
- Items can be purchased and priced by strip/pack (`units_per_pack`, e.g. 10 tablets/capsules).
- Sale can be made in full packs (`container_qty`) or loose units (`qty` loose tablets).
- Billed Amount for loose units:
  $$\text{Line Gross} = \frac{\text{Loose Qty}}{\text{Units Per Pack}} \times \text{Pack Price}$$
- Stock reduction deducts exact base units:
  $$\text{Deducted Base Units} = (\text{Packs} \times \text{Units Per Pack}) + \text{Loose Qty}$$
- Expiry date warning flags batches expiring within store-configured threshold (default: 60 days) or already expired.

---

## 5. Architectural Clarifications & Plan Directives

1. **Windows 7 / 8 Strategy (Non-Negotiable Requirement 3):**
   - Microsoft WebView2 does not officially support Windows 7/8 in modern builds.
   - Tauri 1.x runs on Windows 7 only with fixed older Evergreen/Fixed WebView2 runtimes, while Tauri 2 strictly drops Windows 7.
   - We provide a clear Architecture Decision Record (ADR) analyzing Tauri 1.x vs Electron 22 vs decoupled web client.
2. **Backend API Parity (Non-Negotiable Requirement 4):**
   - Every single local operation (Create bill, cancel bill, add item, update batch, adjust stock, run report) is mapped to a documented OpenAPI endpoint.
   - The system can be operated in headless cloud mode, multi-register store mode, or single workstation mode with 100% data consistency.

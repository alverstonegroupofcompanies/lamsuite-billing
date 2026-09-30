# Module Spec: Master Data Management (MST)

## 1. Overview
Master Data provides the foundational registries for the entire billing ecosystem. It maintains catalog products, multiple barcodes, tax classifications, suppliers, customers, clinical entities (doctors, patients), and automated discount schemes.

---

## 2. Requirement Specifications & Acceptance Criteria

### [MST-001] Catalog Items & Barcode Management
- **Story:** As a store manager, I want to create and manage catalog products with barcodes, GST details, multiple prices, and pharmacy metadata.
- **Acceptance Criteria:**
  - **Given** new item creation,
  - **When** entering product details,
  - **Then** the following fields are captured and validated:
    - Primary Barcode + Secondary Barcodes (box/case barcodes).
    - Item Name, Print Name, HSN/SAC Code, GST % (0, 5, 12, 18, 28) and Cess %.
    - Pricing: MRP, Selling Rate, PTR, PTS, PTSS, Min Sale Price.
    - Pharmacy: Generic Name, Strength, Rack Location, Shelf Location, Units per Pack.
  - **When** a barcode is scanned at POS,
  - **Then** matching succeeds if the barcode matches either the primary barcode or any secondary barcode.

### [MST-002] Categorization Masters (Groups, Brands, Units)
- **Story:** As a store owner, I want to organize items by Group (Category), Brand, Manufacturer, and Unit of Measure.
- **Acceptance Criteria:**
  - **Given** item catalog management,
  - **When** creating or editing an item,
  - **Then** Groups (with parent-child hierarchy), Brands, Manufacturers, and Units (e.g. TAB, STRIP, BTL, BOX, KG, NOS) are selectable with quick inline creation.

### [MST-003] Supplier Directory & Ledger Terms
- **Story:** As a store manager, I want to maintain supplier records with GSTIN, address, contact numbers, and payment credit terms.
- **Acceptance Criteria:**
  - **Given** supplier management,
  - **When** saving a supplier,
  - **Then** 15-character GSTIN format is validated against Indian GST rules, and default credit period (days) is stored.

### [MST-004] Customer Directory & Outstanding Balances
- **Story:** As a cashier, I want to manage customer profiles, phone numbers, and view customer outstanding balances directly.
- **Acceptance Criteria:**
  - **Given** customer management,
  - **When** creating a customer,
  - **Then** mobile number (10 digits), optional additional phone numbers, GSTIN (for B2B billing), and address are saved.
  - **When** viewing the customer profile or ledger,
  - **Then** the current outstanding credit balance and statement of bills/payments are rendered with date range filters.

### [MST-005] Clinical Masters (Doctors & Patients)
- **Story:** As a pharmacist, I want to maintain a directory of prescribing doctors and patient history.
- **Acceptance Criteria:**
  - **Given** medical billing,
  - **When** adding a doctor,
  - **Then** Doctor Name, Medical Registration Number (e.g. KMC/MCI), Clinic/Hospital name, and phone are stored.
  - **When** adding a patient,
  - **Then** Patient Name, Age, Gender, Phone, and past prescription history are retrievable during POS billing.

### [MST-006] Automated Discount Schemas
- **Story:** As a store owner, I want to define promotional discount rules applied automatically at POS.
- **Acceptance Criteria:**
  - **Given** an active discount schema (e.g. "5% off on all Generics" or "Buy 3 Get 1 Free for Brand X"),
  - **When** eligible products are added to the POS cart,
  - **Then** the discount rule is evaluated in real time and applied as an automated line discount without cashier manual override.
  - **When** the cashier explicitly modifies a line discount,
  - **Then** the manual discount is locked and protected from schema overwrite.

### [MST-007] Spreadsheet Import Wizard (Excel / CSV)
- **Story:** As a store owner setting up a new store, I want to import existing product and customer catalogs from Excel.
- **Acceptance Criteria:**
  - **Given** an uploaded spreadsheet,
  - **When** columns are mapped to item attributes,
  - **Then** the import wizard displays an interactive editable grid highlighting invalid rows (e.g. duplicate barcodes, missing names).
  - **When** committed,
  - **Then** valid rows are imported into local SQLite and queued for cloud sync.

---

## 3. Offline Behavior & Conflict Rules
- **Full Offline Master CRUD:** Products, customers, suppliers, and clinical records can be added or edited offline.
- **Local GUIDs:** Items created offline receive a UUID `external_id`.
- **Cloud Master Sync:** On reconnection, local master updates push to central; central master catalog updates pull down and merge locally using last-updated timestamp resolution.

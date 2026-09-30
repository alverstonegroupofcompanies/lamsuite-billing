# Module Spec: Reports & Indian GST Compliance (REP)

## 1. Overview
The reporting engine provides real-time financial, inventory, and statutory compliance insights. All reports run on local data (SQLite) for instant offline execution, with rich filtering, totals rows, and multi-format exports (Excel, CSV, PDF, Print).

---

## 2. Requirement Specifications & Acceptance Criteria

### [REP-001] Sales Register & Daily Collection Summary
- **Story:** As a store owner, I want a comprehensive register of all sales and tender collections for any selected date range.
- **Acceptance Criteria:**
  - **Given** a date range filter (Today, This Week, This Month, Custom),
  - **When** the Sales Register report is generated,
  - **Then** every bill is listed with Date, Bill No, Customer, Payment Mode, Taxable Subtotal, CGST, SGST, IGST, Round-Off, and Grand Total.
  - **When** viewing the Daily Collection summary,
  - **Then** totals are broken down by tender: Total Cash, Total UPI, Total Card, Total Credit, and Total Sales Returns.

### [REP-002] GSTR-1 Compliance Summary
- **Story:** As a tax consultant / store accountant, I want a GSTR-1 summary categorizing sales into statutory Indian GST buckets.
- **Acceptance Criteria:**
  - **Given** tax period dates (monthly or quarterly),
  - **When** the GSTR-1 report is generated,
  - **Then** transactions are bucketed into:
    - **B2B Invoices (Table 4):** Registered customers with valid GSTIN (Invoice No, GSTIN, Place of Supply, Reverse Charge, Taxable Value, Tax amounts).
    - **B2C Large (Table 5):** Inter-state invoices to unregistered persons where invoice value $> ₹2.5 Lakhs.
    - **B2C Small (Table 7):** Intra-state and remaining inter-state unregistered sales grouped by State code and GST rate.
    - **Credit / Debit Notes (Table 9):** Sales returns and price adjustments with original invoice references.

### [REP-003] HSN / SAC Statutory Tax Summary
- **Story:** As a store owner, I want an HSN tax summary table detailing sales grouped by HSN code and GST rate.
- **Acceptance Criteria:**
  - **Given** sales for a tax period,
  - **When** the HSN Summary report runs,
  - **Then** output rows are aggregated by `[hsn_code, gst_percent]`, showing:
    - HSN/SAC Code and Description.
    - Unit Quantity Code (UQC, e.g. NOS, BOX, BTL).
    - Total Quantity Sold.
    - Total Value & Total Taxable Value.
    - Integrated Tax (IGST), Central Tax (CGST), State Tax (SGST), and Cess Amount.

### [REP-004] Inventory Health & Expiry Reports
- **Story:** As a pharmacist or store manager, I want to review stock health, near-expiry medicines, and out-of-stock items.
- **Acceptance Criteria:**
  - **Given** stock ledger data,
  - **When** the "Near Expiry" report is selected with a threshold (e.g. 60 days),
  - **Then** all batches expiring within 60 days are listed sorted by expiry date ascending, displaying on-hand quantity, batch number, rack/shelf position, and manufacturer.
  - **When** the "Low Stock" report runs,
  - **Then** items where current stock $\le$ reorder level are displayed with suggested reorder quantities.

### [REP-005] Customer & Supplier Accounts (Ledger & Aging)
- **Story:** As a store owner, I want to track customer credit receivables and supplier payables with overdue aging.
- **Acceptance Criteria:**
  - **Given** customer credit sales and payment collections,
  - **When** generating the Customer Outstanding report,
  - **Then** each customer's total outstanding balance is displayed with aging breakdown (0-30 days, 31-60 days, 60+ days) and payment history link.

### [REP-006] High-Speed Local Export (Excel / CSV / PDF)
- **Story:** As an accountant, I want to export any report directly into Excel or CSV with one click.
- **Acceptance Criteria:**
  - **Given** any generated report screen,
  - **When** clicking "Export to Excel" or "Export to CSV",
  - **Then** the file is generated locally via native streaming in $< 500\text{ms}$ without browser lag or internet connection.

---

## 3. Offline Behavior & Conflict Rules
- **Pure Local Execution:** 100% of reports run directly against local SQLite. They function identically whether internet is connected or disconnected.
- **Cloud Report Snapshots:** For store owners viewing reports from mobile or remote web, the desktop client pushes periodic compressed daily summary snapshots to central.

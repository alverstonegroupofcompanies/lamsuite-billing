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
  - **Changed by CR-C —** the supplier side of this report is driven by the bill's charge-inclusive `grand_total`, so
    supplier-borne charges in **both** treatments appear in the payable and its aging. A separately-paid charge
    (`PUR-013`) appears only if the bill was keyed while the store billed that money into the payable; the reading
    follows the `in_payable` stored on the charge row, never the policy of the day (`PUR-016`, CR-C-11). A supplier
    ledger row may be expanded to show the goods/tax/charge split of the bill it came from.

### [REP-006] High-Speed Local Export (Excel / CSV / PDF)
- **Story:** As an accountant, I want to export any report directly into Excel or CSV with one click.
- **Acceptance Criteria:**
  - **Given** any generated report screen,
  - **When** clicking "Export to Excel" or "Export to CSV",
  - **Then** the file is generated locally via native streaming in $< 500\text{ms}$ without browser lag or internet connection.

### [REP-007] Purchase Register with Items and Charges Separated
- **Story:** As a purchase manager, I want one register that shows what I bought and what I additionally paid on the bill.
- **Acceptance Criteria:**
  - **Given** a date range and store filter,
  - **When** the Purchase Register runs,
  - **Then** each bill row shows goods taxable value, goods tax, **charge total, charge tax, and a per-charge breakdown by head**, then payable and landed value.
  - **Then** the item view of the same bill shows per line: purchase rate (original), charge allocation, landed unit cost — as separate columns, never merged into one.
  - **When** exported,
  - **Then** the CSV/Excel/PDF carries both blocks with named columns and the totals row reconciles to the bill payable.
  - **Given** the accountant's other question — not "what did this bill cost" but "what did we pay for freight,
    packing, insurance and courier this month, in which store, and is that money inside what we owe the supplier" —
  - **When** the charges view runs (`GET /admin/purchase-charges`, the Bill Charges tab in the admin panel),
  - **Then** it answers it from charge rows, one row per charge across bills, filterable by store, bill-date range,
    head, treatment, spread, ITC eligibility, RCM, paid-separately and payable membership, footed over the whole
    filtered set (row count, charge amount, in-payable total, outside-payable total) rather than over the page, and
    exportable.
  - **Then** a cross-store read names the store on every row, and the split in the `In Payable` column is the
    membership stored on the row — never today's policy — so this report cannot contradict the bill it came from
    (`PUR-016`, CR-C-11).

### [REP-008] Expense Register
- **Story:** As an accountant, I want a register of everything booked as expense, including expense-treated bill charges. *(This register did not exist before CR-C; it is created by it.)*
- **Acceptance Criteria:**
  - **Given** a date range, store, and optional head filter,
  - **When** the Expense Register runs,
  - **Then** rows include manual expenses **and** expense-treated purchase charges (`PUR-012`), each with head, amount, tax columns, ITC flag, payment status, and — for charge rows — a link to the purchase bill and to the separately-paid flag.
  - **Then** the register reconciles to the expense half of the reconciliation identity in `purchase-management.md` to the paisa.
  - **Then** it is exportable in every format the report engine supports.

### [REP-009] Charges-Aware Margin, Input Tax and Reverse-Charge Views
- **Story:** As a store owner, I want margin, ITC and RCM review to follow how each charge was treated.
- **Acceptance Criteria:**
  - **Given** the margin/profit report,
  - **When** CR-C bills exist,
  - **Then** cost of goods uses **landed cost** for add-to-cost charges and the expense register for expense-treated ones, so the two treatments are comparable and never double-counted.
    - The rate a sale line is costed at is the batch's `landed_cost_rate` when a charge moved it (PUR-011), and the
      rate this report has always used — the product's booked rate, then the selling-rate estimate — when it did not,
      so a store that never uses charges sees exactly the margin it saw before CR-C.
    - `cost_basis` names the tier that answered (`landed_cost` / `purchase_rate`), `expense_charge_postings` reports
      the expensed half below the line rather than inside COGS, and each breakdown row carries `cost_per_unit`
      beside `supplier_cost_per_unit` — PUR-011's promise that the supplier rate is never rewritten, made visible.
  - **Given** the GST input summaries (GSTR-2B/ITC working paper, 3B in-memory ITC, GST reconciliation),
  - **When** charge tax exists,
  - **Then** it is included **only** where the charge's own ITC eligibility allows it, and anything other than
    `eligible` — `ineligible`, `blocked` and `partial` alike — is shown as non-creditable with the whole tax
    amount moved to expense/cost. Both tax engines price creditability all-or-nothing
    (`TaxEngine::itc_eligibility === 'eligible'`, mirrored in the till and in `PurchaseCharge::reversibleAmount()`)
    because the contract carries no creditable-share field; a `partial` head is therefore reported under its own
    eligibility label so the split can be made by hand, and a real percentage split would need a new field in
    `purchase_charges`, both engines and the pinned test vectors, not a report-side guess.
  - **Given** a charge with `is_rcm = true` (e.g. freight from an unregistered transporter),
  - **Then** it is **flagged for review** in the working papers with its own section — bill no, date, supplier, head, taxable, self-paid tax — and is listed separately from ordinary input tax. No RCM return filing is implied.
  - **Then** the statutory credit view (`is_rcm = true` or a non-`eligible` head is not ordinary ITC) and the money view stay distinct on purpose: cost allocation, the expense posting and a return's reversal are still priced by `itc_eligibility` alone (the shared engine and `PurchaseCharge::reversibleAmount()`), because a reverse-charge charge's tax is still rupees the books must place somewhere.
  - **Then** every accounting export (Tally, Busy, CSV) carries the charges, and every voucher it emits still balances to the paisa:
    - The purchase voucher debits each **supplier-borne** head under its own ledger name at the head's **taxable**
      value only — the header CGST/SGST/IGST/Cess already include the charge GST (`PUR-001`), so debiting the tax twice
      would unbalance the voucher. A pre-CR-C bill's `freight_charges` scalar is debited the same way, as one Freight
      head (`PUR-017`), and the old `Freight Charges` ledger line is gone.
    - A head the bill **left outside** the payable (`PUR-013`, stored `in_payable = false`) never enters it, so it
      leaves as its own `Payment` voucher — Dr the head and its input tax, Cr the party it was paid to, numbered
      `<bill no>-C<seq>` — after the bill voucher. A separately-paid head a store billed **into** the payable
      (`separately_paid_in_payable`, CR-C-11) rides the purchase voucher like any supplier-borne head and gets no
      `Payment` voucher, because the export reads the stored membership and not today's policy.
    - `purchases.csv` keeps `Subtotal`/`Tax` as the header posted them and adds the charge block beside them:
      `Charge Taxable`, `Charge Tax`, `Charge Total`, `Add To Cost`, `Expensed`, `Paid Separately`, `Charge Heads`
      (one `CODE taxable@rate% in bill|paid separately [RCM]` per head), `Landed Value` and `Payable`.
    - `gst-summary.csv` buckets each head on its own SAC and rate as a `purchase-charge` source, so charge input tax
      is visible beside the item lines that never saw it.
    - `expenses.csv` (the REP-008 register, CSV) lists manual rows and charge rows together with tax columns, ITC and
      RCM flags, the bill link, and a footing row that reconciles to the register totals.
    - The day book counts each rupee once: a supplier-borne charge stays inside its purchase row, while a manual
      expense and a separately-paid charge appear as their own rows (`Expense (bill charge)`).
  - **Then** `GET /data-exchange/export/purchases` returns each bill with its `charges[]` (the same rows the register
      reads, legacy freight included) and each item line with `billed_cost` beside `landed_cost` (`PUR-011`), and
      `GET /data-exchange/export/purchase_charges` returns one row per charge with the `purchase_reference` it belongs
      to — the two templates those row sets are keyed on (`REP-007`).

---

## 3. Offline Behavior & Conflict Rules
- **Pure Local Execution:** 100% of reports run directly against local SQLite. They function identically whether internet is connected or disconnected.
- **Cloud Report Snapshots:** For store owners viewing reports from mobile or remote web, the desktop client pushes periodic compressed daily summary snapshots to central.

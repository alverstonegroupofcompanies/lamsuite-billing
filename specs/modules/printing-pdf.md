# Module Spec: Native Printing & Document Layouts (PRN)

## 1. Overview
The printing engine replaces legacy browser print dialogs and third-party WebSocket print managers (e.g. JSPrintManager) with high-speed, native OS printing. It supports dynamic thermal receipt slips (58mm / 80mm) and comprehensive A4/A5 pharmacy tax invoices.

---

## 2. Requirement Specifications & Acceptance Criteria

### [PRN-001] Native Silent Printing
- **Story:** As a busy cashier, I want the receipt to print automatically and silently to the receipt printer upon completing a sale without popping up an OS print dialog.
- **Acceptance Criteria:**
  - **Given** a completed POS sale and a configured default printer,
  - **When** "Print & New Bill" is triggered (or auto-print is enabled in settings),
  - **Then** the raw print job is sent directly to the local printer spooler (Windows Spooler / CUPS) silently in $< 200\text{ms}$.

### [PRN-002] Dynamic Slip Height (Thermal Roll Optimization)
- **Story:** As a store owner, I want thermal receipts to truncate exactly where the content ends so expensive thermal paper rolls are not wasted.
- **Acceptance Criteria:**
  - **Given** a thermal receipt with 2 items versus 20 items,
  - **When** rendering the slip,
  - **Then** the paper height is dynamically calculated:
    $$\text{Slip Height (mm)} = \text{Header Height} + (\text{Line Count} \times \text{Row Height}) + \text{Totals Height} + \text{Footer Margin}$$
  - **When** sent to the printer,
  - **Then** the printer feeds only the required length and executes a paper cut command without extra trailing blank paper.

### [PRN-003] Pharmacy A4 / A5 Tax Invoice Theme
- **Story:** As a pharmacist or B2B billing clerk, I need a professional A4 or A5 invoice format detailing drug licenses, doctor details, batch, expiry, and HSN tax summary.
- **Acceptance Criteria:**
  - **Given** an invoice printed in A4 format,
  - **When** rendered,
  - **Then** the layout includes:
    - Store Name, Address, Phone, Email, GSTIN.
    - Drug License Numbers (e.g. Form 20B / Form 21B), FSSAI number.
    - Patient Name, Age, Gender; Doctor Name, Registration Number, Clinic.
    - Particulars table: S.No, Description, HSN/SAC, Batch No, Exp Date, Pack Qty, Loose Qty, MRP, Rate, Disc %, Taxable, GST %, Line Total.
    - HSN Tax Breakdown Box: HSN, Taxable Value, CGST Rate & Amt, SGST Rate & Amt, Total Tax.
    - Bank details for payment, Amount in Words (INR), Terms & Conditions, and Authorized Signatory.

### [PRN-004] Dynamic Invoice QR Code (UPI & Verification)
- **Story:** As a cashier, I want a dynamic UPI QR code printed on the receipt so customers can scan and pay with any UPI app (GPay, PhonePe, Paytm).
- **Acceptance Criteria:**
  - **Given** an invoice with grand total ₹450.00 and store UPI VPA `store@upi`,
  - **When** generating the bill slip or A4 invoice,
  - **Then** a dynamic UPI payment string is encoded into the QR code:
    `upi://pay?pa=store@upi&pn=StoreName&am=450.00&tr=INV1001&cu=INR`
  - **When** scanned on a customer smartphone,
  - **Then** the customer's UPI app opens with exact payee and amount pre-filled.

### [PRN-005] Headless Native PDF Generation
- **Story:** As an operator, I want to save or share invoices as PDF without relying on browser "Save as PDF" print previews.
- **Acceptance Criteria:**
  - **Given** an issued invoice,
  - **When** the user clicks "Save as PDF",
  - **Then** a vector PDF is written to disk natively with clean typography, sharp vector barcodes/QRs, and selectable text.

---

## 3. Architecture & OS Integration
- **Rust Native Printing:** The Tauri desktop layer invokes native OS APIs (e.g. Windows Win32 Print Spooler via `winspool.drv` / `tauri-plugin-printer` / direct raw ESC/POS byte streaming) rather than browser DOM printing.
- **Printer Profiles:** The user can configure separate dedicated printers:
  - Thermal Slip Printer (e.g. EPSON TM-T82, TVS RP3200).
  - A4 / Document Printer (e.g. HP LaserJet, Canon LBP).
  - Label / Barcode Printer (e.g. TSC, Zebra).

# Store Owner Guide: Setting Up Remote Counters & Multi-Location Billing

This guide explains how to set up and operate Remote Billing Counters (such as billing from the store owner's residence, a warehouse, or an exhibition counter) with **LamSuite Billing**, while sharing the same catalog, customer accounts, and stock ledgers with zero offline document collision.

---

## 1. Statutory GST Notice (Confirmation with Chartered Accountant Required)

> [!WARNING]
> **Mandatory GST Review under Sections 22 & 24 of the CGST Act**:
> Operating a billing terminal from an owner's home or secondary location from which taxable supplies are issued may require declaring that location as an **"Additional Place of Business" (APOB)** on the GST Common Portal via **Form GST REG-14** (Amendment of Registration). 
> 
> Consult your Chartered Accountant (CA) or Tax Practitioner to verify:
> 1. Whether your remote premises must be endorsed as an APOB on your GST Certificate (REG-06).
> 2. Ensuring that the address printed on tax invoices matches the appropriate principal or additional place of business.

---

## 2. Remote Counter Architecture & Operational Model

- **Shared Single Source of Truth**: All counters in the store share catalog items, prices, batches, customer ledgers, and suppliers.
- **Offline-First Resilience**: If the internet disconnects, the remote counter continues billing locally using its embedded SQLite database.
- **Collision-Free Numbering**: Each counter is assigned an independent document series prefix (e.g. `C01-INV-1001` for Shop Counter, `C02-INV-1001` for Home Counter) or a leased range block, guaranteeing that bill numbers never collide even during prolonged offline periods.
- **Append-Only Stock Ledger Merging**: Sales, returns, and write-offs merge into central inventory as delta entries rather than overwriting absolute balances. If concurrent offline sales result in a batch deficit, the batch balance goes negative, an alert is flagged, and the discrepancy appears in the Negative Stock Reconciliation Register for physical auditing.

---

## 3. Step-by-Step Device Setup Workflow

### Step 1: Enroll Device on the Remote Computer
1. Install and launch LamSuite Billing on the remote workstation or laptop.
2. Select **Enroll Remote Workstation / Counter**.
3. Enter:
   - **Counter Name**: e.g., `Owner Home Office`
   - **Counter Code**: e.g., `C02` or `C03`
   - **Location**: e.g., `Owner Residence - 2nd Floor`
   - **Counter Type**: Select *Standard POS* or *Digital-Only* (if cash drawer is not present).
4. Click **Submit Enrollment Request**. The terminal will enter `Pending Approval` mode.

### Step 2: Approve the Counter in Central Admin Panel
1. The Store Owner opens the Central Admin Panel at `https://your-store-domain/admin`.
2. Navigate to **Devices & Remote Counters**.
3. Under the *Pending Approval* list, locate the newly submitted device UUID and location tag.
4. Click **Approve**.
5. Once approved:
   - The cloud server automatically initializes dedicated invoice, sales return, and receipt sequences.
   - The remote workstation receives its cryptographically signed per-device token and begins immediate delta synchronization.

### Step 3: Configure Permissions & Security Profiles
In the Admin Panel, click **Settings & Permissions** next to the counter:
- **Allow Bill Cancellation**: Uncheck if bills cannot be cancelled remotely without owner presence.
- **Allow Price & Rate Changes**: Uncheck to prevent operators from deviating from fixed retail rates.
- **Allow Stock Adjustments**: Restrict manual inventory corrections to the main shop terminal.
- **Manager Security PIN**: Set a 4-digit PIN required for overriding discounts or tender limits.
- **Digital-Only Mode**: Disables cash drawer reconciliations; only UPI, Card, and Bank transfers will be permitted.

### Step 4: Configure Local Printer or Digital Dispatch
Under **Counter Settings**:
- Select local printer hardware: 3-inch Thermal (80mm), 2-inch Thermal (58mm), or standard A4 invoice format.
- Alternatively, select **Digital PDF Only** to automatically generate vector PDF invoices for one-click dispatch via WhatsApp Web or email.

---

## 4. Shift & Day-End Closing Procedure

1. **Counter Shift Close**: At the end of the day or shift, the remote operator performs a *Counter Shift Close* to reconcile tenders collected (cash in drawer, card receipts, and UPI settlements).
2. **Consolidated Store Day Close**: In the central Admin Panel or main store counter, the manager triggers *Store Day Close*. This aggregates sales, taxes collected, and tender splits across all shop and remote counters to the paisa.

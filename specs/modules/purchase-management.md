# Module Spec: Purchase Management (PUR)

## 1. Overview
Purchase Management handles inward goods receipts, supplier bills with additional bill charges (freight, packing,
loading, insurance and custom heads), batch/expiry creation and landed cost, purchase returns (vendor debit notes),
separately-paid cost links, and automated purchase requests. It also integrates tabular CSV/Excel imports and
OCR/AI document extraction.

> **CR-C (2026-11-19) — Supplier bill charges.** `PUR-007` … `PUR-017` add the charges section; `PUR-001`,
> `PUR-002` and `PUR-003` are amended by it. The single scalar **Freight** field that `PUR-001` used to define is
> retired into the `Freight` charge head (see [PUR-017](#pur-017-offline-charge-entry--sync) for the migration rule).

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
  - **Changed by CR-C —** the document total is computed in **one statutory engine pass that includes the charge
    lines** ([PUR-009](#pur-009-per-charge-gst-through-the-shared-tax-engine)) rather than by adding a freight scalar
    to the tax-engine result afterwards. `grand_total = Σ line taxable + Σ charge taxable + Σ line tax + Σ charge tax
    + round_off`, and the round-off is applied **after** charges.
  - **Changed by CR-C —** the Supplier Invoice Total check compares the entered invoice value against this
    charge-inclusive total, **excluding** charges marked as paid separately
    ([PUR-013](#pur-013-separately-paid-charge-links)), because those are not on the supplier's bill —
    unless the store's `separately_paid_in_payable` policy bills them in, in which case the check reads
    the same total the bill was priced at ([PUR-016](#pur-016-charge-policies-per-store), CR-C-11).
  - **Changed by CR-C —** the supplier ledger credit equals `grand_total`, so it includes supplier-borne charges in
    both treatments and excludes separately-paid charges
    ([PUR-012](#pur-012-expense-treated-charges), [PUR-013](#pur-013-separately-paid-charge-links)) — except
    under a store that bills separately-paid money into the payable, where the ledger follows the same
    `grand_total` and the charge still records who was actually paid (CR-C-11).

### [PUR-002] Free Goods & Bonus Scheme Calculation
- **Story:** As a store manager, I want to record free goods received from suppliers (e.g. Buy 10 strips + 2 free) without distorting taxable value.
- **Acceptance Criteria:**
  - **Given** a purchase line with `billed_qty: 10` and `free_qty: 2` at ₹100/unit,
  - **When** the line total is computed,
  - **Then** Taxable Value = $10 \times 100 = ₹1,000$ (free quantity is not billed).
  - **When** the bill is posted to stock,
  - **Then** total on-hand stock credited to that batch is $10 + 2 = 12$ units, and effective unit cost is recorded as $\frac{1000}{12} = ₹83.33$.
  - **Changed by CR-C —** add-to-cost charge allocations
    ([PUR-010](#pur-010-spread-of-add-to-cost-charges)) are added to the numerator before dividing by total received
    units, so `effective_unit_cost = (line taxable + line charge allocation) / total units (incl. free)`. Free goods
    therefore absorb their share of freight, which is the intended commercial behaviour. The goods-only
    `purchase_rate` is **not** overwritten — see [PUR-011](#pur-011-landed-cost-on-the-batch).

### [PUR-003] Purchase Returns (Debit Note to Supplier)
- **Story:** As a store manager, I want to return damaged or expired goods to a supplier with an automatic debit note.
- **Acceptance Criteria:**
  - **Given** inventory batches from supplier "ABC Pharma",
  - **When** the manager creates a Purchase Return selecting specific batch and return quantity,
  - **Then** a Purchase Return (`PR`) document is issued, batch stock is deducted, and supplier ledger is debited by the returned amount including reversed GST.
  - **Changed by CR-C —** the returned amount also reverses the returned share of the original bill's charges,
    proportionally, unless the store policy keeps them as sunk cost
    ([PUR-015](#pur-015-return-reversal-of-charges), [PUR-016](#pur-016-charge-policies-per-store)). A return line
    must reference the original purchase item so the allocation can be reversed exactly.

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

## 2A. Supplier Bill Charges (CR-C, 2026-11-19)

A **charge** is a line of value on a supplier bill that is not goods: freight, packing, loading/unloading,
insurance, furniture, or a store-defined custom head. Charges carry their own GST, are either capitalised into
the cost of the goods or booked as an expense, and are always part of what the store owes or has paid.

### [PUR-007] Charges Section on Purchase Entry
- **Story:** As a pharmacist, I want to enter the freight, packing and insurance lines of a supplier bill from the keyboard without ever touching the mouse.
- **Acceptance Criteria:**
  - **Given** the purchase entry screen with items already entered,
  - **When** the operator presses **`Alt+F`** (declared in the central key map, `purchase` scope, action `toggleCharges`),
  - **Then** a charges section opens **directly under the item grid**, and focus lands on the head field of the first (or a new) charge line.
  - **Given** the charges section is open,
  - **When** the operator presses `Enter` on a field,
  - **Then** focus advances head → amount → GST % → treatment → spread → ITC → note → next row, exactly as the item grid does; `Shift+Enter` moves back; `Up`/`Down` move between rows; `Ctrl+N` adds a row; `Ctrl+D` duplicates the current row; `Ctrl+Shift+Del` deletes the current row; `Tab` and `ArrowRight` never leave the grid; `Escape` closes the section and returns focus to the item grid without losing data.
  - **Then** every field in the section is reachable and editable by keyboard only, including the head picker (type-to-filter list), treatment, spread method and ITC flag (cycling selects, not dropdowns requiring the pointer).
  - **When** the charges section is open,
  - **Then** it registers as a `modal` scope in the shortcut dispatcher so the purchase screen's chords (F12 post, F8 draft, Shift+F12 post-and-print) keep working and `Escape` resolves through the LIFO escape manager.
- **Non-goal:** a mouse is supported but never required.

### [PUR-008] Charge Head Master
- **Story:** As a store owner, I want my own list of charge heads with my own defaults, not another store's.
- **Acceptance Criteria:**
  - **Given** a store,
  - **Then** the head list contains the seeded heads `Freight`, `Packing`, `Loading/Unloading`, `Insurance`, `Other` plus any custom heads the store has added, and **only** that store's heads (rule `R12`, see [constitution](../constitution.md)).
  - **Given** a head,
  - **Then** it carries a default treatment (`add_to_cost` | `expense`), a default spread method (`value` | `quantity` | `weight`), a default ITC eligibility (`eligible` | `ineligible` | `blocked` | `partial`), a SAC/HSN code for the tax summary, an allowed sign, and an active flag.
  - **When** a head is chosen on a charge line,
  - **Then** the treatment, spread method and ITC flag are prefilled from the head, and the operator may override each one for that bill; the override is never written back to the master.
  - **When** a head is deleted while charges reference it,
  - **Then** the delete is rejected with the referencing bills listed, mirroring the unit delete guard (`MST-008`).

### [PUR-009] Per-Charge GST Through the Shared Tax Engine
- **Story:** As a store accountant, I want the GST on freight computed by the same engine as the GST on goods, so the till and the server never disagree.
- **Acceptance Criteria:**
  - **Given** a charge of amount $A$ at rate $r\%$,
  - **When** the document is computed,
  - **Then** the engine (integer paisa, `round_half_up`) yields `taxable`, `cgst`, `sgst`/`igst`, `cess`, `total` for that charge — the same primitives and the same rounding convention as goods lines, in both `backend/app/Services/Tax/TaxEngine.php` and `frontend/src/lib/tax-engine/taxEngine.ts`.
  - **Given** the supplier's place of supply (resolved from the supplier GSTIN first, then the place-of-supply field) is in the store's state,
  - **Then** the charge tax is split CGST + SGST with `cgst = round_half_up(gst/2)`, `sgst = gst - cgst`; if it is another state, the charge tax is IGST.
  - **Then** charges appear in the HSN/SAC summary under their own SAC code, never blended into goods value.
  - **Then** the tax on a charge is decided by the **supplier's** place of supply, not the transporter's, and each charge line may carry its own place of supply override for a locally paid transporter bill.
  - **Changed by CR-C-11 —** whether a `paid_separately` charge's total belongs to `grand_total` is a document-level
    policy input (`separately_paid_in_payable`) with a per-charge override (`in_payable`) that only a reversal
    supplies, so a debit note inherits the membership of the bill it returns instead of the policy of the day. The
    engine's `charge_taxable_total` / `charge_tax_total` / `charge_total` count the charges **inside** the payable and
    `separate_charge_*` the ones left outside, and the header's CGST/SGST/IGST/Cess columns follow the same split —
    which is why both engines keep footing `reconciliation_identity_delta == 0` under either policy.
  - **Then** the paper a store files says the same thing: every printed purchase document names each charge
    head with its taxable, GST and total, in the A4, invoice-reprint and dot-matrix layouts alike
    ([PRN-007](printing-pdf.md#prn-007-purchase-document-charge-footing-cr-c)).

### [PUR-010] Spread of Add-to-Cost Charges
- **Story:** As a store manager, I want freight spread across the goods it carried so each batch's real cost is visible.
- **Acceptance Criteria:**
  - **Given** a charge with treatment `add_to_cost` and a spread method,
  - **When** the bill is computed,
  - **Then** the charge's **taxable amount** (ex-GST, plus any tax on it that cannot be claimed back) is distributed across the item lines of **that bill only** by the chosen basis:
    - `value` — line taxable value share;
    - `quantity` — line units share, **including free units** (consistent with `PUR-002`);
    - `weight` — line share of `Σ gross_weight_kg`, the **total chargeable weight entered for that line** (CR-C D1: weight is captured at purchase, not in the product master).
  - **Then** allocations are in integer paisa with **zero rounding drift**: `Σ allocations == charge taxable amount +
    the charge's non-creditable tax` exactly. Tax that can never be claimed back is capitalised with the charge
    instead of being left unbooked, so the identity below closes for every eligibility combination; for a fully
    creditable charge the spreadable amount is simply the taxable amount.
  - **Remainder rule (stated):** exact paisa quotients are assigned first; leftover paisa go **one paisa at a time to the lines with the largest fractional remainder**, and ties break by **first line in grid order**. Exactly one line may hold more than one leftover paisa only when the basis is degenerate (single line).
  - **Given** the spread basis sums to zero for the whole bill (every line worth nothing),
  - **Then** the full spreadable amount is placed on the first line in grid order — paisa are never dropped.
  - **Given** the spread method is `weight` and any line has a blank or zero `gross_weight_kg`,
  - **Then** the computation falls back to the `value` basis for the whole charge **and** the screen states which lines lacked weight — a silent mixed basis is forbidden.
  - **Then** the entry screen may optionally show the spread preview per line, and the saved allocations are queryable per bill (`purchase_charge_allocations`).
  - **Given** a negative charge,
  - **Then** the identical rule applies with the sign inverted (a credit spread reduces landed cost).

### [PUR-011] Landed Cost on the Batch
- **Story:** As a store owner, I want margin to reflect landed cost while the supplier's rate stays visible.
- **Acceptance Criteria:**
  - **When** a bill with add-to-cost charges is posted,
  - **Then** each batch records `landed_cost_rate = purchase_rate + (Σ add-to-cost allocations of that line) / total received units`, and `product_batches.purchase_rate` keeps the **original, unmodified** supplier rate.
  - **Then** both figures are visible side by side on the batch, the purchase register, the item-wise purchase report, the product ledger drill-down and the bill view.
  - **Then** stock valuation and margin reports use landed cost, while purchase-price history, supplier price comparison and rate revisions use the original purchase rate.
  - **Given** a batch receives goods from two bills,
  - **Then** its landed cost is re-derived per receipt and the running valuation follows the existing average-cost convention; a bill never rewrites another bill's allocation.

### [PUR-012] Expense-Treated Charges
- **Story:** As an accountant, I want freight I chose to expense to land in the expense register under the right head.
- **Acceptance Criteria:**
  - **Given** a charge with treatment `expense`,
  - **When** the bill is posted,
  - **Then** an expense register entry is created under the chosen head with the **taxable (ex-GST) amount**, dated to the bill, referencing the purchase bill, and the GST is tracked **only** as input tax in the ITC summaries.
  - **Given** the charge's ITC eligibility is `ineligible` or `blocked`,
  - **Then** the non-creditable tax is added to the expense amount so nothing disappears from the books (see the reconciliation identity below).
  - **Then** the batch landed cost is **unchanged** by an expense-treated charge.
  - **Then** editing or cancelling the bill reverses and re-posts the expense entry as a unit with the bill ([PUR-015](#pur-015-return-reversal-of-charges), [PUR-017](#pur-017-offline-charge-entry--sync)).

### [PUR-013] Separately-Paid Charge Links
- **Story:** As a store manager, I want to link freight I paid the transporter directly to the bill it belongs to, without inflating what I owe the supplier.
- **Acceptance Criteria:**
  - **Given** a cost paid outside the supplier bill (transporter, courier, insurer),
  - **When** it is linked to a purchase,
  - **Then** it is stored as a charge with `paid_separately = true` plus a free-text `paid_to_label` (the transporter's name), and **no** master/party record is required.
  - **Then** it spreads into landed cost by the identical `PUR-010` rules and posts to the expense register by the identical `PUR-012` rules when treated as an expense.
  - **Then** it is **excluded** from `grand_total`, from the supplier ledger credit and from the Supplier Invoice
    Total check — the store has already paid it — **unless** the store's `separately_paid_in_payable` policy is on,
    which bills the same charge into the payable as a supplier-borne one
    ([PUR-016](#pur-016-charge-policies-per-store)). The default is off, so a store that never set the switch keeps
    the original behaviour.
  - **Then** the membership each charge line was billed with is **stored on the line** (`in_payable`), so switching
    the policy later cannot restate a bill that already printed, and a debit note inherits the answer of the bill
    it returns (CR-C-11, PUR-016).
  - **Then** `paid_separately` keeps driving what it always drove — the payment column, the expense-register
    attribution and which side of GSTR-2B reports the tax — independently of the payable decision.
  - **Then** its GST still appears in the ITC summaries subject to eligibility, and the bill view shows supplier-borne and separately-paid charges in separate blocks.
  - **Then** the printed purchase document prints it below the grand total, marked as paid separately and outside
    the bill, while the money inside the payable foots on its own
    ([PRN-007](printing-pdf.md#prn-007-purchase-document-charge-footing-cr-c)).

### [PUR-014] Negative Adjustments
- **Story:** As a pharmacist, I want to record cash discount, round-off and TCS lines on the supplier's own bill.
- **Acceptance Criteria:**
  - **Given** a charge head whose allowed sign includes negative,
  - **When** the operator enters a negative amount (cash discount, round-off, or tax collected at source where the supplier's bill shows it),
  - **Then** the engine computes the tax with the same magnitude rule and inverted sign, splits it intra/inter-state identically, and reduces `grand_total` and the supplier payable accordingly.
  - **Given** a head whose allowed sign is positive-only,
  - **Then** the entry screen refuses a negative amount with a keyboard-focusable validation message; the store may switch the head or change its allowed sign in the master.
  - **When** charges would drive the document total below zero,
  - **Then** posting is blocked with the offending line named (a negative payable is a different document and is out of scope).
- **Non-goal:** TCS/TDS certificate tracking and deduction registers are not part of this CR; a TCS line here only mirrors what the supplier's invoice already shows.

### [PUR-015] Return Reversal of Charges
- **Story:** As a store manager, I want a debit note to give back the freight share of what I sent back.
- **Acceptance Criteria:**
  - **Given** a return of part of a bill that carried add-to-cost charges,
  - **When** the return is posted with policy `proportional` (the default),
  - **Then** each charge is reversed by `Σ (allocation of each returned line's purchase item × returned units / original total units of that line)`, i.e. **per-line proportional**, not by a document-level percentage;
  - **Then** the reversed tax is posted against input tax, the batch landed cost is reduced by the reversed allocation, and the supplier payable is debited by the returned goods **and** returned charge totals.
  - **Then** the landed cost is reduced **only by the reversal of charges that actually spread onto that line**: an
    expense-treated charge is given back through the expense register and its register credit never enters a batch,
    even though the books derive a notional per-line share of it to total the reversal (found by the Task 4.15
    reconciliation gate — a batch used to read below the supplier's own rate by that share).
  - **Given** the store policy is `sunk`,
  - **Then** no charge is reversed, landed cost is untouched, and the bill's charges remain exactly as originally posted.
  - **Then** a return may not reverse more than the original allocation, and reversing 100% of the lines reverses 100% of every charge to the paisa.
  - **Then** separately-paid charges follow the same proportional-or-sunk rule against the expense register, and
    reduce the supplier ledger only on the side the original bill was billed: a charge stored `in_payable = false`
    (the default, or any bill keyed before the switch existed) never touches it, while one billed into the payable
    reverses there like any supplier-borne charge (CR-C-11, [PUR-016](#pur-016-charge-policies-per-store)).

### [PUR-016] Charge Policies per Store
- **Story:** As a multi-store owner, I want each store to decide its own charge behaviour.
- **Acceptance Criteria:**
  - **Given** a store, its charge policy (persisted in the store's `billing` company settings, surfaced in the admin Settings screen and the POS settings screen) contains:
    - `reverse_on_return`: `proportional` | `sunk` (default `proportional`);
    - `separately_paid_in_payable`: boolean (default `false`) — added by CR-C-11. Off, a charge marked
      `paid_separately` stays out of `grand_total`, the supplier ledger and the invoice-total check
      ([PUR-013](#pur-013-separately-paid-charge-links)). On, the engine prices it exactly like a
      supplier-borne charge while the line still records the payee;
    - `default_treatment`, `default_spread_method` and `default_itc_eligibility` are **not** billing
      keys: each charge head carries its own defaults (`add_to_cost` | `expense`, `value` | `quantity`
      | `weight`, `eligible` | `ineligible` | `blocked` | `partial`), and a line that states nothing
      inherits them from the head it picked ([PUR-008](#pur-008-charge-head-master));
    - `allow_negative_charges`: boolean (default `true`) — enforced by the server: off, a bill carrying
      a negative charge line is refused. A head's own `allowed_sign` still applies on top of it, so a
      head seeded as positive-only stays positive-only whatever the switch says ([PUR-008](#pur-008-charge-head-master), [PUR-014](#pur-014-negative-adjustments));
    - `max_percent_of_goods`: optional cap on the charge total as a share of the goods value — enforced
      by the server, measured as **all positive rows together** against the goods taxable before charges,
      so two rows that breach it between them are refused although neither breaches it alone; unset or
      `0` means no cap.
  - **Then** both keys are checked at the one place both write paths pass — the HTTP purchase POST and a
    till's sync push — inside the bill's own transaction and before any charge row is written, so a
    refused bill leaves no header, no rows, no allocations and no expense entry behind.
  - **Then** the refusal is a validation error naming what it rejected: `charges.<n>.amount` for a sign
    the policy forbids, `charges` for a total above the cap, each carrying the allowance it measured
    against so the operator can see the number it objected to.
  - **Then** an offline till is not stopped from keying such a bill — it commits locally and the push is
    refused when the link returns, the same shape as every other server-side rule of this CR
    ([PUR-017](#pur-017-offline-charge-entry--sync)).
  - **Then** policy changes never rewrite already-posted bills; each bill keeps the values it was posted with.
  - **Then** the payable membership is a stored fact on the charge row (`purchase_charges.in_payable`), not something
    a report re-derives from the setting of the day; a row written before the column existed is read under the rule
    the migration backfilled it with — `paid_separately` meant outside the payable (CR-C-11).
  - **Then** the switch is read server-side and by the till's own settings; a till push payload never carries
    `in_payable`, because the server derives it from its own read of the policy ([PUR-017](#pur-017-offline-charge-entry--sync)).
  - **Then** one store's policy and heads are invisible to and non-inherited by another store.

### [PUR-017] Offline Charge Entry & Sync
- **Story:** As a counter operator with no internet, I want to enter charges offline and have the cloud agree with me when the link returns.
- **Acceptance Criteria:**
  - **Given** a fully offline till,
  - **Then** the head master, the policy and the whole charges grid work locally, and the bill (header + items + charges + allocations) is committed locally in one transaction.
  - **When** connectivity returns,
  - **Then** the charges ride **inside the existing purchase push payload** as a `charges[]` array (one queue entry per bill, never an orphan child entity), keyed by a deterministic `external_id` per charge line so retries are idempotent;
  - **Then** the server re-derives tax and allocations with its own engine and must reproduce the till's paisa exactly — a mismatch is a defect in the engines, not a conflict to resolve;
  - **When** a bill with charges is edited or cancelled offline and pushed,
  - **Then** the server replaces the child rows atomically (`delete + recreate` keyed by `external_id`, same convention as purchase items) and re-posts reversals once, never twice.
  - **Then** the till derives a note's reversal share from its own stored return records, matched on product and
    batch: a till debit note keeps its lines inside its own record rather than as `purchase_items` rows, so the
    `original_purchase_item_id` link the server writes for a note has no local counterpart to maintain — and a
    bill edit that re-keys its lines therefore cannot orphan a note filed at the counter.
  - **Legacy migration:** a bill whose stored `freight_charges > 0` and which has no charge rows is presented and
    re-computed as one charge line `{head: Freight, treatment: add_to_cost, gst_percent: 0}` materialised on first
    edit; historic totals and payables are **never** changed by this CR, and the missing `freight_charges` /
    `bill_discount*` columns are declared in the local schema as part of it.

### The reconciliation identity (applies to PUR-009 … PUR-017)
For every posted bill, **to the paisa**:

```
Σ goods taxable  +  Σ add-to-cost allocations  +  Σ expense-register postings (incl. non-creditable tax)
                   +  Σ creditable input tax (goods and charges)
    =  (grand_total − round_off)  +  Σ charge totals left outside the payable
```

and separately:

```
grand_total  ==  supplier ledger credit  ==  Σ line taxable + Σ line tax
                 + Σ charge totals billed into the payable + round_off
```

The second term on each side is a membership decision, not a kind of rupee: under the default policy a
`paid_separately` charge sits on the "left outside" side, and under `separately_paid_in_payable` it moves to the
"billed into the payable" side, and the identity foots to the paisa either way (CR-C-11).

Expense postings deliberately absorb non-creditable tax, an add-to-cost charge capitalises the tax it cannot claim
back, and only creditable tax is counted on the ITC side, so a `blocked` head cannot make value disappear. Round-off
is subtracted because it is a cash adjustment on the payable, not value that lands in stock, expense or tax.
`specs/gst_tax_test_vectors.json` asserts this identity as `reconciliation_identity_delta == 0` on every charge
vector (TC11–TC22).

---

## 3. Offline Behavior & Conflict Rules
- **Local Autonomy:** Purchase entries, stock receipts, and returns can be completed 100% offline — including the charges grid ([PUR-017](#pur-017-offline-charge-entry--sync)).
- **Batch Generation:** New batches created offline receive a deterministic unique key: `{product_id}_{batch_no}_{expiry_ymd}`.
- **Supplier Balance:** Supplier transactions sync to the backend sequentially based on document timestamp.
- **Charge Atomicity:** Charge lines and their allocations are part of the purchase aggregate. They are never queued,
  pushed, or deleted independently of the parent bill, so a half-synced bill with charges is impossible by construction.
- **Charge Head Availability:** A till receives only its own store's charge heads (rule `R12`); a head deleted
  centrally while a till is offline cannot strand a queued bill, because the posted bill stores the head **code and
  name** on the charge row, not a foreign key into the master.

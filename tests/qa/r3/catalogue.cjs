/**
 * Journey catalogue for QA round 3 (build 2.1.1).
 * `node catalogue.cjs` writes test-reports/journeys.csv from this list plus results.json.
 * Status vocabulary: PLANNED (before run), PASS, FAIL, BLOCKED, NOT_TESTABLE, FLAKY.
 */
const fs = require('fs');
const path = require('path');

// [id, journey, persona, steps, expected effects]
const J = [
  // J1 Setup and access
  ['J1.01','J1','Owner (admin panel)','Log in to admin panel; create pharmacy store QA Pharma (inclusive, regular GST, KL 32) and cosmetics store QA Glow (exclusive, regular GST, KA 29)','Two stores saved with own GST profile; audit entries; visible in Stores list; no cross-store data'],
  ['J1.02','J1','Owner (admin panel)','Create two counters per store; issue an activation code for each','Counter rows per store; one-time code shown once; code stored hashed; audit entry'],
  ['J1.03','J1','Cashier (desktop)','On a fresh till enter a wrong code, a random code, an expired code, a reused code','Each refused with a specific message; no device/counter claimed; failed attempts audited'],
  ['J1.04','J1','Cashier (desktop)','Enter the right code','Counter becomes active; device bound; store data (products, settings) loads'],
  ['J1.05','J1','Second device','Claim the same counter with the same code from another device','Refused; first device unaffected'],
  ['J1.06','J1','Owner','Re-issue a code for an active counter; old device calls the API','Old device token revoked (401/locked); new code claims cleanly'],
  ['J1.07','J1','Owner + cashier','Lock and unlock a counter from admin; set counter PIN; idle lock; wrong-PIN lockout','Locked counter loses API; unlock with PIN; N wrong PINs lock out'],
  ['J1.08','J1','Multi-store cashier','Store switcher with two stores on one device','Data separated per store; no product/bill bleed'],
  ['J1.09','J1','Attacker','Call tenant routes with no token / another store token','401/403 for every tenant route; nothing changes'],
  // J2 Products
  ['J2.01','J2','Cashier','Quick-add product from billing with typed name prefilled','Product saved on server with store_id; name prefilled'],
  ['J2.02','J2','Purchase clerk','Quick-add product from purchase screen','Same as J2.01'],
  ['J2.03','J2','Owner','Create product in admin panel under one store','Visible under that store only; never in other store'],
  ['J2.04','J2','Cashier (counter 2)','Second counter of same store sees new product within seconds','Pull/stream delivers product'],
  ['J2.05','J2','Owner','Same barcode in two stores allowed; duplicate barcode in one store refused naming the existing product','201 for cross-store; 409/422 naming product in same store'],
  ['J2.06','J2','Owner','Pack/loose conversion, archive, bulk import, image','Conversion persisted; archived hidden from billing; import counts; image stored'],
  ['J2.07','J2','Cashier','Restart / cache clear keeps product','Product reloads from server'],
  // J3 Purchase
  ['J3.01','J3','Purchase clerk','Keyboard-only supplier bill: supplier quick-add, bill no, new+existing batch, expiry, mfg date, no-batch item, pack+loose, free qty, % and amount discount, HSN/rate edit, margin warning','Purchase saved; lines match; warnings shown'],
  ['J3.02','J3','Purchase clerk','Charges: items 10,000 @12% + freight 200 + packing 100 @18% → 11,554; add-to-cost vs book-as-expense','Grand 11,554.00; supplier total check OK; landed cost or expense register per treatment'],
  ['J3.03','J3','Accountant','Post and verify stock per batch, landed cost, supplier ledger, input tax, purchase register','Batch qty +, ledger rows, supplier payable, ITC'],
  ['J3.04','J3','Purchase clerk','Duplicate supplier bill number refused','422/409; no second purchase'],
  ['J3.05','J3','Purchase clerk','Edit and cancel purchase; blocked/reversed when batch sold','Reversal correct or clear block'],
  ['J3.06','J3','Purchase clerk','Draft save and recall; convert PO; pay supplier across bills','Draft persisted; PO linked; allocation across bills'],
  // J4 Sales
  ['J4.01','J4','Cashier','Keyboard cash bill: 90/strip of 15 @12% incl, sell 2 strips + 5 tabs','Total 210.00, taxable 187.50, CGST 11.25, SGST 11.25; FEFO batch; stock -35 tabs; server number; counter/store; salesperson required'],
  ['J4.02','J4','Cashier','Retry and double-click Save','Exactly one invoice'],
  ['J4.03','J4','Cashier','Split cash+UPI with reference; change only from cash','Payments rows sum to total; change correct'],
  ['J4.04','J4','Cashier','Credit sale walk-in blocked; named customer within limit allowed; over limit blocked','Rules enforced server side'],
  ['J4.05','J4','Cashier','Hold and recall; out-of-stock sale & negative flag; discount limit and approval; letters in qty; loose-only qty','Each rule enforced'],
  ['J4.06','J4','Cashier','Exclusive (cosmetics) and composition tax modes','Exclusive adds tax; composition shows no tax'],
  ['J4.07','J4','Pharmacist','Restricted drug needs pharmacist PIN; wrong PIN lockout; expired registration refused; bill stores pharmacist+reg; doctor/patient fields pharmacy only','Gate enforced; fields absent in cosmetics store'],
  // J5 Returns
  ['J5.01','J5','Cashier','Sales return partial/loose with restock vs damaged; proportional tax; remaining-qty limit; refund modes; credit note number','Stock & tax reversed; limit enforced'],
  ['J5.02','J5','Accountant','Customer debit note covering several invoices, partial approval, reconciliation','Ledger matches'],
  ['J5.03','J5','Purchase clerk','Purchase return; blocked when stock sold','Stock/payable/ITC reversed or blocked'],
  // J6
  ['J6.01','J6','Manager','Edit invoice with manager PIN / admin one-time PIN (works once, expires, document-bound) / admin allow-edit unlock','Each path audited; OTP single-use'],
  ['J6.02','J6','Manager','Cancel with reason: stock, ledger, tax reverse; number kept','Status cancelled; reversals; number not reused'],
  ['J6.03','J6','Accountant','Closed period blocks cancel unless audited override; approval inbox','Block + override audit'],
  // J7
  ['J7.01','J7','Store keeper','Single and bulk stock adjustment; daily limit 100 → 120 held for approval','Ledger rows; held adjustment'],
  ['J7.02','J7','Store keeper','Physical count; negative-stock review and offset by purchase','Variance posted; negative resolved'],
  ['J7.03','J7','Store keeper','Transfer between stores: dispatch, in-transit, receive, barcode match, create-on-receive, short receipt','Stock moves exactly once each side'],
  // J8
  ['J8.01','J8','Accountant','Customer receipt allocated to invoices','Outstanding reduced per invoice'],
  ['J8.02','J8','Accountant','Expenses: cash from drawer, bank, credit','Cash book / bank book / payable'],
  ['J8.03','J8','Accountant','Supplier payment allocation','Payable reduced per bill'],
  ['J8.04','J8','Cashier','Shift open/close with mixed modes and cash difference','Expected vs counted; difference recorded'],
  // J9
  ['J9.01','J9','Owner','Dashboard widgets vs independent calculations','Agree to the paisa'],
  ['J9.02','J9','Accountant','Daily summary, sales register, GST (GSTR-1, HSN) agree; cancelled excluded; returns netted','Agree to the paisa'],
  ['J9.03','J9','Accountant','Day boundary 23:55 / 00:05 store time zone','Bills land on correct day'],
  ['J9.04','J9','Owner','Recent invoices list shows each document once','No duplicates'],
  // J10
  ['J10.01','J10','Two cashiers','Two counters sell the same batch concurrently','No oversell beyond policy; ledger consistent'],
  ['J10.02','J10','Cashier','Offline billing with leased numbers; reconnect; sync once in order','No duplicates/clashes'],
  ['J10.03','J10','Two cashiers','Same product created offline on two counters → conflict in sync centre','Conflict visible'],
  ['J10.04','J10','Owner','Revoke counter while offline → locks on reconnect','Locked'],
  ['J10.05','J10','Owner','Admin counter list: status, last salesperson, last bill time, unsynced items, offline periods','Live and correct'],
  // J11
  ['J11.01','J11','Owner','Every record visible in admin under right store, filters/totals/export; nothing from other store','Parity'],
  ['J11.02','J11','Owner','Live policy change (discount limit, tax mode, counter profile) obeyed within seconds','Counter obeys'],
  ['J11.03','J11','Owner','Alerts: low stock, expiry, counter offline, large discount, failed codes; audit trail for sensitive actions','Alerts & audit present'],
  ['J11.04','J11','Owner','Suspend store → counters blocked within a minute','Blocked'],
  // J12
  ['J12.01','J12','Cashier','Print preview from single Print button; save layout as store default','Preview opens; default saved'],
  ['J12.02','J12','Cashier','A4/thermal/dot-matrix values equal invoice; store details; ₹; paper widths reflow; no blank page','Output correct'],
  // J13
  ['J13.01','J13','Owner','UPI details flow into QR/print; tax mode change only affects new docs; store type change shows/hides pharmacy fields','Correct'],
  ['J13.02','J13','Cashier','Shortcut conflicts; counter profile restrictions enforced on direct API calls','Conflicts none; server refuses'],
  // J14
  ['J14.01','J14','Cashier','Every screen at 1366 and 1920; keyboard-only sale/purchase/return; focus; modal stacking; themes; states; no placeholder text','Clean'],
  // J15
  ['J15.01','J15','Owner','Update feed: none / new / missing file / bad signature; data kept','Correct handling'],
  // Integrity
  ['INT.01','INT','QA','Integrity: ledger=batch, no orphans/dup numbers, totals=lines=payments, tax=line tax, ledgers, timestamps, audit, cross-store','Zero mismatches'],
];

function write(results = {}) {
  const esc = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  const rows = [['id', 'journey', 'persona', 'steps', 'expected_effects', 'status', 'defects', 'evidence', 'notes']];
  for (const [id, j, persona, steps, exp] of J) {
    const r = results[id] || {};
    rows.push([id, j, persona, steps, exp, r.status || 'PLANNED', (r.defects || []).join(' '), r.evidence || '', r.notes || '']);
  }
  const out = path.resolve(__dirname, '../../../test-reports/journeys.csv');
  fs.writeFileSync(out, rows.map((r) => r.map(esc).join(',')).join('\n') + '\n');
  return out;
}

if (require.main === module) {
  const resPath = path.resolve(__dirname, 'results.json');
  const results = fs.existsSync(resPath) ? JSON.parse(fs.readFileSync(resPath, 'utf8')) : {};
  console.log(write(results), J.length, 'journeys');
}
module.exports = { J, write };

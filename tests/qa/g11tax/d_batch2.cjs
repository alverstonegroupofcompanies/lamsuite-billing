const { add } = require('./defects.cjs');
add({ id: 'STK-01', group: 'G2-STOCK', title: 'Admin product with opening stock fills the batch but leaves products.current_stock at 0 and writes no stock-ledger entry', severity: 'Critical', type: 'Data', journey: 'J2',
  steps: 'Admin panel > Masters > Add Product (store QA-PH): QA Cough Syrup 100ml, Batch CS-A1, Expiry 2027-06-30, Stock Quantity 40; save.',
  expected: 'Batch CS-A1 qty 40, product current_stock 40, one opening-stock ledger row (+40) so ledger = batch balance',
  actual: 'POST /api/admin/products 201 with initial_batch.stock_qty 40: product_batches.stock_qty = 40, products.current_stock = 0, stock_ledger_entries = 0 rows. Same for QA Ruby Lipstick (25) in QA-CS.',
  evidence: 'tests/qa/r3/evidence/J2_03_admin_products.json',
  cause: 'AdminMasterController (admin products store) creates initial_batch directly on ProductBatch without going through the stock posting service that maintains products.current_stock and stock_ledger_entries.',
  fix: 'Post opening stock through the same stock-movement service used by purchases/adjustments (event_type opening_stock) inside the create transaction.',
  test: 'Feature: create product with initial_batch qty 40 -> current_stock 40 and sum(stock_ledger_entries.qty_delta) for the batch = 40.' });
add({ id: 'PRD-01', group: 'G2-STOCK', title: 'Every admin-created product gets a phantom zero-quantity batch "B1" with an invented expiry (today + 1 year)', severity: 'Medium', type: 'Data', journey: 'J2',
  steps: 'Admin panel > Add Product, leave Stock Quantity 0 (Batch No is prefilled B1, Expiry prefilled today+1y); save.',
  expected: 'No batch is created when no stock is entered', actual: 'product_batches row B1, expiry 2027-11-21, stock_qty 0 for QA Paracet 500 Strip, QA Alprazolam, QA Glow Face Cream.',
  evidence: 'tests/qa/r3/evidence/J2_03_admin_products.json', cause: 'admin-panel/src/pages/MastersPage.tsx always sends initial_batch with defaults; backend accepts a zero-qty initial batch.',
  fix: 'Send initial_batch only when quantity > 0; backend ignores zero-qty initial batches; do not prefill an expiry.', test: 'DOM test: product with stock 0 posts no initial_batch; feature test: zero-qty initial batch creates no row.' });
add({ id: 'ACT-01', group: 'G5-COUNTER', title: 'Activation lockout is per IP: five wrong codes from any till on the shop network block every till behind that IP for 15 minutes, even with a correct code', severity: 'Medium', type: 'Security', journey: 'J1',
  steps: 'From one browser enter 5 wrong/random/revoked codes; then on a different device (same IP) enter a fresh valid code.',
  expected: 'Wrong codes lock the device that typed them (and alert); a valid code on another till still claims, or the lock is per counter/code',
  actual: '429 "Too many failed activation attempts. Counter enrolment is locked for a few minutes" for the valid code from a second device; locked for 15 min.',
  evidence: 'tests/qa/r3/evidence/J1_03_activation.json', cause: 'backend/app/Models/DeviceActivationAttempt.php:36 countRecentFailures() counts failures by ip_address OR device_uuid; CounterClaimService::claim() checks lockedOut() before looking at the code.',
  fix: 'Key the lockout on device_uuid (+ per-code attempt counter); keep an IP limit only as a high ceiling for brute force.', test: 'Feature: 5 failures from device A then valid code from device B on the same IP -> 200.' });
console.log('ok');

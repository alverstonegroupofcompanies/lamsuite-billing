const { add } = require('./defects.cjs');
add({ id: 'TAX-03', group: 'G11-TAX', title: 'Karnataka store bills local walk-in sales as inter-state: place_of_supply "32-Kerala", IGST ₹72 instead of CGST ₹36 + SGST ₹36', severity: 'Critical', type: 'Logic', journey: 'J4',
  steps: 'Till QA-CS (state 29) C01: sell QA Ruby Lipstick ₹400 + 18% (exclusive) to walk-in; save.', expected: 'place_of_supply 29; CGST 36.00 + SGST 36.00; total 472.00',
  actual: 'C01-INV-1051: place_of_supply "32-Kerala", store_state_code 29, cgst 0, sgst 0, igst 72.00 (total 472.00 correct). GSTR-1 would report it as inter-state.',
  evidence: 'tests/qa/r3/evidence/J4_06_exclusive.json', cause: 'Till defaults the bill place of supply to "32-Kerala" (hard-coded Kerala) instead of the store state when no customer state is known; server trusts it (see also MST-01 parties default 32).',
  fix: 'Default place of supply to the store state for walk-in/B2C; derive from customer GSTIN/state otherwise; server recomputes intra/inter from store state vs POS.', test: 'Feature + till test: store 29, walk-in -> place_of_supply 29, CGST/SGST split.' });
console.log('ok');

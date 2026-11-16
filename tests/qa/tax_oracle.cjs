/**
 * INDEPENDENT TAX ORACLE — exact integer-paisa arithmetic.
 *
 * Written from Indian GST mechanics, NOT by reading the app's engine, so that a
 * difference between this and the product is evidence rather than a shared bug.
 *
 * Rules used (documented so a reviewer can disagree with a rule, not a mystery):
 *  R1  billed units   = packs*units_per_pack + loose_units
 *  R2  gross (paisa)  = round_half_up(billed_units * unit_price)   [unit_price in paisa]
 *  R3  line discount  applied before tax: net = gross - round_half_up(gross*pct/100) - flat_paisa
 *  R4  bill discount  applied pro-rata on the summed net base, remainder to the largest line
 *  R5  INCLUSIVE: taxable = round_half_up(net / (1 + rate/100)); tax = net - taxable
 *      -> guarantees taxable + tax == net for every line (no 1-paisa leak)
 *  R6  EXCLUSIVE: taxable = net; tax = round_half_up(net * rate/100)
 *  R7  cess is computed on the taxable base at its own rate; for inclusive, cess is taken
 *      out of the total tax and GST is the remainder
 *  R8  intra-state: cgst = floor(tax/2), sgst = tax - cgst  -> cgst + sgst == tax exactly
 *      inter-state: igst = tax, cgst = sgst = 0
 *  R9  composition / no_tax / unregistered stores: rate forced to 0, no GST columns
 *  R10 round_off: nearest whole rupee (half up) applied to the invoice total;
 *      grand = total_before_round + round_off, so grand is always a whole rupee
 *      and grand == taxable_total + tax_total + round_off
 *  R11 partial return reverses at the ORIGINAL line rate and ORIGINAL inclusive flag
 *
 * All money is integer paisa. Nothing here uses floating point for money.
 */

const PAISA = 100;

/** "10.075" -> 1008 paisa (half up, on the decimal string, no float error). */
function toPaisa(value) {
  const s = String(value).trim();
  const neg = s.startsWith('-');
  const abs = neg ? s.slice(1) : s;
  const [intPart, fracRaw = ''] = abs.split('.');
  const frac = (fracRaw + '000000').slice(0, 6);            // enough for paisa + guard digits
  const whole = BigInt(intPart || '0') * BigInt(PAISA);
  const hundredths = BigInt(frac.slice(0, 2));
  const nextDigit = BigInt(frac[2] || '0');
  let p = whole + hundredths;
  if (nextDigit >= 5n) p += 1n;                              // half up at the paisa boundary
  return Number(neg ? -p : p);
}

const roundHalfUp = (numerator, denominator) => {
  // exact integer half-up division of non-negative values
  const n = BigInt(numerator), d = BigInt(denominator);
  const q = n / d, r = n % d;
  return Number(r * 2n >= d ? q + 1n : q);
};

const fmt = (p) => (p < 0 ? '-' : '') + (Math.abs(p) / PAISA).toFixed(2);

/**
 * @param {object} inv  { store:{state_code, tax_mode, gst_type}, customer:{gstin, place_of_supply},
 *                        lines:[{name, packs, loose_qty, unit_price, units_per_pack, gst_percent,
 *                                 cess_percent, discount_percent, discount_amount, free_qty}],
 *                        bill_discount:{percent|amount}, manual_round_off:number|null,
 *                        payments:[{mode, amount}] }
 */
function computeInvoice(inv) {
  const store = inv.store;
  const inclusive = store.tax_mode === 'inclusive';
  const gstType = (store.gst_type || 'regular').toLowerCase();
  const taxSuppressed = ['composition', 'no_tax', 'unregistered'].includes(gstType);

  // Place of supply: customer GSTIN state wins, then explicit place_of_supply, then store state.
  const pos = (inv.customer?.gstin || '').slice(0, 2)
    || (inv.customer?.place_of_supply || '').slice(0, 2)
    || String(store.state_code);
  const interState = String(pos) !== String(store.state_code);

  const lines = [];
  let sumNetBase = 0;

  for (const l of inv.lines) {
    const upp = Math.max(1, Math.round(l.units_per_pack ?? 1));
    const packs = Math.round(l.packs ?? 0);
    const loose = Math.round(l.loose_qty ?? 0);
    const billedUnits = packs * upp + loose;
    const unitPaisa = toPaisa(l.unit_price);
    // R2 basis is explicit: the product's own meaning of "unit_price" on a pack line must be
    // established from the UI, not assumed. 'per_unit' prices every single piece; 'per_pack'
    // prices the whole pack and derives loose pieces as price/units_per_pack.
    const basis = l.price_basis || inv.price_basis || 'per_unit';
    let gross;
    if (basis === 'per_pack') {
      gross = packs * unitPaisa
        + roundHalfUp(BigInt(loose) * BigInt(unitPaisa), BigInt(upp));
    } else {
      gross = roundHalfUp(BigInt(billedUnits) * BigInt(unitPaisa), 1n);
    }

    const dp = Number(l.discount_percent ?? 0);
    const da = l.discount_amount != null ? toPaisa(l.discount_amount) : 0;
    let lineDisc = 0;
    if (dp) lineDisc += roundHalfUp(BigInt(gross) * BigInt(toPaisa(dp)), 10000n);
    lineDisc += da;
    if (lineDisc > gross) lineDisc = gross;
    const net = gross - lineDisc;
    sumNetBase += net;

    lines.push({ src: l, billedUnits, gross, lineDisc, net, unitPaisa });
  }

  // Bill-level discount, pro-rata across lines, remainder to the largest line.
  let billDiscTotal = 0;
  if (inv.bill_discount?.percent) {
    billDiscTotal = roundHalfUp(BigInt(sumNetBase) * BigInt(toPaisa(inv.bill_discount.percent)), 10000n);
  } else if (inv.bill_discount?.amount) {
    billDiscTotal = Math.min(sumNetBase, toPaisa(inv.bill_discount.amount));
  }
  if (billDiscTotal > 0) {
    const biggest = lines.reduce((a, b) => (b.net > a.net ? b : a), lines[0]);
    let allocated = 0;
    for (const ln of lines) {
      const share = ln === biggest
        ? billDiscTotal - allocated
        : roundHalfUp(BigInt(billDiscTotal) * BigInt(ln.net), BigInt(sumNetBase));
      allocated += share;
      ln.net -= share;
      ln.billDiscShare = share;
    }
  }

  let taxable = 0, gst = 0, cess = 0, cgst = 0, sgst = 0, igst = 0, taxTotal = 0, lineTotalSum = 0;
  const outLines = [];

  for (const ln of lines) {
    const rate = taxSuppressed ? 0 : Number(ln.src.gst_percent ?? 0);
    const cessRate = taxSuppressed ? 0 : Number(ln.src.cess_percent ?? 0);
    let lTaxable, lTax;

    if (inclusive) {
      // taxable = net / (1 + (rate+cess)/100), tax = net - taxable  (R5)
      const denomPaisa = 10000n + BigInt(Math.round((rate + cessRate) * 100));
      lTaxable = roundHalfUp(BigInt(ln.net) * 10000n, denomPaisa);
      lTax = ln.net - lTaxable;
      const cessOnTaxable = cessRate ? roundHalfUp(BigInt(lTaxable) * BigInt(Math.round(cessRate * 100)), 10000n) : 0;
      const lCess = Math.min(cessOnTaxable, lTax);
      const lGst = lTax - lCess;
      const { c, g, i } = splitTax(lGst, lCess, interState, cessRate);
      lTaxable && 0;
      taxable += lTaxable; gst += lGst; cess += lCess;
      cgst += c; sgst += g; igst += i;
      taxTotal += lTax;
      lineTotalSum += lTaxable + lTax;
      outLines.push(mkLine(ln, lTaxable, lGst, lCess, c, g, i, lTax));
    } else {
      lTaxable = ln.net;
      const lGst = rate ? roundHalfUp(BigInt(lTaxable) * BigInt(Math.round(rate * 100)), 10000n) : 0;
      const lCess = cessRate ? roundHalfUp(BigInt(lTaxable) * BigInt(Math.round(cessRate * 100)), 10000n) : 0;
      lTax = lGst + lCess;
      const { c, g, i } = splitTax(lGst, lCess, interState, cessRate);
      taxable += lTaxable; gst += lGst; cess += lCess;
      cgst += c; sgst += g; igst += i;
      taxTotal += lTax;
      lineTotalSum += lTaxable + lTax;
      outLines.push(mkLine(ln, lTaxable, lGst, lCess, c, g, i, lTax));
    }
  }

  const beforeRound = lineTotalSum;
  let roundOff;
  if (inv.manual_round_off != null) roundOff = toPaisa(inv.manual_round_off);
  else roundOff = roundHalfUp(BigInt(beforeRound), PAISA) * PAISA - beforeRound;   // nearest rupee, half up
  const grand = beforeRound + roundOff;

  return {
    meta: { inclusive, gstType, interState, pos, taxSuppressed },
    lines: outLines,
    totals: {
      gross_subtotal: fmt(lines.reduce((a, l) => a + l.gross, 0)),
      discount_total: fmt(lines.reduce((a, l) => a + l.lineDisc + (l.billDiscShare || 0), 0)),
      taxable_subtotal: fmt(taxable),
      tax_total: fmt(taxTotal),
      cgst_total: fmt(cgst),
      sgst_total: fmt(sgst),
      igst_total: fmt(igst),
      cess_total: fmt(cess),
      round_off: fmt(roundOff),
      grand_total: fmt(grand),
    },
    invariants: {
      net_base_reconciles: inclusive
        ? (taxable + taxTotal === lines.reduce((a, l) => a + l.net, 0))   // R5: tax carved out of net
        : (taxable === lines.reduce((a, l) => a + l.net, 0)),              // R6: tax added on top of net
      split_equals_tax: cgst + sgst + igst + cess === taxTotal,
      grand_equals_parts: grand === taxable + taxTotal + roundOff,
      grand_is_whole_rupee: inv.manual_round_off != null ? true : grand % PAISA === 0,
    },
  };
}

function splitTax(gstPaisa, cessPaisa, interState, cessRate) {
  if (interState) return { c: 0, g: 0, i: gstPaisa + cessPaisa };
  const c = Math.floor(gstPaisa / 2);
  const g = gstPaisa - c;
  return { c, g, i: 0 };
}

function mkLine(ln, taxable, gstPaisa, cessPaisa, c, g, i, tax) {
  return {
    name: ln.src.name, billed_units: ln.billedUnits, gross: fmt(ln.gross),
    discount: fmt(ln.lineDisc + (ln.billDiscShare || 0)), taxable: fmt(taxable),
    gst: fmt(gstPaisa), cess: fmt(cessPaisa), cgst: fmt(c), sgst: fmt(g), igst: fmt(i),
    line_tax: fmt(tax), line_total: fmt(taxable + tax),
  };
}

/** Expected stock effect of a sale: units leaving each batch, FEFO order. */
function fefoDraw(batches, units) {
  const sorted = [...batches].sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
  const draws = [];
  let left = units;
  for (const b of sorted) {
    if (left <= 0) break;
    const take = Math.min(left, Math.floor(Number(b.stock_qty)));
    if (take > 0) { draws.push({ batch_no: b.batch_no, batch_id: b.id, take, remaining: Number(b.stock_qty) - take }); left -= take; }
  }
  return { draws, short_by: left };
}

module.exports = { computeInvoice, toPaisa, fmt, fefoDraw, roundHalfUp };

// ---------------- self-test ----------------
if (require.main === module) {
  let pass = 0, fail = 0;
  const t = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) pass++; else { fail++; console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };

  // S1: inclusive 100 @12% -> taxable 89.29, tax 10.71, split 5.35/5.36 (sum exactly 10.71)
  const s1 = computeInvoice({
    store: { state_code: '32', tax_mode: 'inclusive', gst_type: 'regular' },
    lines: [{ name: 'A', packs: 0, loose_qty: 1, unit_price: 100.00, units_per_pack: 1, gst_percent: 12 }],
  });
  t('S1 taxable', s1.totals.taxable_subtotal, '89.29');
  t('S1 tax', s1.totals.tax_total, '10.71');
  t('S1 split sums', Number(s1.totals.cgst_total) + Number(s1.totals.sgst_total), 10.71);
  t('S1 grand (rounds to 100.00)', s1.totals.grand_total, '100.00');

  // S2: exclusive 89.29 @12% -> tax 10.71 (0.12*8929 = 1071.48 -> 1071)
  const s2 = computeInvoice({
    store: { state_code: '32', tax_mode: 'exclusive', gst_type: 'regular' },
    lines: [{ name: 'B', packs: 0, loose_qty: 1, unit_price: 89.29, units_per_pack: 1, gst_percent: 12 }],
    manual_round_off: 0,
  });
  t('S2 tax', s2.totals.tax_total, '10.71');
  t('S2 grand', s2.totals.grand_total, '100.00');

  // S3: pack + loose on per_unit basis: 3 packs x 10 + 7 loose = 37 pieces @ 12.50 = 462.50 @12% incl
  const s3 = computeInvoice({
    store: { state_code: '32', tax_mode: 'inclusive', gst_type: 'regular' },
    lines: [{ name: 'C', packs: 3, loose_qty: 7, unit_price: 12.50, units_per_pack: 10, gst_percent: 12 }],
  });
  t('S3 gross', s3.totals.gross_subtotal, '462.50');
  t('S3 taxable', s3.totals.taxable_subtotal, '412.95');
  t('S3 tax', s3.totals.tax_total, '49.55');
  t('S3 grand', s3.totals.grand_total, '463.00');
  t('S3 split exact', s3.invariants.split_equals_tax, true);

  // S3b: same line on per_pack basis -> 3 packs @12.50/pack = 37.50 plus 7 loose @ (12.50/10)=1.25 = 8.75
  const s3b = computeInvoice({
    store: { state_code: '32', tax_mode: 'exclusive', gst_type: 'regular' },
    price_basis: 'per_pack',
    lines: [{ name: 'C2', packs: 3, loose_qty: 7, unit_price: 12.50, units_per_pack: 10, gst_percent: 0 }],
    manual_round_off: 0,
  });
  t('S3b gross (per_pack)', s3b.totals.taxable_subtotal, '46.25');

  // S4: inter-state -> IGST only
  const s4 = computeInvoice({
    store: { state_code: '32', tax_mode: 'exclusive', gst_type: 'regular' },
    customer: { gstin: '27AAAAA0000QE5Z5' },
    lines: [{ name: 'D', packs: 0, loose_qty: 2, unit_price: 100.00, units_per_pack: 1, gst_percent: 18 }],
    manual_round_off: 0,
  });
  t('S4 igst', s4.totals.igst_total, '36.00');
  t('S4 cgst', s4.totals.cgst_total, '0.00');

  // S5: composition store -> no GST at all
  const s5 = computeInvoice({
    store: { state_code: '32', tax_mode: 'inclusive', gst_type: 'composition' },
    lines: [{ name: 'E', packs: 0, loose_qty: 1, unit_price: 100.00, units_per_pack: 1, gst_percent: 12 }],
    manual_round_off: 0,
  });
  t('S5 tax', s5.totals.tax_total, '0.00');
  t('S5 taxable', s5.totals.taxable_subtotal, '100.00');

  // S6: mixed rates + bill discount 5% on 3 lines
  const s6 = computeInvoice({
    store: { state_code: '32', tax_mode: 'exclusive', gst_type: 'regular' },
    lines: [
      { name: 'F1', packs: 1, loose_qty: 0, unit_price: 30.00, units_per_pack: 10, gst_percent: 12 },
      { name: 'F2', packs: 0, loose_qty: 1, unit_price: 200.00, units_per_pack: 1, gst_percent: 5 },
      { name: 'F3', packs: 0, loose_qty: 1, unit_price: 99.99, units_per_pack: 1, gst_percent: 28 },
    ],
    bill_discount: { percent: 5 },
    manual_round_off: 0,
  });
  t('S6 invariant split==tax', s6.invariants.split_equals_tax, true);
  t('S6 invariant grand', s6.invariants.grand_equals_parts, true);

  console.log(`\ntax oracle self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

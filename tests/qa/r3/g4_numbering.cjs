/**
 * G4-NUMBERING against the live QA backend.
 *
 * NUM-01 — a lease reserves a block; five heartbeat asks must not open five
 *          blocks, and the series cursor must not move because of an ask.
 * NUM-02 — the counter issues the number at save: the number the till is
 *          answered with is the number that lands in the book.
 *
 * Throwaway data only: it creates its own store, counter, product and bills.
 */
const { api, adminToken, sql, one, evidence } = require('./lib.cjs');

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
  return ok;
};

const seriesRow = (counterId) =>
  sql(`select doc_type,next_number,range_start,range_end from counter_sequences where counter_id=${counterId} and doc_type='invoice'`)[0];

(async () => {
  const admin = await adminToken();
  const stamp = Date.now().toString().slice(-6);

  const storeRes = await api('POST', '/admin/stores', {
    name: `G4 Numbering QA ${stamp}`,
    code: `G4N${stamp}`,
    state_code: '32',
    store_type: 'pharmacy',
    gst_type: 'regular',
    tax_mode: 'inclusive',
  }, { token: admin });
  if (storeRes.status !== 201 && storeRes.status !== 200) throw new Error('store create failed ' + storeRes.text);
  const storeId = storeRes.json.id;

  const counterRes = await api('POST', '/admin/counters', {
    counter_name: 'G4 Front Till',
    location_name: 'Front desk',
  }, { token: admin, store: storeId });
  if (counterRes.status !== 201 && counterRes.status !== 200) throw new Error('counter create failed ' + counterRes.text);
  const counterId = counterRes.json.counter.id;

  const codeRes = await api('POST', `/admin/counters/${counterId}/activation-code`, {}, { token: admin, store: storeId });
  if (codeRes.status !== 200) throw new Error('activation code failed ' + codeRes.text);

  const claimRes = await api('POST', '/counters/claim', {
    code: codeRes.json.code,
    device_uuid: `g4-numbering-${stamp}`,
    device_name: 'G4 QA till',
  });
  if (claimRes.status !== 200 || !claimRes.json.device_token) throw new Error('claim failed ' + claimRes.text);
  const device = claimRes.json.device_token;

  const productRes = await api('POST', '/products', {
    barcode: `G4BAR${stamp}`,
    name: 'G4 Numbering Strip',
    mrp: 100,
    sel_rate: 100,
    gst_percent: 0,
    units_per_pack: 1,
  }, { device });
  if (productRes.status !== 201) throw new Error('product create failed ' + productRes.text);

  const batchRes = await api('POST', `/products/${productRes.json.id}/batches`, {
    batch_no: 'G4-B1',
    expiry_date: '2028-01-01',
    stock_qty: 100,
    mrp: 100,
    selling_rate: 100,
  }, { device });
  if (batchRes.status !== 201) throw new Error('batch create failed ' + batchRes.text);

  const bill = async (externalId, overrides = {}) => {
    const res = await api('POST', '/invoices', {
      external_id: externalId,
      idempotency_key: externalId,
      customer_name: 'Walk-in Customer',
      payment_mode: 'Cash',
      payments: [{ mode: 'Cash', amount: 100 }],
      items: [{
        product_id: productRes.json.id,
        batch_id: batchRes.json.id,
        batch_no: 'G4-B1',
        qty: 1,
        unit_price: 100,
        gst_percent: 0,
      }],
      ...overrides,
    }, { device });
    return res;
  };

  const ev = { storeId, counterId, leases: [], bills: [] };

  /* ---------- NUM-01: a heartbeat of asks reserves, it does not spend ---------- */
  for (let i = 0; i < 5; i++) {
    const res = await api('POST', '/counter/sequences/lease', { doc_type: 'invoice', block_size: 50 }, { device });
    if (res.status !== 200) throw new Error('lease failed ' + res.status + ' ' + res.text);
    ev.leases.push({ range: `${res.json.range_start}-${res.json.range_end}`, next_number: res.json.next_number });
  }
  const distinctBlocks = new Set(ev.leases.map((l) => l.range));
  check('five heartbeat asks hold one block', distinctBlocks.size === 1, [...distinctBlocks].join(' '));

  const afterAsks = seriesRow(counterId);
  const first = ev.leases[0];
  check('asking for a block spends nothing', Number(afterAsks.next_number) === Number(first.range.split('-')[0]),
    `cursor ${afterAsks.next_number}, block ${first.range}`);

  /* ---------- NUM-02: the answered number is the filed number ---------- */
  const numbers = [];
  for (let i = 1; i <= 3; i++) {
    const externalId = `g4_num_${stamp}_${i}`;
    const res = await bill(externalId);
    if (res.status !== 201) throw new Error(`bill ${i} failed ${res.status} ${res.text}`);
    const answered = res.json.invoice.invoice_number;
    const filed = one(`select invoice_number from invoices where external_id='${externalId}'`);
    numbers.push({ answered, filed });
    check(`bill ${i}: header equals the saved number`, answered === filed, `${answered} / ${filed}`);
  }
  check('three bills are consecutive in one series',
    new Set(numbers.map((n) => n.answered)).size === 3 &&
    numbers[0].answered.endsWith('-1001') && numbers[1].answered.endsWith('-1002') && numbers[2].answered.endsWith('-1003'),
    numbers.map((n) => n.answered).join(' '));
  check('nothing is filed under a temporary number',
    Number(one(`select count(*) from invoices where store_id=${storeId} and invoice_number like 'TEMP-%'`)) === 0);

  const afterBills = seriesRow(counterId);
  check('the series moved by exactly the three bills', Number(afterBills.next_number) === 1004, `cursor ${afterBills.next_number}`);

  /* ---------- a block closes on what the till reports it spent, not on asks ---------- */
  const lease = async (body) => {
    const res = await api('POST', '/counter/sequences/lease', { doc_type: 'invoice', block_size: 50, ...body }, { device });
    if (res.status !== 200) throw new Error('lease failed ' + res.status + ' ' + res.text);
    return res.json;
  };

  const partUsed = await lease({ used_through: 1003 });
  check('a block with numbers left is held, not replaced',
    Number(partUsed.range_start) === 1001 && Number(partUsed.range_end) === 1050,
    `${partUsed.range_start}-${partUsed.range_end}`);
  check('reporting what was spent moves the cursor to the number after it',
    Number(partUsed.next_number) === 1004, `cursor ${partUsed.next_number}`);

  const idle = await lease({});
  check('an ask that reports nothing new changes nothing',
    Number(idle.range_start) === 1001 && Number(idle.range_end) === 1050 && Number(idle.next_number) === 1004,
    `${idle.range_start}-${idle.range_end} cursor ${idle.next_number}`);

  const drained = await lease({ used_through: 1050 });
  check('a drained block opens the next one right after it',
    Number(drained.range_start) === 1051 && Number(drained.range_end) === 1100,
    `${drained.range_start}-${drained.range_end}`);

  const overstated = await lease({ block_size: 5, used_through: 999999 });
  check('an overstated report cannot burn past the block it holds',
    Number(overstated.range_start) === 1101 && Number(overstated.range_end) === 1105,
    `${overstated.range_start}-${overstated.range_end}`);

  /* ---------- a number that is not this counter's to give is reissued ---------- */
  const stale = await bill(`g4_num_${stamp}_stale`, { invoice_number: numbers[0].answered });
  const staleAnswered = stale.json?.invoice?.invoice_number;
  const staleFiled = one(`select invoice_number from invoices where external_id='g4_num_${stamp}_stale'`);
  check('a re-used number is reissued, not refused', stale.status === 201 && staleAnswered !== numbers[0].answered,
    `${staleAnswered} (asked ${numbers[0].answered})`);
  check('the reissued number is the number on screen', staleAnswered === staleFiled, `${staleAnswered} / ${staleFiled}`);

  const foreign = await bill(`g4_num_${stamp}_foreign`, { invoice_number: 'C99-INV-1001' });
  const foreignAnswered = foreign.json?.invoice?.invoice_number;
  const foreignFiled = one(`select invoice_number from invoices where external_id='g4_num_${stamp}_foreign'`);
  check('a number from another counter series is replaced with this counter own',
    foreign.status === 201 && /^C01-INV-\d+$/.test(String(foreignAnswered)), String(foreignAnswered));
  check('the replaced number is the number in the book', foreignAnswered === foreignFiled, `${foreignAnswered} / ${foreignFiled}`);

  ev.bills = numbers;
  ev.finalSeries = seriesRow(counterId);
  ev.countersInStore = sql(`select counter_code from counters where store_id=${storeId}`);
  const file = evidence('g4_numbering', ev);
  console.log(`\nevidence: ${file}`);
  console.log(failures.length ? `FAILED ${failures.length}: ${failures.join(', ')}` : 'ALL CHECKS PASSED');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });

/**
 * Focused probe for the S2.2 harness path: open the Stock Adjustment Document modal,
 * enter two lines through its Import CSV sheet-paste, post, and report what the grid
 * and the surfaces say. Existence proof only — the verdict lives in gst_s2_returns.cjs.
 */
const {
  storeByCode, fixture, login, sleep, navTo, sql, serverBatchStock, localTable, setInput, shot,
} = require('./gst_kit.cjs');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';
const STORE_CODE = 'QA-A';

(async () => {
  const store = storeByCode(STORE_CODE);
  const { s, ok, stage, detail } = await login({ storeCode: STORE_CODE, key: KEY, username: 'qaa_owner', pin: '9101', counterName: 'GST Adj Probe' });
  console.log('login', ok, stage, JSON.stringify(detail || '').slice(0, 200));
  if (!ok) process.exit(1);

  const PREC = fixture(store.id, 'QA Precision Item');
  const EXE = fixture(store.id, 'QA Exempt Nutritional');
  const bs1 = serverBatchStock(PREC.id).find(b => Number(b.stock_qty) >= 10);
  const bs2 = serverBatchStock(EXE.id).find(b => Number(b.stock_qty) >= 3);
  const ADJ = [
    { prod: PREC, batch: bs1.batch_no, delta: 5, reason: 'Found Stock' },
    { prod: EXE, batch: bs2.batch_no, delta: -2, reason: 'Damaged' },
  ];
  const before = ADJ.map(a => ({ batch: a.batch, server: Number(serverBatchStock(a.prod.id).find(b => b.batch_no === a.batch).stock_qty) }));
  console.log('plan', JSON.stringify(ADJ.map(a => ({ p: a.prod.name, b: a.batch, d: a.delta }))), 'before', JSON.stringify(before));

  await navTo(s, '/stock');
  await sleep(2200);
  const openAdj = await s.clickText('Stock Adjustment');
  await sleep(2800);
  console.log('open clicked', !!openAdj, 'modal', /Stock Adjustment Document/.test(await s.text()));

  const csvText = ADJ.map(a => `${a.prod.name},${a.batch},${a.delta},${a.reason},QA harness adjustment`).join('\n');
  const csvBtn = await s.clickText('Import CSV');
  await sleep(1800);
  console.log('csv btn', !!csvBtn, 'box open', /Import CSV \/ Spreadsheet Rows/.test(await s.text()));
  const typed = await setInput(s, 'textarea', csvText);
  await sleep(2500);
  const scr = (await s.text()).replace(/\n{3,}/g, '\n');
  console.log('typed?', JSON.stringify(typed));
  console.log('csv summary:', JSON.stringify({
    rows: (scr.match(/Rows:\s*(\d+)/i) || [])[1], valid: (scr.match(/Valid:\s*(\d+)/i) || [])[1],
    invalid: (scr.match(/Invalid:\s*(\d+)/i) || [])[1], rejected: (scr.match(/Row \d+: [^\n]+/g) || []).slice(0, 6),
  }));
  const apply = await s.clickText('Apply');
  await sleep(2500);
  const gridRows = await s.page.evaluate(() => {
    const byRow = {};
    for (const el of [...document.querySelectorAll('[data-cell]')]) {
      const [i, ...rest] = el.getAttribute('data-cell').split('-');
      (byRow[i] = byRow[i] || {})[rest.join('-')] = (el.innerText || '').replace(/\s+/g, ' ').trim();
    }
    return Object.keys(byRow).sort().map(i => ({ row: Number(i) + 1, ...byRow[i] }));
  });
  console.log('grid rows:', JSON.stringify(gridRows));
  await shot(s, 'adj_probe_before_post');
  const post = await s.clickText('Post Adjustment');
  await sleep(8000);
  const after = (await s.text()).replace(/\n{3,}/g, '\n');
  console.log('post clicked', !!post);
  console.log('screen tail:\n' + after.slice(-900));
  const afterBatches = ADJ.map(a => ({ batch: a.batch, server: Number(serverBatchStock(a.prod.id).find(b => b.batch_no === a.batch).stock_qty) }));
  const till = await localTable(s, 'product_batches', store.id);
  const tillAfter = ADJ.map(a => {
    const r = till.rows.find(b => b.product_id === a.prod.id && b.batch_no === a.batch);
    return { batch: a.batch, till: r ? Number(r.stock_qty) : null };
  });
  console.log('server after', JSON.stringify(afterBatches), 'till after', JSON.stringify(tillAfter));
  console.log('docs:', JSON.stringify(sql(`select * from stock_adjustment_documents where store_id=${store.id} order by id desc limit 3`)));
  console.log('lines:', JSON.stringify(sql(`select * from stock_adjustment_lines where stock_adjustment_document_id in (select id from stock_adjustment_documents where store_id=${store.id} order by id desc limit 3)`)));
  console.log('ledger:', JSON.stringify(sql(`select id,event_type,qty_delta,batch_id,reference_type,reference_id,balance_after from stock_ledger_entries where store_id=${store.id} order by id desc limit 6`)));
  await shot(s, 'adj_probe_after_post');
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });

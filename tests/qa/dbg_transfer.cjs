/**
 * Focused probe for E3 (inter-store transfer). The broad harness clicked the autocomplete row
 * by text position, which missed; this clicks the suggestion element directly and uses the
 * modal's documented keyboard path (Enter on the highlighted FEFO batch).
 */
const { openCounter, navTo, sleep } = require('./pos_flow.cjs');
const { sql, sqlOne, saveEvidence } = require('./driver.cjs');
const manifest = require('./manifest.json');

(async () => {
  const store = manifest.stores['QA-A'];
  const out = { steps: [] };
  const opened = await openCounter(store, store.users.pur, { counterName: 'QA A Transfer Probe', sessionName: 'qaA_trf' });
  if (!opened.ok) {
    saveEvidence('D3_transfer_probe.json', { blocked: true, detail: opened.detail });
    console.log('BLOCKED sign-in', JSON.stringify(opened.detail).slice(0, 400));
    process.exit(0);
  }
  const s = opened.s;

  await navTo(s, '/purchases');
  await sleep(1200);
  out.nav = await navTo(s, '/stock/transfers');
  await sleep(4500);

  out.destination = await s.page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => /QA Mart General/.test(o.text)));
    if (!sel) return null;
    const target = [...sel.options].find(o => /QA Mart General/.test(o.text));
    sel.value = target.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { text: target.text, value: target.value };
  });
  await sleep(1200);

  const trfNo = 'QA-TRF-' + Date.now().toString().slice(-6);
  out.transfer_no_typed = await s.page.evaluate((no) => {
    const el = document.querySelector('input[placeholder="TRF-001"]');
    if (!el) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, no);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  }, trfNo);

  const prodName = manifest.stores['QA-A'].products['QA-BOX24'].search_name;
  const input = await s.page.$('input[placeholder^="Scan Barcode or Search Products to Transfer"]');
  out.product_input_found = !!input;
  if (input) {
    await input.click();
    await s.page.keyboard.type(prodName, { delay: 40 });
    await sleep(2200);
    out.suggestions = await s.page.evaluate(() =>
      [...document.querySelectorAll('div.absolute.left-0.right-0 > div')].map(d => (d.innerText || '').replace(/\s+/g, ' ').slice(0, 80))
    );
    out.clicked_suggestion = await s.page.evaluate((name) => {
      const rows = [...document.querySelectorAll('div.absolute.left-0.right-0 > div')];
      const row = rows.find(d => (d.innerText || '').includes(name.slice(0, 12)));
      if (!row) return false;
      row.click();
      return true;
    }, prodName);
    await sleep(2000);
  }

  out.batch_modal_open = /Select Batch \(FEFO Order\)/.test(await s.text());
  out.batch_modal_text = out.batch_modal_open ? (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 600) : null;
  if (out.batch_modal_open) {
    // FEFO highlights the near-expiry batch first (12 units), which cannot cover the default
    // 1-pack line (24 units); a user would pick the long-dated batch instead.
    await s.page.keyboard.press('ArrowDown');
    await sleep(500);
    await s.page.keyboard.press('Enter');
    await sleep(1800);
  }
  await s.screenshot('D3_line_added');

  out.lines_on_screen = await s.page.evaluate(() => {
    const table = document.querySelector('table');
    return table ? (table.innerText || '').replace(/\s+/g, ' ').slice(0, 400) : null;
  });
  out.device_transfers_before = await s.page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('lamsuite_tbl_') && k.endsWith('_stock_transfers'));
    if (!key) return null;
    try { return JSON.parse(localStorage.getItem(key)).slice(-2); } catch { return null; }
  });

  const dispatch = await s.clickExact('Dispatch Transfer (F12)') || await s.clickText('Dispatch Transfer');
  out.dispatch_clicked = !!dispatch;
  await sleep(6000);
  out.screen_after_dispatch = (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 500);
  await s.screenshot('D3_after_dispatch');

  await s.page.evaluate(() => {
    const el = document.querySelector('[title*="queued for sync"]');
    if (el) el.click();
  });
  await sleep(12000);

  out.server_transfers = sql(`select id,transfer_number,from_store_id,to_store_id,status,created_at from stock_transfers order by id desc limit 3`);
  const latestId = sqlOne(`select id from stock_transfers order by id desc limit 1`);
  out.server_items = latestId ? sql(`select * from stock_transfer_items where stock_transfer_id=${latestId}`) : [];
  out.server_batches = sql(`select id,batch_no,stock_qty from product_batches where store_id=${store.id} and batch_no like 'QA-A%' order by id asc limit 6`);
  out.expected_no = trfNo;

  saveEvidence('D3_transfer_probe.json', out);
  console.log(JSON.stringify(out, null, 1).slice(0, 6000));
  process.exit(0);
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });

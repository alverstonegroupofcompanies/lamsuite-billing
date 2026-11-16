/**
 * Focused probe for E1 (stock adjustment). The batch combobox in "Record Stock Adjustment"
 * was left empty by the broad harness, so this probe drives it with the keyboard exactly the
 * way a counter user would (type, ArrowDown, Enter) and then checks local + server effects.
 */
const { openCounter, navTo, sleep } = require('./pos_flow.cjs');
const { sql, saveEvidence } = require('./driver.cjs');
const manifest = require('./manifest.json');

(async () => {
  const store = manifest.stores['QA-A'];
  const out = { steps: [] };
  const opened = await openCounter(store, store.users.pur, { counterName: 'QA A Adj Probe', sessionName: 'qaA_adj' });
  if (!opened.ok) {
    saveEvidence('D2_adjustment_probe.json', { blocked: true, detail: opened.detail });
    console.log('BLOCKED sign-in', JSON.stringify(opened.detail).slice(0, 400));
    process.exit(0);
  }
  const s = opened.s;

  await navTo(s, '/purchases');
  await sleep(1200);
  const nav = await navTo(s, '/stock');
  await sleep(4000);
  out.nav = nav;

  await s.clickExact('Stock Adjustment') || await s.clickText('Stock Adjustment');
  await sleep(2000);
  out.modal_open = /Record Stock Adjustment/i.test(await s.text());

  out.controls = await s.page.evaluate(() => {
    const modal = [...document.querySelectorAll('[role="dialog"], .fixed')].find(el => /Record Stock Adjustment/i.test(el.innerText || ''));
    if (!modal) return null;
    return [...modal.querySelectorAll('input, select, button, [role="combobox"], [role="button"]')].map((el, i) => {
      const r = el.getBoundingClientRect();
      return {
        i, tag: el.tagName, role: el.getAttribute('role'), type: el.getAttribute('type'),
        placeholder: el.getAttribute('placeholder'), aria: el.getAttribute('aria-label'),
        text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 40),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    });
  });

  // The batch control is a div[role=combobox] trigger; opening it reveals a real search input.
  const trigger = await s.page.$('[role="combobox"]');
  out.batch_input_found = !!trigger;
  if (trigger) {
    await trigger.click();
    await sleep(900);
    const search = await s.page.$('input[placeholder^="Search product name or batch number"]');
    out.search_input_found = !!search;
    if (search) {
      await search.click();
      await s.page.keyboard.type('QA-', { delay: 40 });
      await sleep(1600);
      out.options_after_type = await s.page.evaluate(() =>
        [...document.querySelectorAll('[role="option"]')].map(el => (el.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 12)
      );
      await s.page.keyboard.press('ArrowDown');
      await sleep(400);
      await s.page.keyboard.press('Enter');
      await sleep(1200);
    }
    out.batch_committed = await s.page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="combobox"]')][0];
      return el ? (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160) : null;
    });
  }
  await s.screenshot('D2_adj_selected');
  out.qty_value = await s.page.evaluate(() => document.querySelector('input[type=number]')?.value);

  const posted = await s.clickExact('Post Adjustment') || await s.clickText('Post Adjustment');
  out.post_clicked = !!posted;
  await sleep(3000);
  out.screen_after_post = (await s.text()).replace(/\n{3,}/g, '\n').slice(-700);
  await s.screenshot('D2_adj_after');

  out.device_tx = await s.page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('lamsuite_tbl_') && k.endsWith('_stock_transactions'));
    if (!key) return null;
    try { return JSON.parse(localStorage.getItem(key)).filter(t => /ADJUST/i.test(String(t.event_type || ''))).slice(-3); } catch { return null; }
  });
  out.device_queue = await s.page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('lamsuite_tbl_') && k.endsWith('_sync_queue'));
    if (!key) return { keys: Object.keys(localStorage).filter(k => k.startsWith('lamsuite_tbl_')).slice(0, 30) };
    try { const q = JSON.parse(localStorage.getItem(key)); return q.map(e => ({ entity: e.entity_type || e.entity, op: e.operation, status: e.status })); } catch { return null; }
  });

  // Flush the queue the same way the header pill does.
  await s.page.evaluate(() => {
    const el = document.querySelector('[title*="queued for sync"]');
    if (el) el.click();
  });
  await sleep(12000);
  out.screen_after_sync = (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 300);
  out.server_adjustments = sql(`select id,product_id,batch_no,adjustment_type,qty,reason,created_at from stock_adjustments where store_id=${store.id} order by id desc limit 3`);
  out.server_ledger = sql(`select event_type,qty_delta,balance_after,reference_type,batch_id from stock_ledger_entries where store_id=${store.id} order by id desc limit 4`);
  out.server_batch = sql(`select id,batch_no,stock_qty from product_batches where store_id=${store.id} and batch_no like 'QA-%' order by id desc limit 5`);

  saveEvidence('D2_adjustment_probe.json', out);
  console.log(JSON.stringify(out, null, 1).slice(0, 5000));
  process.exit(0);
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });

/**
 * Focused probe for D5 (purchase return / debit note). Posts a purchase through the keyboard
 * flow, then returns two units through the Purchase Returns screen and checks what actually
 * happened locally and on the server.
 */
const { newSession, saveEvidence, sql, POS_URL } = require('./driver.cjs');
const { onboard, signInWithPin, navTo, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

(async () => {
  const store = manifest.stores['QA-A'];
  const out = {};
  const s = await newSession('qaA_pret', { url: POS_URL, stable: true });
  await onboard(s, store.activation_key, 'QA A Purchase Return Probe');
  const si = await signInWithPin(s, store.users.pur.pin, store.users.pur.username);
  out.signin = si;
  if (!si.ok) { saveEvidence('D5_return_probe.json', out); console.log('BLOCKED signin'); process.exit(0); }

  // ---- Post the purchase this return will reference ----
  await navTo(s, '/pos'); await sleep(800);
  await navTo(s, '/purchases'); await sleep(3000);
  await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /New Inward Bill/i.test(x.innerText || '')); if (b) b.click(); });
  for (let i = 0; i < 20; i++) {
    const has = await s.page.evaluate(() => !!document.querySelector('input[placeholder^="Select or search supplier"]'));
    if (has) break;
    await sleep(800);
  }
  const ready = await s.page.evaluate(() => !!document.querySelector('input[placeholder^="Select or search supplier"]'));
  if (!ready) { out.why = 'purchase form did not open'; out.screen = (await s.text()).slice(0, 800); saveEvidence('D5_return_probe.json', out); console.log('BLOCKED form'); process.exit(0); }

  await s.page.click('input[placeholder^="Select or search supplier"]');
  await s.page.keyboard.type('QA Supplier Kerala Pvt Ltd', { delay: 25 }); await sleep(1500);
  await s.page.keyboard.press('ArrowDown'); await s.page.keyboard.press('Enter'); await sleep(1000);
  const vb = 'QA-PR-' + Date.now().toString().slice(-6);
  await s.page.click('input[placeholder="INV-001"]'); await s.page.keyboard.type(vb, { delay: 25 });
  const pn = store.products['QA-DOLO650'].name;
  await s.page.click('input[placeholder^="Scan barcode or type product name"]');
  await s.page.keyboard.type(pn, { delay: 30 }); await sleep(1600);
  await s.page.evaluate(() => {
    const o = [...document.querySelectorAll('[role="option"],li,div')].find(e => /QA Dolo 650 Tablet/.test(e.innerText || '') && e.offsetParent !== null && e.children.length <= 4);
    if (o) o.click();
  });
  await sleep(2000);
  const cell = async (ph, val) => {
    const sel = await s.page.evaluate((p) => {
      const el = [...document.querySelectorAll('input')].find(x => (x.placeholder || '') === p && x.offsetParent !== null);
      if (!el) return null; el.id = 'qa-cell-' + Math.random().toString(36).slice(2); return '#' + el.id;
    }, ph);
    if (!sel) return false;
    await s.page.click(sel);
    await s.page.evaluate((x) => { const el = document.querySelector(x); el.focus(); try { el.select(); } catch { /* num */ } }, sel);
    await s.page.keyboard.type(String(val), { delay: 30 }); await s.page.keyboard.press('Tab'); await sleep(350);
    return true;
  };
  await cell('BATCH', 'QA-PRET-01');
  await cell('MM/YY', '12/28');
  await cell('Packs', '4');
  await cell('Rate', '25');
  const btn = await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null).find(e => (e.innerText || '').replace(/\s+/g, ' ').trim() === 'Post Purchase (F12)');
    if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!b.disabled };
  });
  if (btn && !btn.disabled) await s.page.mouse.click(btn.x, btn.y);
  await sleep(2000);
  if (/Confirm & Post Purchase/i.test(await s.text())) await s.page.keyboard.press('Enter');
  await sleep(5000);
  out.posted_purchase_text = (await s.text()).replace(/\n{3,}/g, '\n').slice(-300);
  await s.page.evaluate(() => { const el = document.querySelector('[title*="queued for sync"]'); if (el) el.click(); });
  await sleep(10000);
  out.purchase_server = sql(`select id,invoice_number,grand_total from purchases where invoice_number='${vb}'`);

  // ---- Purchase return ----
  await navTo(s, '/pos'); await sleep(1000);
  out.nav = await navTo(s, '/returns/purchases'); await sleep(4500);
  out.register_before = (await s.text()).replace(/\n{3,}/g, '\n').slice(-200);
  await s.clickExact('New Purchase Return') || await s.clickText('New Purchase Return');
  await sleep(2200);
  out.form_open = /New Purchase Return \/ Debit Note/i.test(await s.text());
  const search = await s.page.$('input[placeholder^="e.g. PB-123456"]');
  out.search_found = !!search;
  if (search) {
    await search.click();
    await s.page.keyboard.type(vb, { delay: 30 });
    await sleep(2500);
    out.suggestions = await s.page.evaluate(() =>
      [...document.querySelectorAll('button')].filter(b => /₹|SUP-|QA-/.test(b.innerText || '')).map(b => (b.innerText || '').replace(/\s+/g, ' ').slice(0, 90)).slice(0, 6)
    );
    out.result_clicked = await s.page.evaluate((v) => {
      const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').includes(v));
      if (!b) return false; b.click(); return true;
    }, vb);
    await sleep(2200);
  }
  out.step2 = /Select items to return to supplier/i.test(await s.text());
  out.step2_text = out.step2 ? (await s.text()).replace(/\n{3,}/g, '\n').slice(-650) : null;
  if (out.step2) {
    await s.clickExact('Select All') || await s.clickText('Select All');
    await sleep(1200);
    await s.screenshot('D5_lines_selected');
    // Return 2 units on the only line.
    out.qty_set = await s.page.evaluate(() => {
      const el = [...document.querySelectorAll('input[type=number]')].filter(x => x.offsetParent !== null)[0];
      if (!el) return null;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '2'); el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    });
    await sleep(800);
    const next = await s.clickExact('Next: Settlement →') || await s.clickText('Next: Settlement');
    out.next_clicked = !!next;
    await sleep(1800);
    out.step3 = /Settlement|Refund from Supplier|Credit/i.test(await s.text());
    await s.screenshot('D5_settlement');
    const saved = await s.clickExact('Save & Print Debit Note') || await s.clickText('Save & Print Debit Note');
    out.save_clicked = !!saved;
    await sleep(4000);
    out.toast_after_save = await s.page.evaluate(() => [...document.querySelectorAll('[role="status"], .fixed')].map(e => (e.innerText || '').replace(/\s+/g, ' ')).filter(t => /debit|returned|saved|error/i.test(t)).slice(0, 4));
    await s.page.keyboard.press('Escape');
    await sleep(1200);
  }
  out.register_after = (await s.text()).replace(/\n{3,}/g, '\n').slice(-350);
  await s.page.evaluate(() => { const el = document.querySelector('[title*="queued for sync"]'); if (el) el.click(); });
  await sleep(12000);

  out.local = await s.page.evaluate(() => {
    const grab = (t) => { const k = Object.keys(localStorage).find(x => x.startsWith('lamsuite_tbl_') && x.endsWith(`_${t}`)); const raw = k ? localStorage.getItem(k) : null; try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
    const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
    return {
      returns: arr(grab('purchase_returns')).map(r => ({ no: r.return_number, grand: r.grand_total, lines: (r.lines || []).map(l => l.return_qty) })),
      batch: arr(grab('product_batches')).filter(b => b && b.batch_no === 'QA-PRET-01').map(b => b.stock_qty),
    };
  });
  out.server_untitled = sql(`select id,external_id,name,sel_rate,current_stock,created_at from products where name='Untitled Product' and store_id=${store.id} order by id desc limit 5`);
  out.server_tables = sql(`select name from sqlite_master where type='table' and name like '%return%'`);
  out.server_purchase_returns = out.server_tables.some(t => t.name === 'purchase_returns') ? sql(`select * from purchase_returns order by id desc limit 3`) : 'no purchase_returns table';
  out.batch_on_server = sql(`select id,batch_no,stock_qty from product_batches where store_id=${store.id} and batch_no='QA-PRET-01'`);
  out.vendor_bill = vb;

  saveEvidence('D5_return_probe.json', out);
  console.log(JSON.stringify(out, null, 1).slice(0, 7000));
  process.exit(0);
})().catch((e) => { console.error('ERR', e && e.stack); process.exit(1); });

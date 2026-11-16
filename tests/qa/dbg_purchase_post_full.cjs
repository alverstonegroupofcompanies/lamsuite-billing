/** Keyboard path: post a purchase, then verify document, stock, batch, ledger, queue on every surface. */
const { newSession, saveEvidence, sql, POS_URL } = require('./driver.cjs');
const { onboard, signInWithPin, navTo, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

(async () => {
  const store = manifest.stores['QA-A'];
  const out = {};
  const s = await newSession('qaA_stores', { url: POS_URL, stable: true });
  await onboard(s, store.activation_key, 'QA A Stores Counter 1');
  const si = await signInWithPin(s, store.users.pur.pin, store.users.pur.username);
  out.signin = si;
  if (!si.ok) { saveEvidence('D1_post_full.json', out); return; }

  await navTo(s, '/pos'); await sleep(800);
  await navTo(s, '/purchases'); await sleep(3000);
  await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /New Inward Bill/i.test(x.innerText || '')); if (b) b.click(); });
  for (let i = 0; i < 20; i++) {
    const has = await s.page.evaluate(() => !!document.querySelector('input[placeholder^="Select or search supplier"]'));
    if (has) break;
    await sleep(800);
  }
  const ready = await s.page.evaluate(() => !!document.querySelector('input[placeholder^="Select or search supplier"]'));
  if (!ready) { out.why = 'purchase form did not open'; out.screen = (await s.text()).slice(0, 800); saveEvidence('D1_post_full.json', out); console.log(JSON.stringify(out).slice(0, 1200)); await s.close(); return; }

  const sup = 'QA Supplier Kerala Pvt Ltd';
  await s.page.click('input[placeholder^="Select or search supplier"]');
  await s.page.keyboard.type(sup, { delay: 25 }); await sleep(1500);
  await s.page.keyboard.press('ArrowDown'); await s.page.keyboard.press('Enter'); await sleep(1000);
  const vb = 'QA-PV-' + Date.now().toString().slice(-6);
  await s.page.click('input[placeholder="INV-001"]'); await s.page.keyboard.type(vb, { delay: 25 });
  const pn = manifest.stores['QA-A'].products['QA-DOLO650'].name;
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
  await cell('BATCH', 'QA-PUR-FULL');
  await cell('MM/YY', '12/28');
  await cell('Packs', '4');
  await cell('Rate', '25');

  const before = await s.page.evaluate(() => {
    const grab = (t) => { const k = Object.keys(localStorage).find(x => x.endsWith(`_${t}`)); const raw = k ? localStorage.getItem(k) : null; try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
    const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
    return { docs: arr(grab('purchase_documents')).length, batches: arr(grab('product_batches')).filter(b => b && b.batch_no === 'QA-PUR-FULL').length, stock: arr(grab('stock_transactions')).length, parties: arr(grab('parties')).length };
  });
  out.before = before;

  const btn = await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null).find(e => (e.innerText || '').replace(/\s+/g, ' ').trim() === 'Post Purchase (F12)');
    if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!b.disabled };
  });
  if (btn && !btn.disabled) await s.page.mouse.click(btn.x, btn.y);
  await sleep(2000);
  out.modal = /Confirm & Post Purchase/i.test(await s.text());
  out.modal_text = (await s.text()).replace(/\n{3,}/g, '\n').slice(-420);
  if (out.modal) { await s.page.keyboard.press('Enter'); }
  await sleep(5000);
  out.after_modal_text = (await s.text()).replace(/\n{3,}/g, '\n').slice(-500);

  out.local_after = await s.page.evaluate(() => {
    const grab = (t) => { const k = Object.keys(localStorage).find(x => x.endsWith(`_${t}`)); const raw = k ? localStorage.getItem(k) : null; try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
    const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
    const docs = arr(grab('purchase_documents'));
    return {
      docs: docs.length,
      last_doc: docs.slice(-1),
      batch: arr(grab('product_batches')).filter(b => b && b.batch_no === 'QA-PUR-FULL'),
      stock_tx: arr(grab('stock_transactions')).filter(r => r && String(r.reference_no || r.reference_id || '').includes('QA-PUR-FULL') || /purchase/i.test(String(r.event_type || r.transaction_type || ''))).slice(-2),
      queue: arr(grab('sync_queue')).filter(r => /purchase/i.test(JSON.stringify(r))).slice(-2),
    };
  });
  out.server_purchase = sql(`select id,store_id,invoice_number,supplier_name,subtotal,tax_total,grand_total,status from purchases where invoice_number='${vb}'`);
  out.server_purchase_items = sql(`select product_name,batch_no,qty,pack_qty,loose_qty,free_qty,units_per_pack,purchase_rate,gst_percent,taxable_amount,tax_amount,total_amount from purchase_items where purchase_id in (select id from purchases where invoice_number='${vb}')`);
  out.server_batch = sql(`select id,batch_no,stock_qty,expiry_date,purchase_rate from product_batches where store_id=${store.id} and batch_no='QA-PUR-FULL'`);
  out.server_supplier_balance = sql(`select id,name,current_balance,opening_balance,updated_at from parties where store_id=${store.id} and name like 'QA Supplier Kerala%'`);
  out.network = s.net.filter(n => /purchase|sync\/push/.test(n.url)).map(n => ({ m: n.method, u: n.url.replace('http://127.0.0.1:8000', ''), s: n.status, req: (n.post_data || '').slice(0, 160) }));
  out.toasts = await s.page.evaluate(() => [...document.querySelectorAll('[role="status"],.toast')].map(e => e.innerText).slice(-4));
  out.pageErrors = s.pageErrs.slice(-5);

  console.log(JSON.stringify(out, null, 1).slice(0, 7000));
  saveEvidence('D1_post_full.json', out);
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });

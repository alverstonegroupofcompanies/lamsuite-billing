/** Post a purchase and inspect the in-session local partitions + the stock screen. */
const { newSession, saveEvidence, POS_URL } = require('./driver.cjs');
const { onboard, signInWithPin, navTo, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

(async () => {
  const store = manifest.stores['QA-A'];
  const out = { parts: {} };
  const s = await newSession('qaA_pur_local', { url: POS_URL, stable: true });
  await onboard(s, store.activation_key, 'QA Counter Local');
  const si = await signInWithPin(s, store.users.pur.pin, store.users.pur.username);
  if (!si.ok) { console.log('signin failed', JSON.stringify(si).slice(0, 300)); await s.close(); return; }
  await navTo(s, '/pos'); await sleep(700);
  await navTo(s, '/purchases'); await sleep(2500);
  await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /New Inward Bill/i.test(x.innerText || '')); if (b) b.click(); });
  for (let i = 0; i < 20; i++) { if (await s.page.evaluate(() => !!document.querySelector('input[placeholder^="Select or search supplier"]'))) break; await sleep(700); }

  const sup = 'QA Supplier Kerala Pvt Ltd';
  await s.page.click('input[placeholder^="Select or search supplier"]');
  await s.page.keyboard.type(sup, { delay: 20 }); await sleep(1500);
  await s.page.keyboard.press('ArrowDown'); await s.page.keyboard.press('Enter'); await sleep(900);
  const vb = 'QA-LOC-' + Date.now().toString().slice(-6);
  await s.page.click('input[placeholder="INV-001"]'); await s.page.keyboard.type(vb, { delay: 20 });
  const pn = manifest.stores['QA-A'].products['QA-DOLO650'].name;
  await s.page.click('input[placeholder^="Scan barcode or type product name"]');
  await s.page.keyboard.type(pn, { delay: 25 }); await sleep(1500);
  await s.page.evaluate(() => { const o = [...document.querySelectorAll('[role="option"],li,div')].find(e => /QA Dolo 650 Tablet/.test(e.innerText || '') && e.offsetParent !== null && e.children.length <= 4); if (o) o.click(); });
  await sleep(1800);
  const cell = async (ph, val) => {
    const sel = await s.page.evaluate((p) => { const el = [...document.querySelectorAll('input')].find(x => (x.placeholder || '') === p && x.offsetParent !== null); if (!el) return null; el.id = 'qa-cell-' + Math.random().toString(36).slice(2); return '#' + el.id; }, ph);
    if (!sel) return false;
    await s.page.click(sel);
    await s.page.evaluate((x) => { const el = document.querySelector(x); el.focus(); try { el.select(); } catch { /* num */ } }, sel);
    await s.page.keyboard.type(String(val), { delay: 25 }); await s.page.keyboard.press('Tab'); await sleep(300);
    return true;
  };
  await cell('BATCH', 'QA-LOC-B1'); await cell('MM/YY', '12/28'); await cell('Packs', '2'); await cell('Rate', '25');
  const btn = await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null).find(e => (e.innerText || '').replace(/\s+/g, ' ').trim() === 'Post Purchase (F12)'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!b.disabled }; });
  if (btn && !btn.disabled) await s.page.mouse.click(btn.x, btn.y);
  await sleep(1500);
  out.modal = /Confirm & Post Purchase/i.test(await s.text());
  if (out.modal) await s.page.keyboard.press('Enter');
  await sleep(3500);

  out.parts = await s.page.evaluate(() => {
    const res = {};
    for (const k of Object.keys(localStorage)) {
      if (!/lamsuite_tbl_/.test(k)) continue;
      const table = k.replace(/^lamsuite_tbl_/, '');
      let v; try { v = JSON.parse(localStorage.getItem(k)); } catch { v = null; }
      const arr = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [];
      if (!['product_batches', 'stock_transactions', 'purchase_documents', 'purchase_items', 'parties', 'products'].includes(table)) continue;
      res[table] = { key: k, count: arr.length, hits: arr.filter(r => r && (r.batch_no === 'QA-LOC-B1' || /QA-LOC-/.test(String(r.reference_id || r.supplier_invoice_no || '')))).slice(0, 2), parties: table === 'parties' ? arr.filter(p => /QA Supplier Kerala/.test(p.name || '')).map(p => ({ id: p.id, current_balance: p.current_balance, outstanding_balance: p.outstanding_balance })) : undefined, product: table === 'products' ? arr.filter(p => /QA Dolo 650/.test(p.name || '')).map(p => ({ id: p.id, current_stock: p.current_stock, ptr: p.ptr })) : undefined };
    }
    return res;
  });
  // stock screen after posting
  await navTo(s, '/stock'); await sleep(2500);
  const stockText = (await s.text()).replace(/\n{3,}/g, '\n');
  out.stock_screen_has_batch = /QA-LOC-B1/.test(stockText);
  out.stock_screen_excerpt = stockText.slice(0, 700);
  out.local_keys = await s.page.evaluate(() => Object.keys(localStorage).filter(k => /lamsuite_tbl_/.test(k)));
  console.log(JSON.stringify({ modal: out.modal, parts: out.parts, stock_screen_has_batch: out.stock_screen_has_batch, stock_excerpt: out.stock_screen_excerpt.slice(0, 500), keys: out.local_keys }, null, 1).slice(0, 6000));
  saveEvidence('D1_local_effects.json', out);
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });

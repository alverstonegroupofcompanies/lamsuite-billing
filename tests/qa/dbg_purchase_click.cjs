/** Post a purchase inward bill with the mouse only, and follow it onto every surface. */
const { newSession, saveEvidence, sql, sqlOne, POS_URL } = require('./driver.cjs');
const { onboard, signInWithPin, navTo, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

/** Real mouse click on the first visible button whose collapsed label matches. */
async function clickButton(s, label, { exact = true } = {}) {
  const box = await s.page.evaluate((spec) => {
    const b = [...document.querySelectorAll('button')].filter(el => el.offsetParent !== null).find(el => {
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      return spec.exact ? t === spec.label : t.toLowerCase().includes(spec.label.toLowerCase());
    });
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (b.innerText || '').replace(/\s+/g, ' ').trim(), disabled: !!b.disabled };
  }, { label, exact });
  if (!box) return { ok: false, why: `no visible button "${label}"` };
  if (box.disabled) return { ok: false, why: `"${label}" is disabled`, box };
  await s.page.mouse.click(box.x, box.y);
  return { ok: true, ...box };
}
const state = (s) => s.page.evaluate(() => ({
  headings: [...document.querySelectorAll('h1,h2,h3,h4')].filter(h => h.offsetParent !== null).map(h => (h.innerText || '').trim()).filter(Boolean),
  confirm: [...document.querySelectorAll('button')].filter(el => el.offsetParent !== null && /confirm & post/i.test(el.innerText || '')).map(el => (el.innerText || '').replace(/\s+/g, ' ').trim()),
}));

(async () => {
  const store = manifest.stores['QA-A'];
  const out = { frames: [] };
  const s = await newSession('qaA_stores', { url: POS_URL, stable: true });
  await onboard(s, store.activation_key, 'QA A Stores Counter 1');
  const si = await signInWithPin(s, store.users.pur.pin, store.users.pur.username);
  if (!si.ok) { console.log('signin failed'); saveEvidence('D1_click_probe.json', out); return; }

  await navTo(s, '/pos'); await sleep(1000);
  await navTo(s, '/purchases'); await sleep(3000);
  out.frames.push({ step: 'new bill', click: await clickButton(s, 'New Inward Bill (F2)'), ...(await state(s)) });
  await sleep(2500);

  const sup = 'QA Supplier Kerala Pvt Ltd';
  await s.page.click('input[placeholder^="Select or search supplier"]');
  await s.page.keyboard.type(sup, { delay: 30 }); await sleep(1800);
  // combobox suggestions are list items, not buttons, so use the element-agnostic matcher
  const supPick = { ok: await s.clickText(sup), how: 'clickText' }; await sleep(1400);

  const vb = 'QA-PV-' + Date.now().toString().slice(-6);
  await s.page.click('input[placeholder="INV-001"]'); await s.page.keyboard.type(vb, { delay: 30 });

  const pn = manifest.stores['QA-A'].products['QA-DOLO650'].search_name || manifest.stores['QA-A'].products['QA-DOLO650'].name;
  await s.page.click('input[placeholder^="Scan barcode or type product name"]');
  await s.page.keyboard.type(pn, { delay: 35 }); await sleep(1800);
  const prodPick = { ok: await s.clickText(pn.slice(0, 18)), how: 'clickText' }; await sleep(2200);

  const cell = async (ph, val) => {
    const sel = await s.page.evaluate((p) => {
      const el = [...document.querySelectorAll('input')].find(x => (x.placeholder || '') === p && x.offsetParent !== null);
      if (!el) return null; el.id = 'qa-cell-' + Math.random().toString(36).slice(2); return '#' + el.id;
    }, ph);
    if (!sel) return { ok: false, why: `no visible input with placeholder "${ph}"` };
    await s.page.click(sel);
    await s.page.evaluate((x) => { const el = document.querySelector(x); el.focus(); try { el.select(); } catch { /* number */ } }, sel);
    await s.page.keyboard.type(String(val), { delay: 35 });
    await s.key('Tab'); await sleep(450);
    return { ok: true, value: await s.page.$eval(sel, e => e.value).catch(() => null) };
  };
  out.cells = {
    batch: await cell('BATCH', 'QA-PUR-09'),
    expiry: await cell('MM/YY', '12/28'),
    qty: await cell('Packs', '5'),
    free: await cell('Free Qty', '2'),
    rate: await cell('Rate', '25'),
    mrp: await cell('MRP (₹)', '34'),
  };
  await s.screenshot('click_ready');

  const ready = (await s.text()).replace(/\n{3,}/g, '\n');
  out.fields_before_post = await s.page.evaluate(() => [...document.querySelectorAll('input,select')]
    .filter(el => el.offsetParent !== null)
    .map(el => ({ ph: el.placeholder || null, id: el.id || null, aria: el.getAttribute('aria-label'), value: (el.value || '').slice(0, 40), label: (el.closest('label')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) }))
    .filter(f => f.ph || f.aria || f.label));
  out.frames.push({ step: 'clicking Post Purchase', supplier_picked: supPick.ok, product_picked: prodPick.ok, vendor_bill: vb,
    line_in_grid: /QA Dolo 650/i.test(ready),
    screen_total: (ready.match(/NET PAYABLE\s*\n+\s*₹?\s*([\d,.]+)/i) || [])[1] || null,
    empty_grid_message: /list is empty/i.test(ready),
    click: await clickButton(s, 'Post Purchase (F12)'), ...(await state(s)) });
  // guards inside openPostSummary answer with a transient toast, so sample the screen fast
  out.toasts = [];
  for (let i = 0; i < 12; i++) {
    const t = await s.text();
    const m = t.match(/(Please select a supplier[^\n]*|Please enter supplier bill[^\n]*|Cannot post empty[^\n]*|Blockers?[^\n]{0,60}|Warning[^\n]{0,60})/i);
    if (m && !out.toasts.includes(m[1])) out.toasts.push(m[1].trim());
    await sleep(300);
  }
  await sleep(1500);
  await sleep(3000);
  await s.screenshot('click_modal');
  out.frames.push({ step: 'modal state', ...(await state(s)) });

  const conf = await clickButton(s, 'Confirm & Post Purchase (Enter)');
  out.frames.push({ step: 'confirm click', click: conf });
  await sleep(10000);
  await s.screenshot('click_after');
  out.after = (await s.text()).replace(/\n{3,}/g, '\n').slice(-800);

  out.local = await s.page.evaluate(() => {
    const grab = (t) => { const k = Object.keys(localStorage).find(x => x.endsWith(`_${t}`)); const raw = k ? localStorage.getItem(k) : null; try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
    const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
    const docs = arr(grab('purchase_documents'));
    return {
      doc_count: docs.length,
      docs: docs.slice(-3),
      batches: arr(grab('product_batches')).filter(r => r && String(r.batch_no || '').toUpperCase() === 'QA-PUR-09'),
      stock_tx: arr(grab('stock_transactions')).filter(r => r && /PURCHASE/i.test(String(r.event_type || ''))).slice(-3),
      queue: arr(grab('sync_queue')).filter(r => r && /purchase/i.test(JSON.stringify(r))).slice(-2),
    };
  });
  out.server_purchase = sql(`select id,store_id,invoice_number,supplier_name,grand_total,tax_total,status from purchases where invoice_number='${vb}'`);
  out.server_batch = sql(`select id,batch_no,stock_qty,expiry_date,purchase_rate from product_batches where store_id=${store.id} and batch_no='QA-PUR-09'`);
  out.network = s.net.filter(n => /purchase|sync\/push/.test(n.url)).map(n => ({ m: n.method, u: n.url.replace('http://127.0.0.1:8000', ''), s: n.status, req: (n.post_data || '').slice(0, 200) }));
  out.pageErrors = s.pageErrs.slice(-6);
  out.console = s.consoleErrs.slice(-10);

  for (const f of out.frames) console.log('\n### ' + f.step + '\n' + JSON.stringify(f).slice(0, 700));
  console.log('\nTOASTS:', JSON.stringify(out.toasts));
  console.log('\nVISIBLE FIELDS:', JSON.stringify(out.fields_before_post, null, 0).slice(0, 1600));
  console.log('\nLOCAL:', JSON.stringify(out.local).slice(0, 1500));
  console.log('\nSERVER PURCHASE:', JSON.stringify(out.server_purchase));
  console.log('\nSERVER BATCH:', JSON.stringify(out.server_batch));
  console.log('\nAFTER:', out.after.replace(/\n/g, ' | ').slice(0, 500));
  console.log('\nPAGE ERRORS:', JSON.stringify(out.pageErrors));
  saveEvidence('D1_click_probe.json', out);
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });

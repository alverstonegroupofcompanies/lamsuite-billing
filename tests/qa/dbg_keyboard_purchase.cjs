/** Keyboard-only supplier selection, then post a purchase and verify every surface. */
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
  if (!si.ok) { saveEvidence('D1_keyboard_purchase.json', out); return; }

  await navTo(s, '/pos'); await sleep(800);
  await navTo(s, '/purchases'); await sleep(3000);
  if (await s.page.evaluate(() => !!document.querySelector('button') && [...document.querySelectorAll('button')].some(b => /New Inward Bill/i.test(b.innerText || '')))) {
    await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /New Inward Bill/i.test(x.innerText || '')); if (b) b.click(); });
    await sleep(2500);
  }

  const sup = 'QA Supplier Kerala Pvt Ltd';
  await s.page.click('input[placeholder^="Select or search supplier"]');
  await s.page.keyboard.type(sup, { delay: 25 });
  await sleep(1500);
  out.option_count = await s.page.evaluate(() => [...document.querySelectorAll('[role="option"]')].length);
  out.at_point = await s.page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find(e => /QA Supplier Kerala Pvt Ltd/.test(e.innerText || ''));
    if (!opt) return null;
    const r = opt.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, hit: el ? (el.innerText || '').replace(/\s+/g, ' ').slice(0, 60) + ' | ' + el.tagName : null };
  });
  await s.page.keyboard.press('ArrowDown');
  await s.page.keyboard.press('Enter');
  await sleep(1200);
  out.after_keyboard_pick = await s.page.evaluate(() => ({
    input_value: (document.querySelector('input[placeholder^="Select or search supplier"]') || {}).value,
    card: [...document.querySelectorAll('div')].some(d => /GSTIN: 32AAAAA0000QS9Z9/.test(d.innerText || '') && d.children.length < 6),
    openDropdowns: [...document.querySelectorAll('[role="listobx"],[role="listbox"]')].filter(e => e.offsetParent !== null).length,
  }));

  const vb = 'QA-PV-' + Date.now().toString().slice(-6);
  await s.page.click('input[placeholder="INV-001"]'); await s.page.keyboard.type(vb, { delay: 25 });
  const pn = manifest.stores['QA-A'].products['QA-DOLO650'].name;
  await s.page.click('input[placeholder^="Scan barcode or type product name"]');
  await s.page.keyboard.type(pn, { delay: 30 }); await sleep(1600);
  const prodOpt = await s.page.evaluate(() => {
    const o = [...document.querySelectorAll('[role="option"],li,div')].find(e => /QA Dolo 650 Tablet/.test(e.innerText || '') && e.offsetParent !== null && e.children.length <= 4);
    if (!o) return null; o.click(); return (o.innerText || '').slice(0, 60);
  });
  out.product_option_clicked = !!prodOpt;
  await sleep(2200);
  const cell = async (ph, val) => {
    const sel = await s.page.evaluate((p) => {
      const el = [...document.querySelectorAll('input')].find(x => (x.placeholder || '') === p && x.offsetParent !== null);
      if (!el) return null; el.id = 'qa-cell-' + Math.random().toString(36).slice(2); return '#' + el.id;
    }, ph);
    if (!sel) return { ok: false };
    await s.page.click(sel);
    await s.page.evaluate((x) => { const el = document.querySelector(x); el.focus(); try { el.select(); } catch { /* num */ } }, sel);
    await s.page.keyboard.type(String(val), { delay: 30 }); await s.page.keyboard.press('Tab'); await sleep(350);
    return { ok: true };
  };
  out.cells = {
    batch: await cell('BATCH', 'QA-PUR-KB'),
    expiry: await cell('MM/YY', '12/28'),
    qty: await cell('Packs', '4'),
    rate: await cell('Rate', '25'),
  };
  out.post_button = await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null).find(e => (e.innerText || '').replace(/\s+/g, ' ').trim() === 'Post Purchase (F12)');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!b.disabled };
  });
  if (out.post_button && !out.post_button.disabled) await s.page.mouse.click(out.post_button.x, out.post_button.y);
  await sleep(2000);
  out.modal_visible = /Confirm & Post Purchase/i.test(await s.text());
  out.screen_after_click = (await s.text()).replace(/\n{3,}/g, '\n').slice(-500);
  out.pageErrors = s.pageErrs.slice(-5);
  out.console = s.consoleErrs.slice(-6);
  out.server_purchase = sql(`select id,store_id,invoice_number,grand_total,status from purchases where invoice_number='${vb}'`);
  out.local_docs = await s.page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.endsWith('_purchase_documents')); const v = k ? JSON.parse(localStorage.getItem(k) || '[]') : []; return Array.isArray(v) ? v.length : Object.keys(v || {}).length; });

  console.log(JSON.stringify(out, null, 1));
  saveEvidence('D1_keyboard_purchase.json', out);
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });

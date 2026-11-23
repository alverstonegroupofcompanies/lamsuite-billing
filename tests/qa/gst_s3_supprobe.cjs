/** Isolated probe: what does the supplier combobox actually expose, and how do we select it? */
const { storeByCode, login, sleep, navTo, shot, setInput, saveEvidence } = require('./gst_kit.cjs');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';
const out = { steps: [] };
const log = (k, v) => { out.steps.push({ [k]: v }); console.log(k, JSON.stringify(v)); };

(async () => {
  const { s, ok, stage, detail } = await login({ storeCode: 'QA-A', key: KEY, username: 'qaa_owner', pin: '9101', counterName: 'GST S3 sup probe' });
  log('login', { ok, stage, detail: JSON.stringify(detail || '').slice(0, 120) });
  if (!ok) return saveEvidence('GST_S3_supprobe.json', out);

  await navTo(s, '/purchases');
  await sleep(2000);
  await s.clickText('New Inward Bill');
  await sleep(3500);

  log('inputs', await s.page.evaluate(() => [...document.querySelectorAll('input,div[role="combobox"],input[role="combobox"]')]
    .filter(e => e.offsetParent !== null)
    .map(e => ({ tag: e.tagName, role: e.getAttribute('role'), type: e.type, ph: e.placeholder, id: e.id, val: e.value || null }))));

  // type into the supplier-looking text input and dump whatever dropdown appears
  const typed = await s.page.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find(e => e.offsetParent !== null && /supplier/i.test(e.placeholder || ''));
    if (!el) return null;
    el.setAttribute('data-qa-p', '1');
    el.focus();
    return { ph: el.placeholder, role: el.getAttribute('role') };
  });
  log('supplier_input', typed);
  if (!typed) { await shot(s, 'probe_nosup'); await s.close(); return saveEvidence('GST_S3_supprobe.json', out); }

  await s.page.keyboard.type('QA Supplier Kerala', { delay: 45 });
  await sleep(2500);
  log('after_type', await s.page.evaluate(() => {
    const list = [...document.querySelectorAll('[role="listbox"],[role="option"],ul li,div')].filter(e => e.offsetParent !== null && /QA Supplier Kerala/.test(e.innerText || ''));
    return list.sort((a, b) => a.innerText.length - b.innerText.length).slice(0, 6)
      .map(e => ({ tag: e.tagName, role: e.getAttribute('role'), len: (e.innerText || '').length, text: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 100) }));
  }));

  const clicked = await s.page.evaluate(() => {
    const els = [...document.querySelectorAll('[role="option"],li,div,button')]
      .filter(e => e.offsetParent !== null && /QA Supplier Kerala/.test(e.innerText || '') && (e.innerText || '').length < 160);
    const el = els.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 90) };
  });
  log('click_target', clicked);
  if (clicked) { await s.page.mouse.click(clicked.x, clicked.y); await sleep(2500); }

  log('value_after_click', await s.page.evaluate(() => {
    const el = document.querySelector('input[data-qa-p="1"]');
    return { value: el ? el.value : null, body_has_supplier_name: /QA Supplier Kerala/.test(document.body.innerText) };
  }));
  log('header_strip', (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 900));

  // also confirm the draft row commit key: Enter on the last (Sell) input
  const p = await s.page.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find(e => e.offsetParent !== null && /scan barcode or type product/i.test(e.placeholder || ''));
    if (el) el.focus();
    return !!el;
  });
  if (p) {
    await s.page.keyboard.type('QA Antibiotic Syrup', { delay: 40 });
    await sleep(2200);
    await s.page.keyboard.press('Enter');
    await sleep(2000);
    log('draft_after_product', await s.page.evaluate(() => (document.querySelector('table tfoot tr') || {}).innerText));
    const before = await s.page.evaluate(() => document.querySelectorAll('table tbody tr').length);
    await s.page.evaluate(() => { const el = [...document.querySelectorAll('table tfoot input')].find(e => (e.placeholder || '') === 'Sell'); if (el) el.focus(); });
    await sleep(400);
    await s.page.keyboard.press('Enter');
    await sleep(2000);
    log('commit_via_sell_enter', { rows_before: before, rows_after: await s.page.evaluate(() => document.querySelectorAll('table tbody tr').length),
      draft: await s.page.evaluate(() => (document.querySelector('table tfoot tr') || {}).innerText) });
  }

  await shot(s, 'S3_sup_probe');
  await s.close();
  saveEvidence('GST_S3_supprobe.json', out);
})().catch(e => { console.error(e); saveEvidence('GST_S3_supprobe.json', out); process.exit(1); });

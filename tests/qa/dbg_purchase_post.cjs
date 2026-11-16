/** Watch a purchase inward bill from "New Inward Bill" to "Post", capturing every
 *  intermediate dialog, blocker and network call. Nothing is asserted here — this is the
 *  reconnaissance that tells the D1 scenario which control a real user has to press. */
const { newSession, saveEvidence, POS_URL } = require('./driver.cjs');
const { onboard, signInWithPin, navTo, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

const visible = (s) => s.page.evaluate(() => ({
  buttons: [...document.querySelectorAll('button')]
    .filter(el => el.offsetParent !== null)
    .map(el => ({ t: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 46), d: !!el.disabled }))
    .filter(b => b.t),
  dialogs: [...document.querySelectorAll('[role="dialog"], .fixed.inset-0')]
    .filter(el => el.offsetParent !== null)
    .map(el => (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500)),
}));

async function column(s, header, value) {
  const uid = await s.page.evaluate((hdr) => {
    const table = [...document.querySelectorAll('table')].find(t => [...t.querySelectorAll('th')].some(th => (th.innerText || '').trim().toLowerCase() === hdr.toLowerCase()));
    if (!table) return null;
    const idx = [...table.querySelectorAll('th')].findIndex(th => (th.innerText || '').trim().toLowerCase() === hdr.toLowerCase());
    const body = table.querySelector('tfoot') || table;
    const row = [...body.querySelectorAll('tr')].reverse().find(r => r.querySelector('input'));
    if (!row) return null;
    const cell = [...row.querySelectorAll('td')][idx];
    const inp = cell && cell.querySelector('input, select, textarea');
    if (!inp) return null;
    const id = `px-${Math.random().toString(36).slice(2)}`;
    inp.id = id;
    return id;
  }, header);
  if (!uid) return { ok: false, why: `no input under "${header}"` };
  await s.page.click(`#${uid}`);
  await s.page.evaluate((x) => { const el = document.querySelector(x); el.focus(); try { el.select(); } catch { /* number input */ } }, `#${uid}`);
  await s.page.keyboard.type(String(value), { delay: 35 });
  await sleep(400);
  await s.key('Tab');
  await sleep(500);
  return { ok: true, value: await s.page.$eval(`#${uid}`, e => e.value).catch(() => null) };
}

(async () => {
  const store = manifest.stores['QA-A'];
  const out = { frames: [] };
  const s = await newSession('qaA_stores', { url: POS_URL, stable: true });
  await onboard(s, store.activation_key, 'QA A Stores Counter 1');
  const si = await signInWithPin(s, store.users.pur.pin, store.users.pur.username);
  out.signin = si;
  console.log('signin ok?', si.ok);
  if (!si.ok) { saveEvidence('D1_purchase_recon.json', out); return; }

  await navTo(s, '/pos'); await sleep(1200);
  const nav = await navTo(s, '/purchases');
  await sleep(3500);
  out.frames.push({ step: 'after F2 nav', nav, ...(await visible(s)) });

  const newBtn = await s.clickText('New Inward Bill');
  await sleep(3000);
  out.frames.push({ step: 'after New Inward Bill click', clicked: newBtn, ...(await visible(s)) });

  // supplier
  const sup = 'QA Supplier Kerala Pvt Ltd';
  await s.page.click('input[placeholder^="Select or search supplier"]');
  await s.page.keyboard.type(sup, { delay: 30 });
  await sleep(1800);
  const supPicked = await s.clickText(sup);
  await sleep(1500);
  // vendor bill number + product line
  const vb = 'QA-PV-' + Date.now().toString().slice(-6);
  await s.page.click('input[placeholder="INV-001"]');
  await s.page.keyboard.type(vb, { delay: 30 });
  const prodName = manifest.stores['QA-A'].products['QA-DOLO650'].search_name || manifest.stores['QA-A'].products['QA-DOLO650'].name;
  await s.page.click('input[placeholder^="Scan barcode or type product name"]');
  await s.page.keyboard.type(prodName, { delay: 35 });
  await sleep(1800);
  const prodPicked = await s.clickText(prodName.slice(0, 16));
  await sleep(2000);
  out.frames.push({ step: 'after picking supplier + product', sup_picked: supPicked, prod_picked: prodPicked, vendor_bill: vb, ...(await visible(s)) });

  const fills = {};
  for (const [h, v] of [['Batch', 'QA-PUR-01'], ['Expiry (MM/YY)', '12/28'], ['Quantity', '5'], ['Free Qty', '2'],
                        ['Pur. Rate (₹)', '25'], ['MRP (₹)', '34'], ['GST %', '12']]) fills[h] = await column(s, h, v);
  out.frames.push({ step: 'after column fills', fills, ...(await visible(s)) });
  await s.screenshot('recon_filled');

  const posted = await s.clickText('Post Purchase');
  await sleep(2500);
  out.frames.push({ step: 'after clicking Post Purchase', clicked: posted, ...(await visible(s)) });
  await s.screenshot('recon_modal');

  const confirmed = await s.clickText('Confirm & Post Purchase');
  await sleep(9000);
  out.frames.push({ step: 'after confirming', clicked: confirmed, ...(await visible(s)) });
  await s.screenshot('recon_after');
  out.tail = (await s.text()).replace(/\n{3,}/g, '\n').slice(-900);

  out.local = await s.page.evaluate(() => {
    const grab = (t) => { const k = Object.keys(localStorage).find(x => x.endsWith(`_${t}`)); const raw = k ? localStorage.getItem(k) : null; try { return raw ? JSON.parse(raw) : null; } catch { return 'unparsable'; } };
    const docs = grab('purchase_documents') || [];
    const tx = grab('stock_transactions') || [];
    const q = grab('sync_queue') || [];
    const batches = grab('product_batches') || [];
    const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
    return {
      purchase_docs: arr(docs).filter(r => r && JSON.stringify(r).includes('QA-PV')).slice(-2),
      doc_count: arr(docs).length,
      stock_tx_purchase: arr(tx).filter(r => r && /PURCHASE/i.test(String(r.event_type || ''))).slice(-3),
      batch_qa_pur_01: arr(batches).filter(r => r && String(r.batch_no || '').toUpperCase() === 'QA-PUR-01'),
      sync_queue_count: arr(q).length,
      sync_queue_purchase: arr(q).filter(r => r && /purchase/i.test(JSON.stringify(r))).slice(-3),
    };
  });
  out.network = s.net.filter(n => /purchase|sync/.test(n.url)).map(n => ({ m: n.method, u: n.url.replace('http://127.0.0.1:8000', ''), s: n.status, req: (n.post_data || '').slice(0, 300), resp: (n.response_body || '').slice(0, 300) }));
  out.console = s.consoleErrs.slice(-12);
  out.pageErrors = s.pageErrs.slice(-8);

  for (const f of out.frames) {
    console.log(`\n### ${f.step}`);
    if (f.nav) console.log(' nav:', JSON.stringify(f.nav));
    console.log(' blockers/dialogs:', JSON.stringify(f.dialogs).slice(0, 700));
    console.log(' buttons:', JSON.stringify(f.buttons).slice(0, 700));
  }
  console.log('\nLOCAL:', JSON.stringify(out.local, null, 1).slice(0, 2500));
  console.log('\nNETWORK:', JSON.stringify(out.network, null, 1).slice(0, 2500));
  console.log('\nPAGE ERRORS:', JSON.stringify(out.pageErrors));
  saveEvidence('D1_purchase_recon.json', out);
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });

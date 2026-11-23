/**
 * DOM survey for the flows S2-S4 must drive: purchases, sales return, purchase return,
 * stock adjustment and the bill list. Prints the real ids/placeholders/options/buttons so the
 * scenarios never code against a remembered selector.
 */
const { login, sleep, navTo, shot, sql } = require('./gst_kit.cjs');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';

async function controls(s, label) {
  const d = await s.page.evaluate(() => {
    const vis = (el) => el.offsetParent !== null;
    return {
      path: location.pathname,
      inputs: [...document.querySelectorAll('input,textarea')].filter(vis).map(e => ({
        id: e.id, ph: e.placeholder, type: e.type || 'text', name: e.name,
        aria: e.getAttribute('aria-label'), val: (e.value || '').slice(0, 20),
        cell: e.getAttribute('data-cell-edit'),
      })),
      selects: [...document.querySelectorAll('select')].filter(vis).map(e => ({
        id: e.id, aria: e.getAttribute('aria-label'),
        opts: [...e.options].slice(0, 8).map(o => o.value + '=' + (o.text || '').trim().slice(0, 30)),
      })),
      buttons: [...document.querySelectorAll('button,[role="button"]')].filter(vis)
        .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 45)).filter(Boolean).slice(0, 60),
      headings: [...document.querySelectorAll('h1,h2,h3,label,th')].filter(vis)
        .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, 60),
    };
  });
  console.log(`\n########## ${label}  [${d.path}] ##########`);
  console.log('INPUTS :', JSON.stringify(d.inputs, null, 0));
  console.log('SELECTS:', JSON.stringify(d.selects, null, 0));
  console.log('BUTTONS:', JSON.stringify(d.buttons));
  console.log('LABELS :', JSON.stringify(d.headings));
  await shot(s, label);
  return d;
}

(async () => {
  const { s, ok, stage, detail } = await login({ storeCode: 'QA-A', key: KEY, username: 'qaa_owner', pin: '9101' });
  console.log('login', ok, stage, JSON.stringify(detail || '').slice(0, 200));
  if (!ok) process.exit(1);

  await controls(s, 'pos_landing');

  const want = (process.env.QA_ROUTES || '/purchases,/returns/sales,/returns/purchases,/stock,/bills')
    .split(',').map(x => x.trim()).filter(Boolean);
  for (const route of want) {
    const n = await navTo(s, route);
    console.log(`\n>>> nav ${route} ${JSON.stringify(n)}`);
    if (!n.ok) continue;
    await sleep(2500);
    await controls(s, 'route' + route.replace(/\W/g, '_'));
    // open the create action the screen advertises
    const triggers = ['New Inward Bill', 'New Return', 'New Purchase Return', 'Stock Adjustment', 'New Purchase'];
    for (const t of triggers) {
      const clicked = await s.clickText(t);
      if (!clicked) continue;
      await sleep(2500);
      await controls(s, 'open' + t.replace(/\W/g, '_') + '_from' + route.replace(/\W/g, '_'));
      try { await s.key('Escape'); } catch (e) { console.log('  escape skipped:', e.constructor.name); }
      await sleep(1200);
      break;
    }
  }

  console.log('\ninvoices on server:', JSON.stringify(sql('select id,store_id,invoice_number,grand_total,status from invoices order by id desc limit 6')));
  await s.close();
})().catch(e => { console.error('PROBE2 FAILED', e); process.exit(1); });

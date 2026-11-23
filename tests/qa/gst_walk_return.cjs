/**
 * Step-by-step DOM walk of the two wizards S2 must drive: Sales Return (credit note) and
 * Stock Adjustment. Nothing is asserted and nothing is saved — the point is to learn the real
 * controls instead of coding against remembered selectors.
 */
const { login, sleep, navTo, shot, sql, setInput } = require('./gst_kit.cjs');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';
const INV = process.env.QA_INV || 'QAA-1041';

async function dump(s, label, { rows = true } = {}) {
  const d = await s.page.evaluate(() => {
    const vis = (el) => el.offsetParent !== null;
    return {
      path: location.pathname,
      inputs: [...document.querySelectorAll('input,textarea')].filter(vis).map(e => ({
        id: e.id, ph: e.placeholder, type: e.type || 'text', aria: e.getAttribute('aria-label'),
        val: (e.value || '').slice(0, 18), cell: e.getAttribute('data-cell-edit'),
      })),
      selects: [...document.querySelectorAll('select')].filter(vis).map(e => ({
        id: e.id, opts: [...e.options].slice(0, 6).map(o => o.value + '=' + (o.text || '').trim().slice(0, 26)),
      })),
      buttons: [...document.querySelectorAll('button,[role="button"]')].filter(vis)
        .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, 45),
      rows: [...document.querySelectorAll('tr')].filter(vis).map(tr =>
        [...tr.querySelectorAll('td,th')].map(td => (td.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 34))
        .join(' | ')).filter(x => x && !/^\s*\|/.test(x)).slice(0, 14),
    };
  });
  console.log(`\n===== ${label} [${d.path}] =====`);
  console.log('INPUTS :', JSON.stringify(d.inputs));
  console.log('SELECTS:', JSON.stringify(d.selects));
  console.log('BUTTONS:', JSON.stringify(d.buttons));
  if (rows) console.log('ROWS   :', JSON.stringify(d.rows, null, 1));
  console.log('TAIL   :', ((await s.text()).replace(/\n{3,}/g, '\n')).slice(-500));
  await shot(s, label);
  return d;
}

async function clickRow(s, frag) {
  const box = await s.page.evaluate((f) => {
    const els = [...document.querySelectorAll('button,[role="button"],tr,div')]
      .filter(el => el.offsetParent !== null && (el.innerText || '').includes(f) && (el.innerText || '').length < 700);
    const el = els.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 90) };
  }, frag);
  if (!box) return false;
  await s.page.mouse.click(box.x, box.y);
  await sleep(2500);
  return box.text;
}

(async () => {
  const { s, ok, stage, detail } = await login({ storeCode: 'QA-A', key: KEY, username: 'qaa_owner', pin: '9101' });
  console.log('login', ok, stage, JSON.stringify(detail || '').slice(0, 160));
  if (!ok) process.exit(1);

  // ---- Sales return wizard ----
  try {
    console.log(await navTo(s, '/returns/sales'));
    await sleep(2000);
    await s.clickText('New Return (F7)');
    await sleep(2500);
    await dump(s, 'ret1_wizard_open');

    await s.page.click('#sales-return-invoice-search');
    await s.page.keyboard.type(INV, { delay: 45 });
    await sleep(3000);
    await dump(s, 'ret2_after_invoice_search');

    console.log('row click:', await clickRow(s, INV));
    await dump(s, 'ret3_after_row_click');

    // the lines step is where return quantities are entered
    const qtyish = await s.page.evaluate(() => [...document.querySelectorAll('input')]
      .filter(e => e.offsetParent !== null && /qty|quantity|return/i.test((e.id || '') + (e.placeholder || '') + (e.getAttribute('aria-label') || '')))
      .map(e => ({ id: e.id, ph: e.placeholder, type: e.type, val: e.value })));
    console.log('QTY-LOOKING INPUTS:', JSON.stringify(qtyish));

    const nxt = await s.clickText('Next');
    console.log('clicked Next:', nxt);
    await sleep(2500);
    await dump(s, 'ret4_after_next');
  } catch (e) {
    console.log('RETURN WALK THREW:', e.message);
    await shot(s, 'ret_walk_error');
  }

  // ---- Stock adjustment document ----
  try {
    console.log(await navTo(s, '/stock'));
    await sleep(2000);
    await s.clickText('Stock Adjustment');
    await sleep(2500);
    await dump(s, 'adj1_modal_open');

    await s.clickText('Add line');
    await sleep(2500);
    await dump(s, 'adj2_after_add_line');

    const cells = await s.page.evaluate(() => [...document.querySelectorAll('[data-cell-edit]')]
      .map(e => ({ cell: e.getAttribute('data-cell-edit'), tag: e.tagName, type: e.type, ph: e.placeholder, val: (e.value || '').slice(0, 14) })));
    console.log('EDITABLE CELLS:', JSON.stringify(cells));

    // type into the product cell of row 0 to see what the picker offers
    const p0 = await s.page.evaluate(() => {
      const el = document.querySelector('[data-cell-edit$="-product"], [data-cell-edit="0-1"]');
      if (!el) return null;
      el.click(); el.focus();
      return { cell: el.getAttribute('data-cell-edit'), tag: el.tagName };
    });
    console.log('product cell:', JSON.stringify(p0));
    if (p0) {
      await s.page.keyboard.type('QA Antibiotic', { delay: 45 });
      await sleep(2500);
      await dump(s, 'adj3_product_typed');
    }
  } catch (e) {
    console.log('ADJUSTMENT WALK THREW:', e.message);
    await shot(s, 'adj_walk_error');
  }

  console.log('\nserver batch stock QA-A-NEAR-01 rows:');
  console.log(JSON.stringify(sql("select pb.batch_no,p.name,pb.stock_qty from product_batches pb join products p on p.id=pb.product_id where pb.store_id=4 and pb.batch_no='QA-A-NEAR-01'")));
  await s.close();
})().catch(e => { console.error('WALK FAILED', e); process.exit(1); });

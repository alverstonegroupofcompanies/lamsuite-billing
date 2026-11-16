/**
 * User-level POS billing primitives. Everything here is a real click/keystroke:
 * no application state is poked directly, so what we observe is what a cashier sees.
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SEARCH = 'input[aria-label="Scan barcode or type product name"]';

async function readInvoiceNo(s) {
  const t = await s.text();
  const m = t.match(/INVOICE NO\s*\n+\s*([A-Z0-9\-]+)/i);
  return m ? m[1] : null;
}

/** Focus the cart and add a product by name/barcode fragment (Enter = select & auto-add).
 *  If more than one batch exists the app raises the FEFO batch picker; pass `batch` to pick a
 *  specific batch number, otherwise the recommended (first) row is accepted with Enter. */
async function addProduct(s, fragment, { batch } = {}) {
  await s.page.click(SEARCH);
  await s.page.keyboard.type(String(fragment), { delay: 45 });
  await sleep(1800);
  await s.key('Enter');
  await sleep(1500);
  let batchModal = false;
  let pickedBatch = null;
  if (/Select Batch \(FEFO Order\)/.test(await s.text())) {
    batchModal = true;
    if (batch) {
      await s.clickText(batch);
      pickedBatch = batch;
    } else {
      await s.key('Enter');   // accept the FEFO recommendation
      pickedBatch = 'fefo-first';
    }
    await sleep(1500);
  }
  const ids = await lineIds(s);
  return { ids, batchModal, pickedBatch };
}

/** Line ids in cart order (a line is identified by its pack/loose input pair). */
async function lineIds(s) {
  return s.page.evaluate(() => [...document.querySelectorAll('input[id^="qty-input-"]')]
    .map(i => i.id.replace(/^qty-input-/, '').replace(/-(pack|loose)$/, ''))
    .filter((v, i, a) => a.indexOf(v) === i));
}

async function setQty(s, lineId, { packs, loose } = {}) {
  const wanted = { pack: packs, loose: loose };
  const seen = {};
  for (const kind of ['pack', 'loose']) {
    const sel = `#qty-input-${lineId}-${kind}`;
    if (!(await s.page.$(sel))) { seen[kind] = 'no-input'; continue; }
    if (wanted[kind] == null) continue;
    const current = await s.page.$eval(sel, (e) => e.value).catch(() => null);
    // A field that already holds the wanted number is left alone: re-typing "0" into a
    // pack box that is already 0 can make the row collapse before the loose box is set.
    if (current != null && Number(current) === Number(wanted[kind])) { seen[kind] = current; continue; }
    await s.page.click(sel);
    await s.page.evaluate((x) => {
      const el = document.querySelector(x);
      el.focus(); el.setSelectionRange(0, el.value.length);
    }, sel);
    await s.page.keyboard.type(String(wanted[kind]), { delay: 40 });
    await sleep(500);
    await s.key('Enter');
    await sleep(900);
    seen[kind] = await s.page.$eval(sel, (e) => e.value).catch(() => null);
  }
  return { ok: true, ...seen };
}

/** Parse the money footer the cashier reads before checkout. */
async function readTotals(s) {
  const t = await s.text();
  const num = (re) => { const m = t.match(re); return m ? m[1].replace(/,/g, '') : null; };
  // The footer prints round-off as "Round-off: -₹0.08" — sign before the currency sign.
  const round = () => {
    const m = t.match(/Round-off:\s*([+-]?)\s*₹?\s*([\d,.]+)/i);
    if (!m) return null;
    const v = `${m[1] === '-' ? '-' : ''}${m[2].replace(/,/g, '')}`;
    return v;
  };
  return {
    subtotal: num(/SUBTOTAL:\s*₹\s*(-?[\d,.]+)/i),
    gst_tax: num(/GST TAX:\s*₹\s*(-?[\d,.]+)/i),
    round_off: round(),
    net_payable: num(/NET PAYABLE\s*\n+\s*₹?\s*(-?[\d,.]+)/i),
    items: num(/ITEMS:\s*\n?\s*(\d+)/i),
    raw_tail: t.split('ITEMS:')[1] ? t.split('ITEMS:')[1].slice(0, 300).replace(/\n{3,}/g, '\n') : null,
  };
}

/** Per-line amounts as displayed in the cart grid. */
async function readLines(s) {
  return s.page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr')]
      .filter(tr => tr.querySelector('input[id^="qty-input-"]'))
      .map(tr => {
        const cells = [...tr.querySelectorAll('td')].map(td => (td.innerText || '').replace(/\s+/g, ' ').trim());
        return { cells };
      });
    return rows;
  });
}

/** Open checkout (F12) and dump the tender dialog so scenarios can target it. */
async function openCheckout(s) {
  await s.key('F12');
  await sleep(2500);
  const t = (await s.text()).replace(/\n{3,}/g, '\n');
  const inputs = await s.page.evaluate(() => [...document.querySelectorAll('input')]
    .filter(el => el.offsetParent !== null)
    .map(el => ({ id: el.id, ph: el.placeholder, value: el.value, type: el.type, aria: el.getAttribute('aria-label') })));
  const buttons = await s.page.evaluate(() => [...document.querySelectorAll('button')]
    .filter(el => el.offsetParent !== null)
    .map(el => (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean));
  return { text: t.slice(t.length - 2600), inputs, buttons };
}

async function newBill(s) {
  await s.key('F1');
  await sleep(2200);
  return await readInvoiceNo(s);
}

module.exports = { SEARCH, sleep, readInvoiceNo, addProduct, lineIds, setQty, readTotals, readLines, openCheckout, newBill };

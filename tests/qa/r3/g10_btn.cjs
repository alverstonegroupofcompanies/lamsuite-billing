/** Throwaway: does the Save BUTTON (fresh render) honour a UPI tender mode? */
const { claim } = require('./pos.cjs');
const { sleep } = require('./lib.cjs');

async function addItem(s, name) {
  await s.page.keyboard.press('F1'); await sleep(1200);
  await s.page.keyboard.type(name, { delay: 30 }); await sleep(1800);
  await s.page.keyboard.press('Enter'); await sleep(1400);
  await s.page.keyboard.press('Enter'); await sleep(1400);
}

const pick = async (s, mode) => {
  const ok = await s.page.evaluate((m) => {
    const el = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'Gift Voucher'));
    if (!el) return false;
    const opt = [...el.options].find((o) => o.value === m);
    opt.selected = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, mode);
  await sleep(900);
  return ok;
};

const lineState = (s) => s.page.evaluate(() => {
  const sel = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'Gift Voucher'));
  if (!sel) return { select: false };
  const ref = sel.closest('div[class*="rounded-lg"]').querySelector('input[type="text"]');
  return { select: true, mode: sel.value, ref_ph: ref ? ref.placeholder : null, ref_val: ref ? ref.value : null };
});

const toast = (s) => s.page.evaluate(() => [...document.querySelectorAll('div,p,span')]
  .map((e) => (e.innerText || '').trim())
  .filter((x) => x && x.length < 160 && /reference|UTR|required|settled|blocked/i.test(x)).slice(-3));

async function clickSave(s) {
  const n0 = s.net.length;
  const clicked = await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^Save \(Ctrl\+S\)/i.test((x.innerText || '').trim()));
    if (!b) return false; b.click(); return true;
  });
  await sleep(6000);
  return { clicked, calls: s.net.slice(n0).filter((x) => /\/invoices$/.test(x.url) && x.method === 'POST')
    .map((x) => ({ st: x.status, pay: (x.post_data || '').match(/"payments":\[[^\]]*\]/)?.[0], res: (x.response_body || '').slice(0, 160) })) };
}

(async () => {
  const s = await claim('g10_btn2', 1, 2);
  await s.clickText('POS Billing'); await sleep(2500);

  // ---- 1) button save with a UPI line and no reference ---------------------
  await addItem(s, 'Kochi Exclusive Wellness Tonic');
  await s.page.keyboard.press('F12'); await sleep(1600);
  await pick(s, 'UPI');
  console.log('state after pick  ' + JSON.stringify(await lineState(s)));
  const r1 = await clickSave(s);
  console.log('button save #1    ' + JSON.stringify(r1));
  console.log('toast             ' + JSON.stringify(await toast(s)));

  // ---- 2) same bill, now with a UTR typed ----------------------------------
  console.log('state still open  ' + JSON.stringify(await lineState(s)));
  const refFocused = await s.page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'Gift Voucher'));
    if (!sel) return false;
    const ref = sel.closest('div[class*="rounded-lg"]').querySelector('input[type="text"]');
    if (!ref) return false;
    ref.focus(); return true;
  });
  if (refFocused) await s.page.keyboard.type('UTRG10SEQ99', { delay: 20 });
  await sleep(700);
  console.log('ref field         ' + JSON.stringify(await lineState(s)));
  const r2 = await clickSave(s);
  console.log('button save #2    ' + JSON.stringify(r2));
  console.log('toast             ' + JSON.stringify(await toast(s)));
  await s.screenshot('g10_btn2_state');
  await s.close();
  console.log(JSON.stringify(require('./lib.cjs').sql(
    "select id,invoice_number,payment_mode,paid_amount from invoices where external_id like 'ext_1795%' order by id desc limit 3")));
})().catch((e) => { console.error(e.message); process.exit(1); });

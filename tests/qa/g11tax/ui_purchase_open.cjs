// Discover the purchase entry form: how it opens by keyboard, and its controls in tab order
const { claim } = require('./pos.cjs');
const { sleep, evidence } = require('./lib.cjs');
(async () => {
  const s = await claim('purchase_open', 2, 4);
  const ev = { open: [] };
  const isForm = async () => /Supplier Bill Total|Physical Bill Total|Post Purchase|Scan barcode or type product name \[F1\]/i.test(await s.text()) || !!(await s.page.$('#supplier-invoice-total-input'));
  await s.page.keyboard.press('F2'); await sleep(2000);
  ev.open.push({ step: 'F2 from billing -> purchases list', form: await isForm() });
  await s.page.keyboard.press('F2'); await sleep(2000);
  ev.open.push({ step: 'F2 on purchases list', form: await isForm() });
  if (!(await isForm())) {
    await s.page.keyboard.down('Control'); await s.page.keyboard.down('Shift'); await s.page.keyboard.press('KeyN'); await s.page.keyboard.up('Shift'); await s.page.keyboard.up('Control');
    await sleep(2000); ev.open.push({ step: 'Ctrl+Shift+N on purchases list', form: await isForm() });
  }
  if (!(await isForm())) { await s.clickText('New Inward Bill'); await sleep(2000); ev.open.push({ step: 'click New Inward Bill', form: await isForm() }); }
  console.log(JSON.stringify(ev.open));
  // tab order walk
  const order = [];
  for (let i = 0; i < 40; i++) {
    const a = await s.page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}:${e.type || ''}:${e.placeholder || e.getAttribute('aria-label') || e.id || (e.innerText || '').slice(0, 30)}` : null; });
    order.push(a); await s.page.keyboard.press('Tab'); await sleep(120);
  }
  ev.tab_order = order;
  console.log('TAB ORDER\n' + order.join('\n'));
  console.log('TEXT', (await s.text()).split('\n').filter(Boolean).slice(20, 90).join(' | '));
  await s.screenshot('purchase_form');
  evidence('purchase_open', ev);
  await s.close();
})();

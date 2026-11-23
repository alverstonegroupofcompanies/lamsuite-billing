// UI-03: the return screen must show batch expiry as MM/YY, never the raw UTC timestamp.
// Deep-links straight to the return form (?invoiceId=) so the probe does not depend on the
// till's local invoice mirror being populated by a sale in the same browser profile.
const { claim } = require('./pos.cjs');
const { evidence, sleep } = require('./lib.cjs');

const INVOICE_ID = process.env.QA_INVOICE_ID || '40';

(async () => {
  const ev = { invoice_id: INVOICE_ID };
  const s = await claim('ui03_expiry', 2, 4);
  // client-side navigation: a hard reload drops the freshly claimed counter back to activation
  await s.page.evaluate((id) => {
    window.history.pushState({}, '', `/returns/sales?invoiceId=${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, INVOICE_ID);
  await sleep(4000);

  ev.api_expiry = null;
  for (const n of s.net) {
    if (!/invoices\/[^/]+/.test(n.url) || !n.response_body) continue;
    try {
      const j = JSON.parse(n.response_body);
      const items = j.items || j.invoice?.items || j.data?.items;
      if (items && items.length) { ev.api_expiry = items[0].expiry_date; break; }
    } catch { /* html */ }
  }

  ev.row = await s.page.evaluate(() => {
    const row = document.querySelector('[data-return-line="0"]');
    if (!row) return null;
    const cells = [...row.querySelectorAll('td')].map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim());
    const expCell = cells[2] || '';
    return { cells, exp_cell: expCell, raw_utc: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(expCell), mm_yy: /Exp:\s*\d{2}\/\d{2}/.test(expCell) };
  });
  if (!ev.row) ev.screen_tail = (await s.text()).split('\n').filter(Boolean).slice(-15);

  await s.screenshot('ui03_return_expiry');
  evidence('UI03_return_expiry', ev);
  console.log(JSON.stringify(ev, null, 1));
  const ok = ev.row && ev.row.mm_yy && !ev.row.raw_utc;
  if (!ok) {
    console.error('UI-03 FAIL: expiry cell is not MM/YY');
    process.exitCode = 1;
  }
  await s.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

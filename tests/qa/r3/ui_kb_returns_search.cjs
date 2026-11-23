// Focused probe: does the returns invoice search find anything on a freshly claimed till?
// The search reads the till's local mirror, so this says whether the mirror or the listbox is at fault.
const { claim } = require('./pos.cjs');
const { evidence, sleep } = require('./lib.cjs');

const options = (s) =>
  s.page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="listbox"] [role="option"]')).map((o) =>
      (o.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60)
    )
  );
const lists = (s) => s.page.evaluate(() => document.querySelectorAll('[role="listbox"]').length);
const active = (s) =>
  s.page.evaluate(() => {
    const e = document.activeElement;
    return e ? `${e.tagName}:${e.placeholder || e.id || ''}` : null;
  });

(async () => {
  const ev = {};
  const s = await claim('kb_returns_search', 2, 4);
  // give the first sync time to fill the till's local mirror
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    const n = await s.page.evaluate(() => document.body.innerText.slice(0, 200));
    if (!/Syncing|Loading/i.test(n)) break;
  }

  await s.page.keyboard.press('F6');
  await sleep(3000);
  ev.past_bills = (await s.text())
    .split('\n')
    .filter((l) => /INV-|No bills|0 Records|match/i.test(l))
    .slice(0, 8);

  await s.page.keyboard.press('F7');
  await sleep(2000);
  ev.opened = await active(s);
  await s.page.keyboard.type('INV-', { delay: 40 });
  await sleep(3000);
  ev.search = { lists: await lists(s), options: await options(s), active: await active(s) };
  ev.search_text = (await s.text())
    .split('\n')
    .filter((l) => /INV-|Type at least|no invoice|Search/i.test(l))
    .slice(0, 10);
  ev.invoice_calls = s.net
    .filter((n) => /\/invoices/.test(n.url))
    .map((n) => ({ m: n.method, u: n.url.slice(0, 120), st: n.status }))
    .slice(-8);

  console.log(JSON.stringify(ev, null, 1));
  evidence('kb_returns_search', ev);
  await s.close();
})();

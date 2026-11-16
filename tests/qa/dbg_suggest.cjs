/** Learn POS product search: type a name fragment, dump the suggestion list, add the line. */
const { openCounter, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

(async () => {
  const store = manifest.stores['QA-A'];
  const { s, ok, detail } = await openCounter(store, store.users.cash, { counterName: 'QA A Main Counter 1' });
  if (!ok) { console.error('sign-in failed', JSON.stringify(detail).slice(0, 300)); await s.close(); process.exit(1); }
  await sleep(2000);
  await s.key('F1');
  await sleep(2500);

  const SEARCH = 'input[aria-label="Scan barcode or type product name"]';
  await s.page.click(SEARCH);
  await s.page.keyboard.type('Dolo', { delay: 60 });
  await sleep(3000);

  const suggestions = await s.page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[role="listbox"] [role="option"], ul li, [data-slot], div[tabindex]').forEach(el => {
      const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
      if (t && t.length < 220 && /dolo/i.test(t)) out.push({ tag: el.tagName, role: el.getAttribute('role'), cls: (el.className || '').slice(0, 60), text: t });
    });
    return out.slice(0, 12);
  });
  console.log('===== SUGGESTIONS =====\n' + JSON.stringify(suggestions, null, 1));
  await s.screenshot('PROBE_suggest');

  await s.key('Enter');
  await sleep(2500);
  const inputs = await s.page.evaluate(() => [...document.querySelectorAll('input')]
    .filter(el => el.offsetParent !== null)
    .map(el => ({ id: el.id, ph: el.placeholder, value: el.value, aria: el.getAttribute('aria-label') })));
  console.log('===== INPUTS AFTER ENTER =====\n' + JSON.stringify(inputs, null, 0));
  const rows = await s.page.evaluate(() => [...document.querySelectorAll('tr')].map(tr => (tr.innerText || '').replace(/\s+/g, ' ').slice(0, 160)).filter(Boolean));
  console.log('===== TABLE ROWS =====\n' + JSON.stringify(rows, null, 0));
  console.log('===== FOOTER =====\n' + (await s.text()).replace(/\n{3,}/g, '\n').split('TOTAL (₹)')[1]?.slice(0, 700));
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });

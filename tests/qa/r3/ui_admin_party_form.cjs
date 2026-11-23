const { adminSession } = require('./ui_admin_login.cjs');
const { sleep } = require('./lib.cjs');
(async () => {
  const s = await adminSession('admin_party_form');
  await s.nav('/masters');
  await s.clickText('Parties & Ledgers'); await sleep(1500);
  const btns = await s.page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => (b.innerText || b.title || '').trim().slice(0, 40)));
  console.log('BUTTONS', JSON.stringify(btns.slice(5)));
  const add = await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((b) => b.offsetParent && /add party|new party|add customer|add supplier|add/i.test(b.innerText) && !/product/i.test(b.innerText)); if (b) { b.click(); return b.innerText; } return null; });
  await sleep(1000); console.log('ADD', add);
  for (const x of await s.labelled()) console.log(x.i, x.tag, x.type, '|', x.label, '|', x.ph, '|', x.value, '|', (x.options || []).join(', '));
  await s.close();
})();

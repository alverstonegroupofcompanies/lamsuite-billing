const { adminSession } = require('./ui_admin_login.cjs');
(async () => {
  const s = await adminSession('admin_product_form');
  await s.nav('/masters');
  await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((b) => /STORE-0/.test(b.innerText) && b.offsetParent); b && b.click(); });
  await new Promise((r) => setTimeout(r, 700));
  await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && b.innerText.includes('QA-PH')).pop(); b && b.click(); });
  await new Promise((r) => setTimeout(r, 2500));
  const btns = await s.page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => (b.innerText || b.title || '').trim().slice(0, 40)));
  console.log('BUTTONS', JSON.stringify(btns));
  console.log('TEXT', (await s.text()).split('\n').filter(Boolean).slice(-25).join(' | '));
  const add = await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((b) => b.offsetParent && /add product|new product|\+ product/i.test(b.innerText)); if (b) { b.click(); return b.innerText; } return null; });
  await new Promise((r) => setTimeout(r, 1200));
  console.log('ADD', add);
  const f = await s.labelled();
  for (const x of f) console.log(x.i, x.tag, x.type, '|', x.label, '|', x.ph, '|', x.value, '|', (x.options || []).slice(0, 8).join(', '));
  await s.screenshot('admin_product_form');
  await s.close();
})();

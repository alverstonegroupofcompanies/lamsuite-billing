// J1.01b correct the two stores through the admin panel edit form (Meta+A clears fields)
const { adminSession } = require('./ui_admin_login.cjs');
const { sql, evidence } = require('./lib.cjs');
const fixes = [
  { id: 4, name: 'QA Pharma Kochi', code: 'QA-PH', st: '32' },
  { id: 5, name: 'QA Glow Cosmetics', code: 'QA-CS', st: '29' },
];
(async () => {
  const s = await adminSession('j1_01b');
  const ev = { steps: [] };
  await s.nav('/stores');
  // map row actions
  const rowButtons = await s.page.evaluate(() => [...document.querySelectorAll('tr')].filter((r) => /QA Pharma Kochi/.test(r.innerText)).map((r) => [...r.querySelectorAll('button,a')].map((b) => (b.getAttribute('title') || b.getAttribute('aria-label') || b.innerText || '').trim())));
  ev.rowButtons = rowButtons; console.log('row buttons', JSON.stringify(rowButtons));
  for (const f of fixes) {
    await s.nav('/stores');
    const opened = await s.page.evaluate((name) => {
      const r = [...document.querySelectorAll('tr')].find((tr) => tr.innerText.includes(name));
      if (!r) return 'no-row';
      const b = [...r.querySelectorAll('button')].find((b) => /edit/i.test((b.getAttribute('title') || '') + (b.getAttribute('aria-label') || '') + b.innerText));
      if (!b) return 'no-edit';
      b.click(); return 'ok';
    }, f.name);
    await new Promise((r) => setTimeout(r, 1200));
    const fields = await s.labelled();
    const byLabel = (re) => fields.find((x) => re.test(x.label));
    const setByIdx = async (idx, v) => {
      const el = (await s.page.$$('input,select,textarea'))[idx];
      await el.click(); await el.evaluate((e) => e.select());
      if (process.env.NO_BS !== '1') await s.page.keyboard.press('Backspace');
      await el.type(v, { delay: 10 });
      return el.evaluate((e) => e.value);
    };
    const code = byLabel(/Store Code/); const st = byLabel(/State Code/);
    const got = { opened, code: code && await setByIdx(code.i, f.code), st: st && await setByIdx(st.i, f.st) };
    const n0 = s.net.length;
    await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && /save|update/i.test(b.innerText)).pop(); b && b.click(); });
    await new Promise((r) => setTimeout(r, 2500));
    const calls = s.net.slice(n0).filter((n) => n.method !== 'GET').map((n) => ({ m: n.method, u: n.url, st: n.status, req: n.post_data, res: (n.response_body || '').slice(0, 400) }));
    const row = sql(`select id,code,state_code,gstin,store_type,tax_mode,version from stores where id=${f.id}`);
    ev.steps.push({ f, got, calls, row });
    console.log(JSON.stringify(got), JSON.stringify(calls).slice(0, 300), JSON.stringify(row));
  }
  await s.screenshot('j1_01b_after_edit');
  evidence('J1_01b_store_edit', ev);
  await s.close();
})();

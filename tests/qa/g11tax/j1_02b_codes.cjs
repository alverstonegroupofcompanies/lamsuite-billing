// J1.02b issue an activation code per counter from its card in the admin panel; capture the code shown once
const { adminSession } = require('./ui_admin_login.cjs');
const { sql, evidence, state, saveState } = require('./lib.cjs');
const CARD = 'div.rounded-2xl';
async function clickInCard(s, name, label) {
  return s.page.evaluate((name, label, CARD) => {
    const card = [...document.querySelectorAll(CARD)].filter((c) => c.innerText.includes(name)).sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!card) return 'no-card';
    const b = [...card.querySelectorAll('button')].find((b) => b.innerText.trim() === label);
    if (!b) return 'no-button';
    b.click(); return 'ok';
  }, name, label, CARD);
}
async function switchStore(s, code) {
  await s.page.evaluate(() => { const b = [...document.querySelectorAll('header button, button')].find((b) => /STORE-0|QA-PH|QA-CS|All Stores/.test(b.innerText) && b.offsetParent); b && b.click(); });
  await new Promise((r) => setTimeout(r, 800));
  await s.page.evaluate((code) => { const b = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && b.innerText.includes(code)).pop(); b && b.click(); }, code);
  await new Promise((r) => setTimeout(r, 2500));
}
(async () => {
  const s = await adminSession('j1_02b');
  const st = state(); st.codes = {};
  const ev = { issued: [] };
  for (const [store, names] of [['QA-PH', ['PH Front Till', 'PH Back Till']], ['QA-CS', ['CS Front Till', 'CS Back Till']]]) {
    await s.nav('/counters'); await switchStore(s, store);
    for (const nm of names) {
      const n0 = s.net.length;
      const r = await clickInCard(s, nm, 'Generate code');
      await new Promise((r) => setTimeout(r, 2500));
      const txt = await s.text();
      const posts = s.net.slice(n0).filter((n) => n.method === 'POST').map((n) => ({ u: n.url, st: n.status, res: (n.response_body || '').slice(0, 700) }));
      let code = null; try { code = JSON.parse(posts.find((p) => /activation-code/.test(p.u))?.res || '{}').code; } catch { /* */ }
      st.codes[nm] = code; saveState(st);
      await s.screenshot(`j1_02b_code_${nm.replace(/\s/g, '_')}`);
      ev.issued.push({ store, nm, click: r, posts, code_on_screen: code ? txt.includes(code) : false, expiry_text: (txt.match(/expir[^\n]{0,80}/i) || [])[0] });
      console.log(store, nm, r, posts.map((p) => p.u.replace(/.*api/, '') + ' ' + p.st).join(','), code, 'onScreen', code ? txt.includes(code) : false);
      // close dialog
      await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && /^(close|done|ok)$/i.test(b.innerText.trim())).pop(); b && b.click(); });
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  ev.db = sql('select id,store_id,counter_id,key_prefix,is_single_use,expires_at,is_revoked,consumed_at from activation_keys order by id');
  console.log(JSON.stringify(ev.db));
  evidence('J1_02b_codes', ev);
  await s.close();
})();

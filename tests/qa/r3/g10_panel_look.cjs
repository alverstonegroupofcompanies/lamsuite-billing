/** Throwaway: what does the panel show at each step of the receipt flow? */
const { newSession, ADMIN_URL } = require('./driver.cjs');
const { sql, sleep } = require('./lib.cjs');

const dump = async (s, tag) => {
  const info = await s.page.evaluate(() => ({
    url: location.pathname,
    inputs: [...document.querySelectorAll('input,select,textarea')].filter((e) => e.offsetParent).map((e) => ({
      tag: e.tagName, type: e.type, ph: e.placeholder || null, opts: e.tagName === 'SELECT' ? [...e.options].slice(0, 6).map((o) => o.value + ':' + o.text.slice(0, 30)) : undefined,
      label: (e.closest('label') || e.parentElement || {}).innerText?.slice(0, 40) || null,
    })),
    buttons: [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.innerText.replace(/\n/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, 40),
    text: (document.body.innerText || '').split('\n').filter((l) => l.trim()).slice(0, 25),
  }));
  console.log(`===== ${tag} (${info.url})`);
  console.log('inputs  ' + JSON.stringify(info.inputs).slice(0, 700));
  console.log('buttons ' + JSON.stringify(info.buttons).slice(0, 900));
  console.log('text    ' + JSON.stringify(info.text).slice(0, 700));
  return info;
};

(async () => {
  const s = await newSession('g10_panel_look', { url: ADMIN_URL });
  await sleep(3000);
  await dump(s, 'landing');
  await s.typeInto('input[type=email]', 'admin@lamstone.in');
  await s.typeInto('input[type=password]', process.env.QA_ADMIN_PASS || 'Qa-Throwaway-2026!');
  await s.page.keyboard.press('Enter');
  await sleep(5000);
  await dump(s, 'after login');

  const store = await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /STORE-0|QA-PH|QA-CS|LamStone|Pharma/i.test(x.innerText));
    if (!b) return null; b.click(); return b.innerText.replace(/\n/g, ' ');
  });
  console.log('store button: ' + JSON.stringify(store));
  await sleep(1200);
  await dump(s, 'store dropdown');
  await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent && /QA-PH/.test(x.innerText)).pop();
    if (b) b.click();
  });
  await sleep(3000);
  await dump(s, 'store switched');

  await s.page.goto(ADMIN_URL + '/transactions', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  await dump(s, 'transactions');
  const tabbed = await s.clickText('Payments');
  console.log('Payments tab clicked=' + tabbed);
  await sleep(2000);
  await dump(s, 'payments tab');
  const rec = await s.clickText('Record Customer Receipt');
  console.log('receipt button clicked=' + rec);
  await sleep(2500);
  await dump(s, 'modal');
  await s.screenshot('g10_panel_look');
  await s.close();
  console.log('party id: ' + JSON.stringify(sql(`select id,name,current_balance from parties where store_id=4 and name like 'G10 UI Credit%'`)));
})().catch((e) => { console.error(e.message); process.exit(1); });

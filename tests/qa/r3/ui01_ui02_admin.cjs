// G8-UI: admin panel copy + store State Code field (UI-01, UI-02) in a real browser.
// Read-only against the throwaway backend: opens the store dialog and types, never saves.
const { newSession, ADMIN_URL } = require('./driver.cjs');
const { adminToken, evidence, sleep } = require('./lib.cjs');

(async () => {
  const ev = { url: ADMIN_URL };
  const t = await adminToken();
  const s = await newSession('ui01_ui02_admin', { url: ADMIN_URL, viewport: { width: 1366, height: 768 } });
  const { page } = s;
  await sleep(4000);

  // 1. Login page copy (no token in a fresh profile)
  ev.login = {
    url: page.url(),
    placeholders: await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.placeholder).filter(Boolean)),
    text_alverstone: await page.evaluate(() => /alverstone/i.test(document.body.innerText)),
  };
  ev.login.pass = ev.login.placeholders.includes('you@company.com') && !ev.login.text_alverstone;
  console.log('LOGIN', JSON.stringify(ev.login));
  await s.screenshot('ui02_login');

  // 2. Sidebar version label on a 2.1.1 build
  await page.evaluate((token) => {
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_store_id', 'all');
  }, t);
  await page.goto(ADMIN_URL + '/stores', { waitUntil: 'networkidle2' });
  await sleep(3500);
  const body = await s.text();
  ev.sidebar = { version_lines: body.split('\n').map((l) => l.trim()).filter((l) => /^v\d/.test(l)), stale_v2: /\bv2\.0\b/.test(body) };
  ev.sidebar.pass = ev.sidebar.version_lines.includes('v2.1.1') && !ev.sidebar.stale_v2;
  console.log('SIDEBAR', JSON.stringify(ev.sidebar));
  await s.screenshot('ui02_sidebar');

  // 3. Add Store Branch -> State Code must clear and accept a new value alone
  const opened = await s.clickText('Add Store Branch');
  await sleep(1200);
  const modal = await page.evaluate(() => !!document.querySelector('input') && /Create New Branch Store/.test(document.body.innerText));
  const found = await s.firstMatchingInput('State Code');
  await page.keyboard.press('Backspace'); // the helper selected the whole value
  await sleep(300);
  const cleared = await page.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find((i) => (i.previousElementSibling?.innerText || '').includes('State Code'));
    return el ? el.value : null;
  });
  await page.keyboard.type('29', { delay: 40 });
  await sleep(400);
  const typed = await page.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find((i) => (i.previousElementSibling?.innerText || '').includes('State Code'));
    return el ? el.value : null;
  });
  ev.state_code = { opened, modal, focused: found, cleared, typed, pass: cleared === '' && typed === '29' };
  console.log('STATE CODE', JSON.stringify(ev.state_code));
  await s.screenshot('ui01_state_code');

  // close the dialog without saving
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const cancel = buttons.find((b) => /cancel/i.test(b.innerText));
    if (cancel) cancel.click();
  });
  ev.console_errors = s.consoleErrs.slice(0, 5);
  ev.page_errors = s.pageErrs.slice(0, 5);
  ev.pass = !!(ev.login.pass && ev.sidebar.pass && ev.state_code.pass);
  console.log('RESULT', ev.pass ? 'PASS' : 'FAIL', 'consoleErrs', ev.console_errors.length, 'pageErrs', ev.page_errors.length);
  evidence('UI01_UI02_admin', ev);
  await s.close();
})();

/**
 * Reusable, user-level POS flows: activation onboarding, staff sign-in (PIN + password),
 * and reaching the billing screen. Used by every UI scenario.
 */
const { newSession, POS_URL, BACKEND } = require('./driver.cjs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function onboard(s, activationKey, counterName) {
  await sleep(2500);
  // A stable profile is already onboarded: the app goes straight to the operator screen.
  const first = await s.text();
  if (/SELECT OPERATOR|Authorize & Open Terminal|Quick PIN/i.test(first) && !/STORE ACTIVATION KEY/i.test(first)) {
    return { ok: true, screen: 'already onboarded', reused: true };
  }
  const ok = await s.typeByPlaceholder('LAM-STORE', activationKey);
  if (!ok) throw new Error('activation key input not found');
  await s.typeByPlaceholder('Counter 01', counterName);
  await s.page.click('button[type=submit]');
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    const t = await s.text();
    if (/SELECT OPERATOR|Sign In to Terminal|Quick PIN|Administrator/i.test(t)) return { ok: true, screen: t.slice(0, 400) };
  }
  return { ok: false, screen: (await s.text()).slice(0, 500) };
}

async function signInWithPassword(s, username, password) {
  // The operator picker shows a credential form when no local operators are cached yet.
  await s.typeByPlaceholder('admin or owner', username);
  await s.typeByPlaceholder('', '');
  const typed = await s.page.evaluate((u) => {
    const inputs = [...document.querySelectorAll('input')];
    const user = inputs.find(i => /username or email/i.test(i.placeholder || ''));
    const pass = inputs.find(i => i.type === 'password');
    if (!user || !pass) return false;
    user.focus(); user.click();
    return true;
  }, username);
  if (!typed) return { ok: false, why: 'credential inputs not visible' };
  await s.page.click('input[placeholder*="username or email" i]');
  await s.page.keyboard.type(username, { delay: 15 });
  await s.page.click('input[type=password]');
  await s.page.keyboard.type(password, { delay: 15 });
  await s.clickText('Authorize & Open Terminal');
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const t = await s.text();
    if (/POS|Billing|Cart|New Bill|Dashboard|Counter/.test(t) && !/Authorize & Open Terminal/.test(t)) return { ok: true };
  }
  return { ok: false, screen: (await s.text()).slice(0, 500) };
}

/** Pick one operator card on the SELECT OPERATOR screen and prove the right one opened.
 *  A plain text click is not enough: an ancestor element contains every card, so the click can
 *  land on the first operator in the list. The deepest matching node is the card itself, and the
 *  "Press 1-9 to select" shortcut is the keyboard-first fallback. */
async function pickOperator(s, username) {
  const handle = `@${username}`;
  const key = username.replace(/^(qaa|qab|qac|qad|qae|qaf)_?/i, '');
  for (let attempt = 0; attempt < 3; attempt++) {
    // wait for the operator list to finish rendering
    for (let i = 0; i < 10; i++) { if (/SELECT OPERATOR/i.test(await s.text())) break; await sleep(500); }
    await sleep(800);
    const clickCard = () => s.page.evaluate((h) => {
      const matches = [...document.querySelectorAll('button, [role="button"], div, li')]
        .filter(el => (el.innerText || '').toLowerCase().includes(h.toLowerCase()));
      const card = matches.sort((a, b) => a.innerText.length - b.innerText.length)[0];
      if (!card) return null;
      const r = card.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (card.innerText || '').replace(/\s+/g, ' ').slice(0, 80) };
    }, handle);
    const box = await clickCard();
    if (box) await s.page.mouse.click(box.x, box.y);
    await sleep(1800);
    let t = await s.text();
    if (key && new RegExp(`Welcome[^\\n]*${key}`, 'i').test(t)) return { ok: true, via: 'card', clicked: box && box.text };
    // fall back to the numeric shortcut the screen advertises, indexed by the handle's row order
    const digit = await s.page.evaluate((h) => {
      const leaves = [...document.querySelectorAll('*')]
        .filter(el => el.children.length === 0 && /@[A-Za-z0-9_]+/.test(el.innerText || ''));
      const rows = [];
      for (const el of leaves) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (!rows.some(u => Math.abs(u.y - r.y) < 4)) rows.push({ y: r.y, t: el.innerText });
      }
      rows.sort((a, b) => a.y - b.y);
      const i = rows.findIndex(u => u.t.toLowerCase().includes(h.toLowerCase()));
      return i >= 0 ? String(i + 1) : null;
    }, handle);
    if (digit) { await s.key(digit); await sleep(1800); t = await s.text(); }
    if (key && new RegExp(`Welcome[^\\n]*${key}`, 'i').test(t)) return { ok: true, via: digit ? `key ${digit}` : 'card', clicked: box && box.text, attempt };
    if (attempt === 2) return { ok: false, via: digit ? `key ${digit}` : 'card', clicked: box && box.text, screen: t.replace(/\n{3,}/g, '\n').slice(0, 400) };
  }
  return { ok: false, why: 'operator card not confirmed' };
}

async function signInWithPin(s, pin, username) {
  // Operator screen: pick the user card, then press the PIN pad like a cashier would.
  let t = await s.text();
  if (/SELECT OPERATOR/i.test(t)) {
    if (username) {
      const picked = await pickOperator(s, username);
      if (!picked.ok) return { ok: false, why: 'operator card not confirmed', detail: picked };
    } else {
      await s.key('1');
    }
    await sleep(1200);
  }
  t = await s.text();
  if (!/QUICK PIN/i.test(t)) {
    // fall back to the documented shortcut if we landed on the password form
    await s.key('Alt'); await s.key('p'); await sleep(1000);
  }
  for (const d of String(pin)) {
    const clicked = await s.clickExact(d);
    if (!clicked) await s.page.keyboard.type(d, { delay: 60 });
    await sleep(150);
  }
  await s.screenshot('pin_entered');
  const authed = await s.clickText('Authorize & Open Terminal');
  if (!authed) await s.key('Enter');
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    t = await s.text();
    if (!/SELECT OPERATOR|Quick PIN|Sign In to Terminal|Authorize & Open Terminal/i.test(t)) return { ok: true };
  }
  return { ok: false, screen: t.slice(0, 600) };
}

/** Full path: fresh browser -> activation -> staff sign-in -> POS ready. */
async function openCounter(store, user, { counterName, pin = true, viewport, stable = true, sessionName } = {}) {
  const s = await newSession(sessionName || `c${store.id}_${user.username}`, { url: POS_URL, viewport, stable });
  const ob = await onboard(s, store.activation_key, counterName || `QA Store ${store.id} Counter 1`);
  if (!ob.ok) return { s, ok: false, stage: 'onboard', detail: ob };
  const res = pin
    ? await signInWithPin(s, user.pin, user.username)
    : await signInWithPassword(s, user.username, user.password);
  return { s, ok: res.ok, stage: 'signin', detail: res };
}

/**
 * Move between modules the way the app's own shortcuts do, because a browser page load is not
 * neutral here: MockSqliteDatabase's constructor calls reset(), which runs
 * window.localStorage.clear() (frontend/src/lib/db/mockSqlite.ts:8,30-37). A reload therefore
 * destroys the device token, the store registry, the staff session and the whole local catalogue
 * and throws a signed-in cashier back to "Workstation Device Registration". Client-side
 * navigation is the only way to test the browser build as a user would.
 */
const ROUTE_KEYS = {
  '/pos': 'F1', '/purchases': 'F2', '/stock': 'F3', '/stock/transfers': 'F3',
  '/reports': 'F4', '/masters': 'F5', '/bills': 'F6', '/returns/sales': 'F7',
  '/returns/purchases': 'F2', '/counters': 'F8', '/import-export': 'F9', '/settings': 'F10',
};
async function navTo(s, route) {
  const key = ROUTE_KEYS[route];
  const shift = route === '/stock/transfers' || route === '/returns/purchases';
  let path = await s.page.evaluate(() => location.pathname);
  if (key) {
    if (shift) { await s.page.keyboard.down('Shift'); await s.page.keyboard.press(key); await s.page.keyboard.up('Shift'); }
    else await s.page.keyboard.press(key);
    for (let i = 0; i < 8; i++) {
      await sleep(700);
      path = await s.page.evaluate(() => location.pathname);
      if (path === route) break;
    }
    if (path === route) return { ok: true, via: (shift ? 'Shift+' : '') + key };
  }
  // fallback that still avoids a document load: click the in-app link
  const clicked = await s.page.evaluate((r) => {
    const a = [...document.querySelectorAll('a[href], button')].find(el => (el.getAttribute('href') || '') === r);
    if (a) { a.click(); return true; }
    return false;
  }, route);
  if (clicked) { await sleep(3000); path = await s.page.evaluate(() => location.pathname); }
  return { ok: path === route, via: clicked ? 'link click' : 'none', path, key_tried: key, shift };
}

module.exports = { onboard, signInWithPassword, signInWithPin, openCounter, navTo, ROUTE_KEYS, sleep };

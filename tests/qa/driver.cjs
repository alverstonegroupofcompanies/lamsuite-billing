/**
 * Shared QA driver helpers: real-user UI control + 4-surface effect capture.
 *
 * Surfaces captured for every scenario:
 *   1. UI      — visible text, input values, computed layout, screenshots, console errors
 *   2. Network — every request/response (method, url, status, request body, response body, timings, duplicates)
 *   3. Database— read-only sqlite queries (before/after)
 *   4. Other   — admin-panel API + a second counter session + reports endpoints
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('../node_modules/puppeteer-core');
const { execSync } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const POS_URL = process.env.QA_POS_URL || 'http://localhost:5173';
const ADMIN_URL = process.env.QA_ADMIN_URL || 'http://localhost:5174';
const BACKEND = process.env.QA_BACKEND || 'http://127.0.0.1:8000';
const DB_PATH = process.env.QA_DB ? path.resolve(process.env.QA_DB) : path.resolve(__dirname, 'qa_fresh.sqlite');
const EVIDENCE = path.resolve(__dirname, '../../test-reports/evidence');
const SHOTS = path.resolve(__dirname, '../../test-reports/screenshots/qa_run');
for (const d of [EVIDENCE, SHOTS]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

function sql(query) {
  const escaped = query.replace(/"/g, '""');
  const out = execSync(`sqlite3 -json "${DB_PATH}" "${escaped}"`, { encoding: 'utf8' }).trim();
  if (!out) return [];
  try { return JSON.parse(out); } catch { return [{ _raw: out }]; }
}

/** Scalar helper: returns first column of first row, or null. */
function sqlOne(query) {
  const r = sql(query);
  if (!r.length) return null;
  const v = Object.values(r[0])[0];
  return v === undefined ? null : v;
}

async function newSession(name, { url = POS_URL, viewport = { width: 1920, height: 1080 }, freshProfile = true, stable = false } = {}) {
  const userDataDir = stable
    ? path.join('/tmp', `qa_chrome_stable_${name}`)
    : path.join('/tmp', `qa_chrome_${name}_${Date.now()}`);
  if (freshProfile && !stable && fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    userDataDir,
    // A busy sync or a heavy render can block the renderer long enough to time out a key event.
    protocolTimeout: 180000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', `--window-size=${viewport.width},${viewport.height}`, '--allow-file-access-from-files'],
    defaultViewport: viewport,
  });
  const page = await browser.newPage();
  const net = [];
  const consoleErrs = [];
  const pageErrs = [];
  const blockedExternal = [];
  // scenario-controlled network faults: a shop laptop loses signal in the middle of a save
  const netRules = { offline: false, drop: [] };

  // Throwaway-environment guard: the product tries to reach the production update feed and
  // GitHub on first paint. We block anything that is not our local backend and record it.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (!(u.includes('localhost') || u.includes('127.0.0.1'))) {
      if (u.startsWith('http')) {
        blockedExternal.push({ url: u.slice(0, 200), method: req.method(), page_name: name });
        return req.abort();
      }
    }
    if (netRules.offline && u.includes(BACKEND)) {
      req.__qaDropped = true;
      net.push({ t: Date.now(), method: req.method(), url: u, post_data: req.postData() || null, state: 'dropped_offline', status: 0 });
      return req.abort();
    }
    for (const frag of netRules.drop) {
      if (u.includes(frag)) {
        req.__qaDropped = true;
        net.push({ t: Date.now(), method: req.method(), url: u, post_data: req.postData() || null, state: 'dropped_forced', status: 0 });
        return req.abort();
      }
    }
    req.continue();
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  page.on('request', (req) => {
    if (!req.url().includes('/api/')) return;
    if (req.__qaDropped) return;   // already recorded by the fault-injection listener
    net.push({ t: Date.now(), method: req.method(), url: req.url(), post_data: req.postData() || null, state: 'pending' });
  });
  page.on('response', async (res) => {
    const req = res.request();
    if (!req.url().includes('/api/')) return;
    const entry = net.find(n => n.url === req.url() && n.method === req.method() && n.state === 'pending');
    let body = null;
    try { body = await res.text(); } catch { body = '<unreadable>'; }
    const rec = entry || net[net.length - 1];
    Object.assign(rec || {}, {
      status: res.status(),
      response_body: body && body.length > 4000 ? body.slice(0, 4000) + '…' : body,
      state: 'done',
    });
    if (!entry) net.push({ method: req.method(), url: req.url(), status: res.status(), response_body: rec, state: 'done' });
  });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrs.push({ type: m.type(), text: m.text().slice(0, 500) }); });
  page.on('pageerror', (e) => pageErrs.push(String(e).slice(0, 500)));

  // a native alert/confirm blocks every later CDP call until it is answered
  const dialogs = [];
  page.on('dialog', async (d) => {
    dialogs.push({ type: d.type(), message: (d.message() || '').slice(0, 200) });
    try { await d.dismiss(); } catch { /* already handled */ }
  });

  const ctx = { browser, page, net, consoleErrs, pageErrs, blockedExternal, name, url, userDataDir, dialogs };
  ctx.goOffline = () => { netRules.offline = true; };
  ctx.goOnline = () => { netRules.offline = false; };
  ctx.dropUrl = (frag) => netRules.drop.push(frag);
  ctx.stopDropping = () => { netRules.drop.length = 0; };
  ctx.dropped = () => net.filter(n => n.state === 'dropped_offline' || n.state === 'dropped_forced')
    .map(n => ({ m: n.method, u: n.url.replace(BACKEND, ''), body: (n.post_data || '').slice(0, 200) }));

  ctx.typeByPlaceholder = async (phStartsWith, value) => {
    const sel = `input[placeholder^="${phStartsWith}"], textarea[placeholder^="${phStartsWith}"]`;
    try { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); }
    catch { return false; }
    await page.click(sel);                       // real mouse focus, like a user
    // Select the existing text with a DOM range instead of Ctrl+A: the app's global
    // shortcut handler swallows Ctrl+A, which used to leave stale characters in place.
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (el && typeof el.setSelectionRange === 'function') el.setSelectionRange(0, el.value.length);
    }, sel);
    await page.keyboard.type(String(value), { delay: 15 });
    return true;
  };
  ctx.controlInventory = () => page.evaluate(() => [...document.querySelectorAll('input,textarea,select,button')].map(el => ({
    tag: el.tagName, type: el.type || null, ph: el.placeholder || null,
    aria: el.getAttribute('aria-label'), id: el.id || null, name: el.name || null,
    text: (el.innerText || '').trim().slice(0, 50),
    disabled: !!el.disabled,
  })));
  ctx.controls = async () => ctx.controlInventory();
  ctx.typeIntoNth = async (idx, value) => {
    const ok = await page.evaluate((i) => {
      const el = [...document.querySelectorAll('input,textarea')][i];
      if (!el) return false;
      el.focus(); el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, idx);
    if (!ok) return false;
    await page.keyboard.type(String(value), { delay: 15 });
    return true;
  };
  ctx.screenshot = async (label) => {
    const file = path.join(SHOTS, `${name}_${label.replace(/[^a-z0-9]+/gi, '_')}.png`);
    try { await page.screenshot({ path: file, fullPage: false }); } catch { /* nav in flight */ }
    return file;
  };
  ctx.text = async () => page.evaluate(() => document.body.innerText);
  ctx.clickText = async (txt, { timeout = 8000 } = {}) => {
    const interactive = 'button, a, [role="button"], input[type=submit], [onclick]';
    const trySel = async (sel) => {
      const handles = await page.$$(sel);
      for (const h of handles) {
        const t = await h.evaluate(el => (el.innerText || el.value || '').trim());
        if (t && t.toLowerCase().includes(String(txt).toLowerCase())) {
          const box = await h.boundingBox();
          if (box) { await h.click(); return true; }
        }
      }
      return false;
    };
    if (await trySel(interactive)) return true;
    return trySel('label, div, span, li, td');
  };
  ctx.clickExact = async (txt, { timeout = 8000 } = {}) => {
    const handles = await page.$$('button, a, [role="button"], input[type=submit], [role="checkbox"], [role="tab"]');
    for (const h of handles) {
      const t = await h.evaluate(el => (el.innerText || el.value || '').trim());
      if (t && t.toLowerCase() === String(txt).toLowerCase()) {
        const box = await h.boundingBox();
        if (box) { await h.click(); return true; }
      }
    }
    return false;
  };
  ctx.typeInto = async (selector, value, { clear = true, delay = 20 } = {}) => {
    await page.waitForSelector(selector, { visible: true, timeout: 15000 });
    if (clear) await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (el && typeof el.setSelectionRange === 'function') { el.focus(); el.setSelectionRange(0, el.value.length); }
    }, selector);
    await page.type(selector, String(value), { delay });
    return true;
  };
  ctx.firstMatchingInput = async (matchText) => {
    return page.evaluate((mt) => {
      const inputs = [...document.querySelectorAll('input, textarea, select')];
      for (const el of inputs) {
        const label = (el.closest('label')?.innerText || '') + ' ' + (el.placeholder || '') + ' ' +
          (el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' +
          (el.previousElementSibling?.innerText || '');
        if (label.toLowerCase().includes(mt.toLowerCase())) {
          el.focus();
          // Select the current text rather than writing .value directly: React controlled
          // inputs ignore a bare value write, so the old clear silently left stale digits.
          if (typeof el.setSelectionRange === 'function') el.setSelectionRange(0, el.value.length);
          return { ok: true, tag: el.tagName, type: el.type, label: label.trim().slice(0, 80) };
        }
      }
      return { ok: false };
    }, matchText);
  };
  ctx.typeByLabel = async (matchText, value) => {
    const found = await ctx.firstMatchingInput(matchText);
    if (!found.ok) return false;
    await page.keyboard.type(String(value), { delay: 20 });
    return true;
  };
  ctx.key = async (k, count = 1) => { for (let i = 0; i < count; i++) await page.keyboard.press(k); };
  ctx.dupNetwork = () => {
    const seen = {};
    for (const n of net) {
      const key = `${n.method} ${n.url} ${(n.post_data || '').slice(0, 400)}`;
      seen[key] = (seen[key] || 0) + 1;
    }
    return Object.entries(seen).filter(([, c]) => c > 1).map(([k, c]) => ({ call: k, count: c }));
  };
  ctx.apiCalls = (frag) => net.filter(n => n.url.includes(frag));
  // full (untruncated) request body of the newest matching POST, for payload-level attribution
  ctx.postBodyFor = (frag, contains) => {
    const e = [...net].reverse().find(n =>
      n.method === 'POST' && n.url.includes(frag) && (n.post_data || '').includes(contains));
    return e ? e.post_data : null;
  };
  ctx.postCount = (frag, contains) => net.filter(n =>
    n.method === 'POST' && n.url.includes(frag) && (n.post_data || '').includes(contains)).length;
  // every non-GET call, so a scenario can see which endpoint actually carried the write
  ctx.apiLog = () => net.filter(n => n.method !== 'GET').map(n => ({
    m: n.method, u: n.url.replace(BACKEND, ''), s: n.status,
    body: (n.post_data || '').slice(0, 4000), resp: (n.response_body || '').slice(0, 600),
  }));
  ctx.close = async () => { try { await browser.close(); } catch { /* already closed */ } };
  return ctx;
}

function saveEvidence(file, obj) {
  const p = path.join(EVIDENCE, file);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

module.exports = { sql, sqlOne, newSession, saveEvidence, POS_URL, ADMIN_URL, BACKEND, DB_PATH, SHOTS, EVIDENCE };

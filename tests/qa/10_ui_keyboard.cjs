/**
 * Group L — the screen itself: advertised shortcuts vs what the keys really do, 1366x768
 * clipping, dark mode, and console/network hygiene. Nothing here touches the source; every
 * observation is a real keypress or click.
 */
const fs = require('fs');
const path = require('path');
const { newSession, saveEvidence, POS_URL, SHOTS } = require('./driver.cjs');
const { onboard, signInWithPin, navTo, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

const results = { shortcuts: [], mismatches: [], layout: [], theme: {}, console: [], pageErrors: [], defects: [] };
const screen = async (s) => (await s.text()).replace(/\n{3,}/g, '\n');

async function openCounterAt(store, user, name, viewport) {
  const s = await newSession(name, { url: POS_URL, stable: true, viewport });
  await onboard(s, store.activation_key, 'QA Counter ' + name.slice(-4));
  const si = await signInWithPin(s, user.pin, user.username);
  return { s, ok: si.ok, detail: si };
}

(async () => {
  const store = manifest.stores['QA-A'];
  const { s, ok } = await openCounterAt(store, store.users.cash, 'qa_ui_1920', { width: 1920, height: 1080 });
  if (!ok) { console.error('sign-in failed'); saveEvidence('L_ui_keyboard.json', results); return; }

  // ---------- A. what the app tells the user the keys do ----------
  await navTo(s, '/pos'); await sleep(1500);
  const helpOpened = await s.clickText('Shortcuts') || await (async () => { await s.page.keyboard.press('?'); return true; })();
  await sleep(1500);
  const helpText = await screen(s);
  await s.screenshot('L_shortcuts_help');
  results.help_modal = { opened: helpOpened, excerpt: helpText.slice(0, 1600) };
  await s.key('Escape'); await sleep(800);

  // ---------- B. press every advertised key from the POS screen and from Purchases ----------
  const KEYS = [
    ['F1', []], ['F2', []], ['F3', []], ['F4', []], ['F6', []], ['F7', []], ['F8', []], ['F9', []], ['F10', []], ['F12', []],
    ['F2', ['Shift']], ['F3', ['Shift']], ['F7', ['Shift']], ['F12', ['Shift']],
  ];
  for (const from of ['/pos', '/purchases', '/stock']) {
    for (const [key, mods] of KEYS) {
      await navTo(s, '/pos'); await sleep(900);
      const nav = await navTo(s, from); await sleep(1200);
      if (!nav.ok) { results.shortcuts.push({ from, key: (mods.join('+') + '+' + key).replace(/^\+/, ''), skipped: 'could not reach ' + from, nav }); continue; }
      const before = await s.page.evaluate(() => location.pathname);
      for (const m of mods) await s.page.keyboard.down(m);
      await s.page.keyboard.press(key);
      for (const m of mods) await s.page.keyboard.up(m);
      await sleep(1600);
      const after = await s.page.evaluate(() => location.pathname);
      const t = await screen(s);
      const modal = /SELECT INCOMING OPERATOR|ENTER QUICK PIN|Switch Cashier/i.test(t) ? 'switch-cashier'
        : /Select Batch \(FEFO/i.test(t) ? 'fefo-batch'
        : /Post Purchase Inward Bill|Confirm & Post Purchase/i.test(t) ? 'post-purchase-summary'
        : /Record Stock Adjustment/i.test(t) ? 'stock-adjustment'
        : /Discount/i.test(t) && /Bill Discount/i.test(t) ? 'discount-modal'
        : null;
      const row = { from, key: (mods.join('+') + '+' + key).replace(/^\+/, ''), before, after, changed_route: before !== after, modal, screen_head: t.slice(0, 140) };
      results.shortcuts.push(row);
      if (modal) await s.key('Escape');
      await sleep(400);
    }
  }

  // ---------- B2. release shortcut contract (central key map, 2026-11) ----------
  const comboResults = [];
  const activeEl = () => s.page.evaluate(() => {
    const el = document.activeElement;
    return el ? { tag: el.tagName, id: el.id, name: el.getAttribute('name'), placeholder: el.getAttribute('placeholder'), text: (el.innerText || '').slice(0, 40) } : null;
  });
  async function combo(from, keys, name) {
    await navTo(s, '/pos'); await sleep(700);
    await navTo(s, from); await sleep(1200);
    const before = await s.page.evaluate(() => location.pathname);
    const parts = keys.split('+');
    const mainKey = parts.pop();
    for (const m of parts) await s.page.keyboard.down(m);
    await s.page.keyboard.press(mainKey);
    for (const m of parts.reverse()) await s.page.keyboard.up(m);
    await sleep(1200);
    const after = await s.page.evaluate(() => location.pathname);
    const text = await screen(s);
    const row = { name, from, keys, before, after, changed_route: before !== after, active: await activeEl(), text_head: text.slice(0, 200) };
    comboResults.push(row);
    await s.key('Escape'); await sleep(300);
    return row;
  }

  await combo('/purchases', 'Alt+S', 'supplier-focus');
  await combo('/pos', 'Alt+H', 'hold-bill');
  await combo('/pos', 'Alt+L', 'recall-bill');
  await combo('/pos', 'Alt+E', 'batch-edit');
  await combo('/pos', 'Alt+I', 'line-discount');
  await combo('/pos', 'F8', 'global-counters-from-pos');
  await combo('/pos', 'F9', 'global-import-export-from-pos');
  await combo('/bills', 'Alt+ArrowRight', 'bills-next-period');
  await combo('/pos', 'Control+Alt+S', 'switch-store-global');
  results.combo_contract = comboResults;

  const comboChecks = [
    { name: 'supplier-focus', ok: (r) => /supplier/i.test(JSON.stringify(r.active || {})) && !/Switch Store|Select.*Store/i.test(r.text_head) },
    { name: 'hold-bill', ok: (r) => /hold|held|suspend/i.test(r.text_head) },
    { name: 'recall-bill', ok: (r) => /recall|held|pick.*bill/i.test(r.text_head) },
    { name: 'batch-edit', ok: (r) => /batch|expiry/i.test(r.text_head) },
    { name: 'line-discount', ok: (r) => /discount/i.test(r.text_head) },
    { name: 'global-counters-from-pos', ok: (r) => r.after === '/counters' },
    { name: 'global-import-export-from-pos', ok: (r) => r.after === '/import-export' },
    { name: 'switch-store-global', ok: (r) => /store|switch/i.test(r.text_head) || r.changed_route },
  ];
  for (const c of comboChecks) {
    const r = comboResults.find(x => x.name === c.name);
    if (!r) continue;
    if (!c.ok(r)) {
      results.mismatches.push({ from: r.from, key: r.keys, expect: c.name,
        actual: r.changed_route ? `navigated to ${r.after}` : (r.active?.placeholder || r.text_head.slice(0, 80)) });
    }
  }
  for (const m of results.mismatches) {
    results.defects.push({ id: 'SHORTCUT-' + m.from.replace(/\W/g, '') + '-' + m.key.replace(/\W/g, ''),
      severity: 'Medium', type: 'Workflow', module: 'Keyboard shortcuts',
      title: `${m.key} on ${m.from} does not do what the central key map documents`, expected: m.expect, actual: m.actual,
      suspected: 'frontend/src/lib/keyboard/centralKeyMap.ts + shortcutDispatcher registration; screens must defer to the dispatcher and screen scope must beat global' });
  }

  // ---------- C. dark mode, driven from Settings the way a user would ----------
  await navTo(s, '/pos'); await sleep(800);
  const navSet = await navTo(s, '/settings');
  await sleep(4000);
  const themeBefore = await s.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const themeSelected = await s.page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'dark'));
    if (!sel) return { ok: false };
    sel.value = 'dark';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: sel.value, options: [...sel.options].map(o => o.text) };
  });
  await sleep(1800);
  const themeAfter = await s.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const darkClass = await s.page.evaluate(() => ({ onHtml: document.documentElement.classList.contains('dark'), onBody: document.body.classList.contains('dark') }));
  await s.screenshot('L_dark_settings');
  await navTo(s, '/pos'); await sleep(2500);
  await s.screenshot('L_dark_pos');
  const darkPos = await s.page.evaluate(() => {
    const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const samples = [...document.querySelectorAll('h1,h2,h3,th,label,td span')].filter(el => el.offsetParent !== null && (el.innerText || '').trim()).slice(0, 40)
      .map(el => { const st = getComputedStyle(el); return { text: (el.innerText || '').trim().slice(0, 24), color: st.color, bg: st.backgroundColor, colorLum: lum(st.color) }; });
    return { bodyBg, bodyBgLum: lum(bodyBg), darkTexts: samples.filter(x => x.colorLum != null && x.colorLum < 0.35).slice(0, 10), sampleCount: samples.length };
  });
  results.theme = { navSet, themeBefore, themeSelected, themeAfter, darkClass, darkPos,
    verdict: themeSelected.ok && darkPos.bodyBgLum != null && darkPos.bodyBgLum < 0.4 ? 'dark applied' : 'dark mode did not apply' };

  // ---------- D. 1366x768 clipping ----------
  const small = await openCounterAt(store, store.users.cash, 'qa_ui_1366', { width: 1366, height: 768 });
  if (small.ok) {
    for (const route of ['/pos', '/purchases', '/stock', '/bills', '/reports']) {
      await navTo(small.s, '/pos'); await sleep(700);
      await navTo(small.s, route); await sleep(2500);
      const m = await small.s.page.evaluate(() => {
        const de = document.documentElement;
        const overflowX = de.scrollWidth - de.clientWidth;
        const offRight = [...document.querySelectorAll('button, input, a, td, th, h1, h2, h3, span')]
          .filter(el => el.offsetParent !== null)
          .map(el => { const r = el.getBoundingClientRect(); return { tag: el.tagName, text: (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 30), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width) }; })
          .filter(x => x.right > window.innerWidth + 1 && x.w > 4)
          .slice(0, 12);
        const offBottom = [...document.querySelectorAll('button')].filter(el => el.offsetParent !== null)
          .map(el => { const r = el.getBoundingClientRect(); return { text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30), bottom: Math.round(r.bottom) }; })
          .filter(x => x.bottom > window.innerHeight + 1).slice(0, 8);
        return { path: location.pathname, innerWidth: window.innerWidth, scrollWidth: de.scrollWidth, overflowX, offRight, offBottom };
      });
      await small.s.screenshot('L_1366' + route.replace(/\W/g, '_'));
      results.layout.push(m);
      if (m.overflowX > 2) results.defects.push({ id: 'LAYOUT-1366' + route.replace(/\W/g, ''), severity: 'Medium', type: 'UI',
        module: 'Layout', title: `Horizontal overflow at 1366x768 on ${route}`, expected: 'content fits a 1366-wide window', actual: `${m.overflowX}px of horizontal scroll; ${m.offRight.length} elements past the right edge`, evidence: m });
    }
    await small.s.close();
  } else results.layout.push({ blocked: '1366 session could not sign in', detail: small.detail });

  results.console = s.consoleErrs.slice(-40);
  results.pageErrors = s.pageErrs.slice(-20);
  if (results.console.length) {
    results.defects.push({ id: 'CONSOLE-ERRORS', severity: 'Low', type: 'UI', module: 'Frontend runtime',
      title: `${results.console.length} console errors/warnings during a normal browsing pass`, expected: 'clean console', actual: results.console.slice(0, 8),
      note: 'the two ERR_FAILED entries are the blocked production update feed and ipify calls, which is expected in a throwaway environment' });
  }

  console.log('\n=== SHORTCUTS (route changes only) ===');
  for (const r of results.shortcuts.filter(x => x.changed_route || x.modal)) {
    console.log(` from ${r.from.padEnd(11)} ${r.key.padEnd(9)} -> ${r.changed_route ? r.after : ''}${r.modal ? ' [' + r.modal + ']' : ''}`);
  }
  console.log('\n=== MISMATCHES ===');
  for (const m of results.mismatches) console.log(` ${m.key} on ${m.from}: expected ${m.expect} -> ${m.actual}`);
  console.log('\n=== LAYOUT @1366 ===');
  for (const l of results.layout) console.log(` ${l.path || l.blocked}: overflowX=${l.overflowX} offRight=${(l.offRight || []).length} ${JSON.stringify((l.offRight || []).slice(0, 3))}`);
  console.log('\n=== THEME ===', JSON.stringify(results.theme.verdict), 'bodyBg', results.theme.darkPos && results.theme.darkPos.bodyBg);
  console.log('\n=== CONSOLE ===', JSON.stringify(results.console.slice(-6)));
  saveEvidence('L_ui_keyboard.json', results);
  fs.writeFileSync(path.join(__dirname, 'L_summary.json'), JSON.stringify({ mismatches: results.mismatches, defects: results.defects.map(d => d.id) }, null, 1));
  await s.close();
})().catch(e => { console.error(e); saveEvidence('L_ui_keyboard.json', results); process.exit(1); });

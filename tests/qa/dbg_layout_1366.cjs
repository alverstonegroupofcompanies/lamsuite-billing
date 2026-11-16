/** 1366x768 clipping check by resizing the live signed-in window (no second sign-in). */
const { newSession, saveEvidence, POS_URL } = require('./driver.cjs');
const { onboard, signInWithPin, navTo, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

(async () => {
  const store = manifest.stores['QA-A'];
  const out = { layout: [], defects: [] };
  const s = await newSession('qa_ui_1366b', { url: POS_URL, stable: true, viewport: { width: 1920, height: 1080 } });
  await onboard(s, store.activation_key, 'QA Counter 1366');
  const si = await signInWithPin(s, store.users.cash.pin, store.users.cash.username);
  out.signin = si.ok;
  if (!si.ok) { saveEvidence('L_layout_1366.json', out); console.log('signin failed', JSON.stringify(si)); await s.close(); return; }

  await s.page.setViewport({ width: 1366, height: 768 });
  await sleep(1200);
  for (const route of ['/pos', '/purchases', '/stock', '/bills', '/reports']) {
    // F3 is swallowed on /pos, so stage from /purchases where the shell handles the key
    await navTo(s, route === '/pos' ? '/pos' : '/purchases'); await sleep(900);
    if (route !== '/pos') { await navTo(s, route); await sleep(2500); }
    const m = await s.page.evaluate(() => {
      const de = document.documentElement;
      const overflowX = de.scrollWidth - de.clientWidth;
      const offRight = [...document.querySelectorAll('button, input, a, td, th, h1, h2, h3, span')]
        .filter(el => el.offsetParent !== null)
        .map(el => { const r = el.getBoundingClientRect(); return { tag: el.tagName, text: (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 30), right: Math.round(r.right), w: Math.round(r.width) }; })
        .filter(x => x.right > window.innerWidth + 1 && x.w > 4).slice(0, 12);
      const offBottom = [...document.querySelectorAll('button')].filter(el => el.offsetParent !== null)
        .map(el => { const r = el.getBoundingClientRect(); return { text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30), bottom: Math.round(r.bottom) }; })
        .filter(x => x.bottom > window.innerHeight + 1).slice(0, 8);
      return { path: location.pathname, innerWidth: window.innerWidth, scrollWidth: de.scrollWidth, overflowX, offRight, offBottom };
    });
    await s.screenshot('L_1366b' + route.replace(/\W/g, '_'));
    out.layout.push(m);
    if (m.overflowX > 2) out.defects.push({ id: 'LAYOUT-1366' + route.replace(/\W/g, ''), severity: 'Medium', type: 'UI', module: 'Layout', title: `Horizontal overflow at 1366x768 on ${route}`, actual: `${m.overflowX}px horizontal scroll, ${m.offRight.length} elements past right edge` });
    console.log(route, 'overflowX=', m.overflowX, 'offRight=', m.offRight.length, 'offBottom=', m.offBottom.length);
  }
  out.console = s.consoleErrs.slice(-15);
  saveEvidence('L_layout_1366.json', out);
  console.log(JSON.stringify({ defects: out.defects, layout: out.layout.map(x => ({ path: x.path, overflowX: x.overflowX, offRight: x.offRight.slice(0, 5), offBottom: x.offBottom })) }, null, 1).slice(0, 4000));
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });

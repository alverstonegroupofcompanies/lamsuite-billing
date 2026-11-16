// Probe 2: is Ctrl+A cancelDefault'd by an app handler, or lost some other way?
// We attach a bubble-phase listener last in the chain and read defaultPrevented.
const { newSession } = require('./driver.cjs');

(async () => {
  const s = await newSession('CTRLA2', { url: 'http://localhost:5173/' });
  await new Promise(r => setTimeout(r, 2500));
  const ph = 'LAM-';
  await s.typeByPlaceholder(ph, 'ABCDEF');

  await s.page.evaluate((p) => {
    window.__log = [];
    window.__el = document.querySelector(`input[placeholder^="${p}"]`);
    // capture first, bubble last -> defaultPrevented tells us if an app handler cancelled it
    window.addEventListener('keydown', (e) => window.__log.push({
      phase: 'capture', key: e.key, ctrl: e.ctrlKey || e.metaKey,
      target: e.target.tagName, prevented: e.defaultPrevented,
    }), true);
    window.addEventListener('keydown', (e) => window.__log.push({
      phase: 'bubble', key: e.key, ctrl: e.ctrlKey || e.metaKey,
      target: e.target.tagName, prevented: e.defaultPrevented,
      selStart: e.target.selectionStart, selEnd: e.target.selectionEnd,
    }), false);
  }, ph);

  await s.page.evaluate(() => { window.__el.focus(); window.__el.setSelectionRange(0, 0); });
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyA'); await s.page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 300));

  const res = await s.page.evaluate(() => ({
    log: window.__log,
    value: window.__el.value,
    selection: { start: window.__el.selectionStart, end: window.__el.selectionEnd },
    docSelection: String(document.getSelection()),
    active: document.activeElement.tagName,
  }));
  console.log(JSON.stringify(res, null, 1));

  // Control experiment: same test on a plain input created by the probe (no app handlers on it,
  // but global window handlers still run) to separate app interference from field behaviour.
  await s.page.evaluate(() => {
    const i = document.createElement('input');
    i.id = 'probe_plain'; i.value = 'PLAINTEXT';
    document.body.appendChild(i);
    window.__log = [];
    i.focus(); i.setSelectionRange(0, 0);
  });
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyA'); await s.page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 200));
  console.log('plain input:', JSON.stringify(await s.page.evaluate(() => ({
    selection: { start: document.getElementById('probe_plain').selectionStart, end: document.getElementById('probe_plain').selectionEnd },
    prevented: window.__log.filter(l => l.key === 'a').map(l => l.phase + ':' + l.prevented),
  }))));
  await s.close();
})();

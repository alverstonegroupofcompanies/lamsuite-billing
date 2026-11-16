// Probe: does the app's global keyboard-shortcut handler swallow Ctrl+A inside a text field?
// A user must be able to select-all the text they are editing; if a page-level listener
// preventDefaults it, that is a real UI defect, not a harness artifact.
const { newSession } = require('./driver.cjs');

(async () => {
  const s = await newSession('CTRLA', { url: 'http://localhost:5173/' });
  await new Promise(r => setTimeout(r, 2500));
  const ph = 'LAM-';
  const ok = await s.typeByPlaceholder(ph, 'ABCDEF');
  const before = await s.page.evaluate((p) => {
    const el = document.querySelector(`input[placeholder^="${p}"]`);
    return el ? { value: el.value, start: el.selectionStart, end: el.selectionEnd } : null;
  }, ph);

  await s.page.evaluate((p) => {
    const el = document.querySelector(`input[placeholder^="${p}"]`);
    if (el) { el.focus(); el.setSelectionRange(0, 0); }
  }, ph);
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyA'); await s.page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 200));

  const after = await s.page.evaluate((p) => {
    const el = document.querySelector(`input[placeholder^="${p}"]`);
    const listeners = [];
    return el ? { value: el.value, start: el.selectionStart, end: el.selectionEnd, active: document.activeElement === el } : null;
  }, ph);

  // Second probe: does typing after Ctrl+A replace, or append?
  await s.page.keyboard.type('ZZ');
  await new Promise(r => setTimeout(r, 200));
  const final = await s.page.evaluate((p) => {
    const el = document.querySelector(`input[placeholder^="${p}"]`);
    return el ? el.value : null;
  }, ph);

  console.log(JSON.stringify({ found_input: ok, before, after_ctrl_a: after, after_typing_ZZ: final }, null, 1));
  await s.close();
})();

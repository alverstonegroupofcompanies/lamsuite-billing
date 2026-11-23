// Focused probe: the returns invoice results must be walkable by keyboard.
// The search reads the till's local mirror, so this posts one QA bill on this very till first,
// then reaches it through the returns form with arrows and Enter only.
const { claim } = require('./pos.cjs');
const { evidence, sleep } = require('./lib.cjs');

const active = (s) =>
  s.page.evaluate(() => {
    const e = document.activeElement;
    return e ? `${e.tagName}:${e.placeholder || e.id || ''}` : null;
  });
const options = (s) =>
  s.page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="listbox"] [role="option"]')).map((o) => ({
      id: o.id,
      selected: o.getAttribute('aria-selected'),
      text: (o.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50),
    }))
  );
const desc = (s) =>
  s.page.evaluate(() => document.activeElement?.getAttribute('aria-activedescendant') || null);
const combo = async (s, mods, key) => {
  for (const m of mods) await s.page.keyboard.down(m);
  await s.page.keyboard.press(key);
  for (const m of [...mods].reverse()) await s.page.keyboard.up(m);
};
const has = (s, pattern) =>
  s.page.evaluate(
    (p) => new RegExp(p, 'i').test(document.body.innerText) ||
      new RegExp(p, 'i').test(Array.from(document.querySelectorAll('input')).map((e) => e.placeholder).join('\n')),
    pattern
  );

(async () => {
  const ev = {};
  const s = await claim('kb_returns_listbox', 2, 4);

  // ---- one QA counter bill, keyboard only
  await s.page.keyboard.press('F1');
  await sleep(800);
  await s.page.keyboard.type('QA Paracet', { delay: 35 });
  await sleep(1500);
  await s.page.keyboard.press('Enter');
  await sleep(1200);
  if (/Select Batch/.test(await s.text())) {
    await s.page.keyboard.press('Enter');
    await sleep(900);
  }
  await s.page.keyboard.press('Enter');
  await sleep(800);
  await s.page.keyboard.press('F12');
  await sleep(1500);
  ev.settlement = await has(s, 'Bill Settlement');
  await combo(s, ['Control'], 'KeyS');
  await sleep(5000);
  const sold = (await s.text()).match(/([A-Z0-9]+-INV-\d+)/);
  ev.sold_invoice = sold ? sold[1] : null;

  // ---- returns: F7 twice (the first walks to the screen, the second opens the return)
  await s.page.keyboard.press('F7');
  await sleep(1500);
  await s.page.keyboard.press('F7');
  await sleep(1000);
  ev.return_focus = await active(s);
  await s.page.keyboard.type('INV-', { delay: 40 });
  await sleep(3000);
  ev.results = await options(s);
  ev.activedescendant = await desc(s);

  await s.page.keyboard.press('ArrowDown');
  await sleep(500);
  ev.after_arrow = { activedescendant: await desc(s), options: await options(s) };

  await s.page.keyboard.press('Enter');
  await sleep(3000);
  ev.after_enter = { items_step: await has(s, 'Select items to return'), loaded: (await s.text()).match(/([A-Z0-9]+-INV-\d+)/g)?.slice(0, 3) };

  await s.screenshot('kb_returns_listbox');
  console.log(JSON.stringify(ev, null, 1));
  evidence('kb_returns_listbox', ev);
  await s.close();
})();

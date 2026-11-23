// UI-04: at 1366x768 the billing hint bar must keep every shortcut chip on screen.
const { claim } = require('./pos.cjs');
const { evidence, sleep } = require('./lib.cjs');

(async () => {
  const s = await claim('ui04_1366', 1, 2, { width: 1366, height: 768 });
  await s.page.keyboard.press('F1');
  await sleep(1500);

  const res = await s.page.evaluate(() => {
    const bar = document.querySelector('[aria-label="Keyboard Shortcuts Bar"]');
    if (!bar) return { found: false };
    const chips = [...bar.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { text: (b.innerText || '').replace(/\s+/g, ' ').trim(), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    });
    const r = bar.getBoundingClientRect();
    return {
      found: true,
      vw: window.innerWidth,
      vh: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      barHeight: Math.round(r.height),
      barBottom: Math.round(r.bottom),
      chips,
      clipped: chips.filter((c) => c.right > window.innerWidth + 1),
      offBottom: chips.filter((c) => c.bottom > window.innerHeight + 1),
    };
  });

  await s.screenshot('ui04_1366_billing');
  evidence('UI04_hintbar_1366', res);

  const missing = ['Recall', 'New Bill', 'Columns'].filter((label) => !res.found || !res.chips.some((c) => c.text.includes(label)));
  const problems = [];
  if (!res.found) problems.push('hint bar not found');
  if (res.clipped?.length) problems.push(`${res.clipped.length} chips past the right edge: ${res.clipped.map((c) => c.text).join(' | ')}`);
  if (res.offBottom?.length) problems.push(`${res.offBottom.length} chips below the viewport`);
  if (missing.length) problems.push(`missing chips: ${missing.join(', ')}`);
  if (res.scrollWidth > res.vw + 1) problems.push(`page h-scroll ${res.scrollWidth} > ${res.vw}`);

  console.log(JSON.stringify({ ...res, problems }, null, 1));
  if (problems.length) {
    console.error('UI-04 FAIL:', problems.join('; '));
    process.exitCode = 1;
  }
  await s.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

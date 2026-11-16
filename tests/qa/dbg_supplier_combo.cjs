/** What does the supplier combobox actually offer after typing, and does clicking it bind? */
const { newSession, saveEvidence, POS_URL } = require('./driver.cjs');
const { onboard, signInWithPin, navTo, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

const dropdown = (s) => s.page.evaluate(() => {
  const inp = [...document.querySelectorAll('input')].find(el => (el.placeholder || '').startsWith('Select or search supplier'));
  if (!inp) return { input: null };
  const box = inp.getBoundingClientRect();
  // any clickable thing rendered below the input, i.e. inside the popup
  const cands = [...document.querySelectorAll('li, [role="option"], [role="listbox"] *, button, div')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      if (r.top <= box.bottom - 2 || r.width < 40 || r.height < 12) return false;
      const t = (el.innerText || '').trim();
      return t.length > 3 && t.length < 120 && /QA Supplier/i.test(t);
    })
    .map(el => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, role: el.getAttribute('role'), text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 70),
        x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), h: Math.round(r.height) };
    });
  // keep the innermost matches only
  const inner = cands.filter(c => !cands.some(o => o !== c && Math.abs(o.y - c.y) < 40 && o.h > c.h));
  return { input: { value: inp.value, x: Math.round(box.x), y: Math.round(box.y) }, candidates: inner.slice(0, 8) };
});

(async () => {
  const store = manifest.stores['QA-A'];
  const out = { frames: [] };
  const s = await newSession('qaA_stores', { url: POS_URL, stable: true });
  await onboard(s, store.activation_key, 'QA A Stores Counter 1');
  await signInWithPin(s, store.users.pur.pin, store.users.pur.username);
  await navTo(s, '/pos'); await sleep(1000);
  await navTo(s, '/purchases'); await sleep(3000);
  await s.clickText('New Inward Bill'); await sleep(2500);

  const inp = 'input[placeholder^="Select or search supplier"]';
  await s.page.click(inp);
  await s.page.keyboard.type('QA Supplier Kerala', { delay: 35 });
  await sleep(2000);
  out.frames.push({ how: 'typed 16 chars, no click yet', ...(await dropdown(s)) });

  // keyboard commit: ArrowDown into the list, Enter to choose
  await s.page.keyboard.press('ArrowDown'); await sleep(600);
  await s.page.keyboard.press('Enter'); await sleep(1500);
  out.frames.push({ how: 'after ArrowDown+Enter', ...(await dropdown(s)) });

  // try to post and read the guard toast
  const postClick = await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter(el => el.offsetParent !== null)
      .find(x => (x.innerText || '').replace(/\s+/g, ' ').trim() === 'Post Purchase (F12)');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!b.disabled };
  });
  if (postClick && !postClick.disabled) await s.page.mouse.click(postClick.x, postClick.y);
  const toasts = [];
  for (let i = 0; i < 14; i++) {
    const m = (await s.text()).match(/(Please select a supplier[^\n]*|Please enter supplier bill[^\n]*|Cannot post empty[^\n]*|Blockers?[^\n]{0,50})/i);
    if (m && !toasts.includes(m[1])) toasts.push(m[1].trim());
    await sleep(250);
  }
  out.keyboard_commit_result = { post_button: postClick, toasts,
    modal_open: !!(await s.page.evaluate(() => [...document.querySelectorAll('button')].some(el => el.offsetParent !== null && /confirm & post/i.test(el.innerText || '')))) };
  console.log('KEYBOARD COMMIT:', JSON.stringify(out.keyboard_commit_result, null, 1));

  // reload the form and try a pure mouse pick on the dropdown row coordinates
  await s.key('Escape'); await sleep(800);
  await s.page.click(inp);
  await s.page.evaluate((sel) => { const el = document.querySelector(sel); el.focus(); try { el.select(); } catch { /* noop */ } }, inp);
  await s.page.keyboard.type('QA Supplier Kerala', { delay: 35 });
  await sleep(2000);
  const dd = await dropdown(s);
  out.frames.push({ how: 'mouse path, list open', ...dd });
  if (dd.candidates && dd.candidates.length) {
    const c = dd.candidates[0];
    await s.page.mouse.click(c.x, c.y);
    await sleep(1800);
    out.mouse_pick = { clicked: c, after: await dropdown(s) };
    const post2 = await s.page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].filter(el => el.offsetParent !== null)
        .find(x => (x.innerText || '').replace(/\s+/g, ' ').trim() === 'Post Purchase (F12)');
      if (!b) return null; const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!b.disabled };
    });
    if (post2 && !post2.disabled) await s.page.mouse.click(post2.x, post2.y);
    const toasts2 = [];
    for (let i = 0; i < 14; i++) {
      const m = (await s.text()).match(/(Please select a supplier[^\n]*|Please enter supplier bill[^\n]*|Cannot post empty[^\n]*)/i);
      if (m && !toasts2.includes(m[1])) toasts2.push(m[1].trim());
      await sleep(250);
    }
    out.mouse_result = { post_button: post2, toasts: toasts2,
      modal_open: !!(await s.page.evaluate(() => [...document.querySelectorAll('button')].some(el => el.offsetParent !== null && /confirm & post/i.test(el.innerText || '')))) };
    console.log('\nMOUSE PICK:', JSON.stringify(out.mouse_result, null, 1));
  }
  await s.screenshot('supplier_combobox');
  for (const f of out.frames) console.log('\n### ' + f.how + '\n' + JSON.stringify(f).slice(0, 600));
  saveEvidence('D1_supplier_combobox.json', out);
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });

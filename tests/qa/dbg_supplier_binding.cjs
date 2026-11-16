/** Is the purchase supplier combobox committed? Count form instances / buttons and test both click styles. */
const { newSession, saveEvidence, POS_URL } = require('./driver.cjs');
const { onboard, signInWithPin, navTo, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

(async () => {
  const store = manifest.stores['QA-A'];
  const out = {};
  const s = await newSession('qaA_stores', { url: POS_URL, stable: true });
  await onboard(s, store.activation_key, 'QA A Stores Counter 1');
  const si = await signInWithPin(s, store.users.pur.pin, store.users.pur.username);
  out.signin = si;
  if (!si.ok) { saveEvidence('D1_supplier_binding.json', out); return; }

  await navTo(s, '/pos'); await sleep(800);
  await navTo(s, '/purchases'); await sleep(3000);
  out.route = await s.page.evaluate(() => location.pathname);
  out.counts_before = await s.page.evaluate(() => ({
    supplierInputs: [...document.querySelectorAll('input[placeholder^="Select or search supplier"]')].filter(e => e.offsetParent !== null).length,
    postButtons: [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null && /Post Purchase/.test(e.innerText || '')).length,
    newBillButtons: [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null && /New Inward Bill/.test(e.innerText || '')).length,
    selectedBadges: [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /^Selected$/.test((e.innerText || '').trim())).length,
  }));
  // click New Inward Bill if the empty state button is shown
  const opened = await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null && /New Inward Bill/i.test(e.innerText || ''))[0];
    if (!b) return false; b.click(); return true;
  });
  out.opened_new_bill = opened;
  await sleep(2500);
  out.counts_after_new = await s.page.evaluate(() => ({
    supplierInputs: [...document.querySelectorAll('input[placeholder^="Select or search supplier"]')].filter(e => e.offsetParent !== null).length,
    postButtons: [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null && /Post Purchase/.test(e.innerText || '')).length,
  }));

  const sup = 'QA Supplier Kerala Pvt Ltd';
  await s.page.click('input[placeholder^="Select or search supplier"]');
  await s.page.keyboard.type(sup, { delay: 25 });
  await sleep(1600);
  // Real mouse click on the option (portal-rendered), not element.click()
  const optBox = await s.page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find(e => /QA Supplier Kerala Pvt Ltd/.test(e.innerText || ''));
    if (!opt) return null;
    const r = opt.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (opt.innerText || '').replace(/\s+/g, ' ').slice(0, 80) };
  });
  out.option = optBox;
  if (optBox) { await s.page.mouse.click(optBox.x, optBox.y); }
  await sleep(1200);

  out.after_pick = await s.page.evaluate(() => {
    const input = [...document.querySelectorAll('input[placeholder^="Select or search supplier"]')].filter(e => e.offsetParent !== null)[0];
    const cardText = [...document.querySelectorAll('div')].filter(d => /GSTIN: 32AAAAA0000QS9Z9/.test(d.innerText || '')).map(d => (d.innerText || '').replace(/\s+/g, ' ').slice(0, 120));
    const selectedBadges = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /^Selected$/.test((e.innerText || '').trim())).length;
    const openDropdowns = [...document.querySelectorAll('[role="listbox"]')].filter(e => e.offsetParent !== null).length;
    return { input_value: input ? input.value : null, card_matches: cardText.length, card_samples: cardText.slice(0, 3), selectedBadges, openDropdowns };
  });

  // Press F12 and record what happens (advertised shortcut vs shell binding)
  await s.page.keyboard.press('F12');
  await sleep(900);
  const f12 = (await s.text()).replace(/\n{3,}/g, '\n');
  out.f12_switch_cashier = /SELECT INCOMING OPERATOR|ENTER QUICK PIN/i.test(f12);
  await s.page.keyboard.press('Escape'); await sleep(600);

  // Now post via the button with a real mouse click
  const post = await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null).find(e => (e.innerText || '').replace(/\s+/g, ' ').trim() === 'Post Purchase (F12)');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!b.disabled };
  });
  out.post_button = post;
  out.toasts = [];
  if (post && !post.disabled) {
    await s.page.mouse.click(post.x, post.y);
    for (let i = 0; i < 12; i++) {
      const t = await s.text();
      const m = t.match(/(Please select a supplier[^\n]*|Please enter supplier bill[^\n]*|Cannot post empty[^\n]*)/i);
      if (m && !out.toasts.includes(m[1].trim())) out.toasts.push(m[1].trim());
      await sleep(250);
    }
  }
  out.modal_visible = /Confirm & Post Purchase/i.test(await s.text());
  out.pageErrors = s.pageErrs.slice(-5);
  out.console = s.consoleErrs.slice(-8);

  console.log(JSON.stringify(out, null, 1));
  saveEvidence('D1_supplier_binding.json', out);
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });

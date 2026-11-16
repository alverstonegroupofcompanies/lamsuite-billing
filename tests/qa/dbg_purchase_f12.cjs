/** Does the purchase form post with its advertised keyboard path (F12 then Enter)? */
const { newSession, saveEvidence, POS_URL } = require('./driver.cjs');
const { onboard, signInWithPin, navTo, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

const probe = (s) => s.page.evaluate(() => {
  const all = [...document.querySelectorAll('button')].filter(el => el.offsetParent !== null);
  return {
    post_buttons: all.filter(b => /post purchase/i.test(b.innerText || '')).map(b => ({ raw: JSON.stringify(b.innerText), d: !!b.disabled })),
    confirm_buttons: all.filter(b => /confirm/i.test(b.innerText || '')).map(b => ({ raw: JSON.stringify(b.innerText), d: !!b.disabled })),
    modal_headings: [...document.querySelectorAll('h1,h2,h3,h4')].filter(h => h.offsetParent !== null).map(h => (h.innerText || '').trim()).filter(Boolean).slice(-8),
    bill_count_label: (document.body.innerText.match(/Inward Purchase Bills \(\d+\)/i) || [])[0] || null,
  };
});

(async () => {
  const store = manifest.stores['QA-A'];
  const out = { frames: [] };
  const s = await newSession('qaA_stores', { url: POS_URL, stable: true });
  await onboard(s, store.activation_key, 'QA A Stores Counter 1');
  const si = await signInWithPin(s, store.users.pur.pin, store.users.pur.username);
  if (!si.ok) { console.log('signin failed', JSON.stringify(si).slice(0, 200)); saveEvidence('D1_f12_probe.json', out); return; }

  await navTo(s, '/pos'); await sleep(1000);
  await navTo(s, '/purchases'); await sleep(3000);
  await s.clickText('New Inward Bill'); await sleep(2500);

  const sup = 'QA Supplier Kerala Pvt Ltd';
  await s.page.click('input[placeholder^="Select or search supplier"]');
  await s.page.keyboard.type(sup, { delay: 30 }); await sleep(1800);
  await s.clickText(sup); await sleep(1200);
  const vb = 'QA-PV-' + Date.now().toString().slice(-6);
  await s.page.click('input[placeholder="INV-001"]'); await s.page.keyboard.type(vb, { delay: 30 });
  const pn = manifest.stores['QA-A'].products['QA-DOLO650'].search_name || manifest.stores['QA-A'].products['QA-DOLO650'].name;
  await s.page.click('input[placeholder^="Scan barcode or type product name"]');
  await s.page.keyboard.type(pn, { delay: 35 }); await sleep(1800);
  await s.clickText(pn.slice(0, 16)); await sleep(2000);

  // fill the grid through the keyboard only: the row accepts Tab between cells
  const qty = await s.page.$$('input[type=number]');
  out.number_input_count = qty.length;
  const setCell = async (sel, val) => { await s.page.click(sel); await s.page.evaluate((x) => { const el = document.querySelector(x); el.focus(); try { el.select(); } catch { /* number */ } }, sel); await s.page.keyboard.type(String(val), { delay: 35 }); await s.key('Tab'); await sleep(450); };
  const batchId = await s.page.evaluate(() => {
    const inp = [...document.querySelectorAll('input')].find(el => (el.placeholder || '').toUpperCase() === 'BATCH');
    if (!inp) return null; inp.id = 'qa-batch'; return '#qa-batch';
  });
  if (batchId) await setCell(batchId, 'QA-PUR-02');
  const expId = await s.page.evaluate(() => {
    const inp = [...document.querySelectorAll('input')].find(el => (el.placeholder || '') === 'MM/YY');
    if (!inp) return null; inp.id = 'qa-exp'; return '#qa-exp';
  });
  if (expId) await setCell(expId, '12/28');
  const rateId = await s.page.evaluate(() => {
    const inp = [...document.querySelectorAll('input')].find(el => (el.placeholder || '') === 'Rate');
    if (!inp) return null; inp.id = 'qa-rate'; return '#qa-rate';
  });
  if (rateId) await setCell(rateId, '25');

  out.frames.push({ step: 'before F12', ...(await probe(s)) });
  await s.page.keyboard.press('F12');
  await sleep(2500);
  out.frames.push({ step: 'after pressing F12', ...(await probe(s)) });
  await s.screenshot('f12_modal');
  // F12 raises the shell's "Switch Cashier" modal on every non-POS page; record that, then
  // close it before trying the mouse path, otherwise the click lands on the overlay.
  out.f12_opened_switcher = /SELECT INCOMING OPERATOR|QUICK PIN/i.test(await s.text());
  out.f12_screen_after_key = (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 260);
  await s.key('Escape'); await sleep(1200);
  await s.screenshot('after_escape');

  // the real submit control, addressed by exact label so the shortcut-hint chip cannot absorb it
  const exact = await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter(el => el.offsetParent !== null)
      .find(x => (x.innerText || '').trim().replace(/\s+/g, ' ') === 'Post Purchase (F12)');
    if (!b) return null;
    b.click();
    return { clicked: 'Post Purchase (F12)', disabled: !!b.disabled };
  });
  await sleep(3000);
  out.frames.push({ step: 'after clicking the exact submit button', exact, ...(await probe(s)) });
  await s.screenshot('exact_click');

  const afterEnter = await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter(el => el.offsetParent !== null).find(x => /confirm/i.test(x.innerText || ''));
    if (!b) return null;
    b.click();
    return { clicked: JSON.stringify(b.innerText) };
  });
  await sleep(9000);
  out.frames.push({ step: 'after clicking confirm via DOM', afterEnter, ...(await probe(s)) });
  await s.screenshot('after_confirm');
  out.tail = (await s.text()).replace(/\n{3,}/g, '\n').slice(-700);
  out.network = s.net.filter(n => /purchase|sync\/push/.test(n.url)).map(n => ({ m: n.method, u: n.url.replace('http://127.0.0.1:8000', ''), s: n.status, req: (n.post_data || '').slice(0, 260) }));
  out.console = s.consoleErrs.slice(-10);
  out.pageErrors = s.pageErrs.slice(-6);

  for (const f of out.frames) console.log('\n### ' + f.step + '\n' + JSON.stringify(f, null, 1).slice(0, 1200));
  console.log('\nTAIL:', out.tail);
  console.log('\nNETWORK:', JSON.stringify(out.network, null, 1).slice(0, 1800));
  console.log('\nPAGE ERRORS:', JSON.stringify(out.pageErrors));
  saveEvidence('D1_f12_probe.json', out);
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });

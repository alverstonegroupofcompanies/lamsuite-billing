// G8-KEYBOARD live walkthrough: KB-01 (F2 on the purchases list), KB-02 (an open purchase bill owns
// its keys and guards navigation), KB-03 (returns F7 + arrow-selected results, POS arrival focus,
// settlement keys that survive macOS Option). No document is posted; nothing but QA store 4 is touched.
const { claim } = require('./pos.cjs');
const { evidence, sleep, sql } = require('./lib.cjs');

const active = (s) =>
  s.page.evaluate(() => {
    const e = document.activeElement;
    return e
      ? `${e.tagName}:${e.type || ''}:${e.placeholder || e.getAttribute('aria-label') || e.id || ''}`
      : null;
  });
const route = (s) => s.page.evaluate(() => location.pathname);
const line = async (s, re) =>
  (await s.text()).split('\n').filter((l) => re.test(l)).slice(0, 6);
// Placeholders and modal headings are read from the DOM: the grid text never carries an input's
// placeholder, so a text-only probe reports a control that is plainly on screen as missing.
const hasControl = (s, pattern, flags = "i") =>
  s.page.evaluate(
    (p, f) => {
      const re = new RegExp(p, f);
      const inputs = Array.from(document.querySelectorAll("input, textarea")).map(
        (e) => e.placeholder || e.getAttribute("aria-label") || e.id || ""
      );
      const buttons = Array.from(document.querySelectorAll("button")).map((e) => e.innerText || "");
      const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4")).map((e) => e.innerText || "");
      return re.test([...inputs, ...buttons, ...headings, document.body.innerText].join("\n"));
    },
    pattern,
    flags
  );
const options = (s) =>
  s.page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="listbox"] [role="option"]')).map((o) => ({
      id: o.id,
      selected: o.getAttribute('aria-selected'),
      text: (o.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    }))
  );
const desc = (s) =>
  s.page.evaluate(() => document.activeElement?.getAttribute('aria-activedescendant') || null);
const tenderModes = (s) =>
  s.page.evaluate(() => Array.from(document.querySelectorAll('select')).map((x) => x.value));
const combo = async (s, mods, key) => {
  for (const m of mods) await s.page.keyboard.down(m);
  await s.page.keyboard.press(key);
  for (const m of [...mods].reverse()) await s.page.keyboard.up(m);
};
// window.confirm is answered here instead of through a native dialog, so the walkthrough can
// choose refusal and approval per step and record the exact message the cashier would read.
const initConfirms = (s) =>
  s.page.evaluate(() => {
    window.__confirms = [];
    window.__confirmAnswer = true;
    window.confirm = (m) => {
      const answer = window.__confirmAnswer !== false;
      window.__confirms.push({ message: String(m).slice(0, 200), answer });
      return answer;
    };
  });
const confirms = (s) => s.page.evaluate(() => window.__confirms.slice());

(async () => {
  const ev = {};
  const s = await claim('kb_g8', 2, 4);
  await initConfirms(s);

  // ---- KB-03(c): arriving at POS by keyboard lands the caret on the entry row
  await s.page.keyboard.press('F5');
  await sleep(1500);
  ev.before_pos_arrival = { route: await route(s), active: await active(s) };
  await s.page.keyboard.press('F1');
  await sleep(1500);
  ev.pos_arrival = { route: await route(s), active: await active(s) };

  // ---- KB-01: the purchases list answers the F2 its own button prints
  await s.page.keyboard.press('F2');
  await sleep(1500);
  ev.list_after_F2 = { route: await route(s), active: await active(s) };
  await s.page.keyboard.press('F2');
  await sleep(1500);
  ev.form_after_F2 = {
    route: await route(s),
    entry_row: await hasControl(s, /type product name \[F1\]/),
    bill_number: await line(s, /INWARD ENTRY NO|C01-PUR/i),
  };

  // ---- KB-02: the open bill owns its chords and guards every navigation key
  await combo(s, ['Alt'], 'KeyB');
  await sleep(300);
  await s.page.keyboard.type('QA-KB-G8', { delay: 25 });
  await sleep(600);
  ev.dirty_bill = { active: await active(s), confirms: await confirms(s) };

  await s.page.keyboard.press('F1');
  await sleep(900);
  ev.purchase_F1 = { route: await route(s), active: await active(s) };

  await s.page.keyboard.press('F9');
  await sleep(1200);
  ev.purchase_F9 = {
    route: await route(s),
    drafts_modal: await hasControl(s, "Saved Purchase Drafts"),
    confirms: await confirms(s),
  };
  await s.page.keyboard.press('Escape');
  await sleep(800);

  await s.page.keyboard.press('F8');
  await sleep(1500);
  ev.purchase_F8 = { route: await route(s), still_in_bill: await hasControl(s, "type product name \\[F1\\]") };

  await s.page.evaluate(() => {
    window.__confirmAnswer = false;
    window.__confirms = [];
  });
  await s.page.keyboard.press('F3');
  await sleep(1500);
  ev.purchase_guard_refused = { route: await route(s), confirms: await confirms(s) };

  await s.page.evaluate(() => {
    window.__confirmAnswer = true;
    window.__confirms = [];
  });
  await s.page.keyboard.press('F3');
  await sleep(1800);
  ev.purchase_guard_approved = { route: await route(s), confirms: await confirms(s) };

  // back onto the purchases list, then into a second bill, this time guarded against F2 and F6
  await s.page.keyboard.press('F2');
  await sleep(1500);
  await s.page.keyboard.press('F2');
  await sleep(1500);
  await combo(s, ['Alt'], 'KeyB');
  await sleep(300);
  await s.page.keyboard.type('QA-KB-G8-B', { delay: 25 });
  await sleep(600);

  await s.page.evaluate(() => {
    window.__confirmAnswer = false;
    window.__confirms = [];
  });
  await s.page.keyboard.press('F2');
  await sleep(1200);
  ev.purchase_F2_refused = {
    route: await route(s),
    confirms: await confirms(s),
    bill_no_kept: await s.page.evaluate(() => {
      const e = document.querySelector('input[placeholder^="INV-"]');
      return e ? e.value : null;
    }),
  };

  await s.page.keyboard.press('F6');
  await sleep(1200);
  ev.purchase_F6_refused = {
    route: await route(s),
    confirms: await confirms(s),
    still_in_bill: await hasControl(s, "type product name \\[F1\\]"),
  };

  await s.page.evaluate(() => {
    window.__confirmAnswer = true;
    window.__confirms = [];
  });
  await s.page.keyboard.press('F6');
  await sleep(1500);
  ev.purchase_F6_approved = {
    route: await route(s),
    confirms: await confirms(s),
    back_on_list: await hasControl(s, "New Inward Bill"),
  };

  // ---- KB-03(a)(b): returns opens on F7 and its results are arrow-selectable
  const invoiceRow = sql(
    "select invoice_number from invoices where store_id=4 and status='issued' order by id desc limit 1"
  )[0];
  // A prefix shared by several bills, so the arrows have somewhere to walk
  const query = invoiceRow ? invoiceRow.invoice_number.slice(0, -4) : 'INV';
  await s.page.keyboard.press('F7');
  await sleep(1500);
  await s.page.keyboard.press('F7');
  await sleep(800);
  ev.returns_after_F7_F7 = { route: await route(s), active: await active(s), query };
  await s.page.keyboard.type(query, { delay: 30 });
  await sleep(2200);
  ev.returns_results = { options: await options(s), activedescendant: await desc(s) };
  await s.page.keyboard.press('ArrowDown');
  await sleep(500);
  ev.returns_arrow = { activedescendant: await desc(s), options: await options(s) };
  await s.page.keyboard.press('Enter');
  await sleep(2500);
  ev.returns_enter = { items_step: await hasControl(s, "Select items to return") };
  await s.page.keyboard.press('Escape');
  await sleep(1000);
  ev.returns_escape = {
    options: await options(s),
    still_open: await hasControl(s, "New Sales Return / Credit Note|Select items to return"),
    route: await route(s),
  };

  // ---- KB-03(d): settlement keys read the physical digit, not the Option symbol
  await s.page.keyboard.press('F1');
  await sleep(1800);
  await s.page.keyboard.press('F1');
  await sleep(600);
  await s.page.keyboard.type('QA Paracet', { delay: 35 });
  await sleep(1500);
  await s.page.keyboard.press('Enter');
  await sleep(1200);
  if (/Select Batch/.test(await s.text())) {
    await s.page.keyboard.press('Enter');
    await sleep(900);
  }
  await s.page.keyboard.press('F12');
  await sleep(1500);
  ev.settlement_open = { modal: await hasControl(s, "Bill Settlement"), modes: await tenderModes(s) };
  await combo(s, ['Alt'], 'Digit2');
  await sleep(900);
  ev.settlement_alt2 = { modes: await tenderModes(s), buttons: line(s, /^\[?\d/i) };
  await combo(s, ['Alt'], 'Digit8');
  await sleep(900);
  ev.settlement_alt8 = { modes: await tenderModes(s) };
  await s.screenshot('kb_g8_settlement');
  await s.page.keyboard.press('Escape');
  await sleep(800);

  ev.console_errors = s.pageErrs.slice(0, 10);
  console.log(JSON.stringify(ev, null, 1));
  evidence('kb_g8', ev);
  await s.close();
})();

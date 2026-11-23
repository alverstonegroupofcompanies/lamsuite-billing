/**
 * Diagnostic probe (not a scenario): find which frontend path rewrites the till's invoice row
 * after a revision. Wraps localStorage writes — every MockSqliteDatabase insert persists its whole
 * table through setItem — and records a signature of the target bill plus the JS call stack, so a
 * revert can be attributed to the file that caused it.
 *
 * Run: QA_DB=tests/qa/qa_gstcheck.sqlite QA_BACKEND=http://127.0.0.1:8010 node tests/qa/gst_s4_clobber_probe.cjs
 */
const {
  storeByCode, fixture, login, sleep, readMoney, invoiceNoShown, addLine, checkoutAndSave,
  serverInvoice, p2, sql, saveEvidence, navTo, batchWithStock, localTable, setInput,
} = require('./gst_kit.cjs');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';
const out = { notes: [], timeline: [], marks: [] };
const log = (m) => console.log(m);

/** Install the write tracer. Survives in-app navigation because no document reload happens. */
async function installProbe(s, invoiceNumber, storeId) {
  return s.page.evaluate((num, sid) => {
    if (!window.__probe) {
      window.__probe = { writes: [], marks: [], seenIds: {} };
      const origSet = Storage.prototype.setItem;
      const origDel = Storage.prototype.removeItem;
      const tableOf = (k) => {
        const m = /^lamsuite_tbl_(\d+)_(invoices|invoice_items)$/.exec(k);
        return m ? { store: m[1], table: m[2] } : null;
      };
      Storage.prototype.setItem = function (k, v) {
        try {
          const t = tableOf(k);
          if (t && window.__probe.target) {
            const entries = JSON.parse(v);
            const p = window.__probe;
            if (t.table === 'invoices') {
              const mine = entries
                .map((e) => e[1])
                .filter((r) => r && r.invoice_number === p.target)
                .map((r) => {
                  p.seenIds[String(r.id)] = true;
                  return [r.id, r.grand_total, r.taxable_subtotal, r.status, r.sync_state,
                    r.updated_at, r.tax_total, r.round_off, r.paid_amount].join('~');
                });
              const sig = 'INV[' + (mine.join(' || ') || 'ABSENT') + ']';
              const last = p.writes.length ? p.writes[p.writes.length - 1].sig : null;
              if (sig !== last || p.forceNext) {
                p.forceNext = false;
                p.writes.push({ t: Date.now(), mark: p.marks[p.marks.length - 1] || null, sig,
                  stack: (new Error()).stack.split('\n').slice(3, 11).map((f) => f.trim().replace(/https?:\/\/[^ )]*/g, (m) => m.split('/').slice(-2).join('/'))).join(' < ') });
                if (p.writes.length > 1500) p.writes.shift();
              }
            } else {
              const ids = Object.keys(p.seenIds);
              const hit = entries.map((e) => e[1]).filter((r) => r && ids.includes(String(r.invoice_id)));
              const sig = 'ITEMS[' + hit.map((r) => [r.invoice_id, r.id, r.product_name, r.qty, r.taxable_amount, r.tax_amount].join('~')).join(' || ') + ']';
              const last = p.writes.length ? p.writes[p.writes.length - 1].sig : null;
              if (sig !== last) {
                p.writes.push({ t: Date.now(), mark: p.marks[p.marks.length - 1] || null, sig,
                  stack: (new Error()).stack.split('\n').slice(3, 11).map((f) => f.trim().replace(/https?:\/\/[^ )]*/g, (m) => m.split('/').slice(-2).join('/'))).join(' < ') });
                if (p.writes.length > 1500) p.writes.shift();
              }
            }
          }
        } catch (e) {
          try { window.__probe.writes.push({ t: Date.now(), sig: 'PROBE_ERROR ' + String(e).slice(0, 120) }); } catch {}
        }
        return origSet.call(this, k, v);
      };
      Storage.prototype.removeItem = function (k) {
        try {
          const t = tableOf(k);
          if (t && window.__probe.target) {
            window.__probe.writes.push({ t: Date.now(), mark: window.__probe.marks[window.__probe.marks.length - 1] || null,
              sig: 'REMOVE ' + t.table, stack: (new Error()).stack.split('\n').slice(3, 11).map((f) => f.trim().replace(/https?:\/\/[^ )]*/g, (m) => m.split('/').slice(-2).join('/'))).join(' < ') });
          }
        } catch {}
        return origDel.call(this, k);
      };
    }
    window.__probe.target = num;
    window.__probe.store = sid;
    return { installed: true, target: num };
  }, invoiceNumber, String(storeId));
}

async function mark(s, name) {
  await s.page.evaluate((n) => {
    if (window.__probe) { window.__probe.marks.push(n); window.__probe.forceNext = true; }
  }, name);
}

async function dump(s) {
  return s.page.evaluate(() => (window.__probe ? { marks: window.__probe.marks, writes: window.__probe.writes, seenIds: Object.keys(window.__probe.seenIds) } : { missing: true }));
}

(async () => {
  const store = storeByCode('QA-A');
  log('store ' + JSON.stringify(store));
  const { s, ok, stage, detail } = await login({ storeCode: 'QA-A', key: KEY, username: 'qaa_owner', pin: '9101', counterName: 'GST Probe S4' });
  log('login ' + ok + ' ' + stage + ' ' + JSON.stringify(detail || '').slice(0, 160));
  if (!ok) { saveEvidence('GST_S4_clobber_probe.json', out); process.exit(1); }

  const SYR = fixture(store.id, 'QA Antibiotic Syrup');
  const EXE = fixture(store.id, 'QA Exempt Nutritional');

  await s.key('F1'); await sleep(2200);
  const shown = await invoiceNoShown(s);
  const added = [];
  for (const l of [{ prod: SYR, packs: 2, loose: 0 }, { prod: EXE, packs: 1, loose: 0 }]) {
    const units = l.packs * (Number(l.prod.units_per_pack) || 1) + l.loose;
    const batch = batchWithStock(l.prod, units);
    const r = await addLine(s, { search: l.prod.name, batch, packs: l.packs, loose: l.loose });
    if (!r.ok) { log('build failed ' + JSON.stringify(r)); await s.close(); process.exit(1); }
    added.push({ ...l, batch });
  }
  const money = await readMoney(s);
  await checkoutAndSave(s, { tender: 'Cash' });
  await sleep(6000);
  const srv = serverInvoice(shown, store.id);
  log(`bill ${shown} ui=${JSON.stringify(money)} server=${srv && srv.grand_total} server_id=${srv && srv.id}`);
  if (!srv) { log('bill never reached the server'); await s.close(); process.exit(1); }

  const tillRows = (await localTable(s, 'invoices', store.id)).rows.filter((r) => r.invoice_number === shown);
  log('till rows for number ' + JSON.stringify(tillRows.map((r) => ({ id: r.id, grand: r.grand_total, sync: r.sync_state, created: r.created_at, upd: r.updated_at }))));
  const tillItemsAll = (await localTable(s, 'invoice_items', store.id)).rows;
  log('till item invoice_ids ' + JSON.stringify([...new Set(tillItemsAll.map((i) => String(i.invoice_id)))]));
  out.notes.push({ tillRows, distinctItemInvoiceIds: [...new Set(tillItemsAll.map((i) => String(i.invoice_id)))] });

  const probe = await installProbe(s, shown, store.id);
  log('probe ' + JSON.stringify(probe));

  await mark(s, 'nav-bills');
  await navTo(s, '/bills');
  await sleep(4000);
  await s.page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.offsetParent !== null && /^(All Time|View All Time)$/i.test((b.innerText || '').trim()));
    if (el) el.click();
  });
  await sleep(5000);

  await mark(s, 'open-bill');
  const box = await s.page.evaluate((n) => {
    const els = [...document.querySelectorAll('tr,button,[role="row"]')]
      .filter((el) => el.offsetParent !== null && (el.innerText || '').includes(n) && (el.innerText || '').length < 900);
    const el = els.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, shown);
  if (!box) { log('row not found'); out.timeline = await dump(s); saveEvidence('GST_S4_clobber_probe.json', out); await s.close(); process.exit(1); }
  await s.page.mouse.click(box.x, box.y);
  await sleep(3000);

  await mark(s, 'click-edit');
  await s.clickText('Edit Bill');
  await sleep(3000);
  await mark(s, 'approve-dialog');
  await setInput(s, '#invoice-approval-identifier', 'qaa_owner');
  await sleep(400);
  await setInput(s, '#invoice-approval-secret', '9101');
  await sleep(400);
  await setInput(s, '#invoice-approval-reason', 'QA probe revision');
  await sleep(600);
  await s.clickText('Authorize Edit');
  await sleep(6000);
  const editMode = /Editing Invoice/i.test(await s.text());
  log('edit mode ' + editMode);

  await mark(s, 'edit-screen');
  let revision = { attempted: editMode };
  if (editMode) {
    const ids = await s.page.evaluate(() => [...document.querySelectorAll('input[id^="qty-input-"]')]
      .map((i) => i.id.replace(/^qty-input-/, '').replace(/-(pack|loose)$/, '')).filter((v, x, a) => a.indexOf(v) === x));
    const lineSel = `#qty-input-${ids[0]}-pack`;
    await s.page.click(lineSel);
    await sleep(200);
    await s.page.keyboard.type('3', { delay: 60 });
    await sleep(800);
    await s.key('Enter');
    await sleep(1500);
    revision.money_after_qty = await readMoney(s);
    await mark(s, 'qty-changed');
    await s.key('F12');
    await sleep(3500);
    let diffUp = /Confirm Revision/i.test(await s.text());
    if (!diffUp) {
      await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyS'); await s.page.keyboard.up('Control');
      await sleep(3500);
      diffUp = /Confirm Revision/i.test(await s.text());
    }
    revision.diff_modal = diffUp;
    if (diffUp) {
      await setInput(s, 'input[placeholder="e.g., Customer altered quantity, corrected item..."]', 'QA probe revision reason');
      await sleep(500);
      await mark(s, 'confirm-click');
      await s.clickText('Confirm & Save Revision');
      await sleep(10000);
    }
    await mark(s, 'after-confirm');
  }

  const tillAfter = (await localTable(s, 'invoices', store.id)).rows.filter((r) => r.invoice_number === shown);
  const idsAfter = tillAfter.map((r) => String(r.id));
  const itemsAfter = (await localTable(s, 'invoice_items', store.id)).rows.filter((i) => idsAfter.includes(String(i.invoice_id)));
  log('till after ' + JSON.stringify(tillAfter.map((r) => ({ id: r.id, taxable: r.taxable_subtotal, tax: r.tax_total, grand: r.grand_total, status: r.status, sync: r.sync_state }))));
  log('items after ' + JSON.stringify(itemsAfter.map((i) => ({ inv: i.invoice_id, id: i.id, n: i.product_name, qty: i.qty }))));
  out.notes.push({ revision, tillAfter, itemsAfter, server: serverInvoice(shown, store.id) });

  await mark(s, 'dump');
  out.timeline = await dump(s);
  console.log('\n=== timeline ===');
  for (const w of (out.timeline.writes || [])) {
    console.log(`${w.mark || '-'} | ${w.sig.slice(0, 260)}\n      ${w.stack || ''}`);
  }
  saveEvidence('GST_S4_clobber_probe.json', out);
  await s.close();
})().catch((e) => { console.error(e); saveEvidence('GST_S4_clobber_probe.json', out); process.exit(1); });

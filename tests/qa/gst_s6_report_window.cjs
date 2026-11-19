/**
 * S6 — the date-window fix judged against the live server.
 *
 * invoices.invoice_date is a TEXT column that the app has filled with both 'YYYY-MM-DD' (the
 * till's own sync) and 'YYYY-MM-DD HH:MM:SS' (older/seeded writes). Every register window and
 * every GST report range used to be compared as a string, so one of the two shapes silently
 * vanished from the result — a bill the cashier could not find and a month's GST that did not
 * add up. Here the same windows are asked of the API and of SQL, and both date shapes have to
 * come back.
 */
const {
  storeByCode, fixture, login, shot, sleep, invoiceNoShown, addLine, checkoutAndSave,
  serverInvoice, sql, p2, cmp, saveEvidence, navTo, batchWithStock, DB_PATH,
} = require('./gst_kit.cjs');
const { execFileSync } = require('child_process');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';
const out = { scenarios: [], defects: [], notes: [] };
const rec = (id, title, status, evidence) => {
  out.scenarios.push({ id, title, status, evidence });
  console.log(`[${status}] ${id} — ${title}`);
  if (status !== 'PASS') console.log('     ' + JSON.stringify(evidence).slice(0, 1500));
};
const def = (d) => { out.defects.push(d); console.log(`  >>> DEFECT ${d.severity} ${d.id}: ${d.title}`); };

/** Ask the live API something the cashier's own session is allowed to ask. */
async function apiGet(s, path) {
  return await s.page.evaluate(async (p) => {
    const base = (() => {
      try { return (window.localStorage.getItem('lamsuite_api_base_url') || '').replace(/"/g, ''); } catch { return ''; }
    })();
    const token = Object.keys(localStorage)
      .map(k => String(localStorage.getItem(k)).replace(/^"|"$/g, ''))
      .find(v => /^[\w.-]{20,}$/.test(v));
    if (!token) return { path: p, status: 0, why: 'no bearer token in the till' };
    const res = await fetch(`${base}${p}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep the raw text for evidence */ }
    return { path: p, status: res.status, json, text: json ? undefined : text.slice(0, 400) };
  }, path);
}

const q = (v) => String(v).replace(/'/g, "''");

/** What the server holds for a window, computed straight from the same table the API reads. */
function billsIn(store, from, to) {
  return sql(`select invoice_number, invoice_date, length(invoice_date) as date_len, status, module_key
              from invoices i where store_id=${store}
                and substr(invoice_date,1,10) between '${q(from)}' and '${q(to)}'
              order by id`);
}

(async () => {
  const store = storeByCode('QA-A');
  console.log('store', JSON.stringify(store));
  const { s, ok, stage, detail } = await login({ storeCode: 'QA-A', key: KEY, username: 'qaa_owner', pin: '9101', counterName: 'GST Run S6' });
  console.log('login', ok, stage, JSON.stringify(detail || '').slice(0, 160));
  if (!ok) { saveEvidence('GST_S6_report_window.json', out); process.exit(1); }

  // ── S6.0 raise one fresh bill through the POS so today has a bill the till itself synced ──
  const SYR = fixture(store.id, 'QA Antibiotic Syrup');
  await s.key('F1'); await sleep(2200);
  const shown = await invoiceNoShown(s);
  const units = 2 * (Number(SYR.units_per_pack) || 1);
  const batch = batchWithStock(SYR, units);
  const add = await addLine(s, { search: SYR.name, batch, packs: 2, loose: 0 });
  if (!add.ok) { rec('S6.0', 'build a bill to date the windows with', 'FAIL', { why: add.why, detail: add }); saveEvidence('GST_S6_report_window.json', out); process.exit(1); }
  await checkoutAndSave(s, { tender: 'Cash' });
  await sleep(6000);
  const inv = serverInvoice(shown, store.id);
  if (!inv) { rec('S6.0', 'the fresh bill reached the server', 'FAIL', { shown }); saveEvidence('GST_S6_report_window.json', out); process.exit(1); }
  const day = String(inv.invoice_date).slice(0, 10);
  const storedShape = String(inv.invoice_date).length === 10 ? 'bare' : 'stamped';
  rec('S6.0', `bill ${shown} is on the server dated ${day} as a ${storedShape} string`, 'PASS',
    { invoice_date: inv.invoice_date, date_len: String(inv.invoice_date).length, grand: inv.grand_total });

  // ── S6.1 the register windows: bare, stamped and suffixed must agree ──
  const shapes = sql(`select length(invoice_date) as date_len, count(*) as n from invoices
                       where store_id=${store.id} and substr(invoice_date,1,10)='${q(day)}'
                       group by length(invoice_date)`);
  out.notes.push({ step: 'stored date shapes on the window day', shapes });

  const expected = billsIn(store.id, day, day);
  const bare = await apiGet(s, `/api/invoices?store_id=${store.id}&per_page=500&start_date=${day}&end_date=${day}`);
  const suffixed = await apiGet(s, `/api/invoices?store_id=${store.id}&per_page=500&start_date=${day}%2000:00:00&end_date=${day}%2023:59:59`);
  const gotBare = (bare.json && bare.json.data || []).map(r => r.invoice_number);
  const gotSuffixed = (suffixed.json && suffixed.json.data || []).map(r => r.invoice_number);
  const wantNames = expected.map(r => r.invoice_number);
  const checks = [];
  cmp('API "Today" row count vs SQL', gotBare.length, wantNames.length, checks);
  cmp('API "Today" total vs SQL', bare.json && bare.json.total, wantNames.length, checks);
  cmp('window in the suffixed style matches the bare one', gotSuffixed.length, wantNames.length, checks);
  cmp('the till-synced bill from a minute ago is listed', gotBare.includes(shown), true, checks);
  const bad = checks.filter(c => !c.ok);
  rec('S6.1', `Past Bills "Today" returns every bill of the day, both date shapes included`,
    bad.length ? 'FAIL' : 'PASS',
    {
      day, shapes: shapes.map(x => ({ date_len: x.date_len, n: x.n })),
      sql_rows: wantNames.length, api_rows: gotBare.length, api_total: bare.json && bare.json.total,
      suffixed_rows: gotSuffixed.length, fresh_bill: shown,
      missing: wantNames.filter(n => !gotBare.includes(n)),
      extra: gotBare.filter(n => !wantNames.includes(n)),
      status: bare.status, checks,
    });
  if (bad.length) def({ id: 'S6-Register', severity: 'High',
    title: 'the register date window still drops bills whose stored invoice_date shape differs from the bound style',
    evidence: out.scenarios[out.scenarios.length - 1].evidence });

  // ── S6.2 the GST reports over the same windows ──
  // /api/reports/* sits behind auth:sanctum, which the till's device bearer cannot present, so
  // the report controllers are run against this very database out of process instead of over
  // HTTP. Same rows, same SQL, same code path.
  let probe;
  try {
    const stdout = execFileSync('php', ['tests/qa/report_window_probe.php'], {
      cwd: `${__dirname}/../..`,
      env: { ...process.env, APP_ENV: 'local', DB_CONNECTION: 'sqlite', DB_DATABASE: DB_PATH, QA_STORE_ID: String(store.id), QA_DAY: day },
      encoding: 'utf8', timeout: 180000,
    });
    probe = JSON.parse(stdout.slice(stdout.indexOf('{\n')));
  } catch (e) {
    const stdout = String((e && e.stdout) || '');
    try { probe = JSON.parse(stdout.slice(stdout.indexOf('{\n'))); } catch { /* recorded below */ }
    if (!probe) {
      rec('S6.2', 'the report-window probe ran', 'FAIL', { why: String(e && e.message).slice(0, 400), stdout: stdout.slice(0, 1200) });
      def({ id: 'S6-Probe', severity: 'Medium', title: 'the report-window probe could not be run against the QA database',
        evidence: { error: String(e && e.message).slice(0, 400) } });
    }
  }
  if (probe) {
    for (const label of ['day', 'month']) {
      const w = probe[label];
      if (!w) continue;
      const rchecks = [];
      cmp('profit total_revenue vs SQL', w.profit_total_revenue, w.expected_revenue, rchecks);
      cmp('hsn-summary taxable vs SQL', w.hsn_taxable_sum, w.expected_taxable, rchecks);
      const rbad = rchecks.filter(c => !c.ok);
      rec(`S6.2-${label}`, `${label} GST reports hold every bill of the window (both stored date shapes)`,
        rbad.length ? 'FAIL' : 'PASS',
        { window: w.window, bills: w.sql_bills, bare_dates: w.sql_bare_dates, stamped_dates: w.sql_stamped_dates,
          revenue_reported: w.profit_total_revenue, revenue_sql: w.expected_revenue,
          taxable_reported: w.hsn_taxable_sum, taxable_sql: w.expected_taxable,
          gstr1_tables: w.gstr1_tables, checks: rchecks,
          before_the_fix: { suffixed_range_bills: w.old_suffixed_range_would_return, bare_range_bills: w.old_bare_range_would_return,
            non_cancelled_bills_in_window: w.non_cancelled_bills_in_window } });
      if (rbad.length) def({ id: `S6-Report-${label}`, severity: 'High',
        title: `GST reports over the ${label} window do not add up to the bills SQL says are in it`,
        evidence: out.scenarios[out.scenarios.length - 1].evidence });
      else if (w.sql_bills > w.old_suffixed_range_would_return) {
        out.notes.push({ step: `the ${label} window before the fix`,
          bills_in_window: w.non_cancelled_bills_in_window,
          seen_by_gstr1_and_recon_old: w.old_suffixed_range_would_return,
          seen_by_profit_and_hsn_old: w.old_bare_range_bills });
      }
    }
  }

  await shot(s, 'S6_report_window');
  out.raw = { invoices_today: { status: bare.status, total: bare.json && bare.json.total }, probe };
  await s.close();
  saveEvidence('GST_S6_report_window.json', out);
  console.log('saved GST_S6_report_window.json');
})().catch(async (e) => {
  console.log('FATAL', e && e.message);
  out.fatal = String(e && (e.stack || e.message)).slice(0, 3000);
  saveEvidence('GST_S6_report_window.json', out);
  process.exit(1);
});

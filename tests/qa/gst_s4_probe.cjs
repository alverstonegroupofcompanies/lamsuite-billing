/**
 * S4 probe — why does Past Bills list nothing for the active store when the server
 * clearly holds the store's invoices? Captures every /api/invoices call (URL, status,
 * body size), the page's own row count after each filter control, and compares an
 * unauthenticated fetch against one carrying the till's bearer token.
 */
const {
  storeByCode, login, shot, sleep, navTo, sql, saveEvidence,
} = require('./gst_kit.cjs');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';
const out = { scenarios: [], defects: [], notes: [], calls: [], states: [] };

function invoicesCalls(s) {
  return s.apiCalls('/api/invoices').map(n => {
    let rows = null, keys = null;
    try {
      const j = JSON.parse(n.response_body || 'null');
      const arr = Array.isArray(j) ? j : (j && (j.data || j.invoices || j.results)) || null;
      rows = Array.isArray(arr) ? arr.length : null;
      keys = j && !Array.isArray(j) ? Object.keys(j) : null;
    } catch { /* non-json body */ }
    return {
      method: n.method,
      url: n.url.replace(/^https?:\/\/[^/]+/, ''),
      status: n.status,
      resp_len: (n.response_body || '').length,
      rows_in_capture: rows,
      body_keys: keys,
      head: (n.response_body || '').slice(0, 260),
    };
  });
}

function pageState(s) {
  return s.page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    const billTable = tables.find(t => [...t.querySelectorAll('thead th')].some(th => /BILL|INVOICE/i.test(th.innerText || '')));
    const rows = billTable ? [...billTable.querySelectorAll('tbody tr')] : [];
    const txt = document.body.innerText;
    return {
      table_found: !!billTable,
      row_count: rows.length,
      row_samples: rows.slice(0, 4).map(r => (r.innerText || '').replace(/\s+/g, ' ').slice(0, 120)),
      empty_state: /No invoices found/i.test(txt),
      cloud_zero_notice: /currently has 0 invoices on the cloud server/i.test(txt),
      buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null)
        .map(b => (b.innerText || '').replace(/\s+/g, ' ').trim()).filter(x => x).slice(0, 40),
      filters: [...document.querySelectorAll('input')].filter(e => e.offsetParent !== null)
        .map(e => ({ type: e.type, ph: e.placeholder, value: e.value })).slice(0, 12),
    };
  });
}

async function clickVisible(s, label) {
  const ok = await s.page.evaluate((l) => {
    const el = [...document.querySelectorAll('button')].find(b =>
      b.offsetParent !== null && (b.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase().includes(l.toLowerCase()));
    if (!el) return false;
    el.click();
    return true;
  }, label);
  await sleep(3500);
  return ok;
}

(async () => {
  const store = storeByCode('QA-A');
  const newest = sql(`select invoice_number, id, status, grand_total, paid_amount from invoices
                      where store_id=${store.id} order by id desc limit 3`);
  console.log('server says store', store.id, 'has:', JSON.stringify(newest));
  out.server_rows = newest;

  const { s, ok, stage, detail } = await login({ storeCode: 'QA-A', key: KEY, username: 'qaa_owner', pin: '9101', counterName: 'GST Run S4P' });
  console.log('login', ok, stage, JSON.stringify(detail || '').slice(0, 140));
  if (!ok) { saveEvidence('GST_S4_probe.json', out); process.exit(1); }

  await navTo(s, '/bills');
  await sleep(6000);
  out.states.push({ step: 'landing', state: await pageState(s) });
  out.calls.push({ step: 'landing', calls: invoicesCalls(s) });
  console.log('landing:', JSON.stringify(out.states[0].state).slice(0, 700));
  console.log('calls  :', JSON.stringify(out.calls[0].calls).slice(0, 900));

  for (const label of ['Reload From Server', 'View All Time', 'Reset All Filters', 'Reload From Server']) {
    const clicked = await clickVisible(s, label);
    const st = await pageState(s);
    out.states.push({ step: label, clicked, state: st });
    out.calls.push({ step: label, calls: invoicesCalls(s) });
    console.log(`${label}: clicked=${clicked} rows=${st.row_count} empty=${st.empty_state} cloud0=${st.cloud_zero_notice}`);
    if (st.row_count > 0) break;
  }

  // search for a bill the server definitely has
  if (newest[0]) {
    const no = newest[0].invoice_number;
    const typed = await s.page.evaluate((n) => {
      const el = [...document.querySelectorAll('input')].find(e => e.offsetParent !== null && /search|bill|invoice/i.test(e.placeholder || '') || e.type === 'search');
      if (!el) return null;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, n);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.placeholder || el.type;
    }, no);
    await sleep(5000);
    const st = await pageState(s);
    out.states.push({ step: `search ${no}`, typed, state: st });
    out.calls.push({ step: `search ${no}`, calls: invoicesCalls(s) });
    console.log(`search ${no}: placeholder=${typed} rows=${st.row_count}`);
  }

  // is the endpoint gated? compare with and without the till's own bearer token
  const probe = await s.page.evaluate(async () => {
    const base = (() => {
      try { return (window.localStorage.getItem('lamsuite_api_base_url') || '').replace(/"/g, ''); } catch { return ''; }
    })();
    const tokenKeys = Object.keys(localStorage).filter(k => /token|auth|bearer/i.test(k));
    const token = tokenKeys.map(k => String(localStorage.getItem(k)).replace(/^"|"$/g, '')).find(v => /^[\w.-]{20,}$/.test(v));
    const origin = base || '';
    const url = `${origin}/api/invoices?store_id=4&per_page=5`;
    const outp = { token_keys: tokenKeys, has_token: !!token, url };
    const plain = await fetch(url, { headers: { Accept: 'application/json' } });
    outp.plain_status = plain.status;
    outp.plain_body = (await plain.text()).slice(0, 300);
    if (token) {
      const auth = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
      outp.auth_status = auth.status;
      outp.auth_body = (await auth.text()).slice(0, 300);
    }
    return outp;
  });
  out.auth_probe = probe;
  console.log('auth probe:', JSON.stringify(probe).slice(0, 900));

  await shot(s, 'S4_probe');
  const last = invoicesCalls(s);
  out.final_calls = last;
  await s.close();
  saveEvidence('GST_S4_probe.json', out);
  console.log('saved GST_S4_probe.json');
})().catch(e => { console.error(e); saveEvidence('GST_S4_probe.json', out); process.exit(1); });

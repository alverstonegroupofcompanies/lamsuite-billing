/**
 * LamSuite Billing — QA fixture bootstrap (throwaway environment)
 *
 * Builds a controlled dataset for effect-verified QA testing by calling the app's
 * own HTTP APIs (never by inventing shortcuts around them) and records the exact
 * expected side effects in a manifest the harness can assert against.
 *
 * Usage: node tests/qa/qa_bootstrap.cjs
 * Output: tests/qa/manifest.json
 *
 * NOTE: fake data only. No production URLs, no real payment/SMS/email credentials.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BACKEND = process.env.QA_BACKEND || 'http://127.0.0.1:8000';
const ADMIN_EMAIL = 'admin@lamstone.in';
const ADMIN_PASS = 'password123';
const DB_PATH = path.resolve(__dirname, 'qa_fresh.sqlite');
const MANIFEST = path.resolve(__dirname, 'manifest.json');

function sql(query) {
  const escaped = query.replace(/"/g, '""');
  const out = execSync(`sqlite3 -json "${DB_PATH}" "${escaped}"`, { encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : [];
}

async function api(method, url, body, opts = {}) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.storeId) headers['X-Store-Id'] = String(opts.storeId);
  const res = await fetch(`${BACKEND}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json, text };
}

const log = (...a) => console.log('[bootstrap]', ...a);

async function main() {
  const manifest = { generated_at: new Date().toISOString(), backend: BACKEND, stores: {}, users: {}, products: {}, parties: {} };

  // ---------- 1. Admin token ----------
  const login = await api('POST', '/api/login', { email: ADMIN_EMAIL, password: ADMIN_PASS });
  if (login.status !== 200 || !login.json?.token) throw new Error('admin login failed: ' + login.text);
  const adminToken = login.json.token;
  manifest.admin_token = adminToken;
  log('admin token ok');

  // ---------- 2. Edge-case stores covering the statutory matrix ----------
  const storeDefs = [
    { code: 'QA-A', name: 'QA City Pharmacy', state_code: '32', gstin: '32AAAAA0000QA1Z1', tax_mode: 'inclusive', gst_type: 'regular', store_type: 'pharmacy', invoice_prefix: 'QAA', timezone: 'Asia/Kolkata',
      feature_flags: { allow_offline_billing: true, allow_custom_discounts: true, enforce_mrp_capping: true, require_doctor_on_schedule_h: false } },
    { code: 'QA-B', name: 'QA Mart General Store', state_code: '32', gstin: '32AAAAA0000QB2Z2', tax_mode: 'exclusive', gst_type: 'regular', store_type: 'kirana_general', invoice_prefix: 'QAB', timezone: 'Asia/Kolkata',
      feature_flags: { allow_offline_billing: true, allow_custom_discounts: true } },
    { code: 'QA-C', name: 'QA Composition Clinic', state_code: '32', gstin: '32AAAAA0000QC3Z3', tax_mode: 'inclusive', gst_type: 'composition', store_type: 'pharmacy', invoice_prefix: 'QAC', timezone: 'Asia/Kolkata', feature_flags: {} },
    { code: 'QA-D', name: 'QA GST Free Kirana', state_code: '32', gstin: null, tax_mode: 'exclusive', gst_type: 'no_tax', store_type: 'kirana_general', invoice_prefix: 'QAD', timezone: 'Asia/Kolkata', feature_flags: {} },
    { code: 'QA-E', name: 'QA Maharashtra Outlet', state_code: '27', gstin: '27AAAAA0000QE5Z5', tax_mode: 'exclusive', gst_type: 'regular', store_type: 'pharmacy', invoice_prefix: 'QAE', timezone: 'Asia/Kolkata', feature_flags: { allow_offline_billing: true } },
  ];

  for (const def of storeDefs) {
    const existing = sql(`select id from stores where code='${def.code}'`);
    if (existing.length) { manifest.stores[def.code] = { id: Number(existing[0].id), reused: true }; continue; }
    const r = await api('POST', '/api/admin/stores', def, { token: adminToken });
    if (r.status !== 201) throw new Error(`store ${def.code} create failed ${r.status}: ${r.text}`);
    manifest.stores[def.code] = { id: Number(r.json.id), activation_key: r.json.activation_key ?? null };
    log(`store ${def.code} id=${r.json.id} key=${r.json.activation_key ? r.json.activation_key.slice(0, 20) + '…' : 'NOT RETURNED'}`);
  }

  // Mint keys for stores created in an earlier run (activation_key is only returned on create).
  for (const code of Object.keys(manifest.stores)) {
    const s = manifest.stores[code];
    if (s.activation_key) continue;
    const r = await api('POST', `/api/admin/stores/${s.id}/regenerate-key`, {}, { token: adminToken });
    if (r.status === 200 && r.json?.activation_key) s.activation_key = r.json.activation_key;
    else log(`WARN no key for ${code}: ${r.status} ${r.text.slice(0, 120)}`);
  }

  // Also give STORE-01 (the seeded realistic store) a key for the desktop onboarding scenario.
  const seed1 = sql("select id from stores where code='STORE-01'");
  if (seed1.length) {
    const r = await api('POST', `/api/admin/stores/${seed1[0].id}/regenerate-key`, {}, { token: adminToken });
    manifest.stores['STORE-01'] = { id: Number(seed1[0].id), activation_key: r.json?.activation_key ?? null };
  }

  // ---------- 3. Register one workstation per QA store (device + counter) ----------
  for (const [code, s] of Object.entries(manifest.stores)) {
    if (!s.activation_key) continue;
    const existing = sql(`select id, counter_code, counter_name from counters where store_id=${s.id}`);
    if (existing.length) { s.counters = existing.map(c => Number(c.id)); }
    const created = [];
    for (let n = 1; n <= (code === 'QA-A' ? 3 : 1); n++) {
      const uuid = `qa_${code.toLowerCase()}_dev_${n}`;
      const dup = sql(`select id, counter_code from counters where store_id=${s.id} and device_uuid='${uuid}'`);
      if (dup.length) { created.push({ id: Number(dup[0].id), counter_code: dup[0].counter_code }); continue; }
      const r = await api('POST', '/api/devices/register', {
        activation_key: s.activation_key,
        device_uuid: uuid,
        device_name: `QA ${code} Machine ${n}`,
        is_hub: n === 1,
        app_version: '2.0.36',
        location_name: `QA Floor ${n}`,
      });
      if (r.status !== 200 && r.status !== 201) { log(`WARN register ${code}#${n} ${r.status} ${r.text.slice(0, 150)}`); continue; }
      created.push({ id: r.json.counter_id, counter_code: r.json.counter_code, counter_name: r.json.counter_name, device_token: r.json.device_token });
    }
    s.counters = created.map(c => c.id);
    s.counter_codes = created.map(c => c.counter_code);
    s.device_tokens = created.map(c => c.device_token).filter(Boolean);
    log(`${code}: counters=${JSON.stringify(s.counter_codes)}`);
  }

  // ---------- 4. Staff users per QA store ----------
  const roles = [
    { suffix: 'owner', role: 'store_owner', pin: '9101' },
    { suffix: 'mgr', role: 'manager', pin: '9202' },
    { suffix: 'cash', role: 'cashier', pin: '9303' },
    { suffix: 'pur', role: 'operator', pin: '9404' },
    { suffix: 'acct', role: 'accountant', pin: '9505' },
  ];
  for (const [code, s] of Object.entries(manifest.stores)) {
    if (!code.startsWith('QA-')) continue;
    s.users = {};
    for (const r of roles) {
      const uname = `${code.toLowerCase().replace('-', '')}_${r.suffix}`.toUpperCase().toLowerCase();
      const email = `${uname}@qa.example`;
      const found = sql(`select id from users where email='${email}'`);
      if (found.length) { s.users[r.suffix] = { id: Number(found[0].id), username: uname, pin: r.pin, password: 'qaPass123' }; continue; }
      const res = await api('POST', '/api/admin/users', {
        name: `QA ${code} ${r.suffix}`, email, username: uname, password: 'qaPass123', pin: r.pin,
        role: r.role, store_id: s.id, idle_timeout_minutes: 30, max_failed_logins: 5,
      }, { token: adminToken });
      if (res.status !== 200 && res.status !== 201) { log(`WARN user ${email} ${res.status} ${res.text.slice(0, 140)}`); continue; }
      s.users[r.suffix] = { id: Number(res.json.id), username: uname, pin: r.pin, password: 'qaPass123' };
    }
    // one locked-out-prone cashier for lockout tests
    const lockedEmail = `${code.toLowerCase().replace('-', '')}_locky@qa.example`;
    const lf = sql(`select id from users where email='${lockedEmail}'`);
    if (!lf.length) {
      const res = await api('POST', '/api/admin/users', { name: `QA ${code} Locky`, email: lockedEmail, username: lockedEmail.split('@')[0], password: 'qaPass123', pin: '9606', role: 'cashier', store_id: s.id, max_failed_logins: 3 }, { token: adminToken });
      if (res.json?.id) s.users.locky = { id: Number(res.json.id), username: lockedEmail.split('@')[0], pin: '9606', password: 'qaPass123', max_failed_logins: 3 };
    } else s.users.locky = { id: Number(lf[0].id), pin: '9606', password: 'qaPass123', max_failed_logins: 3 };
    log(`${code}: users=${Object.keys(s.users).join(',')}`);
  }

  // ---------- 5. Controlled catalogue (exact paisa values) ----------
  // price points chosen to expose rounding bugs: repeating decimals, .xx5 halves, 0%, 5/12/18/28%, pack vs loose.
  const catalogue = [
    { sku: 'QA-DOLO650', name: 'QA Dolo 650 Tablet (Strip of 10)', barcode: '8901111100001', mrp: 32.00, sel_rate: 30.00, gst_percent: 12, units_per_pack: 10, hsn_sac_code: '30049099', category: 'Tablet' },
    { sku: 'QA-CROCIN', name: 'QA Crocin 500 Tablet (Pack of 20)', barcode: '8901111100002', mrp: 60.00, sel_rate: 55.00, gst_percent: 5, units_per_pack: 20, hsn_sac_code: '30041090', category: 'Tablet' },
    { sku: 'QA-ABSYRUP', name: 'QA Antibiotic Syrup 200ml', barcode: '8901111100003', mrp: 215.00, sel_rate: 200.00, gst_percent: 18, units_per_pack: 1, hsn_sac_code: '30049099', category: 'Syrup' },
    { sku: 'QA-SANIT', name: 'QA Hand Sanitizer 500ml (Case of 6)', barcode: '8901111100004', mrp: 99.99, sel_rate: 95.00, gst_percent: 28, units_per_pack: 6, hsn_sac_code: '34029090', category: 'Hygiene' },
    { sku: 'QA-EXEMPT', name: 'QA Exempt Nutritional Food 1kg', barcode: '8901111100005', mrp: 150.00, sel_rate: 140.00, gst_percent: 0, units_per_pack: 1, hsn_sac_code: '21069090', category: 'Food' },
    { sku: 'QA-BOX24', name: 'QA Oral Rehydration Sachet (Box of 24)', barcode: '8901111100006', mrp: 12.50, sel_rate: 12.00, gst_percent: 12, units_per_pack: 24, hsn_sac_code: '30049099', category: 'Sachet' },
    { sku: 'QA-P333', name: 'QA Precision Item 33.33', barcode: '8901111100007', mrp: 33.33, sel_rate: 33.33, gst_percent: 18, units_per_pack: 1, hsn_sac_code: '99999999', category: 'Test' },
    { sku: 'QA-HALF', name: 'QA Half-Paisa Rounding Item', barcode: '8901111100008', mrp: 10.075, sel_rate: 10.075, gst_percent: 12, units_per_pack: 1, hsn_sac_code: '99999999', category: 'Test' },
    { sku: 'QA-SURG', name: 'QA Surgical Gloves Box (100)', barcode: '8901111100009', mrp: 499.99, sel_rate: 450.50, gst_percent: 12, units_per_pack: 100, hsn_sac_code: '39262090', category: 'Device' },
  ];
  const batchPlan = { 'QA-DOLO650': 3, 'QA-CROCIN': 2, 'QA-ABSYRUP': 2, 'QA-SANIT': 2, 'QA-EXEMPT': 1, 'QA-BOX24': 3, 'QA-P333': 2, 'QA-HALF': 2, 'QA-SURG': 2 };

  for (const [code, s] of Object.entries(manifest.stores)) {
    if (!code.startsWith('QA-')) continue;
    s.products = {};
    const token = await staffToken(s, 'pur');
    for (const p of catalogue) {
      const dup = sql(`select id from products where store_id=${s.id} and barcode='${p.barcode}'`);
      if (dup.length) { s.products[p.sku] = { id: Number(dup[0].id), ...p, batches: [] }; continue; }
      // NOTE: POST /api/products (POS group) is structurally broken — it 500s because store_id is
      // not in its validation list, so no client can create a product through it. Fixtures use the
      // admin endpoint, which requires store_id. See defect group SEC/API in the report.
      const r = await api('POST', '/api/admin/products', { ...p, store_id: s.id }, { token: adminToken, storeId: s.id });
      if (r.status >= 400) { log(`WARN product ${p.sku} ${code} -> ${r.status} ${r.text.slice(0, 160)}`); continue; }
      const pid = Number(r.json.id);
      s.products[p.sku] = { id: pid, ...p, store_id_as_returned: r.json.store_id, batches: [] };
      if (String(r.json.store_id) !== String(s.id)) log(`!! TENANT BUG: product ${p.sku} created for store ${code}(${s.id}) but stored store_id=${r.json.store_id}`);
    }
    log(`${code}: products=${Object.keys(s.products).length}`);
  }

  async function staffToken(store, roleSuffix) {
    const u = store.users?.[roleSuffix] || store.users?.cash;
    if (!u) throw new Error('no staff user for ' + JSON.stringify(Object.keys(store.users || {})));
    const r = await api('POST', '/api/staff/login', { store_id: store.id, username: u.username, pin: u.pin, counter_id: store.counters?.[0] });
    if (r.status !== 200 || !r.json?.token) throw new Error(`staff login failed for ${u.username}: ${r.status} ${r.text.slice(0, 200)}`);
    return r.json.token;
  }
  manifest.staffToken = staffToken;

  // ---------- 6. Parties: B2B intra, B2B inter, B2C credit ----------
  const partyDefs = [
    { store: 'QA-A', party_type: 'supplier', name: 'QA Supplier Kerala Pvt Ltd', gstin: '32AAAAA0000QS9Z9', state_code: '32', phone: '9800000001' },
    { store: 'QA-A', party_type: 'supplier', name: 'QA Supplier Maharashtra Ltd', gstin: '27AAAAA0000QS8Z8', state_code: '27', phone: '9800000002' },
    { store: 'QA-A', party_type: 'customer', name: 'QA B2B Kerala Clinic', gstin: '32AAAAA0000QK7Z7', state_code: '32', phone: '9800000003' },
    { store: 'QA-A', party_type: 'customer', name: 'QA B2B Delhi Hospital', gstin: '07AAAAA0000QJ6Z6', state_code: '07', phone: '9800000004' },
    { store: 'QA-A', party_type: 'customer', name: 'QA Credit Customer (no gstin)', gstin: null, state_code: '32', phone: '9800000005' },
    { store: 'QA-E', party_type: 'supplier', name: 'QA Supplier Kerala For MH', gstin: '32AAAAA0000QS9Z9', state_code: '32', phone: '9800000006' },
    { store: 'QA-B', party_type: 'supplier', name: 'QA Kirana Supplier', gstin: '32AAAAA0000QK5Z5', state_code: '32', phone: '9800000007' },
  ];
  for (const pd of partyDefs) {
    const s = manifest.stores[pd.store];
    if (!s) continue;
    const dup = sql(`select id from parties where store_id=${s.id} and name='${pd.name.replace(/'/g, "''")}'`);
    if (dup.length) { manifest.parties[pd.name] = { id: Number(dup[0].id), store: pd.store }; continue; }
    const payload = {
      type: pd.party_type, name: pd.name, gstin: pd.gstin, state_code: pd.state_code ? String(pd.state_code) : null,
      phone: pd.phone, store_id: s.id, credit_limit: pd.party_type === 'customer' ? 5000 : 0, opening_balance: 0,
    };
    // parties.phone/gstin/pan/email are NOT NULL with '' defaults, so an explicit null 500s.
    for (const k of Object.keys(payload)) if (payload[k] === null) delete payload[k];
    const r = await api('POST', '/api/admin/parties', payload, { token: adminToken, storeId: s.id });
    if (r.status >= 400) { log(`WARN party ${pd.name} ${r.status} ${r.text.slice(0, 200)}`); continue; }
    manifest.parties[pd.name] = { id: Number(r.json.id ?? r.json.party?.id), store: pd.store, as_returned: { store_id: r.json.store_id, type: r.json.type } };
  }

  // A doctor + patient party on the pharmacy store (QA-A) and an attempt on the general
  // store (QA-B) so the store-type rule can be probed from both the UI and the API.
  const clinical = [
    { store: 'QA-A', type: 'doctor', name: 'QA Dr. Menon (pharmacy store)' },
    { store: 'QA-A', type: 'patient', name: 'QA Patient Nair (pharmacy store)' },
    { store: 'QA-B', type: 'doctor', name: 'QA Dr. WrongStore (general store)' },
  ];
  manifest.clinical_probes = [];
  for (const c of clinical) {
    const s = manifest.stores[c.store];
    const r = await api('POST', '/api/admin/parties', { type: c.type, name: c.name, store_id: s.id, state_code: '32' }, { token: adminToken, storeId: s.id });
    manifest.clinical_probes.push({ store: c.store, type: c.type, status: r.status, body: r.text.slice(0, 200) });
    if (r.json?.id) manifest.parties[c.name] = { id: Number(r.json.id), store: c.store };
  }

  // ---------- 7. Opening stock through real purchase entries (exercises stock-in path) ----------
  // Two batches per product: one fresh, one near-expiry, so FEFO selection and batch-specific
  // stock reduction can be asserted deterministically.
  manifest.stock_plan = {};
  for (const [code, s] of Object.entries(manifest.stores)) {
    if (!code.startsWith('QA-')) continue;
    const skus = Object.keys(s.products || {});
    if (!skus.length) { log(`${code}: no products, skipping purchases`); continue; }
    const supName = code === 'QA-E' ? 'QA Supplier Kerala For MH' : (code === 'QA-B' ? 'QA Kirana Supplier' : 'QA Supplier Kerala Pvt Ltd');
    const sup = manifest.parties[supName];
    const token = await staffToken(s, 'pur');
    const mkLines = (start) => skus.map((sku, i) => {
      const p = s.products[sku];
      return {
        product_id: p.id, product_name: p.name,
        batch_no: `${code}-B${start + (i % 2)}`, expiry_date: (start === 1 ? '2028-06-30' : '2026-12-20'),
        pack_qty: 0, loose_qty: 0, qty: 0,
        units_per_pack: p.units_per_pack || 1,
        purchase_rate: p.sel_rate, mrp: p.mrp, gst_percent: p.gst_percent,
      };
    });
    const results = [];
    for (const [start, qtyEach] of [[1, 120], [2, 60]]) {
      const lines = mkLines(start).map(l => ({ ...l, loose_qty: qtyEach, qty: qtyEach }));
      const r = await api('POST', '/api/purchases', {
        store_id: s.id, supplier_id: sup?.id ?? null, supplier_name: supName,
        supplier_gstin: code === 'QA-E' ? '32AAAAA0000QS9Z9' : '32AAAAA0000QS9Z9',
        invoice_number: `QAPUR-${code}-${start}`, invoice_date: '2026-11-01',
        lines, is_interstate: false,
      }, { token, storeId: s.id });
      results.push({ invoice: `QAPUR-${code}-${start}`, status: r.status, body: r.status >= 400 ? r.text.slice(0, 300) : undefined, json: r.status < 400 ? r.json : undefined });
      if (r.status >= 400) log(`WARN purchase ${code}/${start} -> ${r.status} ${r.text.slice(0, 250)}`);
    }
    manifest.stock_plan[code] = { purchases: results.map(x => ({ invoice: x.invoice, status: x.status, number: x.json?.invoice?.invoice_number ?? x.json?.invoice_number ?? null })) };
    log(`${code}: purchase entries status=${results.map(x => x.status).join('/')}`);
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  log(`manifest written -> ${MANIFEST}`);
  log(`stores: ${Object.keys(manifest.stores).length}, products per QA store: ${Object.entries(manifest.stores).filter(([k]) => k.startsWith('QA-')).map(([, v]) => Object.keys(v.products || {}).length).join('/')}`);
}

main().catch(e => { console.error('BOOTSTRAP FAILED:', e.message); process.exit(1); });


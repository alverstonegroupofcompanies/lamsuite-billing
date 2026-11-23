/**
 * QA round 3 (build 2.1.1) shared helpers.
 * Throwaway environment only: backend 127.0.0.1:8000 on tests/qa/r3/r3.sqlite, fake data.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKEND = process.env.QA_BACKEND || 'http://127.0.0.1:8000';
const DB = path.resolve(__dirname, 'r3.sqlite');
const EVID = path.resolve(__dirname, 'evidence');
const STATE = path.resolve(__dirname, 'state.json');
if (!fs.existsSync(EVID)) fs.mkdirSync(EVID, { recursive: true });

if (!/127\.0\.0\.1|localhost/.test(BACKEND)) throw new Error('refusing non-local backend');

/** Read-only SQL against the throwaway DB. */
function sql(q) {
  if (!/^\s*(select|with|pragma)/i.test(q)) throw new Error('read-only sql only');
  const out = execFileSync('sqlite3', ['-json', '-readonly', DB, q], { encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : [];
}
const one = (q) => { const r = sql(q); return r.length ? Object.values(r[0])[0] : null; };

async function api(method, url, body, o = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.device) headers['X-Device-Token'] = o.device;
  if (o.store) headers['X-Store-Id'] = String(o.store);
  Object.assign(headers, o.headers || {});
  const t0 = Date.now();
  const res = await fetch(BACKEND + '/api' + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text: text.length > 3000 ? text.slice(0, 3000) + '…' : text, ms: Date.now() - t0 };
}

const state = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {});
const saveState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const evidence = (name, obj) => { fs.writeFileSync(path.join(EVID, name + '.json'), JSON.stringify(obj, null, 2)); return `tests/qa/r3/evidence/${name}.json`; };

async function adminToken() {
  const s = state();
  if (s.adminToken) {
    const chk = await api('GET', '/admin/stores', undefined, { token: s.adminToken });
    if (chk.status === 200) return s.adminToken;
  }
  const r = await api('POST', '/login', { email: 'admin@lamstone.in', password: process.env.QA_ADMIN_PASS || 'Qa-Throwaway-2026!' });
  if (!r.json?.token) throw new Error('admin login failed ' + r.status + ' ' + r.text);
  s.adminToken = r.json.token; saveState(s);
  return r.json.token;
}

/* ---------- independent money oracle: exact integer paise (BigInt) ---------- */
// Values are given as decimal strings or numbers; converted to paise without float math.
function P(v) {
  const s = String(v).trim();
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const frac = (f + '000').slice(0, 3); // keep 3 digits then half-up to 2
  let p = BigInt(i || '0') * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) p += 1n;
  return neg ? -p : p;
}
const R = (p) => { const n = p < 0n; const a = n ? -p : p; return (n ? '-' : '') + (a / 100n) + '.' + String(a % 100n).padStart(2, '0'); };
/** round(a/b) half-up on BigInt */
const divRound = (a, b) => { const n = (a < 0n) !== (b < 0n); a = a < 0n ? -a : a; b = b < 0n ? -b : b; const q = (2n * a + b) / (2n * b); return n ? -q : q; };
/** Inclusive line: gross paise, rate in basis points (12% = 1200). Returns taxable, tax, cgst, sgst. */
function inclusive(grossP, rateBp) {
  const taxable = divRound(grossP * 10000n, 10000n + BigInt(rateBp));
  const tax = grossP - taxable;
  const cgst = divRound(tax, 2n); const sgst = tax - cgst;
  return { taxable, tax, cgst, sgst, total: grossP };
}
function exclusive(taxableP, rateBp) {
  const half = divRound(taxableP * BigInt(rateBp), 20000n);
  return { taxable: taxableP, cgst: half, sgst: half, tax: 2n * half, total: taxableP + 2n * half };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { BACKEND, DB, sql, one, api, state, saveState, evidence, adminToken, P, R, divRound, inclusive, exclusive, sleep };

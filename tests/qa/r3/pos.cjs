// POS (till) helpers: open a till in Chrome, claim a counter with a code, read screen state.
const { newSession } = require('./driver.cjs');
const { api, adminToken, sleep } = require('./lib.cjs');

async function issueCode(counterId, storeId, ttl) {
  const t = await adminToken();
  const r = await api('POST', `/admin/counters/${counterId}/activation-code`, ttl ? { ttl_hours: ttl } : {}, { token: t, store: storeId });
  if (r.status === 422 && /counter_not_unclaimed/.test(r.text)) {
    const q = await api('POST', `/admin/counters/${counterId}/reissue`, ttl ? { ttl_hours: ttl } : {}, { token: t, store: storeId });
    if (q.status !== 200) throw new Error('reissue failed ' + q.status + q.text);
    issueCode.last = q.json; return q.json.code;
  }
  if (r.status !== 200) throw new Error('issue code failed ' + r.status + r.text);
  issueCode.last = r.json; return r.json.code;
}

async function openTill(name, viewport = { width: 1366, height: 768 }) {
  const s = await newSession(name, { viewport });
  await sleep(3000);
  return s;
}

/** Type a code into the activation screen like a user and press Enter. Returns screen text and claim call. */
async function enterCode(s, code) {
  const n0 = s.net.length;
  await s.typeInto('#counter-activation-code', code, { delay: 5 });
  await s.page.keyboard.press('Enter');
  await sleep(3500);
  const claim = s.net.slice(n0).filter((n) => /counters\/claim/.test(n.url)).map((n) => ({ st: n.status, req: n.post_data, res: n.response_body || '' }));
  const text = await s.text();
  return { claim, text };
}

async function claim(name, counterId, storeId, viewport) {
  const s = await openTill(name, viewport);
  const code = await issueCode(counterId, storeId);
  const r = await enterCode(s, code);
  // wait for the till shell to load
  for (let i = 0; i < 10; i++) { const t = await s.text(); if (!/Enter the counter activation code/.test(t)) break; await sleep(1000); }
  await sleep(2500);
  s.claimResult = r; s.counterId = counterId; s.storeId = storeId;
  return s;
}

/** Device token the till holds (from the claim response), for API cross-checks as the counter. */
function deviceTokenOf(s) {
  try { return JSON.parse(s.claimResult.claim[0].res).device_token; } catch { return null; }
}

module.exports = { issueCode, openTill, enterCode, claim, deviceTokenOf };

// J10.04 revoke (re-issue) a counter while its till is offline; on reconnect the till must lock; offline bill fate recorded
const { claim, issueCode } = require('./pos.cjs');
const { sql, evidence, sleep } = require('./lib.cjs');
async function put(s, v) { await s.page.evaluate(() => { const e = document.activeElement; try { e.select && e.select(); } catch { /* */ } }); await s.page.keyboard.type(String(v), { delay: 30 }); }
(async () => {
  const ev = {};
  const s = await claim('j10_04', 5, 5);                   // QA-CS C02
  await s.page.keyboard.press('F1'); await sleep(1000);
  s.goOffline(); await sleep(1500);
  // offline bill
  await s.page.keyboard.press('F1'); await sleep(400);
  await s.page.keyboard.type('QA Ruby', { delay: 40 }); await sleep(1300); await s.page.keyboard.press('Enter'); await sleep(800);
  if (/Select Batch/.test(await s.text())) { await s.page.keyboard.press('Enter'); await sleep(600); }
  await put(s, '1'); await s.page.keyboard.press('Enter'); await sleep(500);
  await s.page.keyboard.press('F12'); await sleep(1000);
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyS'); await s.page.keyboard.up('Control'); await sleep(3000);
  ev.offline_bill_screen = (await s.text()).split('\n').filter((l) => /Offline|C0\d-INV/.test(l)).slice(-3);
  // owner re-issues the counter (revokes this device) while it is offline
  await issueCode(5, 5);
  ev.counter_after_reissue = sql('select status,device_uuid,current_device_id from counters where id=5')[0];
  const before = sql('select count(*) n from invoices where store_id=5')[0].n;
  s.goOnline();
  await sleep(45000);
  ev.screen_after_reconnect = (await s.text()).split('\n').filter(Boolean).slice(0, 12);
  ev.locked = /activation code|locked|revoked|retired|not on a counter/i.test(ev.screen_after_reconnect.join(' '));
  ev.offline_bill_synced = sql('select count(*) n from invoices where store_id=5')[0].n - before;
  ev.calls = s.net.filter((n) => /sync\/push|heartbeat|profile-version|counter\/context/.test(n.url)).slice(-8).map((n) => n.method + ' ' + n.url.replace(/.*\/api/, '') + ' ' + n.status);
  await s.screenshot('j10_04_after_reconnect');
  console.log(JSON.stringify(ev).slice(0, 1800));
  evidence('J10_04_revoke_offline', ev);
  await s.close();
})();

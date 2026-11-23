// Look at the till POS screen after a claim on the isolated stack, step by step.
const { claim } = require('./pos.cjs');
const { sql, sleep } = require('./lib.cjs');

const dump = async (s, label, lines = 60) => {
  const t = (await s.text()).split('\n').map((l) => l.trim()).filter(Boolean);
  console.log(`\n----- ${label} -----\n${t.slice(0, lines).join(' | ')}`);
  console.log('inputs: ' + JSON.stringify((await s.controlInventory()).filter((c) => c.tag === 'INPUT' && !c.disabled).slice(0, 25)));
  console.log('writes: ' + JSON.stringify(s.net.filter((n) => n.method !== 'GET').slice(-4).map((n) => [n.method, n.url.replace('http://127.0.0.1:8100', ''), n.status])));
};

(async () => {
  const s = await claim('g10_look2', 3, 4);
  await dump(s, 'after claim', 20);
  const ok = await s.clickText('POS Billing');
  await sleep(3000);
  console.log('clickText POS Billing ->', ok);
  await dump(s, 'after nav POS Billing');
  await s.page.keyboard.press('F1'); await sleep(1500);
  await dump(s, 'after F1', 30);
  await s.page.keyboard.type('QA Cough Syrup', { delay: 30 }); await sleep(2000);
  await dump(s, 'after typing name', 40);
  await s.page.keyboard.press('Enter'); await sleep(1600);
  await dump(s, 'after Enter', 40);
  await s.screenshot('g10_look2_cart');
  await s.page.keyboard.press('F12'); await sleep(2000);
  await dump(s, 'after F12', 60);
  await s.screenshot('g10_look2_tender');
  await s.close();
  console.log('\nshifts: ' + JSON.stringify(sql("select id,counter_id,status,opening_float,cash_sales,expected_cash from counter_shifts order by id desc limit 3")));
})().catch((e) => { console.error('look error:', e.message); process.exit(1); });

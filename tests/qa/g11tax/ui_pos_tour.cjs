// Claim a till then tour key screens: dump visible controls + screenshot (selector discovery)
const { claim } = require('./pos.cjs');
const { sleep, evidence } = require('./lib.cjs');
(async () => {
  const [cid, sid] = [Number(process.env.CID || 2), Number(process.env.SID || 4)];
  const s = await claim('pos_tour', cid, sid);
  console.log('CLAIM', JSON.stringify(s.claimResult.claim.map((c) => c.st)));
  const out = {};
  const dump = async (label) => {
    const text = (await s.text()).split('\n').filter(Boolean);
    const ctrls = (await s.controls()).filter((c) => !c.disabled).map((c) => `${c.tag}:${c.type || ''}:${c.ph || c.aria || c.id || c.text}`);
    out[label] = { text: text.slice(0, 80), ctrls };
    console.log('\n=====', label, '\n', text.slice(0, 60).join(' | ').slice(0, 1800), '\n CTRLS', ctrls.slice(0, 60).join(' ; ').slice(0, 1800));
    await s.screenshot('tour_' + label);
  };
  await dump('home');
  for (const [label, key] of (process.env.KEYS || 'F1,F2').split(',').map((k) => [k, k])) {
    const parts = key.split('+');
    for (const p of parts.slice(0, -1)) await s.page.keyboard.down(p);
    await s.page.keyboard.press(parts[parts.length - 1]);
    for (const p of parts.slice(0, -1).reverse()) await s.page.keyboard.up(p);
    await sleep(2500);
    await dump(label.replace(/\W/g, '_'));
  }
  evidence('tour_' + (process.env.KEYS || 'F1,F2').replace(/\W/g, '_'), out);
  await s.close();
})();

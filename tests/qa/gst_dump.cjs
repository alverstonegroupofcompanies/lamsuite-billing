/**
 * Live DOM dump: sign in once per route and record the visible controls of the screens
 * the GST/stock run needs, so scenario code is written against the real UI.
 */
const { newSession, POS_URL } = require('./driver.cjs');
const { onboard, signInWithPin, navTo, sleep } = require('./pos_flow.cjs');

const KEY = process.env.QA_KEY || 'LAM-QAA-97814AFCF43A787D-F6323688';
const STORE = Number(process.env.QA_STORE || 4);
const PIN = process.env.QA_PIN || '9101';
const USER = process.env.QA_USER || 'qaa_owner';
const ROUTES = (process.env.QA_ROUTES || '/settings,/purchases,/bills,/returns/sales').split(',');

(async () => {
  for (const route of ROUTES) {
    const s = await newSession(`dump${route.replace(/\W/g, '')}${Date.now()}`, { url: POS_URL, stable: false });
    const ob = await onboard(s, KEY, `Dump ${route}`);
    const si = await signInWithPin(s, PIN, USER);
    const nav = await navTo(s, route);
    await sleep(2500);
    const inv = await s.controls();
    const text = (await s.text()).replace(/\n{3,}/g, '\n');
    console.log(`\n########## ${route} — onboard:${ob.ok} signin:${si.ok} nav:${nav.ok} path:${nav.path}`);
    await s.screenshot(`dump_${route}`);
    console.log('--- visible controls ---');
    console.log(inv.filter(c => !c.disabled).map(c => `${c.tag}:${c.type || ''}${c.ph ? ` ph="${c.ph}"` : ''}${c.aria ? ` aria="${c.aria}"` : ''} "${c.text}"`).slice(0, 60).join('\n'));
    console.log('--- screen text (first 1400) ---');
    console.log(text.slice(0, 1400));
    console.log('--- screen tail ---');
    console.log(text.slice(-700));
    await s.close();
  }
})().catch(e => { console.error('DUMP FAILED', e); process.exit(1); });

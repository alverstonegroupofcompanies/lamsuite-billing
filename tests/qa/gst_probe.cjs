/**
 * Smoke probe for the GST/stock regression run: onboard a workstation against the
 * throwaway QA backend, sign in, reach /pos and add one line. Prints what the screen says.
 */
const { newSession, POS_URL, BACKEND, sql } = require('./driver.cjs');
const { onboard, signInWithPin, navTo, sleep } = require('./pos_flow.cjs');
const { newBill, addProduct, setQty, readTotals } = require('./pos_ui.cjs');

const KEY = process.env.QA_KEY || 'LAM-QAA-97814AFCF43A787D-F6323688';
const STORE = Number(process.env.QA_STORE || 4);
const PIN = process.env.QA_PIN || '9101';
const USER = process.env.QA_USER || 'qaa_owner';

(async () => {
  const s = await newSession(`gstchk${STORE}`, { url: POS_URL, stable: true });
  console.log('POS_URL', POS_URL, 'BACKEND', BACKEND, 'store', STORE);
  const ob = await onboard(s, KEY, `GST Probe Counter ${STORE}`);
  console.log('onboard:', JSON.stringify(ob).slice(0, 200));
  const si = await signInWithPin(s, PIN, USER);
  console.log('signin:', JSON.stringify(si).slice(0, 300));
  const nav = await navTo(s, '/pos');
  console.log('nav /pos:', JSON.stringify(nav));
  console.log('products synced (server says store has):', sql(`select count(*) c from products where store_id=${STORE}`)[0].c);
  const no = await newBill(s);
  console.log('invoice no shown:', no);
  const r = await addProduct(s, 'QA Antibiotic Syrup');
  const id = r.ids[r.ids.length - 1];
  console.log('added line:', id, 'batchModal', r.batchModal, 'picked', r.pickedBatch);
  if (id) {
    await setQty(s, id, { packs: 2 });
    console.log('totals:', JSON.stringify(await readTotals(s)));
  }
  await s.screenshot('probe_pos');
  console.log('screen tail:\n' + (await s.text()).replace(/\n{3,}/g, '\n').slice(-900));
  await s.close();
})().catch(e => { console.error('PROBE FAILED', e); process.exit(1); });

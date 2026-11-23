const ADMIN = process.env.QA_ADMIN_URL || 'http://localhost:5174';
const { newSession } = require('./driver.cjs');
async function adminSession(name='admin', viewport) {
  const s = await newSession(name, { url: ADMIN, viewport });
  await new Promise(r=>setTimeout(r,1500));
  await s.typeInto('input[type=email]', 'admin@lamstone.in');
  await s.typeInto('input[type=password]', 'Qa-Throwaway-2026!');
  await s.page.keyboard.press('Enter');
  await new Promise(r=>setTimeout(r,3500));
  // label inventory helper: label text near each control
  s.labelled = () => s.page.evaluate(() => [...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent).map((el,i) => {
    let lab = el.labels && el.labels[0] ? el.labels[0].innerText : '';
    if (!lab) { const p = el.closest('div'); lab = p ? (p.querySelector('label')||{}).innerText||'' : ''; }
    return { i, tag: el.tagName, type: el.type, name: el.name, ph: el.placeholder, label: lab.trim().slice(0,60), value: el.value?.slice(0,40), options: el.tagName==='SELECT' ? [...el.options].map(o=>o.value+':'+o.text).slice(0,12) : undefined };
  }));
  s.nav = async (p) => { await s.page.goto(ADMIN + p, { waitUntil: 'domcontentloaded' }); await new Promise(r=>setTimeout(r,2500)); };
  return s;
}
module.exports = { adminSession };

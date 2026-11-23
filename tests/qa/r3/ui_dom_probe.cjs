// Print the smallest DOM container holding a text and its buttons (selector discovery)
const { adminSession } = require('./ui_admin_login.cjs');
(async () => {
  const [, , pathArg, needle] = process.argv;
  const s = await adminSession('dom_probe');
  await s.nav(pathArg);
  if (process.env.STORE) { await s.clickText('LamStone Healthcare Center'); await new Promise((r) => setTimeout(r, 600)); await s.clickText(process.env.STORE); await new Promise((r) => setTimeout(r, 2500)); }
  const info = await s.page.evaluate((needle) => {
    const all = [...document.querySelectorAll('body *')].filter((e) => e.innerText && e.innerText.includes(needle));
    const leaf = all.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    let c = leaf; while (c && c.querySelectorAll('button').length < 2) c = c.parentElement;
    return { tag: c.tagName, cls: c.className, text: c.innerText.slice(0, 400), buttons: [...c.querySelectorAll('button')].map((b) => ({ t: b.innerText.trim(), title: b.title, aria: b.getAttribute('aria-label') })) };
  }, needle);
  console.log(JSON.stringify(info, null, 1));
  console.log('PAGE HEAD', (await s.text()).split('\n').filter(Boolean).slice(-40).join(' | '));
  await s.close();
})();

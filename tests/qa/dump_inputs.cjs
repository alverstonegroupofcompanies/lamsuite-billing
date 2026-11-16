const { newSession } = require('./driver.cjs');
(async () => {
  const s = await newSession('dump', { url: 'http://localhost:5173' });
  await new Promise(r => setTimeout(r, 3000));
  const inputs = await s.page.evaluate(() => [...document.querySelectorAll('input,textarea,select,button')].map(el => ({
    tag: el.tagName, type: el.type || null, id: el.id || null, name: el.name || null,
    ph: el.placeholder || null, aria: el.getAttribute('aria-label'), text: (el.innerText || '').trim().slice(0, 50)
  })));
  console.log(JSON.stringify(inputs, null, 1));
  await s.close();
})().catch(e=>{console.error(e);process.exit(1)});

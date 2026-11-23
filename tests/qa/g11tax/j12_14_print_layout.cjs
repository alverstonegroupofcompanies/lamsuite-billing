// J12 print preview from Save & Print; paper sizes; J14 layout at 1366 and 1920 (overflow / clipped controls / placeholder text)
const { claim } = require('./pos.cjs');
const { sql, evidence, sleep } = require('./lib.cjs');
async function put(s, v) { await s.page.evaluate(() => { const e = document.activeElement; try { e.select && e.select(); } catch { /* */ } }); await s.page.keyboard.type(String(v), { delay: 30 }); }
const layout = (s) => s.page.evaluate(() => {
  const vw = window.innerWidth;
  const clipped = [...document.querySelectorAll('button,input,select,a')].filter((e) => { const r = e.getBoundingClientRect(); return e.offsetParent && r.width > 0 && (r.right > vw + 1 || r.left < -1); }).map((e) => (e.innerText || e.placeholder || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 40));
  const text = document.body.innerText;
  return { hscroll: document.documentElement.scrollWidth > vw + 1, scrollWidth: document.documentElement.scrollWidth, vw, clipped: clipped.slice(0, 15),
    placeholder_text: (text.match(/lorem ipsum|TODO|FIXME|demo data|sample store|test store|John Doe|Acme|placeholder/gi) || []).slice(0, 10) };
});
(async () => {
  const ev = { layouts: {} };
  for (const vp of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    const s = await claim(`j14_${vp.width}`, 2, 4, vp);
    for (const [name, key] of [['dashboard', null], ['billing', 'F1'], ['purchases', 'F2'], ['stock', 'F3'], ['reports', 'F4'], ['masters', 'F5'], ['bills', 'F6'], ['returns', 'F7'], ['counters', 'F8'], ['settings', 'F10']]) {
      if (key) { await s.page.keyboard.press(key); await sleep(1800); }
      ev.layouts[`${vp.width}_${name}`] = await layout(s);
      await s.screenshot(`j14_${vp.width}_${name}`);
    }
    if (vp.width === 1366) {
      // J12: sell one bottle and Save & Print (F12 inside settlement)
      await s.page.keyboard.press('F1'); await sleep(1200); await s.page.keyboard.press('F1'); await sleep(400);
      await s.page.keyboard.type('QA Cough', { delay: 40 }); await sleep(1300); await s.page.keyboard.press('Enter'); await sleep(800);
      if (/Select Batch/.test(await s.text())) { await s.page.keyboard.press('Enter'); await sleep(600); }
      await put(s, '1'); await s.page.keyboard.press('Enter'); await sleep(500);
      await s.page.keyboard.press('F12'); await sleep(1200);
      await s.page.keyboard.press('F12'); await sleep(4000);       // Save & Print
      const txt = await s.text();
      ev.print = {
        preview_open: /Print Document|PAPER SIZE|Printer/i.test(txt),
        has_rupee: txt.includes('₹'), store_name: txt.includes('QA Pharma Kochi'), gstin: txt.includes('32ABCDE1234F1Z5'),
        lines: txt.split('\n').filter((l) => /QA Cough|Total|CGST|SGST|Taxable|Round|INV|Printer|Driver|Port/i.test(l)).slice(0, 30),
      };
      await s.screenshot('j12_print_preview');
      const iframes = await s.page.$$eval('iframe', (f) => f.map((x) => x.srcdoc ? x.srcdoc.slice(0, 2000) : x.src));
      ev.print.iframes = iframes.slice(0, 2);
      // cycle paper sizes visible in the preview select(s)
      const sizes = [];
      for (const sel of await s.page.$$('select')) {
        const opts = await sel.evaluate((e) => [...e.options].map((o) => o.value + '|' + o.text));
        if (opts.some((o) => /Thermal|Dot Matrix|A4/.test(o))) {
          for (const o of opts.filter((x) => /Thermal 80|Dot Matrix 6|Dot Matrix 10|Dot Matrix 12|Dot Matrix 15|A4/.test(x))) {
            await sel.select(o.split('|')[0]); await sleep(900);
            const shot = `j12_paper_${o.split('|')[1].replace(/\W+/g, '_')}`; await s.screenshot(shot);
            sizes.push({ size: o.split('|')[1], has_rupee: (await s.text()).includes('₹') });
          }
        }
      }
      ev.print.sizes = sizes;
      const inv = sql("select invoice_number,grand_total,tax_total from invoices where store_id=4 order by id desc limit 1")[0];
      ev.print.saved_invoice = inv; ev.print.number_on_preview = txt.includes(inv.invoice_number);
      console.log('PRINT', JSON.stringify(ev.print).slice(0, 1500));
    }
    await s.close();
  }
  const bad = Object.entries(ev.layouts).filter(([, v]) => v.hscroll || v.clipped.length || v.placeholder_text.length);
  console.log('LAYOUT issues', JSON.stringify(bad).slice(0, 2500));
  evidence('J12_J14_print_layout', ev);
})();

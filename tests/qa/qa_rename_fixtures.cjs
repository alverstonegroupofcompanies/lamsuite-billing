/**
 * Fixture prep: the QA bootstrap created the same 9 SKUs, names and barcodes in all five QA
 * stores. Because the device's master-data pull is not store-scoped, a single POS workstation
 * ends up with five identical products and search cannot target one. Renaming through the admin
 * API makes the harness deterministic; the duplication itself is filed as evidence for the
 * unscoped-delta defect, not silently worked around.
 */
const { BACKEND } = require('./driver.cjs');
const fs = require('fs');
const manifest = require('./manifest.json');

const J = { 'Content-Type': 'application/json', Accept: 'application/json' };

(async () => {
  const login = await fetch(`${BACKEND}/api/login`, { method: 'POST', headers: J, body: JSON.stringify({ email: 'admin@lamstone.in', password: 'password123' }) }).then(r => r.json());
  const H = { ...J, Authorization: `Bearer ${login.token}` };
  const failed = [];

  for (const [code, store] of Object.entries(manifest.stores)) {
    if (!code.startsWith('QA-') || !store.products) continue;
    const tag = code.replace('QA-', ''); // A, B, C, D, E
    for (const [sku, p] of Object.entries(store.products)) {
      const body = {
        name: `${p.name} [${tag}]`,
        sku: `${sku}-${tag}`,
        barcode: `${p.barcode}${tag.charCodeAt(0) % 10}`,
        mrp: p.mrp, sel_rate: p.sel_rate, gst_percent: p.gst_percent,
        units_per_pack: p.units_per_pack, hsn_sac_code: p.hsn_sac_code,
        category: p.category, store_id: store.id,
      };
      const res = await fetch(`${BACKEND}/api/admin/products/${p.id}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
      const txt = await res.text();
      console.log(code, sku, res.status, res.status >= 400 ? txt.slice(0, 200) : body.name);
      if (res.status >= 400) failed.push({ code, sku, status: res.status, body: txt.slice(0, 300) });
    }
  }

  // remember the new display names so scenarios can search them
  for (const [code, store] of Object.entries(manifest.stores)) {
    if (!code.startsWith('QA-') || !store.products) continue;
    const tag = code.replace('QA-', '');
    for (const [sku, p] of Object.entries(store.products)) {
      p.search_name = `${p.name} [${tag}]`;
      p.search = p.search_name;
    }
  }
  fs.writeFileSync(__dirname + '/manifest.json', JSON.stringify(manifest, null, 2));
  console.log('manifest search names updated; failures:', failed.length, JSON.stringify(failed.slice(0, 3)));
})();

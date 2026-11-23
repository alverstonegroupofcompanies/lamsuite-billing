const { adminSession } = require('./ui_admin_login.cjs');
(async () => {
  const s = await adminSession('admin_counters');
  await s.nav('/counters');
  await s.clickText('LamStone Healthcare Center');
  await new Promise((r) => setTimeout(r, 1000));
  console.log('SWITCHER', (await s.text()).slice(-800));
  await s.screenshot('admin_store_switcher');
  await s.page.keyboard.press('Escape');
  await s.clickText('New counter');
  await new Promise((r) => setTimeout(r, 1000));
  console.log('FORM', JSON.stringify(await s.labelled()));
  console.log((await s.text()).slice(-1200));
  await s.screenshot('admin_new_counter');
  await s.close();
})();

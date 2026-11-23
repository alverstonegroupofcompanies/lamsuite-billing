const { adminSession } = require('./ui_admin_login.cjs');
(async () => {
  const s = await adminSession('admin_storeform');
  await s.nav('/stores');
  await s.clickText('Add Store Branch');
  await new Promise(r=>setTimeout(r,1500));
  console.log(JSON.stringify(await s.labelled(), null, 0));
  await s.screenshot('admin_store_form');
  console.log((await s.text()).slice(0,2500));
  await s.close();
})();

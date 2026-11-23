const { newSession } = require('./driver.cjs');
(async () => {
  const s = await newSession('pos_explore', { viewport: { width: 1366, height: 768 } });
  await new Promise((r) => setTimeout(r, 4000));
  console.log((await s.text()).slice(0, 1500));
  console.log(JSON.stringify(await s.controls()));
  await s.screenshot('pos_first_screen');
  console.log('BLOCKED', JSON.stringify(s.blockedExternal));
  console.log('NET', JSON.stringify(s.net.map((n) => n.method + ' ' + n.url + ' ' + n.status)));
  console.log('CONSOLE', JSON.stringify(s.consoleErrs.slice(0, 10)));
  await s.close();
})();

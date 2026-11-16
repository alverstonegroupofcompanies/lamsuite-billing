const puppeteer = require('./node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => console.log('  [POS Console]:', msg.text()));

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

  // Click Owner Login tab
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const text = await (await b.getProperty('innerText')).jsonValue();
    if (text.includes('Owner Login')) {
      await b.click();
      console.log('Clicked Owner Login tab');
      break;
    }
  }

  await new Promise(r => setTimeout(r, 600));

  // Click Complete Store Onboarding
  const submitBtn = await page.$('button[type="submit"]');
  if (submitBtn) {
    await submitBtn.click();
    console.log('Clicked Complete Store Onboarding button');
  }

  // Wait up to 10s for onboarding
  await page.waitForFunction(
    () => !document.body.innerText.includes('LamSuite Billing Setup') || document.body.innerText.includes('Terminal Locked') || document.body.innerText.includes('Enter PIN'),
    { timeout: 12000 }
  ).catch(() => {});

  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'test-reports/screenshots/pos_after_onboarding.png' });
  console.log('Page body after onboarding:\n', (await page.evaluate(() => document.body.innerText)).slice(0, 400));
  await browser.close();
})();

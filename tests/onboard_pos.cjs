const puppeteer = require('./node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => console.log('  [Console]:', msg.text()));

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  console.log('1. Page loaded:', page.url());

  // Click 'Owner Login' tab
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find(x => x.innerText.includes('Owner Login'));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 600));

  // Focus and type email
  const emailInput = await page.$('input[type="email"]');
  if (emailInput) {
    await emailInput.click({ clickCount: 3 });
    await emailInput.press('Backspace');
    await emailInput.type('owner@lamsuite.com');
  }

  // Focus and type password
  const passInput = await page.$('input[type="password"]');
  if (passInput) {
    await passInput.click({ clickCount: 3 });
    await passInput.press('Backspace');
    await passInput.type('owner123');
  }

  console.log('2. Entered owner credentials');
  await new Promise(r => setTimeout(r, 500));

  const submitBtn = await page.$('button[type="submit"]');
  if (submitBtn) {
    await submitBtn.click();
    console.log('3. Clicked Complete Store Onboarding');
  }

  // Wait 4 seconds and log page text
  await new Promise(r => setTimeout(r, 4000));
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('4. Page Body text after 4s:\n', bodyText);
  await page.screenshot({ path: 'test-reports/screenshots/debug_onboard_step.png' });
  await browser.close();
})().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});

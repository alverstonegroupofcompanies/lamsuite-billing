const puppeteer = require('./node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle0' });
  const title = await page.title();
  console.log('Admin Panel Page Loaded. Title:', title);
  await browser.close();
})();

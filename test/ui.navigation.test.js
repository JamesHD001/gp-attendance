const puppeteer = require('puppeteer-core');
const fs = require('fs');
const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ].filter(Boolean);

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

async function testPage(url) {
  console.log(`Testing ${url}`);
  const chromePath = findChromeExecutable();
  const launchOpts = { args: ['--no-sandbox'], headless: true };
  if (chromePath) launchOpts.executablePath = chromePath;
  else console.warn('No local Chrome executable found; set CHROME_PATH env var to the browser executable.');

  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(15000);
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err && err.toString()));

  await page.goto(url, { waitUntil: 'networkidle2' });

  // Wait for main content and sidebar
  await page.waitForSelector('.main-content', { timeout: 5000 });
  await page.waitForSelector('.sidebar .nav-link', { timeout: 5000 });

  // Ensure module initialized (tab buttons present)
  try {
    await page.waitForSelector('.tab-btn', { timeout: 4000 });
  } catch (e) {
    // continue; we'll still validate sidebar behavior
  }

  const navHrefs = await page.$$eval('.sidebar .nav-link', els => els.map(e => e.getAttribute('href')));
  if (!navHrefs.length) {
    console.error('No sidebar links found on', url);
    await browser.close();
    return false;
  }

  for (const href of navHrefs) {
    // Click the link
    await page.evaluate(h => {
      const a = document.querySelector(`.sidebar .nav-link[href="${h}"]`);
      if (a) a.click();
    }, href);

    await page.waitForTimeout(300);

    // Check link has active class
    const active = await page.$eval(`.sidebar .nav-link[href="${href}"]`, el => el.classList.contains('active'))
      .catch(() => false);

    if (!active) {
      console.error(`Link ${href} did not become active on ${url}`);
      await browser.close();
      return false;
    }

    // Check at least one visible tab-content
    const visibleTabs = await page.$$eval('.tab-content', els => els.filter(e => !e.classList.contains('hidden')).length)
      .catch(() => 0);

    if (visibleTabs === 0) {
      console.error(`No visible tab content after clicking ${href} on ${url}`);
      await browser.close();
      return false;
    }

    console.log(`Clicked ${href} OK`);
  }

  await browser.close();
  console.log(`Passed ${url}`);
  return true;
}

(async () => {
  const pages = [
    `${baseUrl}/pages/admin-dashboard.html`,
    `${baseUrl}/pages/instructor-dashboard.html`,
    `${baseUrl}/pages/leader-dashboard.html`
  ];

  let allOk = true;
  for (const p of pages) {
    const ok = await testPage(p);
    if (!ok) allOk = false;
  }

  if (!allOk) {
    console.error('One or more UI navigation tests failed');
    process.exitCode = 1;
  } else {
    console.log('All UI navigation tests passed');
  }
})();

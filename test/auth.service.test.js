const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3001';

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

async function runTest() {
  const chromePath = findChromeExecutable();
  const launchOpts = { args: ['--no-sandbox'], headless: true };
  if (chromePath) launchOpts.executablePath = chromePath;

  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  const results = {};
  page.on('console', msg => {
    const text = msg.text();
    console.log('PAGE LOG:', text);
    if (text.startsWith('TEST-PASS') || text.startsWith('TEST-FAIL') || text.startsWith('NOTIFY:')) {
      results[text] = true;
    }
  });

  page.on('pageerror', err => console.log('PAGE ERROR:', err && err.toString()));

  const url = `${baseUrl}/test/auth-test.html`;
  await page.goto(url, { waitUntil: 'load' });

  // Wait up to 2s for tests to appear
  await new Promise(resolve => setTimeout(resolve, 2000));

  await browser.close();

  const expected = ['TEST-PASS:hydration-current-user','TEST-PASS:hydration-pending-marker','TEST-PASS:missing-role','TEST-PASS:role-redirect-admin'];
  const ok = expected.every(k => Object.prototype.hasOwnProperty.call(results, k));
  if (!ok) {
    console.error('AuthService tests failed or incomplete. Collected logs:', Object.keys(results));
    process.exitCode = 1;
  } else {
    console.log('AuthService tests passed');
  }
}

runTest().catch(err => { console.error(err); process.exit(1); });

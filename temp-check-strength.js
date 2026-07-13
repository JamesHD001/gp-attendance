const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const url = 'http://127.0.0.1:3001/pages/instructor-dashboard.html';
const chromePaths = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].filter(Boolean);
const chromePath = chromePaths.find(p => fs.existsSync(p));
(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath || undefined,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log('Loaded DOMContentLoaded');
    await page.waitForSelector('.sidebar .nav-link[href="#settings"]', { timeout: 10000 });
    await page.click('.sidebar .nav-link[href="#settings"]');
    await page.waitForTimeout(2000);
    const meter = await page.$('.password-strength-meter');
    console.log('meter exists', !!meter);
    if (meter) {
      const html = await page.$eval('.password-strength-meter', el => el.outerHTML);
      console.log(html);
    }
  } catch (err) {
    console.error('ERROR', err.stack || err);
  } finally {
    await browser.close();
  }
})();

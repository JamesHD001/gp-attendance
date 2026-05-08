const puppeteer = require('puppeteer-core');
const fs = require('fs');

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3001';

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

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return null;
}

async function openInstructorPage(browser, isoInstant) {
  const page = await browser.newPage();
  const fixedTime = new Date(isoInstant).getTime();
  const pageErrors = [];
  const pageLogs = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error?.toString?.() || String(error));
  });

  page.on('console', (message) => {
    pageLogs.push(message.text());
  });

  await page.evaluateOnNewDocument((mockNow) => {
    const RealDate = Date;

    class MockDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) {
          super(mockNow);
          return;
        }
        super(...args);
      }

      static now() {
        return mockNow;
      }

      static parse(value) {
        return RealDate.parse(value);
      }

      static UTC(...args) {
        return RealDate.UTC(...args);
      }
    }

    Object.setPrototypeOf(MockDate, RealDate);
    globalThis.Date = MockDate;
    window.Date = MockDate;
  }, fixedTime);

  await page.goto(`${baseUrl}/pages/instructor-dashboard.html`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.tab-btn[data-tab="attendance"]', { timeout: 10000 });
  await page.waitForSelector('#studentsTab .text-muted', { timeout: 10000 });
  await page.click('.tab-btn[data-tab="attendance"]');
  await page.waitForSelector('#attendanceTab [data-attendance-lock-state]', { timeout: 10000 });

  return { page, pageErrors, pageLogs };
}

async function readAttendanceLockState(page) {
  return await page.evaluate(() => {
    const banner = document.querySelector('#attendanceTab [data-attendance-lock-state]');
    const button = document.getElementById('newSessionBtn');

    return {
      state: banner?.getAttribute('data-attendance-lock-state') || null,
      buttonDisabled: Boolean(button?.disabled),
      buttonLabel: button?.textContent?.trim() || '',
      bannerText: banner?.textContent?.replace(/\s+/g, ' ').trim() || ''
    };
  });
}

async function main() {
  const chromePath = findChromeExecutable();
  const launchOptions = { args: ['--no-sandbox'], headless: true };
  if (chromePath) {
    launchOptions.executablePath = chromePath;
  } else {
    console.warn('No local Chrome executable found; set CHROME_PATH to run the instructor attendance lock test.');
  }

  const browser = await puppeteer.launch(launchOptions);

  try {
    const beforeCutoff = await openInstructorPage(browser, '2026-05-08T14:30:00.000Z');
    const beforeState = await readAttendanceLockState(beforeCutoff.page);

    if (beforeCutoff.pageErrors.length) {
      throw new Error(`Before-cutoff page errors: ${beforeCutoff.pageErrors.join(' | ')} :: logs: ${beforeCutoff.pageLogs.join(' | ')}`);
    }

    if (beforeState.state !== 'open' || beforeState.buttonDisabled || beforeState.buttonLabel !== 'New Attendance Session') {
      throw new Error(`Expected attendance to be open before cutoff, received ${JSON.stringify(beforeState)}`);
    }

    if (!beforeState.bannerText.includes('4:00 PM Africa/Lagos')) {
      throw new Error(`Before-cutoff banner did not mention the cutoff: ${beforeState.bannerText}`);
    }

    await beforeCutoff.page.close();

    const afterCutoff = await openInstructorPage(browser, '2026-05-08T15:05:00.000Z');
    const afterState = await readAttendanceLockState(afterCutoff.page);

    if (afterCutoff.pageErrors.length) {
      throw new Error(`After-cutoff page errors: ${afterCutoff.pageErrors.join(' | ')} :: logs: ${afterCutoff.pageLogs.join(' | ')}`);
    }

    if (afterState.state !== 'locked' || !afterState.buttonDisabled || afterState.buttonLabel !== 'Attendance Locked') {
      throw new Error(`Expected attendance to be locked after cutoff, received ${JSON.stringify(afterState)}`);
    }

    if (!afterState.bannerText.includes('cannot mark or change attendance after 4:00 PM')) {
      throw new Error(`After-cutoff banner did not explain the lock: ${afterState.bannerText}`);
    }

    await afterCutoff.page.close();
    console.log('Instructor attendance lock UI test passed');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

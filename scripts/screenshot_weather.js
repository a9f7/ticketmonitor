const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '../dist/gba-summer/index.html');
const outDir = process.argv[3] || path.join(__dirname, '../screenshots');
fs.mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'ipad', width: 820, height: 1180, isMobile: false },
  { name: 'iphone', width: 390, height: 844, isMobile: true, deviceScaleFactor: 3 },
];

(async () => {
  const browser = await chromium.launch();
  const url = 'file:///' + path.resolve(file).replace(/\\/g, '/');
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, deviceScaleFactor: vp.deviceScaleFactor || 1 });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    // Scroll to weather section and expand first row
    const weatherSec = await page.$('#weatherSec, .wmain');
    if (weatherSec) {
      await weatherSec.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }
    const firstRow = await page.$('.wrow');
    if (firstRow) {
      await firstRow.click({ force: true });
      await page.waitForTimeout(400);
    }
    const shotPath = path.join(outDir, `weather_${vp.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log('saved', shotPath);
    await context.close();
  }
  await browser.close();
})();

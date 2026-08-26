const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const outDir = path.join(__dirname, '../screenshots');
fs.mkdirSync(outDir, { recursive: true });

const params = ['', 'map=1', 'view=map', 'display=map', 'showMap=1', 'isMap=true'];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });

  for (const p of params) {
    const url = 'https://m.ctrip.com/webapp/hotel/searchlist/31.5965535/130.5571158/?city=735&checkin=2026-11-18&checkout=2026-11-25' + (p ? '&' + p : '');
    await page.goto(url, { waitUntil: 'networkidle2' });
    await sleep(3000);
    const file = path.join(outDir, 'ctrip_h5_' + (p || 'none') + '.png');
    await page.screenshot({ path: file, fullPage: false });
    console.log('saved', file);
  }

  await browser.close();
})();

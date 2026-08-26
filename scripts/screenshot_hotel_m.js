const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const outDir = path.join(__dirname, '../screenshots');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('https://m.ctrip.com/webapp/hotel/list?city=315&checkin=2026-09-23&checkout=2026-09-30', { waitUntil: 'networkidle2' });
  await sleep(5000);
  const shotPath = path.join(outDir, 'hotel_m_ctrip_desktop.png');
  await page.screenshot({ path: shotPath, fullPage: false });
  console.log('saved', shotPath);
  await browser.close();
})();

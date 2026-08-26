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

  // PC list page
  await page.goto('https://hotels.ctrip.com/hotels/list?city=735&checkIn=2026-11-18&checkOut=2026-11-25', { waitUntil: 'networkidle2' });
  await sleep(3000);
  await page.screenshot({ path: path.join(outDir, 'ctrip_pc_list.png'), fullPage: false });
  console.log('saved ctrip_pc_list.png');

  // H5 map search page
  await page.goto('https://m.ctrip.com/webapp/hotel/searchlist/31.5965535/130.5571158/?city=735&checkin=2026-11-18&checkout=2026-11-25', { waitUntil: 'networkidle2' });
  await sleep(3000);
  await page.screenshot({ path: path.join(outDir, 'ctrip_h5_map.png'), fullPage: false });
  console.log('saved ctrip_h5_map.png');

  await browser.close();
})();

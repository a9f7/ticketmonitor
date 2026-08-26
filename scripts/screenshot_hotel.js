const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const file = process.argv[2] || path.join(__dirname, '../dist/global-year/index.html');
const outDir = process.argv[3] || path.join(__dirname, '../screenshots');
fs.mkdirSync(outDir, { recursive: true });

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'ipad', width: 820, height: 1180, isMobile: false },
  { name: 'iphone', width: 390, height: 844, isMobile: true, deviceScaleFactor: 3 },
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const url = 'file:///' + path.resolve(file).replace(/\\/g, '/');
  for (const vp of viewports) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.deviceScaleFactor || 1, isMobile: vp.isMobile });
    await page.goto(url, { waitUntil: 'networkidle2' });
    await sleep(1200);

    // 滚动到酒店区并点击第一个目的地，再切到携程 tab
    const hotelSec = await page.$('#hotelSec, .hotel-sec');
    if (hotelSec) await hotelSec.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await sleep(400);

    const firstItem = await page.$('.item[data-key]');
    if (firstItem) {
      await firstItem.evaluate(el => el.click());
      await sleep(800);
    }

    // 1) 在「自做标点」视图下截图，验证分类标签在 tab 行右侧
    const leafletTab = await page.$('.hvtab[data-view="leaflet"]');
    if (leafletTab) {
      await leafletTab.evaluate(el => el.click());
      await sleep(800);
    }

    const shotLeaflet = path.join(outDir, `hotel_global_${vp.name}_leaflet.png`);
    await page.screenshot({ path: shotLeaflet, fullPage: false });
    console.log('saved', shotLeaflet);

    // 2) 切到携程视图，验证分类标签隐藏
    const tripTab = await page.$('.hvtab[data-view="trip"]');
    if (tripTab) {
      await tripTab.evaluate(el => el.click());
      await sleep(3000);
      try {
        await page.waitForFunction(() => {
          const f = document.getElementById('hotelTrip');
          return f && f.src && f.src !== 'about:blank';
        }, { timeout: 5000 });
      } catch (_e) {}
      await sleep(3000);
    }

    const shotTrip = path.join(outDir, `hotel_global_${vp.name}_trip.png`);
    await page.screenshot({ path: shotTrip, fullPage: false });
    console.log('saved', shotTrip);
    await page.close();
  }
  await browser.close();
})();

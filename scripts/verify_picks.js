const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE = path.resolve(process.argv[2] || 'dist/global-year/index.html');

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async ()=>{
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args:['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('file:///'+FILE, { waitUntil:'networkidle2' });
  await sleep(1200);

  // 1. 默认大湾区： picks 应存在
  let picks = await page.$$eval('.pick', els => els.map(e => ({
    city: e.querySelector('.pick-city')?.textContent,
    sub: e.querySelector('.pick-sub')?.textContent,
    tier: e.querySelector('.pick-hd .tag')?.textContent
  })));
  console.log('初始 picks 数量:', picks.length);
  picks.forEach(p=>console.log('  ', p.tier, p.city, '|', p.sub));

  async function logState(label){
    const stickyText = await page.$eval('#ssCurrent', e=>e.textContent);
    const originVal = await page.$eval('#ssOriginSelect', e=>e.value);
    const destVal = await page.$eval('#ssSelect', e=>e.value);
    console.log(`\n${label}:`);
    console.log('  sticky current:', stickyText);
    console.log('  origin select:', originVal);
    console.log('  dest select:', destVal);
  }

  // 2. 通过 sticky 出发地选择器切到香港(HKG)
  await page.select('#ssOriginSelect', 'HKG');
  await sleep(600);
  await logState('切到香港(HKG)后');
  picks = await page.$$eval('.pick', els => els.map(e => ({
    city: e.querySelector('.pick-city')?.textContent,
    sub: e.querySelector('.pick-sub')?.textContent,
    tier: e.querySelector('.pick-hd .tag')?.textContent
  })));
  console.log('picks:'); picks.forEach(p=>console.log('  ', p.tier, p.city, '|', p.sub));
  const allFromHKG = picks.every(p => p.sub && p.sub.includes('中国香港'));
  console.log('是否全部从中国香港出发:', allFromHKG);

  // 3. 点击最后一个（最贵档）pick，通常与默认目的地不同
  const pickEls = await page.$$('.pick');
  const targetPick = pickEls[pickEls.length-1];
  if(targetPick){
    const targetCity = await targetPick.$eval('.pick-city', e=>e.textContent);
    await targetPick.click();
    await sleep(600);
    await logState('点击 '+targetCity+' 推荐位后');

    // 4. 点击空白处（页面顶部标题区）
    await page.click('h1');
    await sleep(600);
    await logState('点击空白处恢复后');
  }

  await browser.close();
})();

// jsdom 渲染自检: 确认页面无 JS 报错, 且携程 embed 指向 hotels.ctrip.com 或 trip.com 并带正确 city/日期
// 用法: node test_render.js <moduleId> [目的地IATA...]
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const mod = process.argv[2] || 'gba-summer';
const wantDests = process.argv.slice(3);
const file = path.join(__dirname, '..', 'dist', mod, 'index.html');
const html = fs.readFileSync(file, 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'https://a9f7.github.io/ticketmonitor/' + mod + '/',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

setTimeout(async () => {
  const w = dom.window, d = w.document;
  console.log(`\n===== ${mod} =====`);
  console.log('JS 错误数:', errors.length);
  errors.slice(0, 8).forEach((e) => console.log('  ! ' + e));

  // 关键节点
  const ids = ['ssOriginSelect', 'ssSelect', 'hotelTrip', 'hotelBooking', 'hotelAirbnbWrap'];
  ids.forEach((i) => console.log('  #' + i + ': ' + (d.getElementById(i) ? '✓' : '✗')));

  const sel = d.getElementById('ssSelect');
  if (!sel) { console.log('  !! 目的地下拉缺失'); return; }
  const opts = Array.from(sel.options).map((o) => o.value).filter(Boolean);
  console.log('  目的地数量:', opts.length);

  // 入参是目的地 IATA，映射到形如 "CAN->LJG" 的 route key
  const pick = (iata) => {
    const o = Array.from(sel.options).find((x) => x.value.endsWith('->' + iata));
    return o ? o.value : null;
  };
  const targets = wantDests.length
    ? wantDests.map(pick).filter(Boolean)
    : opts.slice(0, 4);
  const tripIframe = d.getElementById('hotelTrip');

  for (const code of targets) {
    if (!opts.includes(code)) { console.log(`  [${code}] 不在当前下拉中，跳过`); continue; }
    try {
      sel.value = code;
      sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    } catch (e) { console.log(`  [${code}] change 触发失败: ` + e.message); continue; }
    await sleep(200);   // 等过 about:blank -> 新 URL 的 30ms 重置窗口
    const src = (tripIframe && (tripIframe.src || tripIframe.getAttribute('src'))) || '';
    const okHost = src.includes('ctrip.com/hotels/list') || src.includes('trip.com/hotels/list');
    const hostLabel = src.includes('ctrip.com/hotels/list') ? '✓ctrip' : (src.includes('trip.com/hotels/list') ? '✓trip.com' : '✗');
    const mCity = src.match(/[?&]city=(\d+)/);
    const mIn = src.match(/checkIn=([\d-]+)/);
    const mOut = src.match(/checkOut=([\d-]+)/);
    console.log(
      `  [${code}] ${hostLabel}${okHost ? '' : src.slice(0, 50)}` +
      ` city=${mCity ? mCity[1] : '缺失'}` +
      ` in=${mIn ? mIn[1] : '缺失'} out=${mOut ? mOut[1] : '缺失'}`
    );
  }
  console.log(errors.length ? '\n❌ 存在 JS 错误' : '\n✅ 渲染无错误');
  dom.window.close();
}, 2500);

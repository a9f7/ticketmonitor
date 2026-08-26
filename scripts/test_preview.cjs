// 本地预览生成器：模拟"今天"为寒假日期，渲染大湾区寒暑期模块的冬季/春节专项效果。
// 完全隔离：先备份真实 data/gba-summer，生成冬季测试数据 -> 渲染 -> 复制独立预览 HTML -> 还原真实数据并重跑真实 build。
// 用法: node scripts/test_preview.cjs
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { seasonOffset } = require('./seasons');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'gba-summer');
const DIST = path.join(ROOT, 'dist', 'gba-summer');
const TEST_TODAY = '2027-01-15'; // 落在 2027 寒假窗口（1/1–3/1），春节 2027-02-06 → 专项 1/31~2/11

const dayParse = (s) => Date.parse(s + 'T00:00:00Z');
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
const SUM_START = dayParse('2026-07-01');
const WIN_START = dayParse('2027-01-01');
function shiftToWinter(s) {
  let r = Math.round((dayParse(s) - SUM_START) / 86400000);
  r = Math.max(0, Math.min(61, r)); // 暑假 62 天 → 映射到寒假 62 天
  return dayStr(WIN_START + r * 86400000);
}
function shiftPair(dep, ret) {
  const nd = shiftToWinter(dep);
  const span = Math.round((dayParse(ret) - dayParse(dep)) / 86400000);
  return [nd, dayStr(dayParse(nd) + span * 86400000)];
}
function median(a) {
  const x = [...a].sort((m, n) => m - n);
  const i = Math.floor(x.length / 2);
  return x.length % 2 ? x[i] : Math.round((x[i - 1] + x[i]) / 2);
}

// 1) 备份真实数据
const BAK = DATA + '.__bak__';
fs.cpSync(DATA, BAK, { recursive: true });

// 2) 读取真实暑假数据
const flights = JSON.parse(fs.readFileSync(path.join(DATA, 'flights.json'), 'utf8'));
const weather = JSON.parse(fs.readFileSync(path.join(DATA, 'weather.json'), 'utf8'));

// 3) 构造冬季 flights（日期映射进寒假窗口，价格沿用夏季价格作为"当前价"）
const wf = JSON.parse(JSON.stringify(flights));
wf.window = { start: '2027-01-01', end: '2027-03-01' };
wf.generatedAt = '2027-01-15T08:00:00.000Z';
for (const r of (wf.routes || [])) {
  for (const p of (r.cheapestPairs || [])) {
    const [nd, nr] = shiftPair(p.dep, p.ret);
    p.dep = nd; p.ret = nr;
  }
}
weather.window = { start: '2027-01-01', end: '2027-03-01' };

// 4) 构造冬季历史价格：故意偏高（当前价 ×1.25~1.75），使"当前价"被判定为显著历史低价 📉
const hist = {};
let seed = 20270101;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
for (const r of (wf.routes || [])) {
  for (const p of (r.cheapestPairs || [])) {
    const key = r.originCode + '>' + r.code + '@' + p.dep + '->' + p.ret;
    const year = 2027, season = 'winter';
    const offset = seasonOffset(p.dep, season, year);
    const prices = [], at = [];
    for (let i = 0; i < 4; i++) {
      prices.push(Math.round(p.price * (1.25 + rnd() * 0.5)));
      at.push(new Date(Date.UTC(2026, 9 + i, 10 + i, 12, 0, 0)).toISOString());
    }
    hist[key] = { prices, at, median: median(prices), min: Math.min(...prices), max: Math.max(...prices), count: prices.length, season, offset, seasonYear: year };
  }
}

fs.writeFileSync(path.join(DATA, 'flights.json'), JSON.stringify(wf));
fs.writeFileSync(path.join(DATA, 'weather.json'), JSON.stringify(weather));
fs.writeFileSync(path.join(DATA, 'price_history.json'), JSON.stringify(hist));

// 5) 用模拟"今天"渲染冬季版
const ok = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.js'), 'gba-summer'], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, TEST_TODAY },
});
if (ok.status !== 0) { console.error('冬季版 build 失败'); process.exit(1); }

// 6) 复制独立预览（数据已内联，自包含）
const out = path.join(DIST, 'preview-2027winter.html');
fs.copyFileSync(path.join(DIST, 'index.html'), out);
console.log('已生成冬季预览: ' + out);

// 7) 还原真实数据并重跑真实 build（暑假版），保留预览文件
fs.rmSync(DATA, { recursive: true, force: true });
fs.cpSync(BAK, DATA, { recursive: true });
fs.rmSync(BAK, { recursive: true, force: true });
spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.js'), 'gba-summer'], { cwd: ROOT, stdio: 'inherit' });
console.log('已还原真实数据并重建 dist/gba-summer（暑假版）。预览文件仍保留于: ' + out);

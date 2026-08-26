// 按用户原始需求口径输出 A/B 两档推荐（A: <¥1000，B: ¥1000-2000）
// 用法: node scripts/report_ab.js [moduleId] [originCode|ALL]
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MOD_ID = process.argv[2] || 'gba-summer';
const ORIGIN = (process.argv[3] || 'ALL').toUpperCase();

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', MOD_ID, 'flights.json'), 'utf8'));
let wx = null;
try { wx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', MOD_ID, 'weather.json'), 'utf8')); } catch (e) {}

const tripDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const BANDS = [
  { key: 'A', label: 'A 档 · 往返 < ¥1000', lo: 0, hi: 1000 },
  { key: 'B', label: 'B 档 · 往返 ¥1000-2000', lo: 1000, hi: 2000 },
];

function pick(rows) {
  if (!rows.length) return null;
  const used = new Set();
  const take = (cmp) => { const s = [...rows].sort(cmp); return (s.find(r => !used.has(r.key)) || s[0]); };
  const cheapest = take((a, b) => a.minPrice - b.minPrice); used.add(cheapest.key);
  const discount = take((a, b) => b.discountPct - a.discountPct || a.minPrice - b.minPrice); used.add(discount.key);
  const most = take((a, b) => b.optionCount - a.optionCount || b.datePairsInBudget - a.datePairsInBudget || a.minPrice - b.minPrice);
  return { cheapest, discount, most };
}

function line(label, r) {
  const o = r.options[0];
  const fl = (o.out.flights || []).map(f => f.no).filter(Boolean).join('+');
  const air = o.detailLimited ? '实时低价日历' : (fl + ' ' + o.airlineNames.join('/'));
  const tr = o.direct ? '直飞' : '⇄含中转' + (o.out.stops ? '(去程' + o.out.stops + '次)' : '');
  return '- ' + label + '：' + r.originCity + ' → ' + r.city + '(' + r.code + ')  ¥' + r.minPrice +
    '  | ' + o.depDate + ' 去 / ' + o.retDate + ' 回（' + tripDays(o.depDate, o.retDate) + ' 天）' +
    ' | ' + air + ' ' + tr +
    ' | 低于中位价 ' + r.discountPct + '%' +
    ' | 航次 ' + r.optionCount + ' / 可选日期组合 ' + r.datePairsInBudget;
}

const genTime = new Date(new Date(data.generatedAt).getTime() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);
const all = data.routes || [];
const scoped = ORIGIN === 'ALL' ? all : all.filter(r => r.originCode === ORIGIN);

const td = data.tripDuration && typeof data.tripDuration === 'object'
  ? data.tripDuration.min + '~' + data.tripDuration.max + ' 天' : String(data.tripDuration || '');
console.log('模块：' + MOD_ID + ' | 窗口 ' + data.window.start + ' ~ ' + data.window.end +
  ' | 行程 ' + td + ' | 数据更新 ' + genTime);
console.log('命中航线：全部出发地 ' + all.length + ' 条' + (ORIGIN === 'ALL' ? '' : '；' + ORIGIN + ' 出发 ' + scoped.length + ' 条'));
console.log('');

for (const b of BANDS) {
  const rows = scoped.filter(r => r.minPrice >= b.lo && r.minPrice < b.hi);
  console.log('### ' + b.label + '（' + rows.length + ' 条航线）');
  const p = pick(rows);
  if (!p) { console.log('- （本档无命中）'); console.log(''); continue; }
  console.log(line('最便宜', p.cheapest));
  console.log(line('折扣最大', p.discount));
  console.log(line('航次最多', p.most));
  // Top5 便宜清单
  const top = [...rows].sort((a, b2) => a.minPrice - b2.minPrice).slice(0, 8);
  console.log('- 本档最便宜 TOP8：' + top.map(r => r.originCity + '→' + r.city + ' ¥' + r.minPrice).join('、'));
  console.log('');
}

if (wx && (wx.trips || []).length) {
  // 与 build.js 的 wgrade() 保持同一口径（weather.json 里存的 grade 是更严格的旧口径，不可直接用）
  const wgrade = (s) => {
    if (s.heavyDays === 0 && s.dryDays >= 3) return 'dry';
    if (s.heavyDays === 0 && s.dryDays >= 1) return 'mild';
    if (s.heavyDays >= 3) return 'heavy';
    return 'wet';
  };
  const trips = wx.trips || [];
  trips.forEach(t => { t.grade = wgrade(t.summary); });
  const gc = {};
  trips.forEach(t => { gc[t.grade] = (gc[t.grade] || 0) + 1; });
  console.log('### 天气分级（出行窗口内）');
  console.log('- 🟢 干爽少雨 ' + (gc.dry || 0) + ' · 🔵 偶有阵雨 ' + (gc.mild || 0) +
    ' · 🟡 多雨 ' + (gc.wet || 0) + ' · 🔴 强降雨频繁 ' + (gc.heavy || 0) + '（共 ' + trips.length + ' 组行程）');
  const best = trips.filter(t => t.grade === 'dry' || t.grade === 'mild')
    .sort((a, b) => b.summary.dryDays - a.summary.dryDays || a.summary.totalPrcp - b.summary.totalPrcp);
  console.log('- 最干爽 TOP8：' + best.slice(0, 8).map(t => t.city + '(' + t.code + ')·' + t.originCity + '出发 晴' +
    t.summary.dryDays + '/' + t.summary.days + '天·累计雨' + t.summary.totalPrcp + 'mm').join('、'));
  const worst = trips.filter(t => t.grade === 'heavy' || t.grade === 'wet')
    .sort((a, b) => b.summary.totalPrcp - a.summary.totalPrcp);
  if (worst.length) {
    console.log('- 雨量最大 TOP5：' + worst.slice(0, 5).map(t => t.city + '(' + t.code + ')·累计雨' +
      t.summary.totalPrcp + 'mm' + (t.grade === 'heavy' ? '🔴' : '🟡')).join('、'));
  }
}

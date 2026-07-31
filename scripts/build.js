// 构建分模块页面：dist/<moduleId>/index.html + data/<moduleId>/summary.txt
// 天气与枫叶为可选区块，保持「左侧地图 + 右侧可排序列表」架构一致。
// 用法: node build.js <moduleId>
const fs = require('fs');
const path = require('path');
const { MODULES } = require('./modules');

const ROOT = path.resolve(__dirname, '..');
const MOD_ID = process.argv[2] || 'gba-summer';
const MOD = MODULES[MOD_ID];
if (!MOD) { console.error('未知模块: ' + MOD_ID); process.exit(1); }

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', MOD_ID, 'flights.json'), 'utf8'));

const TIER_KEYS = MOD.tiers.map(t => t.key);
const TIER_LABEL = Object.fromEntries(MOD.tiers.map(t => [t.key, t.label]));
const TIER_PALETTE = ['#e02b3c', '#f0731e', '#e0a91e', '#1f9bb3', '#2563d9'];
const TIER_COLOR = {};
MOD.tiers.forEach((t, i) => {
  const c = TIER_PALETTE[i % TIER_PALETTE.length];
  TIER_COLOR[t.key] = { dot: c, bg: shade(c, 0.9), bc: shade(c, 0.6), txt: shade(c, 0.35) };
});
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0.5) { const k = (f - 0.5) * 2; r = Math.round(r + (255 - r) * k); g = Math.round(g + (255 - g) * k); b = Math.round(b + (255 - b) * k); }
  else { const k = f * 2; r = Math.round(r * (0.4 + 0.6 * k)); g = Math.round(g * (0.4 + 0.6 * k)); b = Math.round(b * (0.4 + 0.6 * k)); }
  return '#' + [r, g, b].map(x => String(x).padStart(2, '0')).join('');
}

const AL = {
  '5J': '宿务太平洋', 'AK': '亚航', 'FD': '泰国亚航', 'D7': '亚航X', 'TR': '酷航', 'VJ': '越捷航空',
  'VZ': '泰越捷', 'SL': '泰国狮航', 'JT': '狮子航空', 'QZ': '印尼亚航', 'Z2': '菲亚航', 'MM': '乐桃航空',
  'JW': '真航空', 'TW': '德威航空', 'LJ': '济州航空', '7C': '济州航空', 'BX': '釜山航空', 'RS': '首尔航空',
  'HX': '中国香港航空', 'UO': '中国香港快运', 'CX': '国泰航空', 'KA': '国泰港龙', 'NX': '澳门航空',
  'CI': '中华航空', 'BR': '长荣航空', 'JX': '星宇航空', 'CA': '中国国航', 'MU': '东方航空', 'CZ': '南方航空',
  'HU': '海南航空', 'ZH': '深圳航空', 'MF': '厦门航空', '3U': '四川航空', 'SC': '山东航空', 'FM': '上海航空',
  'HO': '吉祥航空', 'JD': '首都航空', 'GS': '天津航空', 'NS': '河北航空', 'G5': '华夏航空', 'EU': '成都航空',
  'TV': '西藏航空', 'PN': '西部航空', 'KY': '昆明航空', 'DZ': '东海航空', 'BK': '奥凯航空', 'JR': '幸福航空',
  'VN': '越南航空', 'TG': '泰国航空', 'SQ': '新加坡航空', 'MH': '马来西亚航空', 'GA': '印尼鹰航',
  'PR': '菲律宾航空', 'KE': '大韩航空', 'OZ': '韩亚航空', 'NH': '全日空', 'JL': '日本航空',
  'EK': '阿联酋航空', 'QR': '卡塔尔航空', 'EY': '阿提哈德', 'TK': '土耳其航空', 'SU': '俄航',
  'AI': '印度航空', 'UL': '斯里兰卡航空', 'KC': '阿斯塔纳航空', 'HY': '乌兹别克航空', 'OM': '蒙古航空',
  'QV': '老挝航空', 'K6': '柬埔寨吴哥航空', 'KR': '柬埔寨航空', 'MI': '胜安航空', 'BI': '文莱皇家航空',
  'JL': '日本航空', 'NH': '全日空', 'BC': '天空之门', 'GK': '捷星日本', 'DJ': '香草航空',
};
function cleanName(n, code) {
  if (!n || /^[A-Z0-9]{2}$/.test(n)) return AL[code] || n || code;
  return String(n).split(/[|｜]/).pop().trim();
}
for (const r of data.routes) {
  for (const o of r.options) {
    o.airlineNames = o.airlines.map((c, i) => cleanName(o.airlineNames[i], c));
  }
}
const leafletJs = fs.readFileSync(path.join(ROOT, 'vendor', 'leaflet.js'), 'utf8');
const leafletCss = fs.readFileSync(path.join(ROOT, 'vendor', 'leaflet.css'), 'utf8');

// ---------- 天气数据（按出行窗口重新分档） ----------
let wraw = null;
try { wraw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', MOD_ID, 'weather.json'), 'utf8')); } catch (e) { wraw = null; }
const hasWeather = wraw && !wraw.skipped && wraw.trips && wraw.trips.length;
function wgrade(s) {
  if (s.heavyDays === 0 && s.dryDays >= 3) return 'dry';
  if (s.heavyDays === 0 && s.dryDays >= 1) return 'mild';
  if (s.heavyDays >= 3) return 'heavy';
  return 'wet';
}
const WLABEL = { dry: '干爽少雨', mild: '偶有阵雨', wet: '多雨', heavy: '强降雨频繁' };
const WDESC = {
  dry: '出行窗口内少雨、无强降雨，最值得优先安排',
  mild: '偶有阵雨但无强降雨，备好雨具即可',
  wet: '降雨较多，强降雨日 ≤2，出行需留意',
  heavy: '强降雨频繁（≥3 个暴雨日），谨慎选择',
};
let weatherPayload = { window: MOD.weather ? MOD.weather.window : null, gradeCounts: {}, cities: [], trips: [] };
if (hasWeather) {
  wraw.trips.forEach(t => { t.grade = wgrade(t.summary); });
  const wByCode = {}; wraw.trips.forEach(t => { wByCode[t.code] = t; });
  for (const r of data.routes) {
    const w = wByCode[r.code];
    if (w) r.weather = { grade: w.grade, dep: w.dep, ret: w.ret, dryDays: w.summary.dryDays, days: w.summary.days, avgPop: w.summary.avgPop, heavyDays: w.summary.heavyDays, tmax: w.summary.tmax, tmin: w.summary.tmin, prcp: w.summary.totalPrcp };
  }
  weatherPayload = {
    window: wraw.window, generatedAt: wraw.generatedAt, sources: wraw.sources,
    cities: wraw.cities, trips: wraw.trips, gradeCounts: {},
  };
  wraw.trips.forEach(t => { weatherPayload.gradeCounts[t.grade] = (weatherPayload.gradeCounts[t.grade] || 0) + 1; });
}

// ---------- 枫叶数据 ----------
const hasKoyo = !!(wraw && wraw.koyo && wraw.koyo.cities && wraw.koyo.cities.length);

// ---------- 计算推荐 ----------
function picks(rows, tier) {
  const list = rows.filter(r => r.tier === tier);
  if (!list.length) return null;
  const used = new Set();
  const take = (cmp) => { const s = [...list].sort(cmp); return (s.find(r => !used.has(r.key)) || s[0]); };
  const cheapest = take((a, b) => a.minPrice - b.minPrice); used.add(cheapest.key);
  const discount = take((a, b) => b.discountPct - a.discountPct || a.minPrice - b.minPrice); used.add(discount.key);
  const most = take((a, b) => b.optionCount - a.optionCount || b.datePairsInBudget - a.datePairsInBudget || a.minPrice - b.minPrice);
  return { cheapest, discount, most };
}
const P = {}; TIER_KEYS.forEach(t => P[t] = picks(data.routes, t));

const genTime = new Date(new Date(data.generatedAt).getTime() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);

const payload = {
  moduleId: MOD_ID, moduleName: MOD.name, generatedAt: data.generatedAt, genTime,
  origins: data.origins, origin: data.origin, window: data.window,
  tripDuration: data.tripDuration, excludedAirlines: data.excludedAirlines, priceCap: data.priceCap,
  routes: data.routes,
  picks: Object.fromEntries(TIER_KEYS.map(t => [t, P[t] ? { cheapest: P[t].cheapest.key, discount: P[t].discount.key, most: P[t].most.key } : null])),
  weather: weatherPayload, koyo: hasKoyo ? wraw.koyo : null,
};

// ================= HTML =================
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${MOD.title}（${data.window.start} ~ ${data.window.end}）</title>
<style>${leafletCss}</style>
<style>
:root{
  --bg:#f5f6f8; --panel:#ffffff; --line:#e4e7ec; --line2:#eef0f3;
  --tx:#1b1f26; --tx2:#5c6470; --tx3:#8b93a1;
  --red:#e02b3c; --red-soft:#fdecee; --amber:#e08a1e; --amber-soft:#fdf3e4;
  --blue:#2563d9; --blue-soft:#eaf0fd; --green:#0f9960;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;background:var(--bg);color:var(--tx);font-size:13px;line-height:1.5}
.wrap{max-width:1680px;margin:0 auto;padding:14px 16px 24px}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:12px}
h1{font-size:19px;font-weight:700;letter-spacing:-.2px}
h1 small{font-weight:500;font-size:12px;color:var(--tx2);margin-left:8px}
.meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:11.5px;color:var(--tx2)}
.pill{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:3px 11px;white-space:nowrap}
.pill b{color:var(--tx);font-weight:600}
.pill.warn{background:var(--amber-soft);border-color:#f3ddb8;color:#8a5b12}
.picks{display:flex;gap:10px;margin-bottom:10px;overflow-x:auto;padding-bottom:6px;scrollbar-width:thin;scrollbar-height:6px}
.picks::-webkit-scrollbar{height:6px}.picks::-webkit-scrollbar-thumb{background:#c5cad4;border-radius:3px}
.pick{flex:0 0 200px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer;transition:.15s;position:relative;overflow:hidden}
.pick:hover{border-color:#c9d2e0;box-shadow:0 3px 12px rgba(20,30,50,.08);transform:translateY(-2px)}
.pick-hd{display:flex;align-items:center;gap:5px;font-size:9.5px;color:var(--tx3);margin-bottom:4px;letter-spacing:.2px}
.tag{font-size:9px;padding:1px 7px;border-radius:4px;font-weight:600}
.pick-city{font-size:14px;font-weight:700;display:flex;align-items:baseline;gap:5px}
.pick-city span{font-size:9.5px;color:var(--tx3);font-weight:500}
.pick-price{font-size:18px;font-weight:700;color:var(--red);margin:3px 0 4px;font-variant-numeric:tabular-nums}
.pick-price small{font-size:10px;font-weight:500;color:var(--tx2)}
.pick-sub{font-size:10px;color:var(--tx2);line-height:1.45}
.pick-sub em{font-style:normal;color:var(--green);font-weight:600}
.pick-w{margin-top:4px;font-size:9px}
.main{display:grid;grid-template-columns:1fr 460px;gap:12px;height:calc(100vh - 40px);min-height:640px}
@media(max-width:1100px){.main{grid-template-columns:1fr;height:auto}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
#map{width:100%;height:100%;min-height:520px;background:#e8eef4}
.map-legend{position:absolute;right:12px;bottom:22px;z-index:500;background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:11px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.map-legend b{display:block;margin-bottom:4px;font-size:11px;color:var(--tx2)}
.map-legend div{display:flex;align-items:center;gap:6px;margin:2px 0}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block}
.map-wrap{position:relative;height:100%}
.list-hd{padding:10px 12px;border-bottom:1px solid var(--line2);display:flex;flex-direction:column;gap:8px}
.tabs{display:flex;gap:6px;flex-wrap:wrap}
.tab{flex:1;text-align:center;padding:6px 4px;border:1px solid var(--line);border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;color:var(--tx2);background:#fafbfc;transition:.12s;white-space:nowrap}
.tab:hover{border-color:#c9d2e0}.tab.on{background:var(--tx);color:#fff;border-color:var(--tx)}
.row2{display:flex;gap:6px;align-items:center}
select,input[type=text]{border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:12px;background:#fff;color:var(--tx);outline:none;font-family:inherit}
select:focus,input:focus{border-color:var(--blue)}
input[type=text]{flex:1}
.chips{display:flex;gap:5px;flex-wrap:wrap}
.chip{font-size:11px;padding:3px 9px;border-radius:14px;border:1px solid var(--line);cursor:pointer;background:#fafbfc;color:var(--tx2);transition:.12s}
.chip:hover{border-color:#c9d2e0}.chip.on{background:var(--blue-soft);border-color:#b9cdf5;color:var(--blue);font-weight:600}
.count{font-size:11px;color:var(--tx3);padding:0 2px}
#list{overflow-y:auto;flex:1;padding:8px}
#list::-webkit-scrollbar{width:8px}#list::-webkit-scrollbar-thumb{background:#d3d8e0;border-radius:4px}
.item{border:1px solid var(--line);border-radius:9px;padding:9px 10px;margin-bottom:7px;cursor:pointer;transition:.13s;background:#fff}
.item:hover{border-color:#c3cddd;box-shadow:0 2px 10px rgba(20,30,50,.06)}
.item.sel{border-color:var(--blue);box-shadow:0 0 0 2px var(--blue-soft)}
.it-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.it-city{font-size:14.5px;font-weight:700;display:flex;align-items:center;gap:5px}
.it-city .code{font-size:10px;color:var(--tx3);font-weight:500;background:#f2f4f7;padding:1px 5px;border-radius:4px}
.it-price{font-size:17px;font-weight:700;color:var(--red);font-variant-numeric:tabular-nums;white-space:nowrap}
.it-price small{font-size:10.5px;font-weight:500;color:var(--tx3);display:block;text-align:right}
.it-line{font-size:11.5px;color:var(--tx2);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.badge{font-size:10px;padding:1px 6px;border-radius:4px;background:#f2f4f7;color:var(--tx2)}
.badge.g{background:#e7f6ee;color:var(--green)}.badge.r{background:var(--red-soft);color:var(--red)}
.badge.b{background:var(--blue-soft);color:var(--blue)}
.badge.tr{background:#fff2e0;color:#b25a00;border:1px solid #ffcf8f;font-weight:700}
.legs{margin-top:7px;border-top:1px dashed var(--line);padding-top:6px;display:none}
.item.open .legs{display:block}
.leg{display:flex;gap:7px;align-items:flex-start;font-size:11.5px;margin:3px 0}
.leg .dir{flex:0 0 30px;color:var(--tx3);font-size:10px;padding-top:1px}
.leg .body{flex:1;color:var(--tx)}.leg .fno{font-weight:600;color:var(--blue)}.leg .t{font-variant-numeric:tabular-nums}
.alts{margin-top:6px;font-size:11px;color:var(--tx2)}
.alts table{width:100%;border-collapse:collapse}.alts td{padding:2px 4px;border-top:1px solid var(--line2)}
.alts td:last-child{text-align:right;font-weight:600;color:var(--red);font-variant-numeric:tabular-nums}
.empty{text-align:center;color:var(--tx3);padding:40px 10px;font-size:12.5px}
.foot{margin-top:10px;font-size:11px;color:var(--tx3);line-height:1.7}
.leaflet-container{font:inherit}
.mk{border-radius:50%;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.3)}
.mk-lbl{background:rgba(255,255,255,.93);border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:10px;font-weight:600;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.12)}
/* weather */
.sec{border-top:1px solid var(--line);margin-top:16px;padding-top:14px}
.sec-hd{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:10px}
.sec-hd h2{font-size:17px;font-weight:700;display:flex;align-items:center;gap:8px}
.sec-hd h2 small{font-weight:500;font-size:11.5px;color:var(--tx2)}
.wmain{display:grid;grid-template-columns:1fr 460px;gap:12px;height:calc(100vh - 60px);min-height:600px}
@media(max-width:1100px){.wmain{grid-template-columns:1fr;height:auto}}
#wmap{width:100%;height:100%;min-height:520px;background:#e8eef4}
.wlegend{position:absolute;left:12px;bottom:18px;z-index:500;background:rgba(255,255,255,.95);border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-size:11px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.wlegend b{display:block;margin-bottom:4px;font-size:11px;color:var(--tx2)}
.wlegend div{display:flex;align-items:center;gap:6px;margin:3px 0}
.wpanel{display:flex;flex-direction:column}
.wtabs{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px}
.wtab{flex:1;text-align:center;padding:5px 4px;border:1px solid var(--line);border-radius:7px;cursor:pointer;font-size:11px;font-weight:600;color:var(--tx2);background:#fafbfc;transition:.12s;white-space:nowrap}
.wtab:hover{border-color:#c9d2e0}.wtab.on{background:var(--tx);color:#fff;border-color:var(--tx)}
.wlist{overflow-y:auto;flex:1;padding:8px}
.wlist::-webkit-scrollbar{width:8px}.wlist::-webkit-scrollbar-thumb{background:#d3d8e0;border-radius:4px}
.wgroup-hd{font-size:11px;font-weight:700;color:var(--tx2);padding:8px 8px 4px;display:flex;align-items:center;gap:6px;position:sticky;top:0;background:#fff;z-index:2}
.wrow{border:1px solid var(--line);border-radius:9px;padding:8px 10px;margin-bottom:6px;cursor:pointer;transition:.13s;background:#fff}
.wrow:hover{border-color:#c3cddd;box-shadow:0 2px 10px rgba(20,30,50,.06)}
.wrow.sel{border-color:var(--blue);box-shadow:0 0 0 2px var(--blue-soft)}
.wr-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.wr-city{font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px}
.wr-city .code{font-size:10px;color:var(--tx3);font-weight:500;background:#f2f4f7;padding:1px 5px;border-radius:4px}
.wr-g{font-size:10px;padding:1px 7px;border-radius:4px;color:#fff;font-weight:600;white-space:nowrap}
.wr-sub{font-size:11px;color:var(--tx2);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap}
.wr-sub b{color:var(--tx);font-weight:600}
.wfc{border-top:1px solid var(--line2);margin-top:7px;padding-top:6px;display:none}
.wrow.open .wfc{display:block}
.wfclist{display:flex;overflow-x:auto;gap:4px;padding-bottom:4px}
.wfcday{flex:0 0 auto;width:64px;border:1px solid var(--line2);border-radius:7px;padding:4px 3px;text-align:center;font-size:10px;background:#fafbfc}
.wfcday .d{color:var(--tx3);font-size:9.5px}.wfcday .t{font-weight:700;font-size:11px}
.wfcday .p{font-size:9.5px;color:var(--blue)}.wfcday .r{font-size:14px}
.wsrc{margin-top:12px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:11px 13px}
.wsrc b{font-size:12px;display:block;margin-bottom:6px}
.wsrc a{color:var(--blue);text-decoration:none;font-size:11.5px;display:block;margin:3px 0;word-break:break-all}
.wsrc a:hover{text-decoration:underline}.wsrc .sdesc{color:var(--tx3);font-size:10.5px}
.wtag{font-size:9.5px;padding:0 5px;border-radius:3px;background:#eef0f3;color:var(--tx3);margin-left:4px}
/* koyo */
.koyogrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.kcard{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:#fff;position:relative;overflow:hidden;transition:.13s}
.kcard:hover{box-shadow:0 3px 12px rgba(20,30,50,.08);transform:translateY(-2px)}
.kcard.best{border-color:#d8392b;box-shadow:0 0 0 2px #fbe3df}
.kc-top{display:flex;justify-content:space-between;align-items:center;gap:6px}
.kc-city{font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px}
.kc-city .code{font-size:10px;color:var(--tx3);font-weight:500;background:#f2f4f7;padding:1px 5px;border-radius:4px}
.kc-sw{width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.1)}
.kc-stage{font-size:13px;font-weight:700;margin-top:6px}
.kc-prog{height:6px;background:#eee;border-radius:4px;margin:6px 0;overflow:hidden}
.kc-prog>i{display:block;height:100%}
.kc-sub{font-size:10.5px;color:var(--tx2);line-height:1.5}
.kc-sub b{color:var(--tx);font-weight:600}
.kc-best{font-size:9.5px;margin-top:5px;padding:2px 7px;border-radius:4px;background:#fdecee;color:#b0251a;font-weight:600;display:inline-block}
.koyo-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-top:8px}
.koyo-legend div{display:flex;align-items:center;gap:5px}
.hub-back{font-size:12px;color:var(--blue);text-decoration:none}
.modnav{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.modnav-i{font-size:12.5px;padding:7px 14px;border:1px solid var(--line);border-radius:8px;text-decoration:none;color:var(--tx2);background:#fff;transition:.12s;white-space:nowrap;font-weight:500}
.modnav-i:hover{border-color:var(--blue);color:var(--blue);background:#fafbfc}
.modnav-i.on{background:var(--tx);color:#fff;border-color:var(--tx);font-weight:600;cursor:default}
.modnav-i.on:hover{background:var(--tx);color:#fff;border-color:var(--tx)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>${MOD.title}<small>${MOD.sub}</small></h1>
      <div class="meta" style="margin-top:6px">
        <span class="pill">模块 <b>${MOD.name}</b></span>
        <span class="pill">出发地 <b>${data.origins.map(o => o.city).join(' / ')}</b></span>
        <span class="pill">出行窗口 <b>${data.window.start} ~ ${data.window.end}</b></span>
        <span class="pill">行程时长 <b>${data.tripDuration.min} ~ ${data.tripDuration.max} 天</b></span>
        <span class="pill">数据更新 <b>${genTime}</b></span>
        <span class="pill">命中航线 <b id="statAll">-</b></span>
        <span id="tierStats" style="display:contents"></span>
        <span class="pill warn">已剔除春秋/九元等国内廉价航空</span>
        <span class="pill warn">中国香港出发仅国际航线</span>
        <span class="pill warn">国内航线须直飞（≥3000km 方可中转）</span>
      </div>
    </div>
    <nav class="modnav">
      <a href="../gba-summer/index.html" class="modnav-i${MOD_ID==='gba-summer'?' on':''}">大湾区暑期</a>
      <a href="../japan-koyo/index.html" class="modnav-i${MOD_ID==='japan-koyo'?' on':''}">日本枫叶季</a>
      <a href="../global-year/index.html" class="modnav-i${MOD_ID==='global-year'?' on':''}">全球低价(1年)</a>
    </nav>
  </header>

  <div class="picks" id="picks"></div>

  <div class="main">
    <div class="card"><div class="map-wrap">
      <div id="map"></div>
      <div class="map-legend" id="mapLegend"><b>往返价格分档</b></div>
    </div></div>
    <div class="card">
      <div class="list-hd">
        <div class="tabs" id="tabs"><div class="tab on" data-tier="all">全部</div></div>
        <div class="row2">
          <select id="sort">
            <option value="price">按价格 ↑</option>
            <option value="discount">按折扣幅度 ↓</option>
            <option value="options">按可选航次 ↓</option>
            <option value="dates">按可选日期 ↓</option>
          </select>
          <input type="text" id="q" placeholder="搜索城市 / 三字码">
        </div>
        <div class="chips" id="origins"></div>
        <div class="chips" id="regions"></div>
        <div class="count" id="cnt"></div>
      </div>
      <div id="list"></div>
    </div>
  </div>

  ${hasWeather ? `
  <section class="sec">
    <div class="sec-hd">
      <h2>☁️ 目的地天气预测<small>出行窗口内降雨分级 · ${wraw.window.start}–${wraw.window.end} 全程预报（含累计降雨量）</small></h2>
      <div class="meta">
        <span class="pill">预测跨度 <b>${wraw.window.start} ~ ${wraw.window.end}</b></span>
        ${weatherPayload.gradeCounts.dry != null ? `<span class="pill" style="background:#e7f6ee;border-color:#bfe6cf"><b id="wgDry">-</b> 🟢 干爽</span>
        <span class="pill" style="background:var(--blue-soft);border-color:#b9cdf5"><b id="wgMild">-</b> 🔵 偶有阵雨</span>
        <span class="pill" style="background:var(--amber-soft);border-color:#f3ddb8"><b id="wgWet">-</b> 🟡 多雨</span>
        <span class="pill" style="background:var(--red-soft);border-color:#f6cdd2"><b id="wgHeavy">-</b> 🔴 强降雨</span>` : ''}
      </div>
    </div>
    <div class="wmain">
      <div class="card"><div class="map-wrap">
        <div id="wmap"></div>
        <div class="wlegend">
          <b>出行窗口内降雨分级</b>
          <div><span class="dot" style="background:#0f9960"></span> 🟢 干爽少雨（无强降雨·≥3 晴日）</div>
          <div><span class="dot" style="background:#2563d9"></span> 🔵 偶有阵雨（无强降雨）</div>
          <div><span class="dot" style="background:#e08a1e"></span> 🟡 多雨</div>
          <div><span class="dot" style="background:#e02b3c"></span> 🔴 强降雨频繁（≥3 暴雨日）</div>
          <div style="color:#8b93a1;margin-top:4px">圆点越大＝晴日越多</div>
        </div>
      </div></div>
      <div class="card wpanel">
        <div class="list-hd">
          <div class="wtabs" id="wtabs"><div class="tab on" data-wg="all">全部</div></div>
          <div class="count" id="wcnt">点击地图或下方城市查看全程预报与累计降雨量</div>
        </div>
        <div class="wlist" id="wlist"></div>
      </div>
    </div>
    <div class="wsrc" id="wsrc"></div>
  </section>` : ''}

  ${hasKoyo ? `
  <section class="sec">
    <div class="sec-hd">
      <h2>🍁 日本枫叶颜色监控<small>${wraw.koyo.year} 年物候时间表 · 各地点枫叶变色阶段与最佳观赏窗口</small></h2>
      <div class="meta">
        <span class="pill">监测城市 <b>${wraw.koyo.cities.length}</b></span>
        <span class="pill" style="background:#fdecee;border-color:#f6cdd2"><b id="koyoBest">-</b> 个落在最佳观赏窗口内</span>
      </div>
    </div>
    <div class="koyo-legend">
      ${wraw.koyo.legend.map(l => `<div><span class="dot" style="background:${l.color}"></span> ${l.label} · ${l.desc}</div>`).join('')}
    </div>
    <div class="koyogrid" id="koyoGrid" style="margin-top:10px"></div>
  </section>` : ''}

  <div class="foot">
    数据源：Trip.com 公开航班查询接口，价格为 1 名成人经济舱往返含税总价（人民币），实时波动，以最终下单页为准。<br>
    已排除的国内低成本航空：${data.excludedAirlines.map(a => a.name).join('、')}。折扣幅度＝该航线所选最低价相对窗口期内往返价格中位数的降幅。<br>
    航线规则：中国香港出发只查国际航线；国际航线允许中转，国内航线要求直飞，仅当出发地与目的地直线距离 ≥ 3000km 时才纳入中转方案；所有中转方案均以橙色「⇄ 含中转」标注并注明中转城市。
    ${hasWeather ? '<br>天气：Open-Meteo 逐日数值预报与近 5 年同期 ERA5 气候常态推算，累计降雨量为出行窗口内每日降水之和。' : ''}
    ${hasKoyo ? '<br>枫叶：基于日本九大地方典型物候时间表（参照加拿大枫叶颜色时间表实现方式）建模，给出各地绿叶/初红/半红/满红/落叶阶段与最佳观赏窗口，实际变色受当年气候影响，仅供参考。' : ''}
  </div>
</div>

<script>${leafletJs}</script>
<script>
const DATA = ${JSON.stringify(payload)};
const REGION_NAME={domestic:'国内/港澳台',asia:'亚洲',oceania:'大洋洲',europe:'欧洲',america:'美洲',africa:'非洲',japan:'日本'};
const PICK_LABEL={cheapest:'最便宜',discount:'折扣最大',most:'航次最多'};
const TIER_KEYS=${JSON.stringify(TIER_KEYS)};
const TIER_LABEL=${JSON.stringify(TIER_LABEL)};
const TIER_COLOR=${JSON.stringify(TIER_COLOR)};
const ORIGINS=DATA.origins;
const orgLL={}; ORIGINS.forEach(o=>orgLL[o.code]=o);
const W={ dry:{color:'#0f9960',bg:'#e7f6ee',label:'干爽少雨'}, mild:{color:'#2563d9',bg:'#eaf0fd',label:'偶有阵雨'}, wet:{color:'#e08a1e',bg:'#fdf3e4',label:'多雨'}, heavy:{color:'#e02b3c',bg:'#fdecee',label:'强降雨频繁'} };
const wOrder=['dry','mild','wet','heavy'];
let state={tier:'all',sort:'price',q:'',regions:new Set(),origins:new Set(),sel:null};
function tripDays(a,b){return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);}
const byKey={}; DATA.routes.forEach(r=>byKey[r.key]=r);
const destBest={}; DATA.routes.forEach(r=>{ if(!destBest[r.code]||r.minPrice<destBest[r.code].minPrice) destBest[r.code]=r; });

/* ---------- 地图 ---------- */
const map=L.map('map',{zoomControl:true,worldCopyJump:true,minZoom:2}).setView([20,108],3);
L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',{subdomains:['1','2','3','4'],maxZoom:16,attribution:'&copy; 高德地图'}).addTo(map);
ORIGINS.forEach(o=>{ L.circleMarker([o.lat,o.lng],{radius:7,color:'#fff',weight:2,fillColor:'#2563d9',fillOpacity:1}).addTo(map).bindTooltip(o.city+' '+o.code+' · 出发地',{permanent:false}); });
const layer=L.layerGroup().addTo(map);
const lineLayer=L.layerGroup().addTo(map);
const markers={};
function radiusOf(r){ const n=r.optionCount+r.datePairsInBudget; return Math.max(5,Math.min(15,4+Math.sqrt(n)*1.5)); }
function colorOf(r){ return TIER_COLOR[r.tier].dot; }
function drawMap(){
  layer.clearLayers(); lineLayer.clearLayers(); Object.keys(markers).forEach(k=>delete markers[k]);
  TIER_KEYS.forEach(t=>{
    if(state.tier!=='all'&&state.tier!==t) return;
    DATA.routes.filter(r=>r.tier===t).forEach(r=>{
      if(state.regions.size&&!state.regions.has(r.region)) return;
      if(state.origins.size&&!state.origins.has(r.originCode)) return;
      if(state.q){const q=state.q.toLowerCase(); if(!(r.city.toLowerCase().includes(q)||r.code.toLowerCase().includes(q)||r.originCity.toLowerCase().includes(q))) return;}
      const m=L.circleMarker([r.lat,r.lng],{radius:radiusOf(r),color:'#fff',weight:1.5,fillColor:colorOf(r),fillOpacity:.82,className:'mk'}).addTo(layer);
      m.bindTooltip('<b>'+r.city+'</b>（'+r.originCity+'出发） ¥'+r.minPrice+'<br><span style="color:#666">'+r.options[0].depDate.slice(5)+' 去 / '+r.options[0].retDate.slice(5)+' 回</span>',{direction:'top',offset:[0,-4]});
      m.on('click',()=>select(r.key,true));
      markers[r.key]=m;
    });
  });
}
function drawLine(key){
  lineLayer.clearLayers();
  const r=byKey[key]; if(!r) return;
  const O=orgLL[r.originCode]; if(!O) return;
  let lng=r.lng; if(lng-O.lng>180)lng-=360; if(O.lng-lng>180)lng+=360;
  const pts=[]; const n=48;
  for(let i=0;i<=n;i++){const t=i/n;
    const la=O.lat+(r.lat-O.lat)*t + Math.sin(Math.PI*t)*Math.min(18,Math.abs(lng-O.lng)/6+Math.abs(r.lat-O.lat)/6);
    pts.push([la,O.lng+(lng-O.lng)*t]);}
  L.polyline(pts,{color:colorOf(r),weight:2,opacity:.85,dashArray:'5,4'}).addTo(lineLayer);
}
function fmtLeg(o){
  const f=o.out.flights;
  const seg=f.map(x=>'<span class="fno">'+x.no+'</span> '+x.from+(x.fromT?'('+x.fromT+')':'')+' <span class="t">'+x.depT.slice(11,16)+'</span> → '+x.to+(x.toT?'('+x.toT+')':'')+' <span class="t">'+x.arrT.slice(11,16)+'</span>').join('<br>');
  const bk=o.back?o.back.flights.map(x=>'<span class="fno">'+x.no+'</span> <span class="t">'+x.depT+'</span> 起飞').join('<br>'):'—';
  const dur=o.out.duration?Math.floor(o.out.duration/60)+'h'+(o.out.duration%60?String(o.out.duration%60)+'m':''):'';
  return '<div class="leg"><div class="dir">去程</div><div class="body">'+seg+'<div style="color:#8b93a1;font-size:10.5px">'+o.depDate+' · '+(o.out.stops?o.out.stops+' 次中转':'直飞')+(dur?' · 全程 '+dur:'')+'</div></div></div>'+
    '<div class="leg"><div class="dir">回程</div><div class="body">'+bk+'<div style="color:#8b93a1;font-size:10.5px">'+o.retDate+' · 当地时间</div></div></div>';
}
function transitBadge(o,cls){
  if(o.direct) return '<span class="badge g">直飞往返</span>';
  const f=o.out.flights||[];
  const via=f.slice(0,-1).map(x=>x.to).filter(Boolean);
  const parts=[];
  if(o.out.stops) parts.push('去程 '+o.out.stops+' 次'+(via.length?'（经 '+via.join('/')+'）':''));
  if(o.back&&o.back.stops) parts.push('回程 '+o.back.stops+' 次');
  return '<span class="badge tr'+(cls||'')+'">⇄ 含中转'+(parts.length?' · '+parts.join(' · '):'')+'</span>';
}
function itemHTML(r){
  const o=r.options[0];
  const alts=r.cheapestPairs.slice(0,6).map(p=>'<tr><td>'+p.dep.slice(5)+' 去 · '+p.ret.slice(5)+' 回</td><td>¥'+p.price+'</td></tr>').join('');
  const others=r.options.slice(1,5).map(x=>'<tr><td>'+x.depDate.slice(5)+'/'+x.retDate.slice(5)+' '+x.out.flights.map(f=>f.no).join('+')+' '+x.airlineNames.join('/')+'</td><td>¥'+x.price+'</td></tr>').join('');
  const w=r.weather;
  const wBadge= w?('<span class="badge" style="background:'+W[w.grade].bg+';color:'+W[w.grade].color+'">☁ '+W[w.grade].label+' · 晴'+w.dryDays+'/'+w.days+' · 雨'+w.prcp+'mm</span>'):'';
  return '<div class="item" data-key="'+r.key+'">'+
    '<div class="it-top"><div>'+
      '<div class="it-city">'+r.city+'<span class="code">'+r.code+'</span></div>'+
      '<div class="it-line">'+
        '<span>'+r.originCity+' 出发</span>'+
        '<span>'+o.depDate.slice(5)+' 去 · '+o.retDate.slice(5)+' 回 · '+tripDays(o.depDate,o.retDate)+' 天</span>'+
        transitBadge(o)+
        '<span class="badge">'+o.airlineNames.join(' / ')+'</span>'+
        (o.bag?'<span class="badge b">含托运</span>':'')+
      '</div>'+
      '<div class="it-line">'+
        (r.discountPct>0?'<span class="badge r">低于中位价 '+r.discountPct+'%</span>':'')+
        '<span class="badge">'+r.optionCount+' 个航次可选</span>'+
        (r.datePairsInBudget?'<span class="badge">'+r.datePairsInBudget+' 组日期在预算内</span>':'')+
        (r.isDomestic&&r.transitAllowed?'<span class="badge b">远程国内 '+r.distanceKm+'km · 允许中转</span>':'')+
        wBadge+
      '</div>'+
    '</div><div class="it-price">¥'+r.minPrice+'<small>'+TIER_LABEL[r.tier]+'/人往返</small></div></div>'+
    '<div class="legs">'+fmtLeg(o)+
      (others?'<div class="alts"><div style="color:#8b93a1;margin:5px 0 2px">同航线其他航班</div><table>'+others+'</table></div>':'')+
      (alts?'<div class="alts"><div style="color:#8b93a1;margin:5px 0 2px">窗口期内更多低价日期组合（含全部航司）</div><table>'+alts+'</table></div>':'')+
    '</div></div>';
}
function filtered(){
  let rows=DATA.routes.filter(r=>{
    if(state.tier!=='all'&&r.tier!==state.tier) return false;
    if(state.regions.size&&!state.regions.has(r.region)) return false;
    if(state.origins.size&&!state.origins.has(r.originCode)) return false;
    if(state.q){const q=state.q.toLowerCase(); if(!(r.city.toLowerCase().includes(q)||r.code.toLowerCase().includes(q)||r.originCity.toLowerCase().includes(q))) return false;}
    return true;
  });
  const s=state.sort;
  rows.sort((a,b)=> s==='price'?a.minPrice-b.minPrice : s==='discount'?b.discountPct-a.discountPct||a.minPrice-b.minPrice : s==='options'?b.optionCount-a.optionCount||a.minPrice-b.minPrice : b.datePairsInBudget-a.datePairsInBudget||a.minPrice-b.minPrice);
  return rows;
}
function render(){
  const rows=filtered();
  document.getElementById('list').innerHTML= rows.length?rows.map(itemHTML).join(''):'<div class="empty">没有符合条件的航线</div>';
  document.getElementById('cnt').textContent='共 '+rows.length+' 条航线';
  drawMap();
  document.querySelectorAll('.item').forEach(el=>{ el.onclick=()=>{ const k=el.dataset.key; el.classList.toggle('open'); select(k,false); }; });
  if(state.sel&&byKey[state.sel]) select(state.sel,false,true);
}
function select(key,fromMap,quiet){
  state.sel=key;
  document.querySelectorAll('.item').forEach(el=>el.classList.toggle('sel',el.dataset.key===key));
  const r=byKey[key]; drawLine(key);
  if(fromMap){ const el=document.querySelector('.item[data-key="'+key+'"]'); if(el){el.classList.add('open');el.scrollIntoView({behavior:'smooth',block:'center'});} }
  else if(!quiet&&r){ if(markers[key]) markers[key].openTooltip(); }
}
function pickCard(tier,key){
  const r=byKey[key]; if(!r) return '';
  const o=r.options[0];
  const C=TIER_COLOR[tier];
  const w=r.weather;
  const wBadge= w?('<div class="pick-w"><span style="background:'+W[w.grade].bg+';color:'+W[w.grade].color+';padding:1px 6px;border-radius:3px;font-weight:600;font-size:9px">☁ '+W[w.grade].label+' · 雨'+w.prcp+'mm</span></div>'):'';
  return '<div class="pick" data-key="'+key+'" style="border-left:3px solid '+C.dot+'">'+
    '<div class="pick-hd"><span class="tag" style="background:'+C.bg+';color:'+C.txt+'">'+TIER_LABEL[tier]+'</span>该档最低价</div>'+
    '<div class="pick-city">'+r.city+'<span>'+r.code+'</span></div>'+
    '<div class="pick-price">¥'+r.minPrice+'<small>/人往返</small></div>'+
    '<div class="pick-sub">'+r.originCity+' · '+o.depDate.slice(5)+'去'+o.retDate.slice(5)+'回 '+tripDays(o.depDate,o.retDate)+'天 · '
      +(o.direct?'直飞':'<b style="color:#b25a00">⇄ 含中转'+(o.out.stops?'('+o.out.stops+')':'')+'</b>')
      +' · '+o.out.flights.map(f=>f.no).join('+')+' '+o.airlineNames.join('/')+'</div>'+
    wBadge+'</div>';
}
function renderPicks(){
  let h='';
  TIER_KEYS.forEach(t=>{ const p=DATA.picks[t]; if(!p||!p.cheapest) return; h+=pickCard(t,p.cheapest); });
  if(!h) h='<div class="empty">当前各档暂无命中航线</div>';
  document.getElementById('picks').innerHTML=h;
  document.querySelectorAll('.pick').forEach(el=>{
    el.onclick=()=>{ const k=el.dataset.key; const r=byKey[k];
      state.tier='all'; state.regions.clear(); state.origins.clear(); state.q=''; document.getElementById('q').value='';
      document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.tier==='all'));
      document.querySelectorAll('#origins .chip').forEach(t=>t.classList.remove('on'));
      document.querySelectorAll('#regions .chip').forEach(t=>t.classList.remove('on'));
      render(); select(k,true); map.flyTo([r.lat,r.lng],4,{duration:.8}); };
  });
}
function setActiveTab(tier){
  document.querySelectorAll('.tab').forEach(t=>{
    const on=t.dataset.tier===tier; t.classList.toggle('on',on);
    if(on&&tier!=='all'){ const C=TIER_COLOR[tier]; t.style.background=C.dot; t.style.borderColor=C.dot; t.style.color='#fff'; }
    else { t.style.background=''; t.style.borderColor=''; t.style.color=''; }
  });
}
TIER_KEYS.forEach(t=>{ const el=document.createElement('div'); el.className='tab'; el.dataset.tier=t; el.textContent=TIER_LABEL[t]; document.getElementById('tabs').appendChild(el); });
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{ state.tier=t.dataset.tier; setActiveTab(state.tier); render(); });
document.getElementById('sort').onchange=e=>{state.sort=e.target.value;render();};
document.getElementById('q').oninput=e=>{state.q=e.target.value.trim();render();};
const originCities=[...new Set(DATA.routes.map(r=>r.originCode))].map(c=>orgLL[c]).filter(Boolean);
document.getElementById('origins').innerHTML='<span style="font-size:11px;color:var(--tx3);align-self:center">出发地</span>'+originCities.map(o=>'<div class="chip" data-o="'+o.code+'">'+o.city+'</div>').join('');
document.querySelectorAll('#origins .chip').forEach(c=>c.onclick=()=>{ const o=c.dataset.o; if(state.origins.has(o)){state.origins.delete(o);c.classList.remove('on');} else{state.origins.add(o);c.classList.add('on');} render(); });
const regions=[...new Set(DATA.routes.map(r=>r.region))];
document.getElementById('regions').innerHTML='<span style="font-size:11px;color:var(--tx3);align-self:center">区域</span>'+regions.map(r=>'<div class="chip" data-r="'+r+'">'+REGION_NAME[r]+' '+DATA.routes.filter(x=>x.region===r).length+'</div>').join('');
document.querySelectorAll('#regions .chip').forEach(c=>c.onclick=()=>{ const r=c.dataset.r; if(state.regions.has(r)){state.regions.delete(r);c.classList.remove('on');} else{state.regions.add(r);c.classList.add('on');} render(); });
document.getElementById('tierStats').innerHTML=TIER_KEYS.map(t=>{ const c=DATA.routes.filter(r=>r.tier===t).length; const C=TIER_COLOR[t]; return '<span class="pill" style="background:'+C.bg+';border-color:'+C.bc+'"><b>'+c+'</b> 条 '+TIER_LABEL[t]+'</span>'; }).join('');
document.getElementById('statAll').textContent=DATA.routes.length;
document.getElementById('mapLegend').innerHTML='<b>往返价格分档</b>'+TIER_KEYS.map(t=>{const C=TIER_COLOR[t];return '<div><span class="dot" style="background:'+C.dot+'"></span> '+TIER_LABEL[t]+'</div>';}).join('')+'<div style="color:#8b93a1;margin-top:3px">圆点越大＝可选航班/日期越多</div>';
renderPicks(); render();
setTimeout(()=>map.invalidateSize(),300);

/* ---------- 天气模块 ---------- */
const WEATHER=DATA.weather;
if(WEATHER && WEATHER.trips && WEATHER.trips.length){
  const wCities={}; WEATHER.cities.forEach(c=>wCities[c.code]=c);
  const wTrips={}; WEATHER.trips.forEach(t=>wTrips[t.code]=t);
  document.getElementById('wgDry').textContent=WEATHER.gradeCounts.dry||0;
  document.getElementById('wgMild').textContent=WEATHER.gradeCounts.mild||0;
  document.getElementById('wgWet').textContent=WEATHER.gradeCounts.wet||0;
  document.getElementById('wgHeavy').textContent=WEATHER.gradeCounts.heavy||0;
  let wState={grade:'all'};
  function setActiveWTab(g){
    document.querySelectorAll('.wtab').forEach(t=>{ const on=t.dataset.wg===g; t.classList.toggle('on',on);
      if(on&&g!=='all'){ const c=W[g]; t.style.background=c.color; t.style.borderColor=c.color; } else { t.style.background=''; t.style.borderColor=''; } });
  }
  wOrder.forEach(g=>{ const el=document.createElement('div'); el.className='wtab'; el.dataset.wg=g;
    el.innerHTML='<span class="dot" style="background:'+W[g].color+';width:8px;height:8px;display:inline-block;vertical-align:middle;margin-right:3px"></span>'+W[g].label+' <b>'+((WEATHER.gradeCounts[g]||0))+'</b>';
    document.getElementById('wtabs').appendChild(el); });
  document.querySelectorAll('.wtab').forEach(t=>t.onclick=()=>{ wState.grade=t.dataset.wg; setActiveWTab(wState.grade); renderWList(); });
  const wmap=L.map('wmap',{zoomControl:true,worldCopyJump:true,minZoom:1}).setView([20,108],3);
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',{subdomains:['1','2','3','4'],maxZoom:16,attribution:'&copy; 高德地图'}).addTo(wmap);
  ORIGINS.forEach(o=>{ L.circleMarker([o.lat,o.lng],{radius:6,color:'#fff',weight:2,fillColor:'#2563d9',fillOpacity:1}).addTo(wmap).bindTooltip(o.city+' '+o.code+' · 出发地',{permanent:false}); });
  const wLayer=L.layerGroup().addTo(wmap);
  const wMarkers={};
  function wRadius(t){ return 6 + Math.min(11, t.summary.dryDays*1.7); }
  function renderWMap(){
    wLayer.clearLayers();
    WEATHER.trips.forEach(t=>{ const g=W[t.grade];
      const m=L.circleMarker([t.lat,t.lng],{radius:wRadius(t),color:'#fff',weight:1.5,fillColor:g.color,fillOpacity:.85,className:'mk'}).addTo(wLayer);
      m.bindTooltip('<b>'+t.city+'</b> · '+g.label+'<br><span style="color:#666">'+t.originCity+'出发 · 出行 '+t.dep.slice(5)+'~'+t.ret.slice(5)+' · 晴日 '+t.summary.dryDays+'/'+t.summary.days+' · 降雨 '+t.summary.totalPrcp+'mm</span>',{direction:'top',offset:[0,-4]});
      m.on('click',()=>wSelect(t.code,true)); wMarkers[t.code]=m; });
  }
  function wIcon(code,prcp){ if(code==null) return prcp<1?'☀️':(prcp<25?'⛅':'🌧️'); if(code<=3)return'☀️'; if(code<=48)return'⛅'; return'🌧️'; }
  function wRowHTML(t){
    const g=W[t.grade];
    const fc= t.daily && t.daily.length ? t.daily.map(d=>{ const heavy=d.prcp>=25, wet=d.prcp>=1; const col= heavy?'#fdecee':(wet?'#eaf0fd':'#e7f6ee'); return '<div class="wfcday" style="background:'+col+'"><div class="d">'+d.date.slice(5)+'</div><div class="r">'+wIcon(d.code,d.prcp)+'</div><div class="t">'+Math.round(d.tmax)+'°</div><div class="p">💧'+Math.round(d.pop)+'% '+Math.round(d.prcp)+'mm</div></div>'; }).join('') : '';
    return '<div class="wrow" data-code="'+t.code+'">'+
      '<div class="wr-top"><div class="wr-city">'+t.city+'<span class="code">'+t.code+'</span></div><span class="wr-g" style="background:'+g.color+'">'+g.label+'</span></div>'+
      '<div class="wr-sub"><span>'+t.originCity+'出发</span><span>出行 <b>'+t.dep.slice(5)+'~'+t.ret.slice(5)+'</b> · '+t.summary.days+'天</span><span>晴日 <b>'+t.summary.dryDays+'/'+t.summary.days+'</b></span><span>累计降雨 <b>'+t.summary.totalPrcp+' mm</b></span><span>降雨概率均 <b>'+t.summary.avgPop+'%</b></span><span>高温 <b>'+t.summary.tmax+'°</b></span>'+(t.tier?('<span class="badge '+(t.tier==='T1'||t.tier==='T2'?'r':'')+'">机票 '+TIER_LABEL[t.tier]+' ¥'+t.minPrice+'</span>'):'')+'</div>'+
      '<div class="wfc">'+fc+'</div></div>';
  }
  function renderWList(){
    const wg=wState.grade; let h='';
    wOrder.forEach(g=>{ if(wg!=='all'&&wg!==g) return; let ts=WEATHER.trips.filter(t=>t.grade===g); if(!ts.length) return;
      h+='<div class="wgroup-hd"><span class="dot" style="background:'+W[g].color+'"></span>'+W[g].label+'（'+ts.length+'）— '+W[g].desc+'</div>';
      ts.sort((a,b)=> b.summary.dryDays-a.summary.dryDays || a.summary.avgPop-b.summary.avgPop); h+=ts.map(wRowHTML).join(''); });
    document.getElementById('wlist').innerHTML=h || '<div class="empty" style="padding:30px 10px">该分级下暂无目的地</div>';
    document.querySelectorAll('.wrow').forEach(el=>{ el.onclick=()=>{ const c=el.dataset.code; el.classList.toggle('open'); wSelect(c,false); }; });
  }
  function wSelect(code,fromMap,quiet){
    const t=wTrips[code]; if(!t) return;
    document.querySelectorAll('.wrow').forEach(el=>el.classList.toggle('sel',el.dataset.code===code));
    document.getElementById('wcnt').textContent='当前：'+t.city+'（'+t.code+'） · '+W[t.grade].label+' · '+t.originCity+'出发 · 出行 '+t.dep.slice(5)+'~'+t.ret.slice(5)+' · 累计降雨 '+t.summary.totalPrcp+'mm';
    if(fromMap){ const el=document.querySelector('.wrow[data-code="'+code+'"]'); if(el){el.classList.add('open');el.scrollIntoView({behavior:'smooth',block:'center'});} }
    else if(!quiet){ if(wMarkers[code]) wMarkers[code].openTooltip(); }
    wmap.flyTo([t.lat,t.lng], wmap.getZoom()<4?4:wmap.getZoom(), {duration:.7});
  }
  function renderWSrc(){
    const s=WEATHER.sources||[];
    document.getElementById('wsrc').innerHTML='<b>📚 数据来源与引用链接</b>'+
      s.map(x=>'<a href="'+x.url+'" target="_blank" rel="noopener">'+x.name+' <span class="wtag">'+x.url.replace('https://','').replace('http://','')+'</span></a><div class="sdesc">'+x.desc+'</div>').join('')+
      '<div class="sdesc" style="margin-top:6px">预测方法：逐日数值预报与近 5 年同期 ERA5 再分析气候常态推算，仅供参考，出行前请复核官方预警。</div>';
  }
  renderWMap(); renderWList(); renderWSrc();
  setTimeout(()=>wmap.invalidateSize(),300);
}

/* ---------- 枫叶模块 ---------- */
const KOYO=DATA.koyo;
if(KOYO && KOYO.cities && KOYO.cities.length){
  let koyoBest=0;
  function koyoCard(c){
    const best=c.inBest?'<span class="kc-best">🍁 落在最佳观赏窗口 '+c.bestStart+'~'+c.bestEnd+'</span>':'';
    if(c.inBest) koyoBest++;
    return '<div class="kcard'+(c.inBest?' best':'')+'" data-code="'+c.code+'">'+
      '<div class="kc-top"><div class="kc-city">'+c.city+'<span class="code">'+c.code+'</span></div><span class="kc-sw" style="background:'+c.color+'"></span></div>'+
      '<div class="kc-stage" style="color:'+c.color+'">'+c.label+'</div>'+
      '<div class="kc-prog"><i style="width:'+c.progress+'%;background:'+c.color+'"></i></div>'+
      '<div class="kc-sub">变色进度 <b>'+c.progress+'%</b> · '+c.desc+'<br>出行窗口 <b>'+c.winStart.slice(5)+'~'+c.winEnd.slice(5)+'</b><br>盛期 <b>'+c.peak.slice(5)+'</b> · 最佳 <b>'+c.bestStart.slice(5)+'~'+c.bestEnd.slice(5)+'</b></div>'+
      best+'</div>';
  }
  document.getElementById('koyoGrid').innerHTML=KOYO.cities.map(koyoCard).join('');
  document.getElementById('koyoBest').textContent=koyoBest;
  document.querySelectorAll('.kcard').forEach(el=>el.onclick=()=>{
    const c=KOYO.cities.find(x=>x.code===el.dataset.code); if(!c) return;
    map.flyTo([c.lat,c.lng],5,{duration:.8});
  });
}
</script>
</body>
</html>`;

fs.mkdirSync(path.join(ROOT, 'dist', MOD_ID), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', MOD_ID, 'index.html'), html);
console.log('生成 dist/' + MOD_ID + '/index.html (' + Math.round(html.length / 1024) + ' KB)');

// Node 端行程天数计算（浏览器端另有同名函数，作用域隔离）
function tripDays(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

// ---------- 控制台摘要 summary.txt ----------
const out = [];
out.push('# ' + MOD.name + '（' + data.window.start + ' ~ ' + data.window.end + '）');
out.push(MOD.desc);
out.push('数据更新：' + genTime + '　命中航线：' + data.routes.length + ' 条');
out.push('');
for (const t of TIER_KEYS) {
  const p = P[t]; if (!p) continue;
  out.push('### ' + TIER_LABEL[t] + ' 档');
  for (const [k, label] of [['cheapest', '最便宜'], ['discount', '折扣最大'], ['most', '航次最多']]) {
    const r = p[k]; const o = r.options[0];
    out.push('- ' + label + '：' + r.originCity + '→' + r.city + '(' + r.code + ') ¥' + r.minPrice +
      ' | ' + o.depDate + ' 去 / ' + o.retDate + ' 回（' + tripDays(o.depDate, o.retDate) + ' 天）| ' +
      o.out.flights.map(f => f.no).join('+') + ' ' + o.airlineNames.join('/') +
      (o.direct ? ' 直飞' : ' ⇄含中转' + (o.out.stops ? '(去程' + o.out.stops + '次，经' + (o.out.flights || []).slice(0, -1).map(f => f.to).join('/') + ')' : '')) +
      ' | 低于中位价 ' + r.discountPct + '% | 航次 ' + r.optionCount + ' / 日期组合 ' + r.datePairsInBudget);
  }
  out.push('');
}
if (hasWeather) {
  out.push('### ☁️ 天气 · 出行窗口内降雨分级');
  const gc = weatherPayload.gradeCounts;
  out.push('- 🟢 干爽少雨 ' + (gc.dry || 0) + ' 个 · 🔵 偶有阵雨 ' + (gc.mild || 0) + ' 个 · 🟡 多雨 ' + (gc.wet || 0) + ' 个 · 🔴 强降雨频繁 ' + (gc.heavy || 0) + ' 个');
  const best = wraw.trips.filter(t => t.grade === 'dry' || t.grade === 'mild').sort((a, b) => b.summary.dryDays - a.summary.dryDays || a.summary.avgPop - b.summary.avgPop);
  out.push('- 出行窗口内最干爽：' + best.slice(0, 8).map(t => t.city + '(' + t.code + ') ' + t.originCity + '出发 晴' + t.summary.dryDays + '/' + t.summary.days + '·累计降雨' + t.summary.totalPrcp + 'mm').join('、'));
  out.push('');
}
if (hasKoyo) {
  out.push('### 🍁 枫叶颜色监控（' + wraw.koyo.year + ' 年）');
  out.push('- 落在最佳观赏窗口内的目的地：' + wraw.koyo.cities.filter(c => c.inBest).map(c => c.city + '(' + c.label + '·盛期' + c.peak.slice(5) + ')').join('、') || '无');
  out.push('- 各城市枫叶阶段：' + wraw.koyo.cities.slice(0, 15).map(c => c.city + '=' + c.label + '(' + c.progress + '%)').join('、'));
  out.push('');
}
fs.writeFileSync(path.join(ROOT, 'data', MOD_ID, 'summary.txt'), out.join('\n'));
console.log('生成 data/' + MOD_ID + '/summary.txt');

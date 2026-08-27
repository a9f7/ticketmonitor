// 构建分模块页面：dist/<moduleId>/index.html + data/<moduleId>/summary.txt
// 天气与枫叶为可选区块，保持「左侧地图 + 右侧可排序列表」架构一致。
// 用法: node build.js <moduleId>
const fs = require('fs');
const path = require('path');
// 强制 stdout/stderr 立即 flush：Node 在 pipe 模式下 stdout 仍会 block-buffer，
// 所以把 console.log/info/error 全部重定向到 stderr（stderr 在 pipe 模式下 unbuffered）。
{
  const flush = (args) => {
    const s = args.map(a => typeof a === 'string' ? a : require('util').inspect(a)).join(' ') + '\n';
    fs.writeSync(process.stderr.fd, s);
  };
  console.log = function (...a) { flush(a); };
  console.info = console.log;
  console.error = function (...a) { flush(a); };
}
const { MODULES, GBA_ORIGINS, EXTRA_DEPARTURES } = require('./modules');
const PH = require('./price_history');
const { seasonOf, seasonOffset, activeWindow } = require('./seasons');
const TRIP_CITY = require('./city_trip_id');

function isDomesticRoute(r){
  const a=TRIP_CITY[r.originCode], b=TRIP_CITY[r.code];
  return !!(a && b && a.country===1 && b.country===1);
}

const ROOT = path.resolve(__dirname, '..');

// ---------- 构建版本号（用于 GitHub / CloudStudio 对齐） ----------
// 同一轮 pipeline 会分模块多次调用本脚本，为保证各模块版本号一致，
// 版本号缓存在 ROOT/.build-version（{version,ts}）。距上次构建 <6h 复用，
// 否则刷新，确保跨次发布生成新版本号。格式：YYYYMMDD-HHmm。
const VERSION_FILE = path.join(ROOT, '.build-version');
let BUILD_VERSION;
try {
  const _prev = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  if (Date.now() - new Date(_prev.ts).getTime() < 6 * 3600 * 1000) BUILD_VERSION = _prev.version;
} catch (_) {}
if (!BUILD_VERSION) {
  const _d = new Date();
  const _p = n => String(n).padStart(2, '0');
  BUILD_VERSION = `${_d.getFullYear()}${_p(_d.getMonth() + 1)}${_p(_d.getDate())}-${_p(_d.getHours())}${_p(_d.getMinutes())}`;
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: BUILD_VERSION, ts: _d.toISOString() }));
}
let BUILD_TS_ISO;
try { BUILD_TS_ISO = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')).ts; } catch (_) { BUILD_TS_ISO = new Date().toISOString(); }

const MOD_ID = process.argv[2] || 'gba-summer';
const MOD = MODULES[MOD_ID];
if (!MOD) { console.error('未知模块: ' + MOD_ID); process.exit(1); }

// 春节专项导航是否展示：仅当当前处于寒假（冬季）且 gba-spring 已有有效数据时才出现；
// 暑假期间（或非冬季）一律隐藏，满足「和寒假并列、暑假不出现」的需求。
const SPRING_NAV = (() => {
  const t = process.env.TEST_TODAY ? new Date(process.env.TEST_TODAY) : new Date();
  if (activeWindow(t).season !== 'winter') return false;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'gba-spring', 'flights.json'), 'utf8'));
    return (d.routes || []).length > 0;
  } catch (e) { return false; }
})();

// 历史价格存档：每次构建时把本次抓取的最低价组合累积进 data/<id>/price_history.json
// （按 flights.generatedAt 去重，重复构建同一份文件不会重复累积）。随后载入供渲染比对。
try {
  const _f = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', MOD_ID, 'flights.json'), 'utf8'));
  const _r = PH.updateHist(MOD_ID, _f);
  if (_r.added) console.error('[history] 累积 ' + _r.added + ' 条历史价格样本');
} catch (e) { console.error('[history] 读取/累积失败: ' + e.message); }
const HIST = PH.loadHist(MOD_ID);

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', MOD_ID, 'flights.json'), 'utf8'));

// 日本模块：固定 5 档价格分档，上限封顶到 3000+（贴合本次需求）。
const JAPAN_TIERS = [
  { key: 'T1', cap: 1500, label: '<¥1500' },
  { key: 'T2', cap: 2000, label: '¥1500–2000' },
  { key: 'T3', cap: 2500, label: '¥2000–2500' },
  { key: 'T4', cap: 3000, label: '¥2500–3000' },
  { key: 'T5', cap: Infinity, label: '¥3000+' },
];
const TIERS = MOD_ID === 'japan-koyo' ? JAPAN_TIERS : MOD.tiers;
// 重新为日本模块航线分配 tier 并校正「预算内日期组合数」
if (MOD_ID === 'japan-koyo') {
  for (const r of data.routes) {
    const t = TIERS.find(t => r.minPrice <= t.cap);
    r.tier = t ? t.key : 'T5';
    const cap = (TIERS.find(t => t.key === r.tier) || {}).cap || Infinity;
    r.datePairsInBudget = (r.cheapestPairs || []).filter(p => p.price <= cap).length;
  }
}
const TIER_KEYS = TIERS.map(t => t.key);
const TIER_LABEL = Object.fromEntries(TIERS.map(t => [t.key, t.label]));
const TIER_PALETTE = ['#e02b3c', '#f0731e', '#e0a91e', '#1f9bb3', '#2563d9'];
const TIER_COLOR = {};
TIERS.forEach((t, i) => {
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
const FALL_COLOR = '#9c6b3f';
// 枫叶定向搜索结果：抓取阶段已按各目的地红叶期筛选，这里读取剔除清单用于顶部提示条
const REASON_META = {
  fallen: { label: '落叶期', color: '#9c6b3f', desc: '监控窗口开始时已过红叶期' },
  green: { label: '绿叶期', color: '#2f9e44', desc: '监控窗口结束时仍未变色' },
  short: { label: '红叶期过短', color: '#b8860b', desc: '红叶期与窗口交集排不出完整行程' },
  'no-flight': { label: '无低价航班', color: '#8f9296', desc: '红叶期内未搜到符合条件的低价航班' },
};
const koyoFilter = data.koyoFilter || (wraw && wraw.koyo && wraw.koyo.filter) || null;
// 兼容旧数据：无 koyoFilter 时退回「按阶段筛出落叶期」的老口径
const koyoExcluded = koyoFilter ? (koyoFilter.excluded || [])
  : (hasKoyo ? wraw.koyo.cities.filter(c => c.stage === 'falling')
      .map(c => ({ code: c.code, city: c.city, lat: c.lat, lng: c.lng, reason: 'fallen', reasonText: '出行窗口内已入落叶期' })) : []);
// 按原因分组（保持 REASON_META 的键顺序）
const koyoExGroups = Object.keys(REASON_META)
  .map(k => ({ reason: k, ...REASON_META[k], items: koyoExcluded.filter(x => x.reason === k) }))
  .filter(g => g.items.length);
const koyoKept = koyoFilter ? koyoFilter.keptCount : (hasKoyo ? wraw.koyo.cities.length : 0);
const RED_LABELS = koyoFilter && koyoFilter.redStages ? koyoFilter.redStages.map(s => s.label).join(' → ') : '初红 → 半红 → 满红';

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

// ============ 酒店推荐数据（按目的地生成，链接到 OTA 搜索/预订页） ============
// 说明：无实时酒店库存接口，按「品牌模板 + 目的地城市名」生成可跳转的真实预订搜索页。
const HOTEL_CATS = [
  { key:'budget', label:'平价酒店', icon:'💰', color:'#0f9960' },
  { key:'chain',  label:'外资连锁酒店', icon:'🏨', color:'#2563d9' },
  { key:'airbnb', label:'Airbnb', icon:'🏡', color:'#e02b3c' },
];
const JP_AREAS = ['北海道','東北','関東','中部','近畿','中国','四国','九州','沖縄'];
function isJapanDest(area, city){ return JP_AREAS.includes(area) || /[ぁ-んァ-ヶ]/.test(city||''); }
function budgetBrands(area, city){
  if(isJapanDest(area,city)) return ['东横INN','APA酒店','Super Hotel','Route-Inn'];
  if(area==='domestic'||area==='国内') return ['如家酒店','汉庭酒店','锦江之星','7天连锁'];
  return ['ibis budget','Travelodge','easyHotel','OYO'];
}
const CHAIN_BRANDS = [['万豪','Marriott'],['希尔顿','Hilton'],['凯悦','Hyatt'],['洲际','IHG']];
const AIRBNB_TIERS = [['经济型',200,400],['舒适型',400,800],['高级型',800,1500],['豪华型',1500,5000]];
function bookingSearch(brand, city){ return 'https://www.booking.com/searchresults.html?ss='+encodeURIComponent(brand+' '+city)+'&checkin=__CHECKIN__&checkout=__CHECKOUT__&group_adults=1&no_rooms=1&group_children=0&lang=zh-cn&selected_currency=CNY'; }
function airbnbSearch(city, min, max){ return 'https://www.airbnb.cn/s/'+encodeURIComponent(city)+'/homes?checkin=__CHECKIN__&checkout=__CHECKOUT__&price_min='+min+'&price_max='+max; }
const HOTELS_REAL = require('./hotels_real');   // 真实酒店坐标库（覆盖 ~80+ 主要旅游/商务城市）
const CITY_TRIP_ID = require('./city_trip_id'); // 携程 d-city 编号映射（IATA → {country, city, name}）
function synthHotels(city, code){
  // 缺真实坐标时退回到「品牌模板 + 城市」合成数据（selectDest 会按 8 瓣花散布到合理区域）
  const budget=budgetBrands('',city).map((b,i)=>({ name:b+' '+city, brand:b, cat:'budget', price:220+i*45, url:bookingSearch(b,city) }));
  const chain=CHAIN_BRANDS.map(b=>({ name:b[0]+' '+city, brand:b[1], cat:'chain', price:620+CHAIN_BRANDS.indexOf(b)*200, url:bookingSearch(b[1],city) }));
  const airbnb=AIRBNB_TIERS.map(t=>({ name:t[0]+'房源 · '+city, brand:'Airbnb', cat:'airbnb', price:t[1], priceMax:t[2], url:airbnbSearch(city,t[1],t[2]) }));
  return { budget, chain, airbnb };
}
function buildHotels(){
  const out={};
  for(const r of (data.routes||[])){
    const city=r.city, code=r.code, area=r.area;
    const real = HOTELS_REAL[code];
    if(real && real.length){
      // 真实酒店按 cat 分桶，并补全缺失的 url（部分真实库条目只含坐标/价格，无外链）→ 兜底到品牌+城市搜索
      const norm = h => h.url ? h : ({ ...h, url: h.cat==='airbnb' ? airbnbSearch(city, h.price||200, h.priceMax||h.price||5000) : bookingSearch(h.brand||h.name||'', city) });
      const budget = real.filter(h=>h.cat==='budget').map(norm);
      const chain  = real.filter(h=>h.cat==='chain').map(norm);
      const airbnb = real.filter(h=>h.cat==='airbnb').map(norm);
      // 补齐各类到至少 2 家（防御真实库类别不足）
      const fill=(cat, items)=>{
        if(items.length>=2) return items;
        const { budget: b, chain: c, airbnb: a } = synthHotels(city, code);
        const more=[...items, ...b, ...c, ...a].filter(x=>x.cat===cat);
        return [...items, ...more].slice(0,4);
      };
      out[code]={ city, code, lat:r.lat, lng:r.lng, area,
        budget: fill('budget', budget),
        chain:  fill('chain',  chain),
        airbnb: fill('airbnb', airbnb),
        real: true,    // 标记，方便 selectDest 区分渲染
      };
    } else {
      const s = synthHotels(city, code);
      out[code]={ city, code, lat:r.lat, lng:r.lng, area, ...s, real: false };
    }
  }
  return out;
}
const HOTELS = buildHotels();

const payload = {
  moduleId: MOD_ID, moduleName: MOD.name, generatedAt: data.generatedAt, genTime,
  origins: data.origins, origin: data.origin, window: data.window,
  gbaCodes: GBA_ORIGINS.map(e=>e.code), extraCodes: EXTRA_DEPARTURES.map(e=>e.code),
  tripDuration: data.tripDuration, excludedAirlines: data.excludedAirlines, priceCap: data.priceCap,
  routes: data.routes.map(r => {
    const pairs = (r.cheapestPairs || []).map(p => ({ ...p, seasonKey: PH.winKeyOf(MOD_ID, r.originCode, r.code, p.dep) }));
    return { ...r, isDomestic: isDomesticRoute(r), cheapestPairs: pairs };
  }),
  hotelDomain: MOD.hotelDomain || 'ctrip',
  picks: Object.fromEntries(TIER_KEYS.map(t => [t, P[t] ? { cheapest: P[t].cheapest.key, discount: P[t].discount.key, most: P[t].most.key } : null])),
  weather: weatherPayload,
  cityTripId: CITY_TRIP_ID,   // 携程 d-city 编号映射，注入页面供 tripMapUrl 使用
  priceHist: (() => {
    // 同期聚合：按 出发地>目的地 | 窗口内偏移 合并跨年样本，只做同期对比
    //   gba 寒暑期 → 季节内偏移；日本红叶季 → 距 9/15 偏移；全球滚动年 → 距 7/31 偏移
    const o = {};
    for (const r of (data.routes || [])) {
      for (const p of (r.cheapestPairs || [])) {
        const sk = PH.winKeyOf(MOD_ID, r.originCode, r.code, p.dep);
        if (o[sk]) continue;
        const st = PH.aggregateByWinKey(HIST, MOD_ID, r.originCode, r.code, p.dep);
        if (st) {
          const pp = PH.winKeyParts ? PH.winKeyParts(MOD_ID, p.dep) : { group: '', offset: 0 };
          o[sk] = { median: st.median, count: st.count, season: pp.group, offset: pp.offset };
        }
      }
    }
    return o;
  })(),  // 同期历史价格中位数+样本数，供标注"历史低价"（寒假比寒假、红叶季比红叶季、全球同期比同期）
  koyo: hasKoyo ? {
    ...wraw.koyo,
    excluded: koyoExcluded.map(c => ({ code: c.code, city: c.city, lat: c.lat, lng: c.lng,
      reason: c.reason, reasonText: c.reasonText, redStart: c.redStart, redEnd: c.redEnd,
      color: (REASON_META[c.reason] || REASON_META.fallen).color,
      label: (REASON_META[c.reason] || REASON_META.fallen).label })),
  } : null,
  hotels: HOTELS, hotelCats: HOTEL_CATS,
};

// ================= HTML =================
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${MOD.title}（${data.window.start} ~ ${data.window.end}）</title>
<meta name="build-version" content="${BUILD_VERSION}">
<meta name="build-time" content="${BUILD_TS_ISO}">
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
.fly-btns{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.fly-btns a{font-size:11px;line-height:1;padding:5px 9px;border-radius:7px;font-weight:600;text-decoration:none;white-space:nowrap;border:1px solid transparent}
.fly-btns a.fly-trip{background:#2563d9;color:#fff}
.fly-btns a.fly-trip:hover{background:#1d4ed8}
.fly-btns a.fly-sky{background:#fff;border-color:#d8dee8;color:#e02b3c}
.fly-btns a.fly-sky:hover{background:#fff5f4;border-color:#f3c2bd}
.dark .fly-btns a.fly-sky{background:#1b1f26;border-color:#3a4150;color:#ff6b78}
.dark .fly-btns a.fly-qunar{background:#1b1f26;border-color:#3a4150;color:#ff6b78}
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
.it-price.hist-on{background:#fdeceb;border-radius:8px;padding:3px 9px;box-shadow:0 0 0 2px rgba(224,36,27,.16)}
.hist-low{color:#e0241b;font-weight:800}
.hist-tag{display:inline-block;margin-left:4px;padding:1px 6px;border-radius:9px;background:#e0241b;color:#fff;font-size:10px;font-weight:700;vertical-align:middle;white-space:nowrap}
.hist-med{color:#8b93a1;font-size:10.5px;font-weight:400;margin-left:4px;white-space:nowrap}
.alts table td.ta-r{text-align:right;white-space:nowrap}
.it-line{font-size:11.5px;color:var(--tx2);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.it-koyo{font-size:11px;margin-top:4px;padding:2px 0;border-top:1px dashed var(--line)}
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
/* 粘性城市选择器（顶部下拉时一直可见） */
.sticky-selector{position:sticky;top:0;z-index:1100;background:rgba(255,255,255,.96);backdrop-filter:saturate(180%) blur(10px);-webkit-backdrop-filter:saturate(180%) blur(10px);border:1px solid var(--line);border-radius:12px;padding:8px 12px;margin:8px 0 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;box-shadow:0 2px 12px rgba(20,30,50,.06);isolation:isolate}
.sticky-selector .ss-label{font-size:11.5px;color:var(--tx3);font-weight:600;display:flex;align-items:center;gap:4px;white-space:nowrap}
.sticky-selector .ss-current{flex:0 0 auto;font-size:14px;font-weight:700;color:var(--tx);display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--blue-soft);border:1px solid #b9cdf5;border-radius:8px;min-width:140px}
.sticky-selector .ss-current .code{font-size:10.5px;color:var(--tx3);font-weight:500;background:#fff;padding:1px 6px;border-radius:4px}
.sticky-selector .ss-current.empty{background:#f5f6f8;border-color:var(--line);color:var(--tx3);font-weight:500;font-size:12.5px}
.sticky-selector select#ssSelect{flex:1;min-width:200px;max-width:340px;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12.5px;background:#fff;color:var(--tx);font-family:inherit;cursor:pointer;outline:none}
.sticky-selector select#ssSelect:focus{border-color:var(--blue)}
.sticky-selector select#ssOriginSelect{flex:0 0 auto;min-width:138px;max-width:180px;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12.5px;background:#fff;color:var(--tx);font-family:inherit;cursor:pointer;outline:none}
.sticky-selector select#ssOriginSelect:focus{border-color:var(--blue)}
.sticky-selector .ss-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--tx2)}
.sticky-selector .ss-meta .ss-pill{background:#f5f6f8;border:1px solid var(--line);border-radius:14px;padding:2px 9px;white-space:nowrap}
.sticky-selector .ss-meta .ss-pill b{color:var(--tx);font-weight:600}
.sticky-selector .ss-meta .ss-pill.p{background:var(--red-soft);border-color:#f6cdd2;color:var(--red);font-weight:600}
.sticky-selector .ss-meta .ss-pill.t{background:#fff7e0;border-color:#f3ddb8;color:#8a5b12}
@media(max-width:780px){.sticky-selector{padding:7px 9px;gap:7px}.sticky-selector .ss-current{min-width:auto;font-size:12.5px;padding:3px 8px}.sticky-selector select#ssSelect{min-width:140px}}
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
.wgroup-hd{font-size:11px;font-weight:700;color:var(--tx2);padding:6px 8px 3px;display:flex;align-items:center;gap:6px;position:sticky;top:0;background:#fff;z-index:2}
.wrow{border:1px solid var(--line);border-radius:9px;padding:6px 9px;margin-bottom:5px;cursor:pointer;transition:.13s;background:#fff}
.wrow:hover{border-color:#c3cddd;box-shadow:0 2px 10px rgba(20,30,50,.06)}
.wrow.sel{border-color:var(--blue);box-shadow:0 0 0 2px var(--blue-soft)}
.wr-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.wr-city{font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px}
.wr-city .code{font-size:10px;color:var(--tx3);font-weight:500;background:#f2f4f7;padding:1px 5px;border-radius:4px}
.wr-g{font-size:10px;padding:1px 7px;border-radius:4px;color:#fff;font-weight:600;white-space:nowrap}
.wr-sub{font-size:10.5px;color:var(--tx2);margin-top:2px;display:flex;gap:6px;flex-wrap:wrap;row-gap:2px}
.wr-sub b{color:var(--tx);font-weight:600}
.wfc{border-top:1px solid var(--line2);margin-top:5px;padding-top:5px;display:none}
.wrow.open .wfc{display:block}
.wfclist{display:flex;overflow-x:auto;gap:3px;padding-bottom:3px;-webkit-overflow-scrolling:touch}
.wfclist::-webkit-scrollbar{height:5px}.wfclist::-webkit-scrollbar-thumb{background:#d3d8e0;border-radius:3px}
.wfcday{flex:0 0 auto;width:54px;border:1px solid var(--line2);border-radius:6px;padding:3px 2px 2px;text-align:center;font-size:9.5px;line-height:1.25;background:#fafbfc}
.wfcday .d{color:var(--tx3);font-size:9px}.wfcday .t{font-weight:700;font-size:10.5px}
.wfcday .p{font-size:9px;color:var(--blue);white-space:nowrap}.wfcday .r{font-size:13px}
@media(max-width:1100px){.wfcday{width:50px;padding:3px 1px}.wfcday .r{font-size:12px}}
@media(max-width:780px){.wfcday{width:46px;font-size:9px}.wfcday .t{font-size:10px}.wfcday .p{font-size:8.5px}.wr-city{font-size:13px}.wr-sub{font-size:10px;gap:5px}}
@media(max-width:420px){.wfcday{width:42px;padding:2px 1px}.wfcday .r{font-size:11px}.wrow{padding:5px 7px}}
.wsrc{margin-top:12px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:11px 13px}
.wsrc b{font-size:12px;display:block;margin-bottom:6px}
.wsrc a{color:var(--blue);text-decoration:none;font-size:11.5px;display:block;margin:3px 0;word-break:break-all}
.wsrc a:hover{text-decoration:underline}.wsrc .sdesc{color:var(--tx3);font-size:10.5px}
.wtag{font-size:9.5px;padding:0 5px;border-radius:3px;background:#eef0f3;color:var(--tx3);margin-left:4px}
.flight-source{margin-top:14px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.flight-source>b{font-size:12.5px;display:block;margin-bottom:8px;color:var(--tx)}
.flight-source .fs-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center}
.flight-source .fs-desc{font-size:11px;color:var(--tx3);line-height:1.75}
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

/* 酒店推荐板块 */
.htab{font-size:11px;padding:4px 10px;border:1px solid var(--line);border-radius:14px;background:var(--panel);cursor:pointer;color:var(--tx2);font-weight:600;transition:.15s;white-space:nowrap}
.htab:hover{border-color:#c9d2e0}
.htab.on{background:var(--tx);color:#fff;border-color:var(--tx)}
.hotel-main{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.hotel-main.embed{grid-template-columns:1fr}   /* 切到携程/Booking/OSM 嵌入时独享整宽（嵌入页自含酒店列表） */
.hotel-main.embed .hotel-list{display:none}
.hotel-map-wrap{position:relative;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#eef0f3}
/* 5 视图 tab：Leaflet / OSM / 携程 / Booking / Airbnb；分类标签紧靠右侧，只在「自做标点」显示 */
.hotel-views{display:flex;justify-content:space-between;align-items:flex-start;gap:6px;padding:6px 8px;flex-wrap:wrap;border-bottom:1px solid var(--line);background:#f7f9fc}
.hvtab-group{display:flex;gap:6px;flex-wrap:wrap;flex:1 1 auto}
.hotel-cat-tabs{display:none;gap:6px;flex-wrap:wrap;margin-left:auto}
.hotel-cat-tabs.show{display:flex}
.hvtab{font-size:11px;padding:4px 10px;border:1px solid var(--line);border-radius:14px;background:#fff;cursor:pointer;color:var(--tx2);font-weight:600;transition:.15s}
.hvtab.on{background:var(--blue);color:#fff;border-color:var(--blue)}
.hvtab:hover{border-color:var(--blue);color:var(--blue)}
.hvtab.on:hover{color:#fff}
.hotel-view-stage{position:relative;width:100%;height:580px}
#hotelMap, #hotelOsm, #hotelTrip, #hotelBooking{position:absolute;inset:0;width:100%;height:100%;border:0}
/* 设备感知：桌面宽屏给 iframe 更大高度，窄屏/移动端让移动版页面也能完整展示 */
@media(min-width:1200px){ .hotel-view-stage{height:620px} #hotelMap{height:620px} }
@media(max-width:1100px){ .hotel-view-stage{height:560px} #hotelMap{height:560px} }
@media(max-width:900px){ .hotel-view-stage{height:520px} #hotelMap{height:520px} }
.hotel-narrow-tip{display:none;align-items:center;gap:8px;padding:6px 10px;margin-bottom:8px;background:#fff8e6;border:1px solid #f0dca0;border-radius:8px;font-size:11px;color:#7a5c1a}
.hotel-narrow-tip.show{display:flex}
.hotel-narrow-tip a{color:var(--blue);text-decoration:none;border-bottom:1px dashed var(--blue)}
#hotelMap{background:#eef0f3}
.hotel-iframe-wrap{position:absolute;inset:0;background:#fff}
.hotel-iframe-wrap iframe{width:100%;height:100%;border:0;display:block}
.hotel-iframe-fail{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:8px;background:#fff;padding:20px;text-align:center}
.hotel-iframe-fail.show{display:flex}
.hotel-iframe-fail a{color:var(--blue);text-decoration:none;border-bottom:1px dashed var(--blue)}
#hotelMap{height:580px;width:100%}
/* Airbnb 专用降级卡片（不用 iframe：X-Frame-Options 拒绝时 Chrome 会在 native 层画 ERR_BLOCKED_BY_RESPONSE，盖不住 host 文档的 div；索性不放 iframe，整张卡片占位） */
#hotelAirbnbWrap{background:linear-gradient(135deg,#fff5f6 0%,#fff 70%)}
.airbnb-card{display:flex;flex-direction:column;align-items:center;gap:14px;max-width:420px;padding:0 12px}
.airbnb-card .airbnb-logo{font-size:42px;line-height:1}
.airbnb-card .airbnb-title{font-size:15px;font-weight:700;color:#e02b3c}
.airbnb-card .airbnb-desc{font-size:12px;color:var(--tx3);line-height:1.55}
.airbnb-card .airbnb-btn{display:inline-flex;align-items:center;gap:6px;padding:11px 22px;background:#e02b3c;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:13.5px;box-shadow:0 3px 10px rgba(224,43,60,.28);transition:.15s;border-bottom:0!important}
.airbnb-card .airbnb-btn:hover{background:#c0111f;box-shadow:0 4px 14px rgba(192,17,31,.35);transform:translateY(-1px)}
/* 酒店信息浮层（右下角小角标，避开左上 tab + 右上瓦片控件） */
.hotel-mode{position:absolute;left:10px;bottom:28px;z-index:500;background:rgba(255,255,255,.88);border:1px solid var(--line);border-radius:6px;padding:4px 10px;font-size:10.5px;color:var(--tx2);box-shadow:0 1px 4px rgba(20,30,50,.08);max-width:340px;line-height:1.4;pointer-events:auto;text-align:left}
.hotel-mode b{color:var(--tx);font-weight:600}
.hotel-back{cursor:pointer;border:1px solid var(--line);background:#fff;border-radius:14px;padding:2px 10px;font-size:11px;color:var(--tx2);transition:.15s;pointer-events:auto;margin-left:6px}
.hotel-back:hover{border-color:var(--blue);color:var(--blue)}
.hotel-tiles-ctrl{position:absolute;right:10px;top:10px;z-index:500;background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:8px;padding:4px 8px;font-size:11px;color:var(--tx2);box-shadow:0 2px 8px rgba(20,30,50,.1)}
.hotel-tiles-ctrl label{cursor:pointer;margin-right:6px;display:inline-flex;align-items:center;gap:2px}
.hotel-tiles-ctrl input{margin:0 2px 0 0;vertical-align:middle}
.hotel-tiles-ctrl label:last-child{margin-right:0}
.hotel-list{max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-right:4px}
.hotel-card{display:block;text-decoration:none;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 12px;transition:.15s}
.hotel-card:hover{border-color:#c9d2e0;box-shadow:0 3px 12px rgba(20,30,50,.08);transform:translateY(-1px)}
.hotel-actions{display:flex;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid var(--line2);flex-wrap:wrap}
.hotel-actions a{flex:1;min-width:120px;text-align:center;text-decoration:none;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:11.5px;color:var(--tx);background:#fff;transition:.15s}
.hotel-actions a:hover{border-color:var(--blue);color:var(--blue);transform:translateY(-1px)}
.hotel-actions a.trip{border-color:#e02b3c;color:#e02b3c}
.hotel-actions a.trip:hover{background:#fef3f4;color:#c0111f;border-color:#c0111f}
.hotel-actions a.booking{border-color:#003b95;color:#003b95}
.hotel-actions a.booking:hover{background:#eaf0fd;color:#003b95}
.hotel-actions a.airbnb{border-color:#e02b3c;color:#e02b3c}
.hotel-actions a.airbnb:hover{background:#fdeef0;color:#c0111f;border-color:#c0111f}
.hotel-list-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.hotel-list-head .ttl{font-weight:700;color:var(--tx);font-size:13px}
.hc-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px}
.hc-cat{font-size:10px;font-weight:700;color:#fff;padding:1px 8px;border-radius:10px}
.hc-price{font-size:13px;font-weight:700;color:var(--red);font-variant-numeric:tabular-nums}
.hc-name{font-size:13px;font-weight:600}
.hc-go{font-size:11px;color:var(--blue);margin-top:3px}
.hc-go a{color:var(--blue);text-decoration:none}
.hc-go a:hover{text-decoration:underline}
.hc-go::after{content:'点击卡片定位地图 · 链接跳转携程 →';color:var(--tx3);font-size:10.5px;display:block;margin-top:1px}
.hotel-card{cursor:pointer}
.hotel-card.is-sel{border-color:#ff7a00;box-shadow:0 0 0 2px rgba(255,122,0,.18)}
/* 酒店价格气泡 marker（divIcon） */
.hm-icon{background:transparent!important;border:0!important}
.hm-wrap{position:relative;width:0;height:0}
.hm-dot{position:absolute;left:-4px;top:-4px;width:8px;height:8px;background:#fff;border:2px solid var(--blue);border-radius:50%;box-shadow:0 1px 3px rgba(20,30,50,.35)}
.hm-bubble{position:absolute;left:0;top:-30px;transform:translateX(-50%);background:#fff;border:1.5px solid var(--line);border-radius:7px;padding:2px 7px;font-size:11.5px;font-weight:700;color:var(--tx);white-space:nowrap;box-shadow:0 2px 6px rgba(20,30,50,.18);cursor:pointer;transition:transform .15s,box-shadow .15s,border-color .15s;user-select:none;pointer-events:auto}
.hm-bubble:hover{transform:translateX(-50%) scale(1.12);z-index:1000}
.hm-bubble.budget{border-color:#0f9960;color:#0f9960}
.hm-bubble.chain{border-color:#2563d9;color:#2563d9}
.hm-bubble.airbnb{border-color:#e02b3c;color:#e02b3c}
.hm-bubble.sel{border-color:#ff7a00;color:#ff7a00;background:#fff8ee;box-shadow:0 0 0 3px rgba(255,122,0,.22),0 4px 12px rgba(255,122,0,.4);transform:translateX(-50%) scale(1.22);z-index:1000}
.hm-bubble::after{content:'';position:absolute;left:50%;bottom:-5px;margin-left:-4px;width:0;height:0;border:4px solid transparent;border-top-color:inherit;border-bottom:0}
.hotel-global{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.hg-card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer;transition:.15s}
.hg-card:hover{border-color:#c9d2e0;box-shadow:0 3px 12px rgba(20,30,50,.08)}
.hg-card b{font-size:13px}
.hg-card span{display:block;font-size:10.5px;color:var(--tx3);margin-top:2px}
@media(max-width:780px){ .hotel-main{grid-template-columns:1fr} #hotelMap{height:460px} .hotel-view-stage{height:460px} .hotel-list{max-height:320px} .hotel-views{padding:5px 6px;flex-wrap:wrap} .hvtab{font-size:10px;padding:3px 7px} .hotel-cat-tabs{gap:4px;flex-wrap:wrap} .htab{font-size:10px;padding:3px 7px}
  .picks{flex-wrap:wrap;overflow-x:visible} .pick{flex:1 1 calc(50% - 5px);min-width:0} .flight-source .fs-desc{font-size:10.5px} .flight-source .fs-row{margin-bottom:8px} }
@media(max-width:480px){ #hotelMap{height:420px} .hotel-view-stage{height:420px} .hvtab{font-size:9.5px;padding:3px 6px} .pick{flex:1 1 100%} .picks{gap:8px} .foot{font-size:10px} .sticky-selector select#ssSelect,#ssOriginSelect{flex:1 1 100%;max-width:none} }
.koyo-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-top:8px}
.koyo-legend div{display:flex;align-items:center;gap:5px}
#kMap{height:400px;border-radius:10px;border:1px solid var(--line);margin-top:10px;background:#eaf3fb}
.kmap-wrap{position:relative}
.kmap-legend{position:absolute;top:10px;left:10px;background:rgba(255,255,255,.96);border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-size:11px;z-index:500;box-shadow:0 2px 8px rgba(0,0,0,.08);max-width:240px}
.kmap-legend b{display:block;margin-bottom:5px;font-size:11.5px;color:var(--tx)}
.kmap-legend div{display:flex;align-items:center;gap:5px;margin:2px 0;color:var(--tx2);line-height:1.45}
.kcard.sel{box-shadow:0 0 0 2px var(--blue);border-color:var(--blue)}
.kcard.flash{animation:kflash 1.2s}
@keyframes kflash{0%{background:#fff7d6}100%{background:#fff}}
.kmk-best{animation:kpulse 1.6s infinite}
@keyframes kpulse{0%,100%{box-shadow:0 0 0 0 rgba(216,57,43,.55)}50%{box-shadow:0 0 0 6px rgba(216,57,43,0)}}
.hub-back{font-size:12px;color:var(--blue);text-decoration:none}
.modnav{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.modnav-i{font-size:12.5px;padding:7px 14px;border:1px solid var(--line);border-radius:8px;text-decoration:none;color:var(--tx2);background:#fff;transition:.12s;white-space:nowrap;font-weight:500}
.modnav-i:hover{border-color:var(--blue);color:var(--blue);background:#fafbfc}
.modnav-i.on{background:var(--tx);color:#fff;border-color:var(--tx);font-weight:600;cursor:default}
.modnav-i.on:hover{background:var(--tx);color:#fff;border-color:var(--tx)}
/* 枫叶「已排除」提示条 */
.exclude-bar{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;margin-bottom:10px;border-radius:10px;background:linear-gradient(0deg,#fbf2e6,#fdf7eb);border:1px solid #e9d3ad;border-left:4px solid #9c6b3f;color:#5c431d;font-size:12.5px;line-height:1.55}
.exclude-bar b{color:#7a4f1f;font-weight:700}
.exclude-bar .ex-icon{flex:0 0 22px;height:22px;border-radius:50%;background:#9c6b3f;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:1px}
.exclude-bar .ex-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}
.exclude-bar .ex-tag{font-size:11px;padding:2px 9px;border-radius:14px;background:#fff;border:1px solid #d9c5a3;color:#6b4a23;font-weight:500;display:inline-flex;align-items:center;gap:4px}
.exclude-bar .ex-tag .dot{width:8px;height:8px;border-radius:50%;background:#9c6b3f}
.exclude-bar .ex-hint{margin-top:4px;font-size:11px;color:#8a6f44}
.exclude-bar .ex-tag i{font-style:normal;color:#9a7c4e;margin-left:5px;font-size:10px}
.exclude-bar .ex-grp{margin-top:6px;padding-top:6px;border-top:1px dashed #e4d0ac}
.exclude-bar .ex-rsn{display:inline-block;font-size:10.5px;font-weight:700;color:#fff;padding:1px 8px;border-radius:10px;vertical-align:middle}
.exclude-bar .ex-rsn-d{font-size:11px;color:#8a6f44;margin-left:6px}
.exclude-bar .ex-close{margin-left:auto;cursor:pointer;color:#9c7e54;font-size:14px;line-height:1;padding:0 4px;align-self:flex-start}
.exclude-bar.collapsed .ex-body{display:none}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>${MOD.title}<small>${MOD.sub}</small></h1>
      <div class="meta" style="margin-top:6px">
        <span class="pill">模块 <b>${MOD.name}</b></span>
        ${(MOD.seasonInfo ? `<span class="pill" style="background:#eaf1ff;border-color:#b9cdf5">当前监测 <b>${MOD.seasonInfo.label}</b></span>` : '')}
        ${(MOD.seasonInfo && MOD.seasonInfo.springStart ? `<span class="pill" style="background:#fdecee;border-color:#f6cdd2">春节专项 <b>${MOD.seasonInfo.springStart} ~ ${MOD.seasonInfo.springEnd}</b></span>` : '')}
        ${(MOD.koyoInfo ? `<span class="pill" style="background:#fdeede;border-color:#f3c98a">当前红叶季 <b>${MOD.koyoInfo.label}</b></span>` : '')}
        <span class="pill">出发地 <b>${data.origins.map(o => o.city).join(' / ')}</b></span>
        <span class="pill">出行窗口 <b>${data.window.start} ~ ${data.window.end}</b></span>
        <span class="pill">行程时长 <b>${data.tripDuration.min} ~ ${data.tripDuration.max} 天</b></span>
        <span class="pill">数据更新 <b>${genTime}</b></span>
        <span class="pill">命中航线 <b id="statAll">-</b></span>
        <span id="tierStats" style="display:contents"></span>
      </div>
    </div>
    <nav class="modnav">
      <a href="../gba-summer/index.html" class="modnav-i${MOD_ID==='gba-summer'?' on':''}">大湾区寒暑期</a>
      ${SPRING_NAV ? `<a href="../gba-spring/index.html" class="modnav-i${MOD_ID==='gba-spring'?' on':''}">🧧 春节专项</a>` : ''}
      <a href="../japan-koyo/index.html" class="modnav-i${MOD_ID==='japan-koyo'?' on':''}">日本枫叶季</a>
      <a href="../global-year/index.html" class="modnav-i${MOD_ID==='global-year'?' on':''}">全球低价(1年)</a>
    </nav>
  </header>

  <div class="sticky-selector" id="stickySel">
    <span class="ss-label">📍 当前</span>
    <div class="ss-current empty" id="ssCurrent">未选择目的地</div>
    <select id="ssSelect" aria-label="切换目的地">
      <option value="">— 切换目的地 —</option>
    </select>
    <select id="ssOriginSelect" aria-label="切换出发地" class="ss-origin-sel">
      <option value="">— 切换出发地 —</option>
    </select>
    <div class="ss-meta" id="ssMeta"></div>
  </div>

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
      ${koyoExcluded.length ? `<div style="color:#9c6b3f"><span class="dot" style="background:#9c6b3f"></span> 另有 <b>${koyoExcluded.length} 个</b>目的地已剔除（详见底部提示条）</div>` : ''}
    </div>
    <div class="kmap-wrap">
      <div id="kMap"></div>
      <div class="kmap-legend"><b>枫叶变色阶段</b>
        ${wraw.koyo.legend.map(l => '<div><span class="dot" style="background:' + l.color + '"></span> ' + l.label + ' · ' + l.desc + '</div>').join('')}
        <div style="margin-top:5px;padding-top:5px;border-top:1px solid var(--line2);color:var(--tx3);font-size:10.5px">⭐ 标记 = 落在最佳观赏窗口</div>
        <div style="margin-top:3px;color:var(--tx3);font-size:10.5px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:rgba(156,107,63,.25);border:1.5px dashed #9c6b3f;vertical-align:middle;margin-right:3px"></span> 虚线 = 已剔除的目的地</div>
        <div style="margin-top:3px;color:var(--tx3);font-size:10.5px">彩色实心 = 仅含初红 / 半红 / 满红</div>
      </div>
    </div>
    <div class="koyogrid" id="koyoGrid" style="margin-top:14px"></div>
  </section>` : ''}

  ${(Object.keys(HOTELS).length) ? `
  <section class="sec hotel-sec">
    <div class="sec-hd">
      <h2>🏨 目的地酒店推荐<small>选定目的地后自动切换为当地酒店 · 含地图定位</small></h2>
    </div>
    <div class="hotel-narrow-tip" id="hotelNarrowTip">
      <span>⚠️ 当前窗口较窄，第三方酒店页面正以移动版展示。如需桌面版，可</span>
      <a id="hotelNarrowOpen" href="#" target="_blank" rel="noopener">在新窗口打开</a>
    </div>
    <div class="hotel-main">
      <div class="hotel-map-wrap">
        <div class="hotel-mode" id="hotelMode">🌍 全球酒店分布</div>
        <div class="hotel-views" id="hotelViews">
          <div class="hvtab-group">
            <div class="hvtab on" data-view="leaflet">🗺 自做标点</div>
            <div class="hvtab" data-view="osm">🌐 OSM 实图（嵌入）</div>
            <div class="hvtab" data-view="trip">🗺 携程（国内站 · 列表）</div>
            <div class="hvtab" data-view="booking">🗺 Booking（嵌入）</div>
            <div class="hvtab" data-view="airbnb">🏠 Airbnb（新窗口）</div>
          </div>
          <div class="hotel-cat-tabs show" id="hotelTabs">
            ${HOTEL_CATS.map(c => `<div class="htab${c.key==='budget'?' on':''}" data-cat="${c.key}">${c.icon} ${c.label}</div>`).join('')}
          </div>
        </div>
        <div class="hotel-view-stage" id="hotelStage">
          <div id="hotelMap"></div>
          <div class="hotel-iframe-wrap" id="hotelOsmWrap" style="display:none">
            <iframe id="hotelOsm" title="OpenStreetMap" loading="lazy"></iframe>
            <div class="hotel-iframe-fail" id="hotelOsmFail">
              <div style="font-size:13px;font-weight:600">⚠️ OpenStreetMap 嵌入式加载失败</div>
              <div style="font-size:11px;color:var(--tx3)">（沙箱/网络限制。可点下方按钮在新窗口打开）</div>
              <a id="hotelOsmOpen" href="#" target="_blank" rel="noopener">↗ 在新窗口打开 OSM 地图</a>
            </div>
          </div>
          <div class="hotel-iframe-wrap" id="hotelTripWrap" style="display:none">
            <iframe id="hotelTrip" title="Trip.com" loading="lazy"></iframe>
            <div class="hotel-iframe-fail" id="hotelTripFail">
              <div style="font-size:13px;font-weight:600">⚠️ 携程酒店列表加载失败</div>
              <div style="font-size:11px;color:var(--tx3)">（X-Frame-Options 或异地会话异常。可点下方按钮在新窗口查看）</div>
              <a id="hotelTripOpen" href="#" target="_blank" rel="noopener">↗ 在新窗口打开携程酒店列表</a>
            </div>
          </div>
          <div class="hotel-iframe-wrap" id="hotelBookingWrap" style="display:none">
            <iframe id="hotelBooking" title="Booking" loading="lazy"></iframe>
            <div class="hotel-iframe-fail" id="hotelBookingFail">
              <div style="font-size:13px;font-weight:600">⚠️ Booking 拒绝嵌入</div>
              <div style="font-size:11px;color:var(--tx3)">（安全策略拦截或会话异常。可点下方按钮在新窗口查看）</div>
              <a id="hotelBookingOpen" href="#" target="_blank" rel="noopener">↗ 在新窗口打开 Booking</a>
            </div>
          </div>
          <div class="hotel-iframe-wrap" id="hotelAirbnbWrap" style="display:none">
            <div class="hotel-iframe-fail show" id="hotelAirbnbFail">
              <div class="airbnb-card">
                <div class="airbnb-logo">🏠</div>
                <div class="airbnb-title">Airbnb 不支持网页内嵌</div>
                <div class="airbnb-desc">浏览器安全策略（X-Frame-Options）禁止在 iframe 中加载 Airbnb。已根据当前目的地与出行日期生成搜索链接，点击下方按钮在新窗口打开 Airbnb 地图模式：</div>
                <a class="airbnb-btn" id="hotelAirbnbOpen" href="#" target="_blank" rel="noopener">↗ 在新窗口打开 Airbnb 搜索</a>
                <div class="airbnb-desc" id="hotelAirbnbMeta" style="font-size:11px;opacity:.7"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="hotel-list" id="hotelList"></div>
    </div>
  </section>` : ''}

  <div class="flight-source">
    <b>📚 机票数据来源与规则</b>
    <div class="fs-row">
      <span class="pill warn">已剔除春秋/九元等国内廉价航空</span>
      <span class="pill warn">中国香港出发仅国际航线</span>
      <span class="pill warn">国内航线须直飞（≥3000km 方可中转）</span>
      ${MOD.tripRangesByArea ? '<span class="pill warn">按区域偏好：国内/东亚/东南亚 5~9 天，美洲/欧洲/大洋洲/非洲/南亚/中亚/中东 12~20 天</span>' : ''}
      ${data.detailLimited ? '<span class="pill warn">⚠ 航班号/航司因 Trip.com 反爬（whaleguard）临时受限，价格为实时低价日历数据，已按区域偏好筛选行程天数（短程 5~9 / 长程 12~20）</span>' : ''}
    </div>
    <div class="fs-desc">
      数据源：Trip.com 公开航班查询接口，价格为 1 名成人经济舱往返含税总价（人民币），实时波动，以最终下单页为准。<br>
      已排除的国内低成本航空：${data.excludedAirlines.map(a => a.name).join('、')}。折扣幅度＝该航线所选最低价相对窗口期内往返价格中位数的降幅。<br>
      航线规则：中国香港出发只查国际航线；国际航线允许中转，国内航线要求直飞，仅当出发地与目的地直线距离 ≥ 3000km 时才纳入中转方案；所有中转方案均以橙色「⇄ 含中转」标注并注明中转城市。
      ${MOD.tripRangesByArea ? '<br>行程偏好：按目的地所在区域偏好不同行程时长 —— 短程区域（国内 / 东亚 / 东南亚）默认输出 5~9 天；长程区域（美洲 / 大洋洲 / 欧洲 / 非洲 / 南亚 / 中亚 / 中东）默认输出 12~20 天往返。每条航线最终显示的「行程 X 天」即该航线最低价机票对应的实际往返天数。' : ''}
    </div>
  </div>

  <div class="foot">
    ${hasWeather ? '天气：Open-Meteo 逐日数值预报与近 5 年同期 ERA5 气候常态推算，累计降雨量为出行窗口内每日降水之和。<br>' : ''}
    ${hasKoyo ? '枫叶：基于日本九大地方典型物候时间表（参照加拿大枫叶颜色时间表实现方式）建模，给出各地绿叶/初红/半红/满红/落叶阶段与最佳观赏窗口，实际变色受当年气候影响，仅供参考。<br>' : ''}
    本页由脚本自动生成，数据仅供参考。
  </div>
</div>

${(MOD_ID==='japan-koyo' && hasKoyo) ? `
<div class="exclude-bar" id="excludeBar" style="margin:16px auto 0;max-width:1200px">
  <div class="ex-icon">🍁</div>
  <div style="flex:1;min-width:0">
    <div><b>已按各目的地红叶期定向搜索</b>：先按当地物候推算「${RED_LABELS}」的日期，<b>只在该区间内</b>搜索低价航班——绿叶期与落叶期的目的地及日期均不纳入结果。</div>
    <div class="ex-hint">共 <b>${koyoKept}</b> 个目的地命中红叶期航班${koyoExcluded.length ? `，剔除 <b>${koyoExcluded.length}</b> 个：` : '。'}</div>
    ${koyoExGroups.map(g => `<div class="ex-grp"><span class="ex-rsn" style="background:${g.color}">${g.label}</span><span class="ex-rsn-d">${g.desc}</span>
      <div class="ex-tags">${g.items.map(c => '<span class="ex-tag"><span class="dot" style="background:'+g.color+'"></span>'+c.city+' '+c.code+(c.redStart?'<i>红叶期 '+c.redStart.slice(5)+'~'+c.redEnd.slice(5)+'</i>':'')+'</span>').join('')}</div></div>`).join('')}
  </div>
  <div class="ex-close" id="excludeClose" title="收起">×</div>
</div>` : ''}

<script>${leafletJs}</script>
<script>
const DATA = ${JSON.stringify(payload)};
const CITY_TRIP_ID = DATA.cityTripId || {};   // 携程 d-city 编号映射（注入页面，避免引用 Node 端变量）
// 历史低价判定（浏览器端）：当前价 ≤ 历史中位 × 阈值 且样本达标 → 显著低于历史
const HIST_THRESHOLD = 0.80, HIST_MIN_SAMPLES = 3;
function histLow(seasonKey, price) {
  const s = DATA.priceHist[seasonKey];
  return !!(s && s.count >= HIST_MIN_SAMPLES && price <= Math.round(s.median * HIST_THRESHOLD));
}
function histStat(seasonKey) { return DATA.priceHist[seasonKey] || null; }
const REGION_NAME={domestic:'国内/港澳台',asia:'亚洲',oceania:'大洋洲',europe:'欧洲',america:'美洲',africa:'非洲',japan:'日本'};
const PICK_LABEL={cheapest:'最便宜',discount:'折扣最大',most:'航次最多'};
const TIER_KEYS=${JSON.stringify(TIER_KEYS)};
const TIER_LABEL=${JSON.stringify(TIER_LABEL)};
const TIER_COLOR=${JSON.stringify(TIER_COLOR)};
const ORIGINS=DATA.origins;
const orgLL={}; ORIGINS.forEach(o=>orgLL[o.code]=o);
const W={ dry:{color:'#0f9960',bg:'#e7f6ee',label:'干爽少雨',desc:'无强降雨，晴日≥3'}, mild:{color:'#2563d9',bg:'#eaf0fd',label:'偶有阵雨',desc:'偶有阵雨，无强降雨'}, wet:{color:'#e08a1e',bg:'#fdf3e4',label:'多雨',desc:'降雨较多，强降雨≤2'}, heavy:{color:'#e02b3c',bg:'#fdecee',label:'强降雨频繁',desc:'≥3个暴雨日'} };
const wOrder=['dry','mild','wet','heavy'];
let state={tier:'all',sort:'price',q:'',regions:new Set(),origins:new Set(DATA.gbaCodes),sel:null};
let _inSelect=false;  // 防止 select↔selectDest 互调死循环
let userBaseState={origins:new Set(state.origins),sel:null}; // 用户主动选择的出发地/目的地，用于推荐位点击后恢复
let pickPreview=false; // 是否因点击推荐位进入临时预览状态
function tripDays(a,b){return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);}
function saveUserBaseState(){ userBaseState={origins:new Set(state.origins),sel:state.sel}; }
function wgradeScore(r){ const g=r.weather&&r.weather.grade; if(g==='dry')return 3; if(g==='mild')return 2; if(g==='wet')return 1; return 0; }
// 按当前出发地集合 + 价格档位动态计算推荐位：
// - 未选价格档位（all）：每档 1 条最低价；不足 5 条再从全部航线补齐到 5 条。
// - 选定价格档位：只在该档位内推荐最多 5 条航线（按目的地去重）。
// - originsSet 为空时：出发地不限；有出发地时：只从已选出发地筛选。
function computePicksForOrigins(originsSet){
  const routeSort=(a,b)=>{
    const priceDiff=a.minPrice-b.minPrice;
    const threshold=Math.max(a.minPrice,b.minPrice)*0.15;
    if(Math.abs(priceDiff)>threshold) return priceDiff;
    const ws=wgradeScore(b)-wgradeScore(a);
    if(ws!==0) return ws;
    return priceDiff;
  };
  const inOrigin = r => originsSet.size===0 || originsSet.has(r.originCode);
  const picks=[];
  const pickedCodes=new Set();
  const tier = state.tier || 'all';

  if(tier==='all'){
    // 第 1 步：每档 1 条
    TIER_KEYS.forEach(t=>{
      const list=DATA.routes.filter(r=>r.tier===t && inOrigin(r) && !pickedCodes.has(r.code));
      if(!list.length) return;
      list.sort(routeSort);
      const r=list[0];
      picks.push({tier:t, key:r.key, reason:'该档最低价'});
      pickedCodes.add(r.code);
    });
    // 第 2 步：不足 5 条时，从全部航线补齐
    if(picks.length<5){
      const all=DATA.routes.filter(r=>inOrigin(r) && !pickedCodes.has(r.code));
      all.sort(routeSort);
      for(const r of all){
        if(picks.length>=5) break;
        picks.push({tier:r.tier, key:r.key, reason:'低价优选'});
        pickedCodes.add(r.code);
      }
    }
  } else {
    // 已选定档位：只从该档位推荐最多 5 条
    const list=DATA.routes.filter(r=>r.tier===tier && inOrigin(r) && !pickedCodes.has(r.code));
    list.sort(routeSort);
    for(const r of list){
      if(picks.length>=5) break;
      picks.push({tier:tier, key:r.key, reason:'该档最低价'});
      pickedCodes.add(r.code);
    }
  }
  return picks;
}
const byKey={}; DATA.routes.forEach(r=>byKey[r.key]=r);
const code2key={}; DATA.routes.forEach(r=>{ if(!code2key[r.code]) code2key[r.code]=r.key; });

/* ---------- 粘性城市选择器（顶部下拉时一直可见） ---------- */
// 重建目的地下拉菜单：按当前 state.origins 过滤，只列出该出发地集合内的航线
function populateDestDropdown(){
  const sel=document.getElementById('ssSelect'); if(!sel) return;
  sel.innerHTML = '<option value="">— 切换目的地 —</option>';
  const sorted=DATA.routes.slice().sort((a,b)=>a.minPrice-b.minPrice);
  sorted.forEach(r=>{
    if(state.origins.size && !state.origins.has(r.originCode)) return;  // 按当前出发地过滤
    const o=r.options[0];
    const opt=document.createElement('option');
    opt.value=r.key;
    opt.textContent=r.city+' ('+r.code+') · ¥'+r.minPrice+' · '+r.originCity+'出发 · '+o.depDate.slice(5)+'→'+o.retDate.slice(5);
    sel.appendChild(opt);
  });
}
function initSticky(){
  const sel=document.getElementById('ssSelect'); if(!sel) return;
  sel.onchange=()=>{
    const k=sel.value;
    if(k && byKey[k]){
      const r=byKey[k];
      // 按当前 state.origins 重选一条同目的地的最佳 route；找不到则用 sel 选中的那条（会显示「该出发地暂无该目的地数据」）
      const scoped = findBestRoute(r.code, state.origins);
      const finalR = scoped || r;
      state.sel = finalR.key;
      select(finalR.key, false);                     // ← fromMap=false：不触发 scrollIntoView，留在原地
      map.flyTo([finalR.lat, finalR.lng], 4, {duration:.7});
      pickPreview=false;
      saveUserBaseState();
    }
    sel.value='';
  };

  // 出发地选择器（10 城：大湾区 5 + 新增 5）
  const oSel=document.getElementById('ssOriginSelect'); if(!oSel) return;
  // a. 大湾区 5 城汇总项
  const gbaOpt=document.createElement('option');
  gbaOpt.value='__GBA__';
  gbaOpt.textContent='✈ 大湾区（5 城）';
  oSel.appendChild(gbaOpt);
  // b. 大湾区 5 城分别列出
  DATA.origins.filter(o=>DATA.gbaCodes.includes(o.code)).forEach(o=>{
    const opt=document.createElement('option');
    opt.value=o.code;
    opt.textContent='  '+o.city+' ('+o.code+')';
    oSel.appendChild(opt);
  });
  // c. 分隔线 + 新增 5 城
  const sepOpt=document.createElement('option');
  sepOpt.disabled=true;
  sepOpt.textContent='── 其他城市 ──';
  oSel.appendChild(sepOpt);
  DATA.origins.filter(o=>!DATA.gbaCodes.includes(o.code)).forEach(o=>{
    const opt=document.createElement('option');
    opt.value=o.code;
    opt.textContent='  '+o.city+' ('+o.code+')';
    oSel.appendChild(opt);
  });
  oSel.onchange=()=>{
    const v=oSel.value;
    if(!v) return;
    if(v==='__GBA__'){
      state.origins=new Set(DATA.gbaCodes);
    } else {
      state.origins=new Set([v]);
    }
    // 同步更新顶部 chip 选择器高亮
    document.querySelectorAll('#origins .chip').forEach(c=>{
      const o=c.dataset.o;
      const isGbaAll=(v==='__GBA__') && DATA.gbaCodes.includes(o);
      const isMatch=(state.origins.size===1 && state.origins.has(o));
      c.classList.toggle('on', isGbaAll || isMatch);
    });
    // 按当前目的地 + 新出发地集合 找一条最佳 route
    const curDest = state.sel ? (byKey[state.sel] && byKey[state.sel].code) : null;
    const newR = curDest ? findBestRoute(curDest, state.origins) : null;
    if(newR){ state.sel = newR.key; }
    // 找不到时保留原 state.sel，syncSticky 内部会显示「该出发地暂无该目的地数据」
    populateDestDropdown();   // 切完出发地，刷新目的地下拉，只显示该出发地的航线
    rebuildDestBest();         // 按新出发地重建 destBest（修 embed/酒店卡片仍用旧 origin route 的 bug）
    // hotelSel 在新出发地下可能不存在；若仍在，重新渲染酒店视图（让 embed/酒店列表用新 origin 的日期）
    if(hotelSel){
      const newHR = destBest[hotelSel];
      if(newHR){
        const d2 = HOTEL_DATA[hotelSel];
        if(d2){ try{ selectDest(hotelSel, newHR); }catch(_e){ refreshHotelIframes(d2, newHR); } }
      } else {
        // 该目的地在新出发地下无 route，回到全球视图
        hotelSel = null;
        try{ drawHotelGlobal(); }catch(_e){}
        try{ refreshGlobalIframes(); }catch(_e){}
      }
    }
    pickPreview=false;
    saveUserBaseState();
    renderPicks();
    render();
    syncSticky(newR || byKey[state.sel] || null);
    if(newR) map.flyTo([newR.lat, newR.lng], 4, {duration:.7});
  };
  // 默认：oSel 显式设值「大湾区（5 城）」，并按默认大湾区状态选一条最便宜的 route 作为初始 state.sel
  oSel.value='__GBA__';
  if(!state.sel){
    let cheapest=null;
    DATA.routes.forEach(r=>{
      if(!state.origins.has(r.originCode)) return;
      if(!cheapest || r.minPrice<cheapest.minPrice) cheapest=r;
    });
    if(cheapest){ state.sel=cheapest.key; }
  }
  populateDestDropdown();   // 初始化目的地下拉，按默认 state.origins (大湾区 5 城) 过滤
  syncSticky(state.sel ? byKey[state.sel] : null);
}
// 在 state.origins 集合下找 (destCode) 的最低价 route；找不到返回 null
function findBestRoute(destCode, originSet){
  let best=null;
  DATA.routes.forEach(r=>{
    if(r.code!==destCode) return;
    if(!originSet.has(r.originCode)) return;
    if(!best || r.minPrice<best.minPrice) best=r;
  });
  return best;
}
function syncSticky(r){
  const cur=document.getElementById('ssCurrent'); if(!cur) return;
  const meta=document.getElementById('ssMeta'); if(!meta) return;
  if(!r){ cur.className='ss-current empty'; cur.textContent='未选择目的地 · 从上方卡片/列表/酒店地图点选'; meta.innerHTML=''; return; }
  const o=r.options[0];
  cur.className='ss-current';
  cur.innerHTML=r.city+'<span class="code">'+r.code+'</span>';
  // 检测当前 r 的 originCode 是否还在 state.origins 里；不在则视为「该出发地暂无该目的地数据」
  const inScope = state.origins.size===0 || state.origins.has(r.originCode);
  const w=r.weather;
  if(!inScope){
    const originNames = r.originCity + ' (' + r.originCode + ')';
    meta.innerHTML =
      '<span class="ss-pill" style="background:#fff5e0;border-color:#f3ddb8;color:#8a5b12">⚠ 当前出发地（'+originNames+'）暂无该目的地数据，可换其他出发地查看</span>'+
      '<span class="ss-pill" style="color:#8b93a1">¥'+r.minPrice+' <i style="font-style:normal;opacity:.75">/'+TIER_LABEL[r.tier]+'</i> · '+r.originCity+'出发（参考）</span>';
    return;
  }
  const wPill=w?('<span class="ss-pill" style="background:'+W[w.grade].bg+';border-color:'+W[w.grade].color+'40;color:'+W[w.grade].color+'">☁ '+W[w.grade].label+' · 雨'+w.prcp+'mm</span>'):'';
  const days=tripDays(o.depDate,o.retDate);
  meta.innerHTML=
    '<span class="ss-pill">行程 <b>'+o.depDate.slice(5)+' → '+o.retDate.slice(5)+'</b> · '+days+' 天</span>'+
    '<span class="ss-pill p">¥'+r.minPrice+' <i style="font-style:normal;opacity:.75">/'+TIER_LABEL[r.tier]+'</i></span>'+
    wPill;
}
initSticky();
// 初始化用户基准状态为默认大湾区+当前默认选中航线
saveUserBaseState();

// 点击页面空白处恢复推荐位预览前的原始出发地/目的地
// 排除 sticky 选择器、推荐卡片、列表项、地图、酒店区、chip/tab 等主动交互区域
document.addEventListener('click',(e)=>{
  if(!pickPreview) return;
  const t=e.target;
  if(t.closest('.sticky-selector')) return;
  if(t.closest('.picks')) return;
  if(t.closest('.item')) return;
  if(t.closest('.map-wrap')) return;
  if(t.closest('.hotel-sec')) return;
  if(t.closest('.chip')) return;
  if(t.closest('.tab')) return;
  restoreUserBaseState();
});

// 酒店推荐板块状态（变量在此声明，确保 select() 首次调用时已初始化）
const HOTEL_DATA = DATA.hotels || {};
const HOTEL_DESTS = Object.values(HOTEL_DATA);
let hotelMap=null, hotelLayer=null, hotelMarkers=[], hotelCat='budget', hotelSel=null;
// destBest 按当前 state.origins 集合重建（切换出发地后必须刷新，否则 embed / 酒店卡片仍引用旧 origin 下的 route，导致日期/价格与顶部选择器对不上）
let destBest={};
function rebuildDestBest(){
  destBest={};
  DATA.routes.forEach(r=>{
    if(state.origins.size && !state.origins.has(r.originCode)) return;
    if(!destBest[r.code] || r.minPrice<destBest[r.code].minPrice) destBest[r.code]=r;
  });
}
rebuildDestBest();
// 把 OTA URL 中的 __CHECKIN__/__CHECKOUT__ 替换为该目的地推荐航线的实际日期
function buildHotelUrl(h, route){
  if(!route) return h.url;
  const o=route.options[0]; if(!o) return h.url;
  return h.url.replace('__CHECKIN__', o.depDate).replace('__CHECKOUT__', o.retDate);
}

/* ---------- 地图 ---------- */
// 可靠瓦片层：多源链式降级 + 超时兜底。主源高德标准地图 style=7（内容完整，国内可达），异常或 2.2s 未加载则换 style=8/OSM DE/OSM FR。
function makeReliableTileLayer(map){
  const sources=[
    {u:'https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', sub:['1','2','3','4'], a:'高德地图'},
    {u:'https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', sub:['1','2','3','4'], a:'高德地图'},
    {u:'https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png', sub:['a','b','c'], a:'OSM'},
    {u:'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', sub:['a','b','c'], a:'OSM FR'}
  ];
  function tileUrl(src, coords){
    const s=src.sub[Math.abs((coords.x+coords.y+coords.z)%src.sub.length)];
    return src.u.replace('{s}',s).replace('{x}',coords.x).replace('{y}',coords.y).replace('{z}',coords.z);
  }
  const layer=L.tileLayer(sources[0].u, {
    subdomains:sources[0].sub, maxZoom:18, minZoom:1,
    attribution:sources.map(s=>s.a).filter((v,i,a)=>a.indexOf(v)===i).join(' / '),
    crossOrigin:false, detectRetina:false
  });
  function tryNext(tile, coords){
    let idx=tile._relIdx||0;
    if(idx>=sources.length-1) return;
    idx++; tile._relIdx=idx;
    tile.src=tileUrl(sources[idx], coords);
    startTimer(tile, coords);
  }
  function startTimer(tile, coords){
    clearTimeout(tile._relTo);
    tile._relTo=setTimeout(()=>{
      if(tile.complete && tile.naturalWidth>0) return;
      tryNext(tile, coords);
    }, 2200);
  }
  layer.on('tileloadstart', function(e){ if(e.tile){ e.tile._relIdx=0; startTimer(e.tile, e.coords); } });
  layer.on('tileload',       function(e){ if(e.tile) clearTimeout(e.tile._relTo); });
  layer.on('tileerror',      function(e){ if(e.tile){ clearTimeout(e.tile._relTo); tryNext(e.tile, e.coords); } });
  return layer.addTo(map);
}
const map=L.map('map',{zoomControl:true,worldCopyJump:true,minZoom:2}).setView([20,108],3);
makeReliableTileLayer(map);
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
  if(o.detailLimited) return '<div class="leg"><div class="dir">去程</div><div class="body"><div>'+o.depDate+' 出发 · 行程 '+o.durationDays+' 天（实时低价日历）</div></div></div><div class="leg"><div class="dir">回程</div><div class="body"><div>'+o.retDate+' 返回</div></div></div>';
  const f=o.out.flights;
  const seg=f.map(x=>'<span class="fno">'+x.no+'</span> '+x.from+(x.fromT?'('+x.fromT+')':'')+' <span class="t">'+x.depT.slice(11,16)+'</span> → '+x.to+(x.toT?'('+x.toT+')':'')+' <span class="t">'+x.arrT.slice(11,16)+'</span>').join('<br>');
  const bk=o.back?o.back.flights.map(x=>'<span class="fno">'+x.no+'</span> <span class="t">'+x.depT+'</span> 起飞').join('<br>'):'—';
  const dur=o.out.duration?Math.floor(o.out.duration/60)+'h'+(o.out.duration%60?String(o.out.duration%60)+'m':''):'';
  return '<div class="leg"><div class="dir">去程</div><div class="body">'+seg+'<div style="color:#8b93a1;font-size:10.5px">'+o.depDate+' · '+(o.out.stops?o.out.stops+' 次中转':'直飞')+(dur?' · 全程 '+dur:'')+'</div></div></div>'+
    '<div class="leg"><div class="dir">回程</div><div class="body">'+bk+'<div style="color:#8b93a1;font-size:10.5px">'+o.retDate+' · 当地时间</div></div></div>';
}
function transitBadge(o,cls){
  if(o.detailLimited) return '<span class="badge">实时低价日历</span>';
  if(o.direct) return '<span class="badge g">直飞往返</span>';
  const f=o.out.flights||[];
  const via=f.slice(0,-1).map(x=>x.to).filter(Boolean);
  const parts=[];
  if(o.out.stops) parts.push('去程 '+o.out.stops+' 次'+(via.length?'（经 '+via.join('/')+'）':''));
  if(o.back&&o.back.stops) parts.push('回程 '+o.back.stops+' 次');
  return '<span class="badge tr'+(cls||'')+'">⇄ 含中转'+(parts.length?' · '+parts.join(' · '):'')+'</span>';
}
// ---------- 机票预订跳转链接（携程 / 天巡）----------
// 直接深链到「出发地 → 目的地 / 指定往返日期」的航线搜索页，点击即在新标签打开对应查票结果。
// 经验复用酒店板块：默认走国内站点，比原 trip.com / skyscanner.com 国际站在国内更稳。
function tripFlightUrl(r){
  const o=r.options && r.options[0]; if(!o) return 'https://flights.ctrip.com/';
  // 携程国内机票往返的正确格式：depdate=去程日期_回程日期（下划线连接）
  const u=new URL('https://flights.ctrip.com/online/list/round-'+r.originCode+'-'+r.code+'/');
  u.searchParams.set('depdate', o.depDate+'_'+o.retDate);
  u.searchParams.set('cabin', 'y_s_c_f');
  u.searchParams.set('adult', '1');
  u.searchParams.set('child', '0');
  u.searchParams.set('infant', '0');
  return u.toString();
}
// 天巡（Skyscanner 中国站）机票搜索结果深链：经实测，正确格式为
//   /transport/flights/{出发}/{到达}/{YYMMDD}/{YYMMDD}/?adultsv2=1&cabinclass=economy&childrenv2=&ref=home&rtn=1&...
// 城市码为 IATA 小写（服务端识别，真实浏览器可正常打开结果页）；日期必须是 6 位 YYMMDD。
// 个别城市天巡码与 IATA 不同（如东京 TYO→tyoa），用 TIANXUN_CODE 覆盖（实测 tyo 也认，但 tyoa 与官网一致）。
const TIANXUN_CODE = { TYO: 'tyoa' };
function tianxunCode(iata){ return (TIANXUN_CODE[iata] || iata).toLowerCase(); }
function skyFlightUrl(r){
  const o=r.options && r.options[0]; if(!o) return 'https://www.tianxun.com/';
  const from=tianxunCode(r.originCode), to=tianxunCode(r.code);
  const dep=o.depDate.slice(2).replace(/-/g,''), ret=o.retDate.slice(2).replace(/-/g,'');
  const u=new URL('https://www.tianxun.com/transport/flights/'+from+'/'+to+'/'+dep+'/'+ret+'/');
  u.searchParams.set('adultsv2','1');
  u.searchParams.set('cabinclass','economy');
  u.searchParams.set('childrenv2','');
  u.searchParams.set('ref','home');
  u.searchParams.set('rtn','1');
  u.searchParams.set('preferdirects','false');
  u.searchParams.set('outboundaltsenabled','false');
  u.searchParams.set('inboundaltsenabled','false');
  return u.toString();
}
function flightLinks(r){
  if(!r || !r.options || !r.options.length) return '';
  const trip=tripFlightUrl(r), sky=skyFlightUrl(r);
  return '<div class="fly-btns">'+
    '<a class="fly-trip" href="'+trip+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="在携程查看 '+r.originCity+'→'+r.city+' 该行程查票">✈️ 携程查票</a>'+
    '<a class="fly-sky" href="'+sky+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="在天巡网查看 '+r.originCity+'→'+r.city+' 该行程查票">🌐 天巡查票</a>'+
  '</div>';
}
function itemHTML(r){
  const o=r.options[0];
  const _k = (DATA.moduleId==='japan-koyo' && DATA.koyo && DATA.koyo.cities) ? (DATA.koyo.cities.find(c=>c.code===r.code)||null) : null;
  const _koyo = _k ? '<span class="koyo-tag" style="color:'+_k.color+'">🍁 '+_k.label+' · 观赏窗 '+_k.winStart.slice(5)+'~'+_k.winEnd.slice(5)+'</span>' : '';
  const alts=r.cheapestPairs.slice(0,6).map(p=>{
    const st=histStat(p.seasonKey);
    const low = histLow(p.seasonKey, p.price);
    const priceCell = low
      ? '<span class="hist-low">¥'+p.price+'<span class="hist-tag">📉历史低价</span><span class="hist-med">历史中位¥'+st.median+'</span></span>'
      : '¥'+p.price;
    return '<tr><td>'+p.dep.slice(5)+' 去 · '+p.ret.slice(5)+' 回</td><td class="ta-r">'+priceCell+'</td></tr>';
  }).join('');
  const others=r.options.slice(1,5).map(x=>'<tr><td>'+x.depDate.slice(5)+'/'+x.retDate.slice(5)+' '+x.out.flights.map(f=>f.no).join('+')+' '+x.airlineNames.join('/')+'</td><td>¥'+x.price+'</td></tr>').join('');
  const w=r.weather;
  const wBadge= w?('<span class="badge" style="background:'+W[w.grade].bg+';color:'+W[w.grade].color+'">☁ '+W[w.grade].label+' · 晴'+w.dryDays+'/'+w.days+' · 雨'+w.prcp+'mm</span>'):'';
  return '<div class="item" data-key="'+r.key+'">'+
    '<div class="it-top"><div>'+
      '<div class="it-city">'+r.city+'<span class="code">'+r.code+'</span></div>'+
      (DATA.moduleId==='japan-koyo'?'<div class="it-koyo">'+_koyo+'</div>':'')+
      '<div class="it-line">'+
        '<span>'+r.originCity+' 出发</span>'+
        '<span>'+o.depDate.slice(5)+' 去 · '+o.retDate.slice(5)+' 回 · '+tripDays(o.depDate,o.retDate)+' 天</span>'+
        transitBadge(o)+
        '<span class="badge">'+o.airlineNames.join(' / ')+'</span>'+
        (o.bag?'<span class="badge b">含托运</span>':'')+
      '</div>'+
      '<div class="it-line">'+
        (r.discountPct>0?'<span class="badge r">低于中位价 '+r.discountPct+'%</span>':'')+
        (r.isLimited?'<span class="badge">'+r.optionCount+' 组低价日期</span>':'<span class="badge">'+r.optionCount+' 个航次可选</span>')+
        (r.datePairsInBudget?'<span class="badge">'+r.datePairsInBudget+' 组日期在预算内</span>':'')+
        (r.isDomestic&&r.transitAllowed?'<span class="badge b">远程国内 '+r.distanceKm+'km · 允许中转</span>':'')+
        wBadge+
      '</div>'+
    (function(){ const _low=(r.cheapestPairs||[]).some(p=>histLow(p.seasonKey,p.price)); return '</div><div class="it-price'+(_low?' hist-on':'')+'">'+( _low?'<span class="hist-low">¥'+r.minPrice+'</span><small>'+TIER_LABEL[r.tier]+'/人往返</small><span class="hist-tag">📉历史低价</span>':'¥'+r.minPrice+'<small>'+TIER_LABEL[r.tier]+'/人往返</small>')+'</div></div>'; })()+
    '<div class="legs">'+fmtLeg(o)+
      (others?'<div class="alts"><div style="color:#8b93a1;margin:5px 0 2px">同航线其他航班</div><table>'+others+'</table></div>':'')+
      (alts?'<div class="alts"><div style="color:#8b93a1;margin:5px 0 2px">窗口期内更多低价日期组合（含全部航司）</div><table>'+alts+'</table></div>':'')+
    '</div>'+
    flightLinks(r)+
  '</div>';
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
  if(_inSelect) return;
  if(state.sel===key && quiet) return;  // 同一 key 重复静默调用直接返回
  _inSelect=true;
  try{
    if(pickPreview && !quiet) pickPreview=false;  // 列表/地图等主动交互退出推荐位预览
    state.sel=key;
    if(!quiet) saveUserBaseState();  // 用户主动选择目的地时保存为新的基准
    document.querySelectorAll('.item').forEach(el=>el.classList.toggle('sel',el.dataset.key===key));
    const r=byKey[key]; drawLine(key);
    if(fromMap){ const el=document.querySelector('.item[data-key="'+key+'"]'); if(el){el.classList.add('open');el.scrollIntoView({behavior:'smooth',block:'center'});} }
    else if(!quiet&&r){ if(markers[key]) markers[key].openTooltip(); }
    syncHotels(r?r.code:null, r);   // 透传选中航线 r，避免 embed 退化为「同目的地最便宜路线」的日期
    syncSticky(r);
    if(r && typeof wSelect==='function' && DATA.weather && DATA.weather.trips && DATA.weather.trips.length && typeof wTrips!=='undefined' && wTrips[r.code]) wSelect(r.code, false, true);
  } finally { _inSelect=false; }
}
function pickCard(tier,key,reason){
  const r=byKey[key]; if(!r) return '';
  const o=r.options[0];
  const C=TIER_COLOR[tier];
  const w=r.weather;
  const wBadge= w?('<div class="pick-w"><span style="background:'+W[w.grade].bg+';color:'+W[w.grade].color+';padding:1px 6px;border-radius:3px;font-weight:600;font-size:9px">☁ '+W[w.grade].label+' · 雨'+w.prcp+'mm</span></div>'):'';
  const _k = (DATA.moduleId==='japan-koyo' && DATA.koyo && DATA.koyo.cities) ? (DATA.koyo.cities.find(c=>c.code===r.code)||null) : null;
  const kBadge = _k ? '<div class="pick-w" style="margin-top:3px"><span style="background:'+_k.color+';color:#fff;padding:1px 6px;border-radius:3px;font-weight:600;font-size:9px">🍁 '+_k.label+'</span><span style="background:#fff7e0;color:#8a5b12;padding:1px 6px;border-radius:3px;font-weight:600;font-size:9px;margin-left:3px">观赏 '+_k.winStart.slice(5)+'~'+_k.winEnd.slice(5)+'</span></div>' : '';
  return '<div class="pick" data-key="'+key+'" style="border-left:3px solid '+C.dot+'">'+
    '<div class="pick-hd"><span class="tag" style="background:'+C.bg+';color:'+C.txt+'">'+TIER_LABEL[tier]+'</span>'+(reason||'该档最低价')+'</div>'+
    '<div class="pick-city">'+r.city+'<span>'+r.code+'</span></div>'+
    '<div class="pick-price">¥'+r.minPrice+'<small>/人往返</small></div>'+
    '<div class="pick-sub">'+r.originCity+' · '+o.depDate.slice(5)+'去'+o.retDate.slice(5)+'回 '+tripDays(o.depDate,o.retDate)+'天 · '
      +(o.detailLimited
        ? '实时低价 · 行程'+o.durationDays+'天'
        : (o.direct?'直飞':'<b style="color:#b25a00">⇄ 含中转'+(o.out.stops?'('+o.out.stops+')':'')+'</b>')+' · '+o.out.flights.map(f=>f.no).join('+')+' '+o.airlineNames.join('/'))
      +'</div>'+
    wBadge+kBadge+
    flightLinks(r)+
  '</div>';
}
function renderPicks(){
  const picks=computePicksForOrigins(state.origins);
  let h=picks.map(p=>pickCard(p.tier,p.key,p.reason)).join('');
  if(!h) h='<div class="empty">当前出发地暂无命中航线</div>';
  document.getElementById('picks').innerHTML=h;
  document.querySelectorAll('.pick').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const k=el.dataset.key; const r=byKey[k]; if(!r) return;
      if(!pickPreview) saveUserBaseState();
      // 临时切到该推荐航线对应的出发地+目的地，并在 sticky 顶置显示
      state.origins=new Set([r.originCode]);
      const oSel=document.getElementById('ssOriginSelect'); if(oSel) oSel.value=r.originCode;
      document.querySelectorAll('#origins .chip').forEach(c=>{ c.classList.toggle('on',c.dataset.o===r.originCode); });
      populateDestDropdown();
      state.sel=k;
      render();
      select(k,false,true); // quiet 避免 select() 清掉预览标记
      const sel=document.getElementById('ssSelect'); if(sel) sel.value=k;
      map.flyTo([r.lat,r.lng],4,{duration:.8});
      pickPreview=true;
    };
  });
}
// 点击页面空白处，从推荐位预览状态恢复到用户主动选择的原始出发地/目的地
function restoreUserBaseState(){
  if(!pickPreview) return;
  pickPreview=false;
  state.origins=new Set(userBaseState.origins);
  state.sel=userBaseState.sel;
  // 同步 sticky 出发地选择器
  const oSel=document.getElementById('ssOriginSelect');
  if(oSel){
    if(state.origins.size>1 && Array.from(state.origins).every(c=>DATA.gbaCodes.includes(c))) oSel.value='__GBA__';
    else if(state.origins.size===1) oSel.value=Array.from(state.origins)[0];
    else oSel.value='';
  }
  // 同步出发地 chip
  document.querySelectorAll('#origins .chip').forEach(c=>{ c.classList.toggle('on',state.origins.has(c.dataset.o)); });
  populateDestDropdown();
  render();
  if(state.sel&&byKey[state.sel]) select(state.sel,false,true);
  else syncSticky(null);
}
function setActiveTab(tier){
  document.querySelectorAll('.tab').forEach(t=>{
    const on=t.dataset.tier===tier; t.classList.toggle('on',on);
    if(on&&tier!=='all'){ const C=TIER_COLOR[tier]; t.style.background=C.dot; t.style.borderColor=C.dot; t.style.color='#fff'; }
    else { t.style.background=''; t.style.borderColor=''; t.style.color=''; }
  });
}
TIER_KEYS.forEach(t=>{ const el=document.createElement('div'); el.className='tab'; el.dataset.tier=t; el.textContent=TIER_LABEL[t]; document.getElementById('tabs').appendChild(el); });
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{ state.tier=t.dataset.tier; setActiveTab(state.tier); renderPicks(); render(); });
document.getElementById('sort').onchange=e=>{state.sort=e.target.value;render();};
document.getElementById('q').oninput=e=>{state.q=e.target.value.trim();render();};
// 固定渲染全部出发地（GBA 5 城 + 新增 5 城），即使某城市当前模块暂无命中航线，也始终可选，切换后列表为空即提示无票
const originCities=DATA.origins.map(o=>({code:o.code, city:o.city}));
document.getElementById('origins').innerHTML='<span style="font-size:11px;color:var(--tx3);align-self:center">出发地</span>'+originCities.map(o=>'<div class="chip" data-o="'+o.code+'"'+(DATA.gbaCodes.includes(o.code)?' data-gba="1"':'')+'>'+o.city+'</div>').join('');
document.querySelectorAll('#origins .chip').forEach(c=>{
  if(c.dataset.gba==='1') c.classList.add('on');
  c.onclick=(e)=>{
    e.stopPropagation();
    pickPreview=false;
    const o=c.dataset.o; state.origins=new Set([o]); document.querySelectorAll('#origins .chip').forEach(x=>{ if(x!==c) x.classList.remove('on'); }); c.classList.add('on');
    saveUserBaseState();
    populateDestDropdown(); renderPicks(); render();
  };
});
const regions=[...new Set(DATA.routes.map(r=>r.region))];
document.getElementById('regions').innerHTML='<span style="font-size:11px;color:var(--tx3);align-self:center">区域</span>'+regions.map(r=>'<div class="chip" data-r="'+r+'">'+REGION_NAME[r]+' '+DATA.routes.filter(x=>x.region===r).length+'</div>').join('');
document.querySelectorAll('#regions .chip').forEach(c=>c.onclick=()=>{ const r=c.dataset.r; if(state.regions.has(r)){state.regions.delete(r);c.classList.remove('on');} else{state.regions.add(r);c.classList.add('on');} render(); });
const _exClose=document.getElementById('excludeClose'); if(_exClose){ _exClose.onclick=()=>{ const bar=document.getElementById('excludeBar'); if(bar) bar.style.display='none'; }; }
document.getElementById('tierStats').innerHTML=TIER_KEYS.map(t=>{ const c=DATA.routes.filter(r=>r.tier===t).length; const C=TIER_COLOR[t]; return '<span class="pill" style="background:'+C.bg+';border-color:'+C.bc+'"><b>'+c+'</b> 条 '+TIER_LABEL[t]+'</span>'; }).join('');
document.getElementById('statAll').textContent=DATA.routes.length;
document.getElementById('mapLegend').innerHTML='<b>往返价格分档</b>'+TIER_KEYS.map(t=>{const C=TIER_COLOR[t];return '<div><span class="dot" style="background:'+C.dot+'"></span> '+TIER_LABEL[t]+'</div>';}).join('')+'<div style="color:#8b93a1;margin-top:3px">圆点越大＝可选航班/日期越多</div>';
renderPicks(); render();
setTimeout(()=>map.invalidateSize(),300);

/* ---------- 酒店推荐模块 ---------- */
// 双瓦片源：默认高德（境内清晰）+ 标准英文（OSM/CartoDB 海外覆盖），用户可手动切换
const HOTEL_TILES = {
  gaode: { url:'https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', sub:['1','2','3','4'], max:18, label:'高德地图', attr:'&copy; 高德地图' },
  osm:   { url:'https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png',                              sub:['a','b','c'],     max:19, label:'标准英文', attr:'&copy; OpenStreetMap' },
};
let hotelTileBase = 'gaode';
function isIntlCity(lat,lng){ return lat<5 || lat>55 || lng<70 || lng>145; }
function setHotelTiles(base){
  if(!hotelMap) return;
  if(window._hotelTileLayer){ hotelMap.removeLayer(window._hotelTileLayer); window._hotelTileLayer=null; }
  hotelTileBase = base;
  const opt = HOTEL_TILES[base];
  const fallback = HOTEL_TILES[base==='gaode'?'osm':'gaode'].url;
  window._hotelTileLayer = L.tileLayer(opt.url,{subdomains:opt.sub,maxZoom:opt.max,attribution:opt.attr,crossOrigin:false,detectRetina:false}).addTo(hotelMap);
  window._hotelTileLayer.on('tileerror',function(e){
    const img=e.tile; if(!img || img._hotelFbDone || !img.src) return;
    let z,x,y;
    try{
      const u=new URL(img.src);
      z=u.searchParams.get('z'); x=u.searchParams.get('x'); y=u.searchParams.get('y');
      if(!z || !x || !y){
        const parts=u.pathname.split('/').filter(Boolean);
        if(parts.length>=3){ z=parts[parts.length-3]; x=parts[parts.length-2]; y=parts[parts.length-1].replace('.png',''); }
      }
    }catch(_){ return; }
    if(!z || !x || !y) return;
    img._hotelFbDone=true;
    img.src=fallback.replace('{z}',z).replace('{x}',x).replace('{y}',y);
  });
  document.querySelectorAll('input[name="hotelTile"]').forEach(r=>{ r.checked = (r.value===base); });
}
function initHotel(){
  if(!HOTEL_DESTS.length || !document.getElementById('hotelMap')) return;
  hotelMap=L.map('hotelMap',{zoomControl:true,worldCopyJump:true,minZoom:2}).setView([20,108],3);
  setHotelTiles('gaode');
  hotelLayer=L.layerGroup().addTo(hotelMap);
  // 右上：瓦片源切换控件
  const tileCtrl=document.createElement('div');
  tileCtrl.className='hotel-tiles-ctrl';
  tileCtrl.innerHTML = Object.entries(HOTEL_TILES).map(([k,o])=>'<label><input type="radio" name="hotelTile" value="'+k+'">'+o.label+'</label>').join('');
  tileCtrl.addEventListener('change', e=>{ if(e.target.name==='hotelTile') setHotelTiles(e.target.value); });
  // Leaflet 把 .leaflet-top/.leaflet-right 上的元素识别为控件
  const wrap=document.createElement('div'); wrap.className='leaflet-top leaflet-right'; wrap.appendChild(tileCtrl);
  document.getElementById('hotelMap').appendChild(wrap);
  document.querySelectorAll('.htab').forEach(t=>t.onclick=()=>{
    document.querySelectorAll('.htab').forEach(x=>x.classList.toggle('on',x===t));
    hotelCat=t.dataset.cat; renderHotelList();
  });
  // 视图切换（上方 4 个 tab）
  document.querySelectorAll('.hvtab').forEach(t=>t.onclick=()=>setHotelView(t.dataset.view));
  drawHotelGlobal();
  setTimeout(()=>hotelMap.invalidateSize(),300);
}
function drawHotelGlobal(){
  if(!hotelMap) return;
  hotelLayer.clearLayers(); hotelMarkers=[]; hotelSel=null;
  HOTEL_DESTS.forEach(d=>{
    const m=L.circleMarker([d.lat,d.lng],{radius:6,color:'#fff',weight:1.5,fillColor:'#0f9960',fillOpacity:.82}).addTo(hotelLayer);
    m.bindTooltip('<b>'+d.city+'</b> · 点击查看当地酒店',{direction:'top'});
    m.on('click',()=>selectDest(d.code));
    hotelMarkers.push(m);
  });
  setHotelMode('🌍 全球酒店分布');
  refreshGlobalIframes();
  renderHotelList();
}
// 在地图左上提示框里写文字 + 「↺ 返回全球视图」按钮
function setHotelMode(html){
  const mode=document.getElementById('hotelMode'); if(!mode) return;
  mode.innerHTML = '<span>'+html+'</span>' + (hotelSel ? '<button class="hotel-back" id="hotelBackBtn">↺ 返回全球视图</button>' : '');
  const back=document.getElementById('hotelBackBtn');
  if(back) back.onclick = ()=>drawHotelGlobal();
}
// 携程酒店搜索 URL —— 默认使用国内携程 hotels.ctrip.com，模块可通过 hotelDomain:'trip' 切回国际站
// - hotels.ctrip.com 与 trip.com 使用同一套 city 数字 ID，均支持 ?city={数字ID}&checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD 同时预填目的地与日期
// - 两者均无 X-Frame-Options / CSP frame-ancestors 限制，可直接 iframe 嵌入
// - 数字 ID 取自 CITY_TRIP_ID[d.code].city（已按现行编号校正）
// - 表外城市兜底：统一回桌面端 PC 酒店列表页（hotels.ctrip.com/hotels/list），绝不跳移动端 H5；国际站回 PC 首页
function _cacheBust(u){ const x=new URL(u); x.searchParams.set('_', String(Date.now())); return x.toString(); }
function tripMapUrl(d, rk){
  const dep=rk?.options[0]?.depDate, ret=rk?.options[0]?.retDate;
  const cid = (d && CITY_TRIP_ID[d.code] && CITY_TRIP_ID[d.code].city) || null;
  const isCtrip = ((DATA && DATA.hotelDomain) || 'ctrip') !== 'trip';
  if(!cid){
    // 桌面端 PC 列表页（可手动搜索），避免 iframe 内呈现移动端 H5 布局
    return isCtrip ? 'https://hotels.ctrip.com/hotels/list' : 'https://www.trip.com/hotels/list';
  }
  const base = isCtrip ? 'https://hotels.ctrip.com/hotels/list' : 'https://www.trip.com/hotels/list';
  const u = new URL(base);
  u.searchParams.set('city', String(cid));
  if(dep) u.searchParams.set('checkIn', dep);
  if(ret) u.searchParams.set('checkOut', ret);
  if(!isCtrip) u.searchParams.set('adult', '1');
  return _cacheBust(u.toString());
}
function bookingMapUrl(d, rk){
  const dep=rk?.options[0]?.depDate, ret=rk?.options[0]?.retDate;
  const u = new URL('https://www.booking.com/searchresults.html');
  u.searchParams.set('ss', d.city);
  if(dep) u.searchParams.set('checkin', dep);
  if(ret) u.searchParams.set('checkout', ret);
  u.searchParams.set('group_adults','1');
  u.searchParams.set('no_rooms','1');
  u.searchParams.set('group_children','0');
  u.searchParams.set('map','1');
  u.searchParams.set('lang','zh-cn');
  u.searchParams.set('selected_currency','CNY');
  return _cacheBust(u.toString());
}
function airbnbMapUrl(d, rk){
  // Airbnb 禁止 iframe 嵌入（X-Frame-Options: SAMEORIGIN），此 URL 仅供「在新窗口打开」用（需预填目的地+日期+地图模式）
  const dep=rk?.options[0]?.depDate, ret=rk?.options[0]?.retDate;
  const u = new URL('https://www.airbnb.com/s/'+encodeURIComponent(d.city)+'/homes');
  if(dep) u.searchParams.set('checkin', dep);
  if(ret) u.searchParams.set('checkout', ret);
  u.searchParams.set('adults', '1');
  u.searchParams.set('search_mode', 'map_search');  // 默认地图模式
  u.searchParams.set('currency', 'CNY');
  return u.toString();
}
function osmEmbedUrl(d){
  // bbox ≈ 4.5km×4.5km 框（lng,lat 范围）+ 中心 marker
  const dLng = 0.022, dLat = 0.018;
  const lngMin = (d.lng - dLng).toFixed(4), lngMax = (d.lng + dLng).toFixed(4);
  const latMin = (d.lat - dLat).toFixed(4), latMax = (d.lat + dLat).toFixed(4);
  return 'https://www.openstreetmap.org/export/embed.html?bbox='+lngMin+'%2C'+latMin+'%2C'+lngMax+'%2C'+latMax+'&layer=mapnik&marker='+d.lat.toFixed(4)+'%2C'+d.lng.toFixed(4);
}
function osmOpenUrl(d){
  const dLng = 0.022, dLat = 0.018;
  const lngMin = (d.lng - dLng).toFixed(4), lngMax = (d.lng + dLng).toFixed(4);
  const latMin = (d.lat - dLat).toFixed(4), latMax = (d.lat + dLat).toFixed(4);
  return 'https://www.openstreetmap.org/?mlat='+d.lat.toFixed(4)+'&mlon='+d.lng.toFixed(4)+'#map=13/'+d.lat.toFixed(4)+'/'+d.lng.toFixed(4);
}
// 视图切换 + 全局 URL
let hotelView='leaflet';
function setHotelView(v){
  hotelView=v;
  ['leaflet','osm','trip','booking','airbnb'].forEach(k=>{
    document.querySelectorAll('.hvtab[data-view="'+k+'"]').forEach(t=>t.classList.toggle('on', k===v));
    const wrap = document.getElementById(k==='leaflet'?'hotelMap' : 'hotel'+k.charAt(0).toUpperCase()+k.slice(1)+'Wrap');
    if(!wrap) return;
    if(k==='leaflet'){ wrap.style.display = (v==='leaflet') ? '' : 'none'; if(v==='leaflet' && hotelMap) setTimeout(()=>hotelMap.invalidateSize(),50); }
    else{ wrap.style.display = (v===k) ? '' : 'none'; }
  });
  // 酒店分类标签只在「自做标点」视图有意义
  const catTabs=document.getElementById('hotelTabs');
  if(catTabs) catTabs.classList.toggle('show', v==='leaflet');
  // 切到嵌入视图时让酒店地图区域独享整宽（嵌入页自含酒店列表）
  const main = document.querySelector('.hotel-main');
  if(main) main.classList.toggle('embed', v!=='leaflet');
  // 同步更新当前 hotelSel 下的 iframe
  if(hotelSel){
    const d=HOTEL_DATA[hotelSel]; if(d) refreshHotelIframes(d, destBest[hotelSel]);
  } else {
    // 还没选具体目的地时，使用东亚兜底；只要用户选了目的地，下一次切 tab 会自动重新 refreshHotelIframes
    refreshGlobalIframes();
  }
}
function refreshHotelIframes(d, rk){
  const osmUrl=osmEmbedUrl(d), osmOpen=osmOpenUrl(d);
  const osmI=document.getElementById('hotelOsm');
  if(osmI){
    osmI.onload=()=>hideFail('hotelOsmFail');
    osmI.onerror=()=>showFail('hotelOsmFail');
    // 强制重载：先置 about:blank 再设新 URL（避免同 URL 跨域缓存复用）
    if(osmI.src && osmI.src!=='about:blank'){ osmI.src='about:blank'; setTimeout(()=>{ osmI.src=osmUrl; }, 30); }
    else { osmI.src=osmUrl; }
  }
  const osmOpenA=document.getElementById('hotelOsmOpen'); if(osmOpenA) osmOpenA.href=osmOpen;
  const tripUrl=tripMapUrl(d,rk);
  const tripI=document.getElementById('hotelTrip');
  if(tripI){
    tripI.onload=()=>hideFail('hotelTripFail');
    tripI.onerror=()=>showFail('hotelTripFail');
    if(tripI.src && tripI.src!=='about:blank'){ tripI.src='about:blank'; setTimeout(()=>{ tripI.src=tripUrl; }, 30); }
    else { tripI.src=tripUrl; }
  }
  const tripOpenA=document.getElementById('hotelTripOpen'); if(tripOpenA) tripOpenA.href=tripUrl;
  const bkUrl=bookingMapUrl(d,rk);
  const bkI=document.getElementById('hotelBooking');
  if(bkI){
    bkI.onload=()=>hideFail('hotelBookingFail');
    bkI.onerror=()=>showFail('hotelBookingFail');
    if(bkI.src && bkI.src!=='about:blank'){ bkI.src='about:blank'; setTimeout(()=>{ bkI.src=bkUrl; }, 30); }
    else { bkI.src=bkUrl; }
  }
  const bkOpenA=document.getElementById('hotelBookingOpen'); if(bkOpenA) bkOpenA.href=bkUrl;
  const abUrl=airbnbMapUrl(d,rk);
  // Airbnb 不放 iframe（X-Frame-Options 触发时 Chrome 在 native 层画 ERR_BLOCKED_BY_RESPONSE，盖不住 host 文档的 div）
  // 直接用降级卡片占位 #hotelAirbnbWrap
  const abOpenA=document.getElementById('hotelAirbnbOpen'); if(abOpenA) abOpenA.href=abUrl;
  const abMeta=document.getElementById('hotelAirbnbMeta');
  if(abMeta){
    const dep=rk?.options[0]?.depDate, ret=rk?.options[0]?.retDate;
    const dateTxt = (dep && ret) ? (dep+' → '+ret) : (d.city==='东亚' ? '请先在地图上点选具体目的地' : '请选择出行日期');
    abMeta.textContent = '当前：'+d.city+(dateTxt?' · '+dateTxt:'');
  }
}
function refreshGlobalIframes(){
  // 全球视图：中央标点 = 东亚中心
  const d = { city:'东亚', lat:30, lng:108 };
  refreshHotelIframes(d, null);
}
function showFail(id){
  const el=document.getElementById(id); if(el) el.classList.add('show');
}
function hideFail(id){
  const el=document.getElementById(id); if(el) el.classList.remove('show');
}
function highlightHotel(h){
  if(!hotelMap || !h) return;
  // 1) 重置所有气泡的选中态
  hotelMarkers.forEach(m=>{
    if(!m._hotelData) return;
    const el=m._icon;
    if(el){
      const bub=el.querySelector('.hm-bubble');
      if(bub) bub.classList.remove('sel');
    }
  });
  // 2) 列表卡片去掉高亮
  document.querySelectorAll('#hotelList .hotel-card').forEach(c=>c.classList.remove('is-sel'));
  // 3) 找对应 marker
  const key = h.name+'_'+h.cat;
  const m = hotelMarkers.find(x=>x._hotelKey===key);
  if(m){
    const ll = m.getLatLng();
    hotelMap.flyTo(ll, 14, {duration:.7});
    const el=m._icon;
    if(el){
      const bub=el.querySelector('.hm-bubble');
      if(bub){
        bub.classList.add('sel');
        bub.offsetHeight;
      }
    }
    m.setZIndexOffset(1000);
    m.openTooltip();
  }
  // 4) 列表卡片加高亮 + 滚到可见
  const card = document.querySelector('#hotelList .hotel-card[data-key="'+key.replace(/"/g,'\\"')+'"]');
  if(card){
    card.classList.add('is-sel');
    card.scrollIntoView({block:'nearest', behavior:'smooth'});
  }
}
function selectDest(code, rk){
  const d=HOTEL_DATA[code]; if(!d||!hotelMap) return;
  // rk 优先：用户实际点击的航线 > 全局 destBest（按 origin 重建后的最便宜）
  if(!rk) rk = destBest[code];
  if(rk && code2key[code]){ try{ select(code2key[code], false, true); }catch(e){ /* 选择器联动失败不影响酒店/地图刷新 */ } }   // 联动机票 / 天气 / 粘性选择器
  hotelSel=code;
  if(isIntlCity(d.lat,d.lng) && hotelTileBase==='gaode') setHotelTiles('osm');
  hotelMap.flyTo([d.lat,d.lng], 12, {duration:.8});
  hotelLayer.clearLayers(); hotelMarkers=[];
  const all=[...d.budget,...d.chain,...d.airbnb];
  const n=all.length;
  const dep=rk?.options[0]?.depDate, ret=rk?.options[0]?.retDate;
  const colMap={budget:'#0f9960',chain:'#2563d9',airbnb:'#e02b3c'};
  // 8 瓣花抖动半径：真实坐标库的城市用 0（按真实经纬度），合成数据用 0.006
  const jitter = (n>8 && !d.real) ? 0.006 : 0.002;
  const slots = Math.min(n, 8);
  all.forEach((h,i)=>{
    let la, ln;
    if(typeof h.lat==='number' && typeof h.lng==='number'){
      la = h.lat; ln = h.lng;
    } else {
      const ang = (Math.PI*2*(i%slots))/slots;
      const rad  = jitter;
      const jL = (((i*9301+49297)%233280)/233280 - 0.5) * 0.0006;
      const jG = (((i*3673+12791)%198491)/198491 - 0.5) * 0.0006;
      la = d.lat + Math.cos(ang)*rad + jL;
      ln = d.lng + Math.sin(ang)*rad + jG;
    }
    const col=colMap[h.cat];
    const priceTxt = h.priceMax ? ('¥'+h.price+'–'+h.priceMax) : ('¥'+h.price);
    const icon = L.divIcon({
      className:'hm-icon',
      html:'<div class="hm-wrap"><div class="hm-bubble '+h.cat+'">'+priceTxt+'</div><div class="hm-dot"></div></div>',
      iconSize:[0,0], iconAnchor:[0,0]
    });
    const m=L.marker([la,ln],{icon,riseOnHover:true}).addTo(hotelLayer);
    const priceDetail = h.priceMax ? ('¥'+h.price+'–'+h.priceMax+'/晚') : ('¥'+h.price+'/晚起');
    m.bindTooltip('<b>'+h.name+'</b><br><span style="color:#666">'+h.brand+' · '+priceDetail+(dep?'<br>入住 '+dep+' · 退房 '+ret:'')+'</span>',{direction:'right',offset:[8,0]});
    m._hotelKey = h.name+'_'+h.cat;
    m._hotelData = h;
    m.on('click',()=>{ highlightHotel(h); });
    hotelMarkers.push(m);
  });
  // 城市中心白色小点（永久标签）
  const center=L.circleMarker([d.lat,d.lng],{radius:3,color:'#1b1f26',weight:1,fillColor:'#fff',fillOpacity:1}).addTo(hotelLayer);
  center.bindTooltip('<b>📍 '+d.city+' 中心</b>',{permanent:true,direction:'right',offset:[6,0]});
  setHotelMode('📍 <b>'+d.city+'</b> · 当地酒店 '+n+' 家'+(rk?(' · 入住 '+dep+' · 退房 '+ret+'（机票推荐行程）'):''));
  refreshHotelIframes(d, rk);
  renderHotelList();
}
function renderHotelList(){
  const list=document.getElementById('hotelList'); if(!list) return;
  if(!hotelSel){
    list.innerHTML='<div class="hotel-global">'+HOTEL_DESTS.map(d=>'<div class="hg-card" data-code="'+d.code+'"><b>'+d.city+'</b><span>'+d.budget.length+' 平价 · '+d.chain.length+' 连锁 · '+d.airbnb.length+' Airbnb</span></div>').join('')+'</div>';
    list.querySelectorAll('.hg-card').forEach(c=>c.onclick=()=>selectDest(c.dataset.code));
    return;
  }
  const d=HOTEL_DATA[hotelSel];
  const items=d[hotelCat]||[];
  const colMap={budget:'#0f9960',chain:'#2563d9',airbnb:'#e02b3c'};
  const rk=destBest[hotelSel];
  const dep=rk?.options[0]?.depDate, ret=rk?.options[0]?.retDate;
  const trip = tripMapUrl(d, rk), bmap = bookingMapUrl(d, rk), abnb = airbnbMapUrl(d, rk);
  list.innerHTML =
    '<div class="hotel-list-head"><div class="ttl">📍 '+d.city+'</div><button class="hotel-back" id="hotelListBackBtn">↺ 返回全球</button></div>'+
    '<div class="hotel-actions" style="margin-bottom:8px;padding-top:0;border:0">'+
      '<a class="trip"    href="'+trip+'"  target="_blank" rel="noopener">🗺 携程酒店列表 →</a>'+
      '<a class="booking" href="'+bmap+'"  target="_blank" rel="noopener">🗺 在 Booking 地图查看 →</a>'+
      '<a class="airbnb"  href="'+abnb+'"  target="_blank" rel="noopener">🏠 在 Airbnb 地图查看 →</a>'+
    '</div>'+
    items.map(h=>{
      const price=h.priceMax?('¥'+h.price+'–'+h.priceMax+'/晚'):('¥'+h.price+'/晚起');
      const catLabel=DATA.hotelCats.find(c=>c.key===h.cat).label;
      const url=buildHotelUrl(h,rk);
      const key=h.name+'_'+h.cat;
      return '<div class="hotel-card" data-key="'+key+'" data-url="'+url+'">'+
        '<div class="hc-top"><span class="hc-cat" style="background:'+colMap[h.cat]+'">'+catLabel+'</span><span class="hc-price">'+price+'</span></div>'+
        '<div class="hc-name">'+h.name+'</div>'+
        (dep?'<div class="hc-date" style="font-size:10.5px;color:var(--tx3);margin-top:2px">✈️ 机票推荐行程 '+dep+' → '+ret+'（共 '+tripDays(dep,ret)+' 晚）</div>':'')+
        '<div class="hc-go"><a href="'+url+'" target="_blank" rel="noopener" data-trip>在携程打开预订 →</a></div></div>';
    }).join('');
  // 卡片点击联动地图（div 化后由 JS 绑事件，stopPropagation 避免点链接时误触）
  list.querySelectorAll('.hotel-card').forEach(card=>{
    card.addEventListener('click', e=>{
      if(e.target.closest('a')) return;  // 点内部链接不触发地图联动
      const key=card.dataset.key;
      const h=(items.find(x=>(x.name+'_'+x.cat)===key));
      if(h) highlightHotel(h);
    });
  });
  const back=document.getElementById('hotelListBackBtn');
  if(back) back.onclick = ()=>drawHotelGlobal();
}
function syncHotels(code, rk){
  if(!hotelMap) return;            // 初始化前跳过
  if(HOTEL_DATA[code]){
    // 用用户实际点击的路线 rk（destBest 只是兜底），保证 embed 日期/价格与选中航线一致
    if(code===hotelSel && rk===destBest[code]) return;
    selectDest(code, rk);
  } else if(hotelSel !== null){
    // 该目的地无酒店数据：避免 embed 卡在旧目的地（用户切到一个没收录酒店的城市时尤其明显），重置到全球视图
    hotelSel = null;
    try{ drawHotelGlobal(); }catch(_e){}
    try{ refreshGlobalIframes(); }catch(_e){}
  }
}
if(HOTEL_DESTS.length) initHotel();

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
  makeReliableTileLayer(wmap);
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
    const fc= t.daily && t.daily.length ? t.daily.map(d=>{ const heavy=d.prcp>=25, wet=d.prcp>=1; const col= heavy?'#fdecee':(wet?'#eaf0fd':'#e7f6ee'); return '<div class="wfcday" style="background:'+col+'"><div class="d">'+d.date.slice(5)+'</div><div class="r">'+wIcon(d.code,d.prcp)+'</div><div class="t">'+Math.round(d.tmax)+'°</div><div class="p">'+Math.round(d.pop)+'% · '+Math.round(d.prcp)+'mm</div></div>'; }).join('') : '';
    return '<div class="wrow" data-code="'+t.code+'">'+
      '<div class="wr-top"><div class="wr-city">'+t.city+'<span class="code">'+t.code+'</span></div><span class="wr-g" style="background:'+g.color+'">'+g.label+'</span></div>'+
      '<div class="wr-sub"><span>'+t.originCity+'出发</span><span>出行 <b>'+t.dep.slice(5)+'~'+t.ret.slice(5)+'</b> · '+t.summary.days+'天</span><span>晴日 <b>'+t.summary.dryDays+'/'+t.summary.days+'</b></span><span>累计降雨 <b>'+t.summary.totalPrcp+' mm</b></span><span>降雨概率均 <b>'+t.summary.avgPop+'%</b></span><span>高温 <b>'+t.summary.tmax+'°</b></span>'+(t.tier?('<span class="badge '+(t.tier==='T1'||t.tier==='T2'?'r':'')+'">机票 '+TIER_LABEL[t.tier]+' ¥'+t.minPrice+'</span>'):'')+'</div>'+
      '<div class="wfc"><div class="wfclist">'+fc+'</div></div></div>';
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

  // 枫叶地图：Leaflet + 高德 tiles，标记按变色阶段上色，最佳观赏窗口脉动
  const kmap=L.map('kMap',{zoomControl:true,worldCopyJump:true,minZoom:4,maxZoom:9,scrollWheelZoom:true}).setView([37.2,138.0],5);
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',{subdomains:['1','2','3','4'],maxZoom:16,attribution:'&copy; 高德地图'}).addTo(kmap);
  const kLayer=L.layerGroup().addTo(kmap);
  const kMarkers={};
  KOYO.cities.forEach(c=>{
    if(c.stage==='falling') return;  // 落叶期城市：作为已剔除标记单独画
    const m=L.circleMarker([c.lat,c.lng],{
      radius:c.inBest?11:8,
      color:'#fff',
      weight:c.inBest?2.5:1.5,
      fillColor:c.color,
      fillOpacity:.92,
      className:(c.inBest?'mk kmk-best':'mk')
    }).addTo(kLayer);
    m.bindTooltip('<b>'+c.city+'</b>（'+c.code+'）· '+c.label+
      '<br><span style="color:#666">变色进度 '+c.progress+'% · 盛期 '+c.peak.slice(5)+
      (c.inBest?' · ⭐ 最佳 '+c.bestStart.slice(5)+'~'+c.bestEnd.slice(5):'')+'</span>',
      {direction:'top',offset:[0,-6]});
    m.on('click',()=>kSelect(c.code,true));
    kMarkers[c.code]=m;
  });
  // 已剔除目的地标记（半透明虚线，颜色随剔除原因）
  const exCities=(KOYO.excluded||[]).filter(c=>c.lat!=null&&c.lng!=null);
  if(exCities.length){
    const exLayer=L.layerGroup().addTo(kmap);
    exCities.forEach(c=>{
      const col=c.color||'#9c6b3f';
      const m=L.circleMarker([c.lat,c.lng],{
        radius:7,color:col,weight:1.5,dashArray:'3,2',
        fillColor:col,fillOpacity:.25,className:'mk'
      }).addTo(exLayer);
      m.bindTooltip('<b>'+c.city+'</b>（'+c.code+'）· <span style="color:'+col+'">已剔除 · '+(c.label||'')+'</span>'
        +(c.reasonText?'<br><span style="color:#666">'+c.reasonText+'</span>':''),{direction:'top',offset:[0,-4]});
    });
  }
  function kSelect(code,fromMap){
    const c=KOYO.cities.find(x=>x.code===code); if(!c) return;
    document.querySelectorAll('.kcard').forEach(el=>el.classList.toggle('sel',el.dataset.code===code));
    if(fromMap){
      const el=document.querySelector('.kcard[data-code="'+code+'"]');
      if(el){ el.scrollIntoView({behavior:'smooth',block:'center'}); el.classList.add('flash'); setTimeout(()=>el.classList.remove('flash'),1200); }
    }
    if(kMarkers[code]) kMarkers[code].openTooltip();
    kmap.flyTo([c.lat,c.lng], kmap.getZoom()<5?6:kmap.getZoom(), {duration:.7});
  }
  // 双向联动：点卡片 → 飞地图 + 高亮标记
  document.querySelectorAll('.kcard').forEach(el=>el.onclick=()=>{
    const c=KOYO.cities.find(x=>x.code===el.dataset.code); if(!c) return;
    kSelect(c.code,false);
  });
  setTimeout(()=>kmap.invalidateSize(),300);
}
</script>
<div style="position:fixed;right:8px;bottom:8px;z-index:9999;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#8b93a1;background:rgba(255,255,255,.82);border:1px solid #e4e7ec;border-radius:6px;padding:2px 7px;backdrop-filter:blur(2px)" title="构建版本 ${BUILD_VERSION} · ${BUILD_TS_ISO}">构建 v${BUILD_VERSION}</div>
</body>
</html>`;

fs.mkdirSync(path.join(ROOT, 'dist', MOD_ID), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', MOD_ID, 'index.html'), html);
console.log('生成 dist/' + MOD_ID + '/index.html (' + Math.round(html.length / 1024) + ' KB)');

// 版本清单：供 GitHub / CloudStudio 对齐 & 上传守护比对（被全量推送一并带上）
try {
  const vf = path.join(ROOT, 'dist', 'version.json');
  let vj = {};
  try { vj = JSON.parse(fs.readFileSync(vf, 'utf8')); } catch (_) {}
  vj.version = BUILD_VERSION;
  vj.ts = BUILD_TS_ISO;
  vj.modules = Object.keys(MODULES);
  vj.built = vj.built || {};
  vj.built[MOD_ID] = new Date().toISOString();
  fs.writeFileSync(vf, JSON.stringify(vj, null, 2));
} catch (_) {}

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
  out.push('- 搜索口径：先按各目的地物候推算「' + RED_LABELS + '」的日期区间，仅在该区间内搜索低价航班；绿叶期与落叶期的目的地及日期均不纳入结果。');
  out.push('- 最终保留目的地 ' + koyoKept + ' 个' + (koyoExcluded.length ? '，剔除 ' + koyoExcluded.length + ' 个' : ''));
  for (const g of koyoExGroups) {
    out.push('  · 已剔除 ' + g.items.length + ' 个「' + g.label + '」目的地（' + g.desc + '）：' +
      g.items.map(c => c.city + '(' + c.code + ')' + (c.redStart ? ' 红叶期' + c.redStart.slice(5) + '~' + c.redEnd.slice(5) : '')).join('、'));
  }
  out.push('- 落在最佳观赏窗口内的目的地：' + (wraw.koyo.cities.filter(c => c.inBest).map(c => c.city + '(' + c.label + '·盛期' + c.peak.slice(5) + ')').join('、') || '无'));
  out.push('- 各城市枫叶阶段：' + wraw.koyo.cities.slice(0, 15).map(c => c.city + '=' + c.label + '(' + c.progress + '%)').join('、'));
  out.push('');
}
fs.writeFileSync(path.join(ROOT, 'data', MOD_ID, 'summary.txt'), out.join('\n'));
console.log('生成 data/' + MOD_ID + '/summary.txt');

// 通用「仅日历」抓取：当 Trip.com 的 FlightListSearch 被 whaleguard 反爬拦截（返回 430 "whaleguard block"）时，
// 退而使用可正常访问的 GetLowPriceInCalender 接口，按目的地区域偏好的行程天数筛选实时低价日期组合。
// 兼容任意模块（默认 global-year；可传 moduleId）。产物与 scrape.js 完全兼容（data/<id>/flights.json），
// 航班号/航司/中转信息因接口限制暂不可用（route.options[].detailLimited=true，build.js 已做降级渲染）。
// 用法: node scrape_calendar.js [moduleId]
const fs = require('fs');
const path = require('path');
{
  const flush = (args) => {
    const s = args.map(a => typeof a === 'string' ? a : require('util').inspect(a)).join(' ') + '\n';
    fs.writeSync(process.stderr.fd, s);
  };
  console.log = function (...a) { flush(a); };
  console.info = console.log;
  console.error = function (...a) { flush(a); };
}
const api = require('./api');
const { MODULES } = require('./modules');
const koyoLib = require('./koyo');

const ROOT = path.resolve(__dirname, '..');
const MOD_ID = process.argv[2] || 'global-year';
const MOD = MODULES[MOD_ID];
if (!MOD) { console.error('未知模块: ' + MOD_ID); process.exit(1); }

const ORIGINS = MOD.origins;
const DESTS = MOD.destinations;
const WIN_START = MOD.window.start;
const WIN_END = MOD.window.end;
const PRICE_CAP = MOD.priceCap;
const TIERS = MOD.tiers;
const INTL_ONLY_ORIGINS = new Set(MOD.rules.intlOnlyOrigins);
const LCC = new Set(['9C', 'AQ', 'PN', 'KN', '8L', 'DR', 'GJ', 'UQ', 'GY']);
const LCC_NAME = { '9C': '春秋航空', 'AQ': '九元航空', 'PN': '西部航空', 'KN': '中国联合航空', '8L': '祥鹏航空', 'DR': '瑞丽航空', 'GJ': '长龙航空', 'UQ': '乌鲁木齐航空', 'GY': '多彩贵州航空' };

function haversineKm(a, b) {
  const R = 6371, rad = (x) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function routeEnabled(o, d) {
  if (o.code === d.code) return false;
  if (INTL_ONLY_ORIGINS.has(o.code) && d.region === 'domestic') return false;
  return true;
}
function tripDays(dep, ret) {
  return Math.round((Date.parse(ret + 'T00:00:00Z') - Date.parse(dep + 'T00:00:00Z')) / 86400000);
}
function addDays(dateStr, n) {
  return new Date(Date.parse(dateStr + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
function tierOf(price) {
  for (const t of TIERS) if (price <= t.cap) return t.key;
  return null;
}
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
// 区域 → 偏好行程天数区间（未配置则用模块整体 tripMin/tripMax）
function bandOf(area) {
  const ranges = MOD.tripRangesByArea;
  if (ranges && area) {
    for (const k of Object.keys(ranges)) {
      const r = ranges[k];
      if (r.areas && r.areas.indexOf(area) >= 0) return { min: r.min, max: r.max, kind: k };
    }
  }
  return { min: MOD.tripMin, max: MOD.tripMax, kind: 'default' };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function retry(fn, times = 2, gap = 800) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(gap * (i + 1)); }
  }
  throw last;
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { __error: e.message }; }
    }
  }));
  return out;
}
// 在 [winS, winE] 内均匀取 n 个出发锚点（去重；窗口短时自动收敛为更少的锚点）
function depAnchors(winS = WIN_START, winE = WIN_END, n = 6) {
  const s = Date.parse(winS + 'T00:00:00Z');
  const e = Date.parse(winE + 'T00:00:00Z');
  if (!(e > s)) return [winS];
  const N = Math.max(2, n);
  const arr = [];
  for (let i = 0; i < N; i++) {
    const d = new Date(s + (e - s) * (i / (N - 1)));
    arr.push(d.toISOString().slice(0, 10));
  }
  return [...new Set(arr)];
}
function optOf(p) {
  return {
    price: p.price,
    depDate: p.dep,
    retDate: p.ret,
    durationDays: p.dur,
    airlines: ['RT'],
    airlineNames: ['实时低价'],
    out: { flights: [], stops: 0, duration: 0 },
    back: { flights: [] },
    direct: true,
    hasLCC: false,
    stopsTotal: 0,
    detailLimited: true,
    bag: false,
  };
}
function makeRoute(o, d, pairs) {
  pairs.sort((a, b) => a.price - b.price);
  const best = pairs[0];
  const prices = pairs.map(p => p.price);
  const tier = tierOf(best.price);
  if (!tier) return null;
  const tierCap = TIERS.find(t => t.key === tier).cap;
  const distanceKm = Math.round(haversineKm(o, d));
  const calMax = Math.max(...prices);
  const calMedian = median(prices);
  return {
    key: o.code + '->' + d.code,
    originCode: o.code, originCity: o.city,
    code: d.code, city: d.city, region: d.region, lat: d.lat, lng: d.lng, tz: d.tz,
    area: d.area || null,
    query: d.code,
    distanceKm, transitAllowed: d.region !== 'domestic', transitFiltered: 0,
    isDomestic: d.region === 'domestic',
    tier,
    minPrice: best.price,
    calMedian, calMax,
    discountPct: calMax > best.price ? Math.round((1 - best.price / calMax) * 100) : 0,
    datePairsInBudget: pairs.filter(p => p.price <= tierCap).length,
    totalPairs: pairs.length,
    optionCount: pairs.length,
    lccFiltered: 0,
    isLimited: true,
    cheapestPairs: pairs.slice(0, 10).map(p => ({ dep: p.dep, ret: p.ret, price: p.price })),
    options: pairs.slice(0, 5).map(optOf),
  };
}

(async () => {
  const t0 = Date.now();
  const anchors = depAnchors();

  // ===== 枫叶定向搜索（japan-koyo）=====
  // 先确定各目的地「初红→半红→满红」对应的日期区间，只保留与监控窗口有足够交集的目的地，
  // 后续只在该区间内搜索低价日期组合——绿叶期与落叶期的航班从源头就不会进入结果。
  const KOYO_ON = !!MOD.koyo;
  const KOYO_YEAR = MOD.koyoYear || Number(WIN_START.slice(0, 4));
  const koyoWin = {};          // code -> searchWindow
  const koyoExcluded = [];     // 被剔除的目的地及原因
  if (KOYO_ON) {
    const REASON = {
      green: '监控窗口结束时仍未变色（绿叶期）',
      fallen: '监控窗口开始时已过红叶期（落叶期）',
      short: '红叶期与监控窗口交集不足一次完整行程',
    };
    for (const d of DESTS) {
      const sw = koyoLib.searchWindow(d, WIN_START, WIN_END, KOYO_YEAR, MOD.tripMin);
      if (sw.ok) { koyoWin[d.code] = sw; continue; }
      koyoExcluded.push({
        code: d.code, city: d.city, area: d.area || null, lat: d.lat, lng: d.lng,
        reason: sw.reason, reasonText: REASON[sw.reason] || sw.reason,
        redStart: sw.red.start, redEnd: sw.red.end, peak: sw.red.peak,
        overlapDays: sw.days,
      });
    }
    console.log('[枫叶定向] ' + KOYO_YEAR + ' 年红叶期 ∩ 监控窗口：保留 ' + Object.keys(koyoWin).length
      + ' 个目的地，剔除 ' + koyoExcluded.length + ' 个'
      + (koyoExcluded.length ? '（' + koyoExcluded.map(x => x.city + '·' + x.reason).join('、') + '）' : ''));
  }

  let routes = [];
  for (const o of ORIGINS) for (const d of DESTS) {
    if (!routeEnabled(o, d)) continue;
    // 国内航线白名单（仅 global-year 启用）：只保留指定省份/地区的目的地
    if (MOD.domesticKeep && d.region === 'domestic' && MOD.domesticKeep.indexOf(d.code) < 0) continue;
    // 枫叶模块：绿叶/落叶目的地不进入搜索
    if (KOYO_ON && !koyoWin[d.code]) continue;
    routes.push({ o, d });
  }
  console.log('[日历模式][' + MOD_ID + '] ' + ORIGINS.length + ' 出发地 × ' + DESTS.length + ' 目的地 → 有效航线 ' + routes.length + ' 条；锚点 ' + anchors.length + '；窗口 ' + WIN_START + '~' + WIN_END);

  let okRoutes = 0, totalPairs = 0, blocked = 0;
  const res = await pool(routes, 8, async (rt) => {
    const { o, d } = rt;
    const band = bandOf(d.area);
    // 枫叶模块按该目的地的红叶期收窄搜索区间；其他模块沿用整个监控窗口
    const kw = KOYO_ON ? koyoWin[d.code] : null;
    const sStart = kw ? kw.start : WIN_START;
    const sEnd = kw ? kw.end : WIN_END;
    const ancs = kw ? depAnchors(sStart, sEnd, 4) : anchors;
    const all = [];
    let routeBlocked = false;
    for (const dep of ancs) {
      try {
        const list = await retry(() => api.lowPriceCalendar(o.code, d.code, dep, addDays(dep, 30)), 2, 800);
        for (const p of list) {
          if (!p.price || p.price <= 0) continue;
          const dur = tripDays(p.dep, p.ret);
          if (dur < band.min || dur > band.max) continue;
          if (p.price > PRICE_CAP) continue;
          // 整段行程（去程与回程）都必须落在监控窗口内（枫叶模块即红叶期；其他模块即本模块窗口）
          const lo = kw ? sStart : WIN_START, hi = kw ? sEnd : WIN_END;
          if (p.dep < lo || p.ret > hi) continue;
          all.push({ dep: p.dep, ret: p.ret, price: p.price, dur });
        }
      } catch (e) {
        if (/whaleguard|430|block/i.test(e.message)) routeBlocked = true;
      }
      await sleep(60);
    }
    return { o, d, all, routeBlocked };
  });

  const rows = [];
  for (const r of res) {
    if (r.__error) { console.log('  跳过 ' + r.o.code + '->' + r.d.code + ' (错误: ' + r.__error + ')'); continue; }
    if (r.routeBlocked) blocked++;
    if (!r.all.length) continue;
    const row = makeRoute(r.o, r.d, r.all);
    if (row) { rows.push(row); okRoutes++; totalPairs += r.all.length; }
  }

  rows.sort((a, b) => a.minPrice - b.minPrice);

  // ===== 枫叶最终兜底：逐条校验最低价行程的枫叶阶段，非「初红/半红/满红」一律丢弃 =====
  let koyoFilter = null;
  if (KOYO_ON) {
    const fr = koyoLib.applyRedFilter({ rows, dests: DESTS, windows: koyoWin,
      excluded: koyoExcluded, year: KOYO_YEAR, log: (m) => console.log(m) });
    rows.length = 0; rows.push(...fr.rows);
    koyoFilter = fr.koyoFilter;
  }

  console.log('[3/3] 生成数据文件 ...');
  const payload = {
    moduleId: MOD_ID,
    moduleName: MOD.name,
    generatedAt: new Date().toISOString(),
    season: MOD.seasonInfo ? MOD.seasonInfo.season : null,
    seasonLabel: MOD.seasonInfo ? MOD.seasonInfo.label : null,
    detailLimited: true,
    detailLimitedNote: '航班号/航司/中转信息因 Trip.com 反爬（whaleguard）临时限制不可用；价格与行程天数为实时低价日历数据，已按区域偏好筛选行程天数。',
    origins: ORIGINS,
    origin: ORIGINS[0],
    window: { start: WIN_START, end: WIN_END },
    tripDuration: { min: MOD.tripMin, max: MOD.tripMax },
    priceCap: PRICE_CAP,
    tiers: TIERS.map(t => ({ key: t.key, cap: t.cap, label: t.label })),
    excludedAirlines: [...LCC].map(c => ({ code: c, name: LCC_NAME[c] })),
    rules: {
      intlOnlyOrigins: [...INTL_ONLY_ORIGINS],
      transitMinKm: MOD.rules.transitMinKm,
      note: '中国香港出发仅国际航线；国际航线可中转，国内航线须直飞（直线距离 ≥ ' + MOD.rules.transitMinKm + 'km 除外）',
    },
    koyoFilter,
    routes: rows,
  };
  const dir = path.join(ROOT, 'data', MOD_ID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'flights.json'), JSON.stringify(payload));
  console.log('[完成][' + MOD_ID + '] 命中航线 ' + rows.length + '（日历模式），收集低价日期组合 ' + totalPairs + ' 组；日历接口被拦截航线 ' + blocked + ' 条；耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');
  TIERS.forEach(t => {
    const c = rows.filter(r => r.tier === t.key).length;
    console.log('  档位 ' + t.key + '(' + t.label + '): ' + c);
  });
})();

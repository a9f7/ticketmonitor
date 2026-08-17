// 模块化机票抓取：按 scripts/modules.js 中指定模块驱动
// 用法: node scrape.js <moduleId>   （默认 gba-summer）
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
const api = require('./api');
const { MODULES } = require('./modules');
const koyoLib = require('./koyo');

const ROOT = path.resolve(__dirname, '..');
const MOD_ID = process.argv[2] || 'gba-summer';
const MOD = MODULES[MOD_ID];
if (!MOD) { console.error('未知模块: ' + MOD_ID); process.exit(1); }

const ORIGINS = MOD.origins;
const DESTS = MOD.destinations;
const WIN_START = MOD.window.start;
const WIN_END = MOD.window.end;
const TRIP_MIN_DAYS = MOD.tripMin;
const TRIP_MAX_DAYS = MOD.tripMax;
const PRICE_CAP = MOD.priceCap;
const TIERS = MOD.tiers;
const INTL_ONLY_ORIGINS = new Set(MOD.rules.intlOnlyOrigins);
const TRANSIT_MIN_KM = MOD.rules.transitMinKm;
const LCC = new Set(['9C', 'AQ', 'PN', 'KN', '8L', 'DR', 'GJ', 'UQ', 'GY']);
const LCC_NAME = { '9C': '春秋航空', 'AQ': '九元航空', 'PN': '西部航空', 'KN': '中国联合航空', '8L': '祥鹏航空', 'DR': '瑞丽航空', 'GJ': '长龙航空', 'UQ': '乌鲁木齐航空', 'GY': '多彩贵州航空' };
const ORIGIN_TZ = 8;

function haversineKm(a, b) {
  const R = 6371;
  const rad = (x) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function transitAllowed(o, d) {
  if (d.region !== 'domestic') return true;
  return haversineKm(o, d) >= TRANSIT_MIN_KM;
}
function routeEnabled(o, d) {
  if (o.code === d.code) return false;
  if (INTL_ONLY_ORIGINS.has(o.code) && d.region === 'domestic') return false;
  return true;
}

function tierOf(price) {
  for (const t of TIERS) if (price <= t.cap) return t.key;
  return null; // 超价（> priceCap）丢弃
}

function tripDays(dep, ret) {
  return Math.round((Date.parse(ret + 'T00:00:00Z') - Date.parse(dep + 'T00:00:00Z')) / 86400000);
}
// 按目的地 area 决定偏好行程天数范围；未配置 tripRangesByArea 时回退到 module 整体 tripMin/tripMax
function tripMinMaxOf(d) {
  const ranges = MOD.tripRangesByArea;
  if (ranges && d && d.area) {
    for (const k of Object.keys(ranges)) {
      const r = ranges[k];
      if (r.areas && r.areas.indexOf(d.area) >= 0) return { min: r.min, max: r.max };
    }
  }
  return { min: TRIP_MIN_DAYS, max: TRIP_MAX_DAYS };
}
function okDuration(dep, ret, d) {
  const { min, max } = tripMinMaxOf(d);
  const days = tripDays(dep, ret);
  return days >= min && days <= max;
}
function addDays(dateStr, n) {
  return new Date(Date.parse(dateStr + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

// ===== 枫叶定向搜索（japan-koyo）=====
// 先算出各目的地「初红→半红→满红」的日期区间，与监控窗口求交集：
// 交集为空（全程绿叶或全程落叶）或短于一次完整行程的目的地直接剔除，不再搜索航班。
const KOYO_ON = !!MOD.koyo;
const KOYO_YEAR = MOD.koyoYear || Number(WIN_START.slice(0, 4));
const KOYO_REASON = {
  green: '监控窗口结束时仍未变色（绿叶期）',
  fallen: '监控窗口开始时已过红叶期（落叶期）',
  short: '红叶期与监控窗口交集不足一次完整行程',
};
const koyoWin = {};
const koyoExcluded = [];
if (KOYO_ON) {
  for (const d of DESTS) {
    const sw = koyoLib.searchWindow(d, WIN_START, WIN_END, KOYO_YEAR, MOD.tripMin);
    if (sw.ok) { koyoWin[d.code] = sw; continue; }
    koyoExcluded.push({
      code: d.code, city: d.city, area: d.area || null, lat: d.lat, lng: d.lng,
      reason: sw.reason, reasonText: KOYO_REASON[sw.reason] || sw.reason,
      redStart: sw.red.start, redEnd: sw.red.end, peak: sw.red.peak, overlapDays: sw.days,
    });
  }
  console.log('[枫叶定向] ' + KOYO_YEAR + ' 年红叶期 ∩ 监控窗口：保留 ' + Object.keys(koyoWin).length
    + ' 个目的地，剔除 ' + koyoExcluded.length + ' 个');
}
// 该目的地允许搜索的日期区间（非枫叶模块返回整个监控窗口）
function searchRange(d) {
  const kw = KOYO_ON ? koyoWin[d.code] : null;
  return kw ? { start: kw.start, end: kw.end, koyo: true } : { start: WIN_START, end: WIN_END, koyo: false };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); }
      catch (e) { out[k] = { __error: e.message }; }
    }
  }));
  return out;
}
async function retry(fn, times = 3, gap = 1200) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(gap * (i + 1)); }
  }
  throw last;
}
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function fmtLocal(ms, tzHours) {
  const d = new Date(ms + tzHours * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}

// ================= Stage 1：低价日历 =================
async function stage1() {
  const jobs = [];
  for (const o of ORIGINS) for (const d of DESTS) {
    if (!routeEnabled(o, d)) continue;
    // 国内航线白名单（仅 global-year 启用）：只保留指定省份/地区的目的地
    if (MOD.domesticKeep && d.region === 'domestic' && MOD.domesticKeep.indexOf(d.code) < 0) continue;
    // 枫叶模块：绿叶/落叶目的地不进入搜索
    if (KOYO_ON && !koyoWin[d.code]) continue;
    jobs.push({ o, d });
  }
  const domesticCount = DESTS.filter(d => d.region === 'domestic').length;
  const skipCount = ORIGINS.filter(o => INTL_ONLY_ORIGINS.has(o.code)).length * domesticCount;
  console.log('[1/3][' + MOD_ID + '] 扫描 ' + ORIGINS.length + ' 出发地 × ' + DESTS.length + ' 目的地 → 有效航线 ' + jobs.length + ' 条'
    + '（中国香港仅国际，已跳过约 ' + skipCount + ' 条国内航线）...');

  // 构造探针窗口
  const probeWindows = MOD.probe.kind === 'anchors'
    ? MOD.probe.anchors.map(dep => ({ dep, ret: addDays(dep, 30) }))
    : [{ dep: MOD.probe.dates[0], ret: MOD.probe.dates[1] }];

  const res = await pool(jobs, 14, async (j) => {
    const o = j.o, d = j.d;
    const codes = [d.code, d.alt].filter(Boolean);
    // 枫叶模块把探针与合法日期都收窄到该目的地的红叶期内
    const sr = searchRange(d);
    const wins = sr.koyo
      ? [0, 0.5, 1].map(f => {
          const s = Date.parse(sr.start + 'T00:00:00Z'), e = Date.parse(sr.end + 'T00:00:00Z');
          const dep = new Date(s + (e - s) * f).toISOString().slice(0, 10);
          return { dep, ret: addDays(dep, 30) };
        })
      : probeWindows;
    const collected = [];
    for (const c of codes) {
      for (const w of wins) {
        try {
          const pairs = await retry(() => api.lowPriceCalendar(o.code, c, w.dep, w.ret), 2);
          const valid = pairs.filter(p => p.dep >= sr.start && p.dep <= sr.end && p.ret >= p.dep && p.ret <= sr.end && okDuration(p.dep, p.ret, d));
          if (valid.length) { collected.push(...valid); break; }
        } catch (e) { /* 试下一个窗口/机场码 */ }
      }
      if (collected.length) break;
    }
    return { o, d, query: d.alt || d.code, pairs: collected };
  });
  const withCal = res.filter(r => r.pairs.length);
  const noCal = res.filter(r => !r.pairs.length);
  console.log('    有日历数据 ' + withCal.length + ' 条，需回退查询 ' + noCal.length + ' 条');
  return { withCal, noCal };
}

// ================= 解析航班 =================
function parseReturnLeg(shortPolicyId) {
  if (!shortPolicyId) return null;
  const parts = shortPolicyId.split('^');
  const tail = parts[parts.length - 1];
  const seg = tail.split(';');
  if (seg.length < 3) return null;
  const legs = seg[seg.length - 1].split('|').map(s => s.split(','));
  const back = legs.filter(a => a[0] === '2');
  if (!back.length) return null;
  return back.map(a => ({ no: a[3], ts: Number(a[5]) })).filter(x => x.no && x.ts)
    .sort((x, y) => x.ts - y.ts);
}
function parseItineraries(data, tz) {
  const airlineMap = {};
  (data.airlineList || []).forEach(a => { if (a.code) airlineMap[a.code] = a.name; });
  const out = [];
  for (const it of (data.itineraryList || [])) {
    const j = (it.journeyList || [])[0];
    const pol = (it.policies || [])[0];
    if (!j || !pol || !pol.price) continue;
    const price = pol.price.totalPrice || pol.price.averagePrice;
    if (!price) continue;
    const secs = (j.transSectionList || []).filter(s => s.transportType === 'FLIGHT');
    if (!secs.length) continue;
    const outLeg = {
      dep: secs[0].departDateTime, arr: secs[secs.length - 1].arriveDateTime,
      stops: secs.length - 1, duration: j.duration,
      flights: secs.map(s => ({
        no: s.flightInfo.flightNo, al: s.flightInfo.airlineCode,
        craft: ((s.flightInfo.craftInfo || {}).shortName) || '',
        from: s.departPoint.cityName, fromT: s.departPoint.terminal || '',
        to: s.arrivePoint.cityName, toT: s.arrivePoint.terminal || '',
        depT: s.departDateTime, arrT: s.arriveDateTime,
      })),
    };
    const backRaw = parseReturnLeg(pol.shortPolicyId);
    const backLeg = backRaw ? {
      stops: backRaw.length - 1,
      flights: backRaw.map((b, i) => ({
        no: b.no, al: b.no.slice(0, 2).toUpperCase(),
        depT: fmtLocal(b.ts, i === 0 ? tz : ORIGIN_TZ),
      })),
    } : null;
    const codes = [...new Set([
      ...outLeg.flights.map(f => f.al),
      ...(backLeg ? backLeg.flights.map(f => f.al) : []),
    ])];
    const bag = (pol.tagList || []).some(t => t.key === 'FREE_CHECKED_BAGGAGE');
    out.push({
      price, airlines: codes,
      airlineNames: codes.map(c => airlineMap[c] || c),
      hasLCC: codes.some(c => LCC.has(c)),
      lccNames: codes.filter(c => LCC.has(c)).map(c => LCC_NAME[c] || c),
      direct: outLeg.stops === 0 && (!backLeg || backLeg.stops === 0),
      bag,
      out: outLeg, back: backLeg,
    });
  }
  return out;
}

// ================= Stage 2：具体航班 =================
function pickDates(route) {
  const sorted = [...route.pairs].sort((a, b) => a.price - b.price);
  const minP = sorted[0] ? sorted[0].price : 9999;
  const quota = minP < 900 ? 6 : minP < 1500 ? 5 : minP < 2200 ? 3 : 2;
  const picks = []; const usedDep = new Map(); const seen = new Set();
  for (const p of sorted) {
    if (picks.length >= quota) break;
    const k = p.dep + p.ret;
    if (seen.has(k)) continue;
    const c = usedDep.get(p.dep) || 0;
    if (c >= 2) continue;
    usedDep.set(p.dep, c + 1);
    seen.add(k); picks.push(p);
  }
  return picks;
}
function fallbackFor(mod, d) {
  // 枫叶模块的回退日期同样只在该目的地红叶期内取，避免落回绿叶/落叶期
  const sr = searchRange(d);
  const s = Date.parse(sr.start + 'T00:00:00Z');
  const e = Date.parse(sr.end + 'T00:00:00Z');
  // 按目的地 area 决定 fallback 行程天数（区域偏好的中位数）
  const ranges = mod.tripRangesByArea;
  let minDays = mod.tripMin, maxDays = mod.tripMax;
  if (ranges && d && d.area) {
    for (const k of Object.keys(ranges)) {
      const r = ranges[k];
      if (r.areas && r.areas.indexOf(d.area) >= 0) { minDays = r.min; maxDays = r.max; break; }
    }
  }
  const mid = Math.round((minDays + maxDays) / 2);
  return [0.15, 0.5, 0.8].map(f => {
    const dep = new Date(s + (e - s) * f).toISOString().slice(0, 10);
    const ret = addDays(dep, mid);
    return { dep, ret };
  });
}
async function stage2(withCal, noCal) {
  const jobs = [];
  for (const r of withCal) for (const p of pickDates(r)) jobs.push({ r, p });
  for (const r of noCal) for (const p of fallbackFor(MOD, r.d)) jobs.push({ r, p });
  console.log('[2/3] 查询 ' + jobs.length + ' 组具体航班（并发 12）...');
  let done = 0;
  const res = await pool(jobs, 12, async (j) => {
    const r = j.r;
    const data = await retry(() => api.flightList(r.o.code, r.query, j.p.dep, j.p.ret), 2, 2000);
    done++;
    if (done % 40 === 0) console.log('    进度 ' + done + '/' + jobs.length);
    return { key: r.o.code + '->' + r.d.code, originCode: r.o.code, originCity: r.o.city, dep: j.p.dep, ret: j.p.ret, items: parseItineraries(data, r.d.tz) };
  });
  const byKey = {};
  res.forEach(x => { if (x && !x.__error && x.items) (byKey[x.key] = byKey[x.key] || []).push(x); });
  console.log('    完成 ' + done + '/' + jobs.length);
  return byKey;
}

// ================= 汇总 =================
function build(all, flightsByKey) {
  const rows = [];
  for (const r of all) {
    const key = r.o.code + '->' + r.d.code;
    const groups = flightsByKey[key] || [];
    const distanceKm = Math.round(haversineKm(r.o, r.d));
    const canTransit = transitAllowed(r.o, r.d);
    const options = [];
    let rawCount = 0, lccCount = 0, transitCount = 0;
    for (const g of groups) {
      for (const it of g.items) {
        rawCount++;
        if (it.hasLCC) { lccCount++; continue; }
        if (!canTransit && !it.direct) { transitCount++; continue; }
        const stopsTotal = (it.out.stops || 0) + (it.back ? (it.back.stops || 0) : 0);
        options.push({ ...it, depDate: g.dep, retDate: g.ret, stopsTotal });
      }
    }
    if (!options.length) continue;
    const seen = new Set();
    const uniq = options.filter(o => {
      const k = o.depDate + o.retDate + o.out.flights.map(f => f.no).join('/') + o.price;
      if (seen.has(k)) return false; seen.add(k); return true;
    }).sort((a, b) => a.price - b.price);

    const best = uniq[0];
    const tier = tierOf(best.price);
    if (!tier) continue; // 超价丢弃
    const cap = TIERS.find(t => t.key === tier).cap;

    const calPrices = r.pairs.map(p => p.price);
    const medP = calPrices.length ? median(calPrices) : median(uniq.map(o => o.price));
    const maxP = calPrices.length ? Math.max(...calPrices) : Math.max(...uniq.map(o => o.price));

    rows.push({
      key,
      originCode: r.o.code, originCity: r.o.city,
      code: r.d.code, city: r.d.city, region: r.d.region, lat: r.d.lat, lng: r.d.lng, tz: r.d.tz,
      area: r.d.area || null,
      query: r.query || r.d.code,
      distanceKm, transitAllowed: canTransit, transitFiltered: transitCount,
      isDomestic: r.d.region === 'domestic',
      tier,
      minPrice: best.price,
      calMedian: medP, calMax: maxP,
      discountPct: medP > best.price ? Math.round((1 - best.price / medP) * 100) : 0,
      datePairsInBudget: r.pairs.filter(p => p.price <= cap).length,
      totalPairs: r.pairs.length,
      optionCount: uniq.filter(o => o.price <= cap).length,
      lccFiltered: lccCount,
      cheapestPairs: [...r.pairs].sort((a, b) => a.price - b.price).slice(0, 10),
      options: uniq.slice(0, 10),
    });
  }
  return rows;
}

// Stage 2.5：对「有希望跌破最低档」的航线加采样（仅当存在明确最低档时）
async function stage25(all, byKey) {
  const lowestCap = TIERS[0].cap;
  const extra = [];
  for (const r of all) {
    if (!r.pairs.length) continue;
    const key = r.o.code + '->' + r.d.code;
    const got = (byKey[key] || []);
    const canTransit = transitAllowed(r.o, r.d);
    const best = Math.min(...got.flatMap(g => g.items
      .filter(i => !i.hasLCC && (canTransit || i.direct))
      .map(i => i.price)).concat([99999]));
    if (best <= lowestCap || best > lowestCap * 1.5) continue;
    if (median(r.pairs.map(p => p.price)) > lowestCap * 1.25) continue;
    const tried = new Set(got.map(g => g.dep + g.ret));
    const cands = [...r.pairs].sort((a, b) => a.price - b.price)
      .filter(p => !tried.has(p.dep + p.ret)).slice(0, 15);
    const usedDep = new Map(); const picks = [];
    for (const p of cands) {
      if (picks.length >= 6) break;
      const c = usedDep.get(p.dep) || 0; if (c >= 1) continue;
      usedDep.set(p.dep, c + 1); picks.push(p);
    }
    picks.forEach(p => extra.push({ r, p }));
  }
  if (!extra.length) return byKey;
  console.log('[2.5] 对 ' + new Set(extra.map(e => e.r.o.code + '->' + e.r.d.code)).size + ' 条潜力航线补采 ' + extra.length + ' 组 ...');
  const res = await pool(extra, 12, async (j) => {
    const r = j.r;
    const data = await retry(() => api.flightList(r.o.code, r.query || r.d.code, j.p.dep, j.p.ret), 2, 1500);
    return { key: r.o.code + '->' + r.d.code, originCode: r.o.code, originCity: r.o.city, dep: j.p.dep, ret: j.p.ret, items: parseItineraries(data, r.d.tz) };
  });
  res.forEach(x => { if (x && !x.__error && x.items) (byKey[x.key] = byKey[x.key] || []).push(x); });
  return byKey;
}

(async () => {
  const t0 = Date.now();
  const { withCal, noCal } = await stage1();
  let flights = await stage2(withCal, noCal);
  flights = await stage25([...withCal, ...noCal], flights);
  let rows = build([...withCal, ...noCal], flights);
  rows.sort((a, b) => a.minPrice - b.minPrice);

  // 枫叶最终兜底：逐条校验行程枫叶阶段，非「初红/半红/满红」一律丢弃
  let koyoFilter = null;
  if (KOYO_ON) {
    const fr = koyoLib.applyRedFilter({ rows, dests: DESTS, windows: koyoWin,
      excluded: koyoExcluded, year: KOYO_YEAR, log: (m) => console.log(m) });
    rows = fr.rows;
    koyoFilter = fr.koyoFilter;
  }

  console.log('[3/3] 生成数据文件 ...');
  const payload = {
    moduleId: MOD_ID,
    moduleName: MOD.name,
    generatedAt: new Date().toISOString(),
    season: MOD.seasonInfo ? MOD.seasonInfo.season : null,
    seasonLabel: MOD.seasonInfo ? MOD.seasonInfo.label : null,
    origins: ORIGINS,
    origin: ORIGINS[0],
    window: { start: WIN_START, end: WIN_END },
    tripDuration: { min: TRIP_MIN_DAYS, max: TRIP_MAX_DAYS },
    priceCap: PRICE_CAP,
    tiers: TIERS.map(t => ({ key: t.key, cap: t.cap, label: t.label })),
    excludedAirlines: [...LCC].map(c => ({ code: c, name: LCC_NAME[c] })),
    rules: {
      intlOnlyOrigins: [...INTL_ONLY_ORIGINS],
      transitMinKm: TRANSIT_MIN_KM,
      note: '中国香港出发仅国际航线；国际航线可中转，国内航线须直飞（直线距离 ≥ ' + TRANSIT_MIN_KM + 'km 除外）',
    },
    koyoFilter,
    routes: rows,
  };
  const dir = path.join(ROOT, 'data', MOD_ID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'flights.json'), JSON.stringify(payload));
  console.log('[完成][' + MOD_ID + '] 命中航线 ' + rows.length + '，耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');
  TIERS.forEach(t => {
    const c = rows.filter(r => r.tier === t.key).length;
    console.log('  档位 ' + t.key + '(' + t.label + '): ' + c);
  });
  const transitRoutes = rows.filter(r => r.transitAllowed).length;
  const dropped = rows.reduce((s, r) => s + (r.transitFiltered || 0), 0);
  console.log('  规则：允许中转航线 ' + transitRoutes + ' / ' + rows.length + '，国内近程剔除中转方案 ' + dropped + ' 个');
})();

// 天气模块（模块化）：为命中航线的目的地抓取出行窗口内逐日天气
// 日本枫叶季模块额外计算并附加枫叶颜色数据。
// 用法: node weather.js <moduleId>
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
const { MODULES } = require('./modules');
const koyo = require('./koyo');

const ROOT = path.resolve(__dirname, '..');
const MOD_ID = process.argv[2] || 'gba-summer';
const MOD = MODULES[MOD_ID];
if (!MOD) { console.error('未知模块: ' + MOD_ID); process.exit(1); }

const WIN = MOD.weather ? MOD.weather.window : null;
const CLIMO_YEARS = [2021, 2022, 2023, 2024, 2025];
const RAIN_MM = 1.0;
const DRIZZLE_MM = 0.1;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getJSON(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 40000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { last = e; await sleep(1200 * (i + 1)); }
  }
  throw last;
}
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
function dateRange(a, b) {
  const out = [];
  for (let t = Date.parse(a + 'T00:00:00Z'); t <= Date.parse(b + 'T00:00:00Z'); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
function wmoText(c) {
  if (c === 0) return '晴';
  if (c === 1) return '晴间多云';
  if (c === 2) return '多云';
  if (c === 3) return '阴';
  if (c === 45 || c === 48) return '雾';
  if (c >= 51 && c <= 57) return '毛毛雨';
  if (c >= 61 && c <= 65) return '雨';
  if (c >= 66 && c <= 67) return '冻雨';
  if (c >= 71 && c <= 77) return '雪';
  if (c >= 80 && c <= 82) return '阵雨';
  if (c >= 85 && c <= 86) return '阵雪';
  if (c >= 95) return '雷雨';
  return '—';
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }

async function fetchForecast(city) {
  const u = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + city.lat + '&longitude=' + city.lng
    + '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,windspeed_10m_max'
    + '&timezone=auto&forecast_days=16';
  const j = await getJSON(u);
  const d = j.daily || {};
  const map = {};
  (d.time || []).forEach((day, i) => {
    map[day] = {
      date: day, src: 'forecast', code: d.weathercode[i], text: wmoText(d.weathercode[i]),
      tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i],
      prcp: d.precipitation_sum[i], pop: d.precipitation_probability_max[i], wind: d.windspeed_10m_max[i],
    };
  });
  return map;
}
async function fetchClimo(city, days) {
  if (!days.length) return {};
  // 按日历年份分段：避免跨年区间（如缺失日 08-17 ~ 次年 07-31）拼成 start>end 的无效请求。
  // 例：全球一年模块窗口 365 天，预报仅覆盖前 ~16 天，剩余 ~349 天需按历史气候推算，
  // 缺失日会跨年，原写法 start_date=2021-08-17 & end_date=2021-07-31 非法 → 整城气候数据为空。
  const segs = [];
  const byYear = {};
  for (const d of days) {
    const Y = d.slice(0, 4);
    (byYear[Y] = byYear[Y] || []).push(d);
  }
  for (const Y of Object.keys(byYear)) {
    const ds = byYear[Y].slice().sort();
    segs.push({ mds: ds.map(d => d.slice(5)) });
  }
  const byMd = {};
  days.forEach(d => { const m = d.slice(5); byMd[m] = byMd[m] || { prcp: [], tmax: [], tmin: [], wet: 0, n: 0 }; });
  for (const seg of segs) {
    const first = seg.mds[0], last = seg.mds[seg.mds.length - 1];
    for (const y of CLIMO_YEARS) {
      const u = 'https://archive-api.open-meteo.com/v1/archive'
        + '?latitude=' + city.lat + '&longitude=' + city.lng
        + '&start_date=' + y + '-' + first + '&end_date=' + y + '-' + last
        + '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&timezone=auto';
      let j;
      try { j = await getJSON(u, 2); } catch (e) { continue; }
      const d = j.daily || {};
      (d.time || []).forEach((day, i) => {
        const key = day.slice(5);
        if (!byMd[key]) return;
        const p = d.precipitation_sum[i];
        if (p == null) return;
        byMd[key].prcp.push(p);
        if (d.temperature_2m_max[i] != null) byMd[key].tmax.push(d.temperature_2m_max[i]);
        if (d.temperature_2m_min[i] != null) byMd[key].tmin.push(d.temperature_2m_min[i]);
        byMd[key].n++;
        if (p >= RAIN_MM) byMd[key].wet++;
      });
      await sleep(100);
    }
  }
  const out = {};
  days.forEach(day => {
    const b = byMd[day.slice(5)];
    if (!b || !b.n) return;
    const p = mean(b.prcp);
    const pop = Math.round(b.wet / b.n * 100);
    out[day] = {
      date: day, src: 'climatology', years: b.n, code: null,
      text: pop >= 60 ? '常年多雨' : pop >= 30 ? '可能有雨' : '常年少雨',
      tmax: b.tmax.length ? Math.round(mean(b.tmax) * 10) / 10 : null,
      tmin: b.tmin.length ? Math.round(mean(b.tmin) * 10) / 10 : null,
      prcp: Math.round(p * 10) / 10, pop, wind: null,
    };
  });
  return out;
}
function summarize(days) {
  const list = days.filter(Boolean);
  const rain = list.filter(d => d.prcp >= RAIN_MM).length;
  const drizzle = list.filter(d => d.prcp >= DRIZZLE_MM && d.prcp < RAIN_MM).length;
  const dry = list.length - rain - drizzle;
  const heavy = list.filter(d => d.prcp >= 25).length;
  const tmaxs = list.map(d => d.tmax).filter(v => v != null);
  const tmins = list.map(d => d.tmin).filter(v => v != null);
  return {
    days: list.length, rainDays: rain, drizzleDays: drizzle, dryDays: dry, heavyDays: heavy,
    totalPrcp: Math.round(list.reduce((s, d) => s + (d.prcp || 0), 0) * 10) / 10,
    avgPop: list.length ? Math.round(mean(list.map(d => d.pop || 0))) : 0,
    tmax: tmaxs.length ? Math.round(Math.max(...tmaxs) * 10) / 10 : null,
    tmin: tmins.length ? Math.round(Math.min(...tmins) * 10) / 10 : null,
    dryRatio: list.length ? Math.round(dry / list.length * 100) : 0,
  };
}
function grade(s) {
  if (s.rainDays === 0 && s.drizzleDays === 0) return 'dry';
  if (s.rainDays === 0) return 'mild';
  if (s.rainDays <= Math.max(1, Math.round(s.days * 0.25)) && s.heavyDays === 0) return 'wet';
  return 'heavy';
}

(async () => {
  const t0 = Date.now();
  const dir = path.join(ROOT, 'data', MOD_ID);
  const flightsPath = path.join(dir, 'flights.json');

  // 本模块不做天气（如 global-year）
  if (!WIN) {
    const payload = { moduleId: MOD_ID, skipped: true, generatedAt: new Date().toISOString(),
      reason: '本模块仅监控机票价格，未启用天气/枫叶模块' };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'weather.json'), JSON.stringify(payload));
    console.log('[天气][' + MOD_ID + '] 本模块未启用天气，跳过');
    return;
  }

  const flights = JSON.parse(fs.readFileSync(flightsPath, 'utf8'));

  // 目的地集合（多出发地下取最低价代表）
  const destMap = {};
  for (const r of flights.routes) {
    if (!destMap[r.code]) destMap[r.code] = { code: r.code, city: r.city, region: r.region, area: r.area || null, lat: r.lat, lng: r.lng, tz: r.tz, minPrice: r.minPrice, tier: r.tier, routes: [] };
    destMap[r.code].routes.push(r);
    if (r.minPrice < destMap[r.code].minPrice) { destMap[r.code].minPrice = r.minPrice; destMap[r.code].tier = r.tier; }
  }
  const cities = Object.values(destMap).map(c => ({ code: c.code, city: c.city, region: c.region, area: c.area, lat: c.lat, lng: c.lng, tier: c.tier, minPrice: c.minPrice }));
  const allDays = dateRange(WIN.start, WIN.end);
  console.log('[天气][' + MOD_ID + '] ' + cities.length + ' 个目的地 × ' + allDays.length + ' 天（' + WIN.start + ' ~ ' + WIN.end + '）');

  console.log('[1/2] 抓取逐日数值预报 ...');
  const fcs = await pool(cities, 6, async (c) => await fetchForecast(c));
  const missing = [];
  fcs.forEach((f, i) => { missing[i] = (f && !f.__error) ? allDays.filter(d => !f[d]) : allDays; });
  const climoDays = missing.reduce((m, x) => Math.max(m, x.length), 0);
  console.log('[2/2] 抓取气候常态（近 ' + CLIMO_YEARS.length + ' 年同期），每城约 ' + climoDays + ' 天 ...');
  let done = 0;
  const clis = await pool(cities, 5, async (c, i) => {
    const r = await fetchClimo(c, missing[i]);
    done++;
    if (done % 10 === 0) console.log('    进度 ' + done + '/' + cities.length);
    return r;
  });

  const out = [];
  const dailyByCode = {};
  cities.forEach((c, i) => {
    const f = (fcs[i] && !fcs[i].__error) ? fcs[i] : {};
    const cl = (clis[i] && !clis[i].__error) ? clis[i] : {};
    const daily = allDays.map(d => f[d] || cl[d] || null).filter(Boolean);
    if (!daily.length) return;
    const s = summarize(daily);
    dailyByCode[c.code] = daily;
    out.push({ code: c.code, city: c.city, region: c.region, area: c.area, lat: c.lat, lng: c.lng,
      tier: c.tier || null, minPrice: c.minPrice || null, summary: s, grade: grade(s) });
  });

  // 出行窗口内天气（取最低价航线的日期区间）
  const byCode = {};
  out.forEach(w => byCode[w.code] = w);
  const trips = [];
  for (const c of cities) {
    const w = byCode[c.code];
    if (!w) continue;
    const bestRoute = [...destMap[c.code].routes].sort((a, b) => a.minPrice - b.minPrice)[0];
    const o = bestRoute.options[0];
    const span = dateRange(o.depDate, o.retDate);
    const dl = span.map(d => (dailyByCode[c.code] || []).find(x => x.date === d)).filter(Boolean);
    if (!dl.length) continue;
    const s = summarize(dl);
    trips.push({ code: c.code, city: c.city, region: c.region, area: c.area, lat: c.lat, lng: c.lng,
      tier: bestRoute.tier, minPrice: bestRoute.minPrice,
      originCode: bestRoute.originCode, originCity: bestRoute.originCity,
      dep: o.depDate, ret: o.retDate, summary: s, grade: grade(s), daily: dl });
  }

  const payload = {
    moduleId: MOD_ID, generatedAt: new Date().toISOString(),
    window: { start: WIN.start, end: WIN.end },
    thresholds: { rainMm: RAIN_MM, drizzleMm: DRIZZLE_MM }, climoYears: CLIMO_YEARS,
    sources: [
      { name: 'Open-Meteo 逐日数值预报', desc: 'ICON / GFS / ECMWF 集成', url: 'https://open-meteo.com/en/docs' },
      { name: 'Open-Meteo 历史天气 API（ERA5 再分析）', desc: '远期按近 5 年同期气候常态推算', url: 'https://open-meteo.com/en/docs/historical-weather-api' },
      { name: 'ECMWF ERA5 再分析数据集', desc: '气候常态原始数据来源', url: 'https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels' },
      { name: 'WMO 天气现象代码表', desc: '天气代码与文字描述对照', url: 'https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM' },
    ],
    cities: out, trips,
  };

  // ===== 枫叶颜色（日本模块） =====
  if (MOD.koyo) {
    const year = (flights.koyoFilter && flights.koyoFilter.year) || 2026;
    const koyoCities = [];
    const notRed = [];
    for (const c of cities) {
      const bestRoute = [...destMap[c.code].routes].sort((a, b) => a.minPrice - b.minPrice)[0];
      const o = bestRoute.options[0];
      const kw = koyo.koyoDuringWindow(c, o.depDate, o.retDate, year);
      const full = koyo.koyoFor(c, o.depDate, year); // 出行起始日阶段
      // 兜底：抓取阶段已按红叶期定向搜索，这里只做校验——非初红/半红/满红不应出现
      if (!koyo.isRed(kw.winStage)) {
        notRed.push(c.city + '(' + c.code + ')=' + kw.winLabel + ' ' + o.depDate + '~' + o.retDate);
        continue;
      }
      const red = koyo.redWindow(c, year);
      koyoCities.push({
        code: c.code, city: c.city, area: c.area, lat: c.lat, lng: c.lng,
        winStart: o.depDate, winEnd: o.retDate,
        // color 跟随实际展示的 stage，避免与 winStage 不一致
        stage: kw.winStage, label: kw.winLabel, color: koyo.STAGES[kw.winStage].color,
        progress: full.progress, desc: koyo.STAGES[kw.winStage].desc,
        peak: full.peak, bestStart: full.bestStart, bestEnd: full.bestEnd,
        inBest: kw.hit && full.inBest, hit: kw.hit,
        start: full.start, end: full.end,
        redStart: red.start, redEnd: red.end,
      });
    }
    koyoCities.sort((a, b) => (a.inBest === b.inBest ? (b.progress - a.progress) : (b.inBest ? 1 : -1)));
    payload.koyo = { year, cities: koyoCities,
      redStages: koyo.RED_STAGES,
      filter: flights.koyoFilter || null,
      legend: Object.entries(koyo.STAGES).map(([k, v]) => ({ stage: k, label: v.label, color: v.color, desc: v.desc })) };
    console.log('[枫叶] 已计算 ' + koyoCities.length + ' 城枫叶阶段（' + year + ' 年，仅初红/半红/满红）');
    if (notRed.length) console.log('[枫叶][告警] ' + notRed.length + ' 城行程不在红叶期，已剔除：' + notRed.join('、'));
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'weather.json'), JSON.stringify(payload));
  const g = (k) => trips.filter(t => t.grade === k).length;
  console.log('[完成][' + MOD_ID + '] ' + out.length + ' 城，耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');
  console.log('  行程区间：全程无雨 ' + g('dry') + ' | 仅零星小雨 ' + g('mild') + ' | 有雨 ' + g('wet') + ' | 多雨 ' + g('heavy'));
})();

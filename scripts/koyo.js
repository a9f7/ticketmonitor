// 日本枫叶（紅葉）颜色时间表模型
// 参照加拿大枫叶颜色时间表的实现方式：基于地区/海拔的典型物候，给出各地每年枫叶变色阶段与最佳观赏窗口。
// 阶段：green(绿叶) / early(初红) / half(半红) / full(满红) / falling(落叶)
const STAGES = {
  green:   { label: '绿叶',   color: '#2f9e44', desc: '尚未变色，满山翠绿' },
  early:   { label: '初红',   color: '#a9c94a', desc: '开始泛红，零星点缀' },
  half:    { label: '半红',   color: '#e8920c', desc: '红黄交杂，渐入佳境' },
  full:    { label: '满红',   color: '#d8392b', desc: '漫山红遍，最佳观赏期' },
  falling: { label: '落叶',   color: '#9c6b3f', desc: '叶片飘落，观赏尾声' },
};
const ORDER = ['green', 'early', 'half', 'full', 'falling'];

// 九大地方典型枫叶时间表（MM-DD：开始 / 盛期 / 结束）
// 已按多方红叶前线数据（日本气象/ Walkerplus / 旅游攻略）重校：
//   「开始」= 该地区最早开始变红（初红）；「结束」= 全境最晚仍可见红叶的收尾日。
//   北海道高山 9 月中旬即初红，故取 9-15；九州最晚、约 12 月中旬收尾。
const AREA_SCHED = {
  hokkaido:  { start: '09-15', peak: '10-05', end: '11-05' },
  tohoku:    { start: '09-25', peak: '10-20', end: '11-20' },
  kanto:     { start: '10-10', peak: '11-20', end: '12-10' },
  chubu:     { start: '10-05', peak: '11-15', end: '12-05' },
  kansai:    { start: '10-15', peak: '11-25', end: '12-08' },
  chugoku:   { start: '10-10', peak: '11-15', end: '12-03' },
  shikoku:   { start: '10-10', peak: '11-15', end: '12-03' },
  kyushu:    { start: '10-25', peak: '11-25', end: '12-12' },
  okinawa:   { start: '11-25', peak: '12-10', end: '12-22' },
};
// 个别著名赏枫地微调（相对地区基准的偏移，单位：天；负数=提前）
const CITY_OFFSET = {
  CTS: 0, AKJ: -2, HKD: 1,
  AOJ: 0, AXT: 0, SDJ: 0, HNA: 0,
  TYO: 0, NRT: 0,
  NGO: 0, FSZ: 1, TOY: -4, KMQ: 0, KIJ: 0,
  OSA: 0, KIX: 0, UKB: 0,
  HIJ: 0, OKJ: 0, YGJ: 0,
  TAK: 0, MYJ: 0, KCZ: 0, TCY: 0,
  FUK: 0, KMJ: 0, NGS: 0, KOJ: 0, OIT: 0, KMI: 0, KKJ: 0,
  OKA: 1, ISG: 2, MMY: 2,
};

function mdToDate(y, mmdd) {
  const [m, d] = mmdd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function offsetDate(dt, off) {
  return new Date(dt.getTime() + off * 86400000);
}

// 某城市某年枫叶时间表（含微调偏移）
function schedule(city, year) {
  const area = city.area || 'kanto';
  const base = AREA_SCHED[area] || AREA_SCHED.kanto;
  const off = CITY_OFFSET[city.code] || 0;
  return {
    start: offsetDate(mdToDate(year, base.start), off),
    peak: offsetDate(mdToDate(year, base.peak), off),
    end: offsetDate(mdToDate(year, base.end), off),
  };
}

function stageOf(sch, date) {
  const t = date.getTime();
  if (t < sch.start.getTime()) return 'green';
  if (t < sch.peak.getTime()) {
    const r = (t - sch.start.getTime()) / (sch.peak.getTime() - sch.start.getTime());
    return r < 0.5 ? 'early' : 'half';
  }
  if (t < sch.end.getTime()) {
    const r = (t - sch.peak.getTime()) / (sch.end.getTime() - sch.peak.getTime());
    return r < 0.5 ? 'full' : 'falling';
  }
  return 'falling';
}

// 颜色进度 0-100（用于着色深浅）
function progress(sch, date) {
  const t = date.getTime();
  if (t <= sch.start.getTime()) return 0;
  if (t >= sch.end.getTime()) return 100;
  return Math.round((t - sch.start.getTime()) / (sch.end.getTime() - sch.start.getTime()) * 100);
}

// 最佳观赏窗口（盛期前后各 5 天）
function bestWindow(sch) {
  const a = offsetDate(sch.peak, -5), b = offsetDate(sch.peak, 5);
  return { start: a.toISOString().slice(0, 10), end: b.toISOString().slice(0, 10) };
}

// 给定城市与日期 -> 完整信息
function koyoFor(city, dateStr, year) {
  const sch = schedule(city, year);
  const dt = new Date(dateStr + 'T00:00:00Z');
  const stage = stageOf(sch, dt);
  const bw = bestWindow(sch);
  return {
    stage, label: STAGES[stage].label, color: STAGES[stage].color, desc: STAGES[stage].desc,
    progress: progress(sch, dt),
    start: sch.start.toISOString().slice(0, 10),
    peak: sch.peak.toISOString().slice(0, 10),
    end: sch.end.toISOString().slice(0, 10),
    bestStart: bw.start, bestEnd: bw.end,
    inBest: dateStr >= bw.start && dateStr <= bw.end,
  };
}

// ===== 红叶期（初红/半红/满红）定向搜索支持 =====
// 只有这三个阶段值得出行；green(未变色) 与 falling(已落叶) 一律排除。
const RED_STAGES = ['early', 'half', 'full'];
const isRed = (stage) => RED_STAGES.indexOf(stage) >= 0;
const iso = (dt) => dt.toISOString().slice(0, 10);

// 某城市某年的「红叶期」连续日期区间（含首尾）。
// 逐日用 stageOf 判定而非直接按比例推算，避免 (end-peak) 为奇数天时半开区间算错边界。
function redWindow(city, year) {
  const sch = schedule(city, year);
  let first = null, last = null;
  for (let t = sch.start.getTime(); t <= sch.end.getTime(); t += 86400000) {
    const dt = new Date(t);
    if (!isRed(stageOf(sch, dt))) continue;
    if (!first) first = dt;
    last = dt;
  }
  if (!first) first = last = sch.peak;   // 理论不会发生，兜底取盛期当天
  return { start: iso(first), end: iso(last), peak: iso(sch.peak),
    schedStart: iso(sch.start), schedEnd: iso(sch.end) };
}

// 红叶期 ∩ 监控窗口 -> 该目的地实际可搜索的出行日期区间
// ok=false 表示该目的地在监控窗口内全程为绿叶或落叶，应整体剔除。
// reason: 'green'  监控窗口结束时仍未变色（红叶期整体晚于窗口）
//         'fallen' 监控窗口开始时已落叶（红叶期整体早于窗口）
//         'short'  有交集但短于最短行程天数，排不出完整行程
function searchWindow(city, winStart, winEnd, year, minDays = 1) {
  const red = redWindow(city, year);
  const start = red.start > winStart ? red.start : winStart;
  const end = red.end < winEnd ? red.end : winEnd;
  if (start > end) {
    return { ok: false, red, start: null, end: null, days: 0,
      reason: red.end < winStart ? 'fallen' : 'green' };
  }
  const days = Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000) + 1;
  if (days < minDays) return { ok: false, red, start, end, days, reason: 'short' };
  return { ok: true, red, start, end, days, reason: null };
}

// 给定城市与出行窗口 -> 窗口内最佳阶段与最佳观赏日期
function koyoDuringWindow(city, winStart, winEnd, year) {
  const sch = schedule(city, year);
  const s = new Date(winStart + 'T00:00:00Z').getTime();
  const e = new Date(winEnd + 'T00:00:00Z').getTime();
  const interStart = new Date(Math.max(s, sch.start.getTime()));
  const interEnd = new Date(Math.min(e, sch.end.getTime()));
  const mid = new Date((interStart.getTime() + interEnd.getTime()) / 2);
  const k = koyoFor(city, mid.toISOString().slice(0, 10), year);
  const hit = interEnd.getTime() >= interStart.getTime();
  return { hit, ...k, winStage: k.stage, winLabel: k.label };
}

// 结果兜底 + 剔除清单汇总（scrape.js / scrape_calendar.js 共用）
// rows: 已抓到的航线；windows: code -> searchWindow；excluded: 搜索前已剔除的目的地
// 返回过滤后的 rows 与可直接写进 flights.json 的 koyoFilter。
const EXCLUDE_ORDER = { fallen: 0, green: 1, short: 2, 'no-flight': 3 };
function applyRedFilter({ rows, dests, windows, excluded, year, log = () => {} }) {
  const kept = [];
  for (const r of rows) {
    const o = r.options && r.options[0];
    if (!o) continue;
    const kw = koyoDuringWindow(r, o.depDate, o.retDate, year);
    if (!kw.hit || !isRed(kw.winStage)) {
      log('  [枫叶兜底] 丢弃 ' + r.key + '（' + o.depDate + '~' + o.retDate + ' 为 ' + kw.winLabel + '）');
      continue;
    }
    const w = windows[r.code];
    r.koyoStage = kw.winStage;
    r.koyoLabel = kw.winLabel;
    if (w) r.koyoWindow = { start: w.start, end: w.end };
    kept.push(r);
  }

  const hit = new Set(kept.map(r => r.code));
  const all = excluded.slice();
  for (const code of Object.keys(windows)) {
    if (hit.has(code)) continue;
    const d = (dests || []).find(x => x.code === code) || { city: code };
    const w = windows[code];
    all.push({
      code, city: d.city, area: d.area || null, lat: d.lat, lng: d.lng,
      reason: 'no-flight',
      reasonText: '红叶期（' + w.start + '~' + w.end + '）内未搜到符合条件的低价航班',
      redStart: w.red.start, redEnd: w.red.end, peak: w.red.peak, overlapDays: w.days,
    });
  }
  all.sort((a, b) => (EXCLUDE_ORDER[a.reason] - EXCLUDE_ORDER[b.reason]) || String(a.city).localeCompare(String(b.city), 'zh'));

  const koyoFilter = {
    year,
    redStages: RED_STAGES.map(s => ({ stage: s, label: STAGES[s].label })),
    note: '先按各目的地所在地方的物候推算「初红→半红→满红」日期，再只在该日期区间内搜索低价航班；绿叶期与落叶期的目的地及日期均不纳入结果。',
    windowByCode: Object.fromEntries(Object.entries(windows).map(([k, v]) =>
      [k, { start: v.start, end: v.end, redStart: v.red.start, redEnd: v.red.end, peak: v.red.peak }])),
    keptCount: hit.size,
    excluded: all,
  };
  log('[枫叶定向] 最终命中目的地 ' + hit.size + ' 个，剔除 ' + all.length + ' 个（'
    + Object.keys(EXCLUDE_ORDER).map(k => k + ':' + all.filter(x => x.reason === k).length).join(' ') + '）');
  return { rows: kept, koyoFilter };
}

module.exports = { STAGES, ORDER, AREA_SCHED, CITY_OFFSET, schedule, koyoFor, koyoDuringWindow,
  RED_STAGES, isRed, redWindow, searchWindow, applyRedFilter };

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
const AREA_SCHED = {
  hokkaido:  { start: '10-05', peak: '10-20', end: '11-05' },
  tohoku:    { start: '10-20', peak: '11-05', end: '11-20' },
  kanto:     { start: '11-10', peak: '11-28', end: '12-10' },
  chubu:     { start: '11-05', peak: '11-22', end: '12-05' },
  kansai:    { start: '11-10', peak: '11-28', end: '12-08' },
  chugoku:   { start: '11-05', peak: '11-22', end: '12-03' },
  shikoku:   { start: '11-05', peak: '11-22', end: '12-03' },
  kyushu:    { start: '11-10', peak: '11-28', end: '12-08' },
  okinawa:   { start: '12-01', peak: '12-12', end: '12-22' },
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

module.exports = { STAGES, ORDER, AREA_SCHED, CITY_OFFSET, schedule, koyoFor, koyoDuringWindow };

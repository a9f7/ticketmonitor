// 历史价格存档：按 出发地>目的地@去日期->回日期 累积每次抓取的最低价（cheapestPairs）
// 用途：build.js 渲染时比对「当前价」与「历史中位数」，显著低于则标注「历史低价」。
//
// 同期对比（寒暑期长期化核心）：每条样本额外打上 season（summer/winter/spring）与
// seasonOffset（季节内偏移天数）。跨年同一「出发地>目的地 | 季节 | 偏移」才能互相比较——
// 即寒假比寒假、暑假比暑假、春节比春节。
//
// 数据粒度说明：当前 Trip.com WAF 降级（detailLimited）下没有航班号，
// 最小可用粒度 = 出发地+目的地+去/回日期 的最低价组合。若将来恢复详单模式（含航班号），
// 可在 key 末尾追加航班号细化。
const fs = require('fs');
const path = require('path');
const { seasonOf, seasonOffset } = require('./seasons');

const THRESHOLD = 0.80;   // 当前价 ≤ 历史中位数 × 0.80（即低于中位 20%）视为显著低价
const MIN_SAMPLES = 3;    // 至少 3 次历史抓取才计算中位数并标注

function histPath(moduleId) {
  return path.join(__dirname, '..', 'data', moduleId, 'price_history.json');
}
function loadHist(moduleId) {
  try { return JSON.parse(fs.readFileSync(histPath(moduleId), 'utf8')); } catch (e) { return {}; }
}
function saveHist(moduleId, hist) {
  fs.mkdirSync(path.dirname(histPath(moduleId)), { recursive: true });
  fs.writeFileSync(histPath(moduleId), JSON.stringify(hist));
}
function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}
// 把本次 flights.json 的 cheapestPairs 价格追加进历史；用 generatedAt 去重，避免同一份重复 append
function updateHist(moduleId, flights) {
  const hist = loadHist(moduleId);
  const gen = flights.generatedAt || new Date().toISOString();
  let added = 0;
  for (const r of (flights.routes || [])) {
    for (const p of (r.cheapestPairs || [])) {
      const key = r.originCode + '>' + r.code + '@' + p.dep + '->' + p.ret;
      const rec = hist[key] || { prices: [], at: [] };
      if (rec.at.includes(gen)) continue; // 同一份数据不重复累积
      const year = Number(p.dep.slice(0, 4));
      const season = seasonOf(p.dep, year);
      const offset = seasonOffset(p.dep, season, year);
      rec.prices.push(p.price);
      rec.at.push(gen);
      rec.season = season;
      rec.offset = offset;
      rec.seasonYear = year;
      rec.median = median(rec.prices);
      rec.min = Math.min(...rec.prices);
      rec.max = Math.max(...rec.prices);
      rec.count = rec.prices.length;
      hist[key] = rec;
      added++;
    }
  }
  saveHist(moduleId, hist);
  return { added, hist };
}
function statOf(hist, originCode, destCode, dep, ret) {
  return hist[originCode + '>' + destCode + '@' + dep + '->' + ret] || null;
}
// 同期聚合：把所有「出发地>目的地」且 season/offset 相同的样本合并，用于跨年同期对比
// 兼容旧记录（无 season/offset 标签）：从 key 内嵌的日期反推，避免历史数据丢失对比能力。
function seasonalStat(hist, originCode, destCode, season, offset) {
  let prices = [];
  for (const k in hist) {
    if (k.indexOf(originCode + '>' + destCode + '@') !== 0) continue;
    const r = hist[k];
    let s = r.season, o = r.offset;
    if (s == null || o == null) {
      const dep = k.split('@')[1].split('->')[0];
      const y = Number(dep.slice(0, 4));
      s = seasonOf(dep, y);
      o = seasonOffset(dep, s, y);
    }
    if (s !== season || o !== offset) continue;
    if (Array.isArray(r.prices)) for (const p of r.prices) prices.push(p);
  }
  if (!prices.length) return null;
  return {
    median: median(prices),
    min: Math.min(...prices),
    max: Math.max(...prices),
    count: prices.length,
  };
}
// 由一条去程日期算出同期聚合 key（season + offset），供 build.js 注入与判定
function seasonalKeyOf(originCode, destCode, dep) {
  const year = Number(dep.slice(0, 4));
  const season = seasonOf(dep, year);
  const offset = seasonOffset(dep, season, year);
  return { season, offset, key: originCode + '>' + destCode + '|' + season + '|' + offset };
}

// ===== 模块级同期聚合键（寒暑期 / 日本红叶 / 全球滚动年 统一口径） =====
// 核心：跨年"同一窗口内同一日历位置"才能互相比较。
//   gba-summer : 季节(summer/winter/spring) + 季节内偏移（沿用寒暑期逻辑）
//   japan-koyo : 红叶季(koyo) + 距当年 9/15 偏移（跨年同年度红叶季同位置对比）
//   global-year: 全球滚动年(gy) + 距所属滚动窗口 7/31 偏移（跨年同期位置对比）
// 旧记录无预存标签时，从 key 内嵌日期反推，完全兼容（无需迁移历史数据）。
function winKeyParts(moduleId, dep) {
  if (moduleId === 'japan-koyo') {
    const y = Number(dep.slice(0, 4));
    const base = new Date(Date.UTC(y, 8, 15)); // 9/15 全境最早初红
    const off = Math.round((Date.parse(dep + 'T00:00:00Z') - base.getTime()) / 86400000);
    return { group: 'koyo', offset: off };
  }
  if (moduleId === 'global-year') {
    const d = new Date(dep + 'T00:00:00Z');
    const y = d.getUTCFullYear();
    const winStartYear = d.getUTCMonth() >= 7 ? y : y - 1; // 滚动窗口 7/31 起算
    const base = new Date(Date.UTC(winStartYear, 6, 31));
    const off = Math.round((d.getTime() - base.getTime()) / 86400000);
    return { group: 'gy', offset: off };
  }
  const y = Number(dep.slice(0, 4));
  const season = seasonOf(dep, y), off = seasonOffset(dep, season, y);
  return { group: season, offset: off };
}
function winKeyOf(moduleId, originCode, destCode, dep) {
  const p = winKeyParts(moduleId, dep);
  return originCode + '>' + destCode + '|' + p.group + '|' + p.offset;
}
// 按模块同期聚合键聚合历史（兼容旧记录：从 key 内日期反推 group/offset）
function aggregateByWinKey(hist, moduleId, originCode, destCode, dep) {
  const target = winKeyOf(moduleId, originCode, destCode, dep);
  let prices = [];
  for (const k in hist) {
    if (k.indexOf(originCode + '>' + destCode + '@') !== 0) continue;
    const r = hist[k];
    const depK = k.split('@')[1].split('->')[0];
    if (winKeyOf(moduleId, originCode, destCode, depK) !== target) continue;
    if (Array.isArray(r.prices)) for (const p of r.prices) prices.push(p);
  }
  if (!prices.length) return null;
  return { median: median(prices), min: Math.min(...prices), max: Math.max(...prices), count: prices.length };
}
// 判断是否「显著低于历史（同期）」：样本达标且当前价 ≤ 同期历史中位 × 阈值
function isHistLow(stat, price) {
  return !!(stat && stat.count >= MIN_SAMPLES && price <= Math.round(stat.median * THRESHOLD));
}
module.exports = { loadHist, saveHist, updateHist, statOf, seasonalStat, seasonalKeyOf, winKeyOf, winKeyParts, aggregateByWinKey, isHistLow, median, histPath, THRESHOLD, MIN_SAMPLES };

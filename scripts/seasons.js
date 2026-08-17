// 寒暑期长期化：季节窗口与同期对比工具
// ------------------------------------------------------------------
// 规则（来自需求）：
//   • 暑假 = 7 月 1 日 ~ 8 月 31 日
//   • 寒假 = 1 月 1 日 ~ 3 月 1 日
//   • 春节专项 = 春节当日 ±5 天（寒假窗口内的子集，单独打 spring 标签）
//   • 暑期过了之后搜接下来寒假；寒假过了之后搜接下来暑假
//   • 历史价格对比只对比同期：寒假比寒假、暑假比暑假（春节比春节）
//
// 同期对比的核心：把每条价格样本按「出发地>目的地 | 季节 | 季节内偏移天数」
// 聚合，跨年同一季节同一日历位置才能互相比较（如 2026 暑期中段 vs 2027 暑期中段）。

// 春节（农历正月初一）公历日期表：覆盖项目生命周期足够长（2025–2040）。
// 数据来源：公开农历对照表，已逐一核对。
const SPRING = {
  2025: [1, 29], 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13],
  2030: [2, 3], 2031: [1, 23], 2032: [2, 11], 2033: [1, 31], 2034: [2, 19],
  2035: [2, 8], 2036: [1, 28], 2037: [2, 15], 2038: [2, 4], 2039: [1, 24],
  2040: [2, 12],
};

function springFestival(year) {
  const m = SPRING[year];
  return m ? new Date(Date.UTC(year, m[0] - 1, m[1])) : null;
}
function addDaysDate(d, n) {
  return new Date(d.getTime() + n * 86400000);
}
function ymd(d) {
  return d.toISOString().slice(0, 10);
}

// 给定日期所属季节：summer / winter / spring
function seasonOf(dateStr, refYear) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const m = d.getUTCMonth() + 1;
  if (m === 7 || m === 8) return 'summer';           // 7/1–8/31 锁定为暑假
  const y = refYear != null ? refYear : d.getUTCFullYear();
  const cn = springFestival(y);
  if (cn) {
    const s = addDaysDate(cn, -5), e = addDaysDate(cn, 5);
    if (d >= s && d <= e) return 'spring';           // 春节 ±5 天专项
  }
  return 'winter';                                   // 其余（1–3 月等）归寒假
}

// 季节内偏移天数：用于跨年同期对齐
//   summer → 距 7/1 的天数
//   winter → 距 1/1 的天数
//   spring → 距（春节-5）的天数
function seasonOffset(dateStr, season, year) {
  const d = new Date(dateStr + 'T00:00:00Z');
  let base;
  if (season === 'summer') base = new Date(Date.UTC(year, 6, 1));
  else if (season === 'winter') base = new Date(Date.UTC(year, 0, 1));
  else { const cn = springFestival(year); base = cn ? addDaysDate(cn, -5) : new Date(Date.UTC(year, 0, 1)); }
  return Math.round((d.getTime() - base.getTime()) / 86400000);
}

function seasonLabel(season, year) {
  return year + (season === 'summer' ? ' 暑期' : ' 寒假');
}

// 当前应监测的窗口：取「结束日期 >= 今天」的第一个候选窗口。
// 候选按 今年暑假 / 今年寒假 / 明年暑假 / 明年寒假 排列，
// 天然满足：暑期过了→寒假；寒假过了（3/2 起）→ 今年暑假。
function activeWindow(today) {
  const t = today ? new Date(today) : new Date();
  const td = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  const Y = td.getUTCFullYear();

  function mk(season, year) {
    if (season === 'summer') {
      return { season, year, start: year + '-07-01', end: year + '-08-31' };
    }
    const cn = springFestival(year);
    const start = year + '-01-01';
    const end = year + '-03-01';
    return {
      season, year, start, end,
      springStart: cn ? ymd(addDaysDate(cn, -5)) : null,
      springEnd: cn ? ymd(addDaysDate(cn, 5)) : null,
      springYear: year,
    };
  }

  const cands = [mk('summer', Y), mk('winter', Y), mk('summer', Y + 1), mk('winter', Y + 1)];
  // 按「开始日期」升序排列，再取第一个 end >= 今天 的窗口——
  // 这样 9 月~次年 6 月会选中最邻近的寒假，而非更远的明年暑假。
  cands.sort((a, b) => Date.parse(a.start + 'T00:00:00Z') - Date.parse(b.start + 'T00:00:00Z'));
  for (const c of cands) {
    if (Date.parse(c.end + 'T00:00:00Z') >= td.getTime()) return decorate(c);
  }
  return decorate(cands[cands.length - 1]); // 极端兜底
}
function decorate(c) {
  c.label = seasonLabel(c.season, c.year);
  return c;
}

module.exports = { SPRING, springFestival, seasonOf, seasonOffset, seasonLabel, activeWindow };

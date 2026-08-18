// 日本枫叶季长期化：红叶期年度自动切换（类比 seasons.js 的寒暑期切换）
// 规则（来自需求）：枫叶季过去之后，自动搜索下一年度的枫叶季机票。
//   全境红叶物候（综合日本气象株式会社 / Walkerplus / 各旅游攻略多年数据）：
//     • 开始变红最早：北海道高山 9 月中旬（取 9/15 为全境"至少有一地开始红"的起点）
//     • 全部结束最晚：关西/九州等 12 月中旬（取 12/15 为全境"没有一处还红"的终点）
//   故监控窗口固定：当年 9/15 ~ 12/15。
//   • 若今天 < 当年 9/15（红叶季未开始）→ 监测当年度红叶季（提前铺垫/抢票）
//   • 若今天 > 当年 12/15（本季已过）→ 自动切到下一年度红叶季
//   • 若今天 ∈ [9/15, 12/15] → 监测当年度红叶季（进行中）
function koyoWindowFor(todayStr) {
  const t = todayStr ? new Date(todayStr) : new Date();
  const td = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  // 候选：今年度 与 下一年度 两个窗口，按开始日期升序，取第一个 end >= 今天
  const cands = [mkWindow(td.getUTCFullYear()), mkWindow(td.getUTCFullYear() + 1)];
  cands.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (const c of cands) {
    if (Date.parse(c.end) >= td.getTime()) return c;
  }
  return cands[cands.length - 1];
}
function mkWindow(year) {
  const start = year + '-09-15';
  const end = year + '-12-15';
  return { year, start, end, label: year + ' 红叶季' };
}
module.exports = { koyoWindowFor, KOYO_START: '09-15', KOYO_END: '12-15' };

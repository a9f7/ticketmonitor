// 测试用：为各模块生成历史价格种子（当前价 + 2 份抬高的"历史"样本），
// 以便 build 时能演示「历史低价」标注与历史中位显示。
// 等自动化每日真实累积后，种子会被真实样本稀释（中位自然趋于真实）。
const fs = require('fs');
const path = require('path');
const PH = require('./price_history');
const ROOT = path.resolve(__dirname, '..');
const ids = ['gba-summer', 'japan-koyo', 'global-year'];
for (const id of ids) {
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', id, 'flights.json'), 'utf8'));
  const gen = f.generatedAt || new Date().toISOString();
  const hist = {};
  const pastGens = ['2026-07-29T10:00:00.000Z', '2026-07-31T10:00:00.000Z'];
  for (const r of f.routes) {
    for (const p of r.cheapestPairs) {
      const key = r.originCode + '>' + r.code + '@' + p.dep + '->' + p.ret;
      const prices = [p.price];
      const at = [gen];
      for (const pg of pastGens) {
        const mult = 1.15 + Math.random() * 0.65; // 历史样本整体偏高 1.15~1.8 倍
        prices.push(Math.round(p.price * mult / 10) * 10);
        at.push(pg);
      }
      const sorted = [...prices].sort((a, b) => a - b);
      const m = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
      hist[key] = { prices, at, median, min: Math.min(...prices), max: Math.max(...prices), count: prices.length };
    }
  }
  PH.saveHist(id, hist);
  console.error(id + ': 种子 ' + Object.keys(hist).length + ' 个 key，各 3 样本');
}

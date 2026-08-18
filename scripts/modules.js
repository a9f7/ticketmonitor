// 多模块配置中枢：大湾区暑期出游 / 日本枫叶季出游 / 未来一年全球低价出游
// 统一驱动 scripts/scrape.js / weather.js / build.js。
const DESTS = require('./destinations');
const DESTS_JP = require('./destinations-japan');
const { activeWindow } = require('./seasons');
const { koyoWindowFor } = require('./koyo_seasons');

// 粤港澳大湾区 5 城出发地（所有模块共用现有框架配置）
const GBA_ORIGINS = [
  { code: 'CAN', city: '广州', lat: 23.1291, lng: 113.2644, tz: 8 },
  { code: 'FUO', city: '佛山', lat: 23.0233, lng: 113.1214, tz: 8 },
  { code: 'SZX', city: '深圳', lat: 22.5431, lng: 113.9500, tz: 8 },
  { code: 'ZUH', city: '珠海', lat: 22.2700, lng: 113.5700, tz: 8 },
  { code: 'HKG', city: '中国香港', lat: 22.3193, lng: 114.1694, tz: 8 },
];

// 新增 5 个可切换出发地（保持默认大湾区出发，新增城市抓取逻辑与大湾区分支完全一致）
const EXTRA_DEPARTURES = [
  { code: 'BJS', city: '北京', lat: 39.9042, lng: 116.4074, tz: 8 },
  { code: 'SHA', city: '上海', lat: 31.2304, lng: 121.4737, tz: 8 },
  { code: 'HGH', city: '杭州', lat: 30.2741, lng: 120.1551, tz: 8 },
  { code: 'CTU', city: '成都', lat: 30.5728, lng: 104.0668, tz: 8 },
  { code: 'CSX', city: '长沙', lat: 28.2282, lng: 112.9388, tz: 8 },
];

// 在 [start,end] 内均匀生成 count 个出发日锚点（使 30 天日历窗口覆盖整段区间）
function anchors(start, end, count) {
  const s = Date.parse(start + 'T00:00:00Z');
  const e = Date.parse(end + 'T00:00:00Z');
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = s + Math.round((e - s) * i / (count - 1));
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const MODULES = {
  // ===== 一、大湾区寒暑期出游机票监控（长期化：暑期/寒假自动切换，数据跨年同期对比） =====
  'gba-summer': (() => {
    // 动态季节窗口：根据当前日期自动选「暑期 7/1–8/31」或「寒假 1/1–3/1（含春节±5天专项）」
    // TEST_TODAY 仅用于本地预览：模拟"今天"以提前查看寒/暑切换与春节专项效果（生产环境不设该变量）
    const TEST_TODAY = process.env.TEST_TODAY;
    const aw = activeWindow(TEST_TODAY ? new Date(TEST_TODAY) : new Date());
    const origins = [...GBA_ORIGINS, ...EXTRA_DEPARTURES];
    const win = { start: aw.start, end: aw.end };
    // probe 取窗口内两个锚点（用于详单接口探测）
    const ws = Date.parse(aw.start + 'T00:00:00Z'), we = Date.parse(aw.end + 'T00:00:00Z');
    const probeDates = [
      new Date(ws + (we - ws) * 0.4).toISOString().slice(0, 10),
      new Date(ws + (we - ws) * 0.75).toISOString().slice(0, 10),
    ];
    const springNote = aw.springStart
      ? `；另含春节专项 ${aw.springStart}～${aw.springEnd}`
      : '';
    return {
      id: 'gba-summer',
      name: '大湾区寒暑期机票监控',
      short: '大湾区寒暑期',
      origins,
      destinations: DESTS,
      window: win,
      tripMin: 5, tripMax: 9,
      priceCap: 3000,            // >3000 丢弃
      tiers: [
        { key: 'T1', cap: 1000, label: '<¥1000' },
        { key: 'T2', cap: 1500, label: '¥1000-1500' },
        { key: 'T3', cap: 2000, label: '¥1500-2000' },
        { key: 'T4', cap: 2500, label: '¥2000-2500' },
        { key: 'T5', cap: 3000, label: '¥2500-3000' },
      ],
      rules: { intlOnlyOrigins: ['HKG'], transitMinKm: 3000 },
      weather: { mode: 'window', window: win },
      koyo: false,
      hotelDomain: 'ctrip',
      probe: { kind: 'single', dates: probeDates },
      seasonInfo: aw,
      title: '大湾区 ' + aw.label + ' · 往返机票监控',
      sub: '单人往返含税总价 · 经济舱',
      desc: `大湾区 5 城出发，${aw.label}（${aw.start}～${aw.end}）飞往全国与世界各地的低价往返机票${springNote}。历史数据跨年同期对比：寒假比寒假、暑假比暑假、春节比春节。`,
    };
  })(),

  // ===== 二、日本枫叶季出游机票监控（长期化：红叶季过后自动切下一年度） =====
  'japan-koyo': (() => {
    // 动态红叶季窗口：根据当前日期自动选「今年度 9/15–12/15」或「下一年度 9/15–12/15」
    const TEST_TODAY = process.env.TEST_TODAY;
    const kw = koyoWindowFor(TEST_TODAY ? TEST_TODAY : new Date().toISOString().slice(0, 10));
    const win = { start: kw.start, end: kw.end };
    const probeDates = anchors(kw.start, kw.end, 5);
    return {
      id: 'japan-koyo',
      name: '日本枫叶季出游机票监控',
      short: '日本枫叶季',
      origins: [...GBA_ORIGINS, ...EXTRA_DEPARTURES],
      destinations: DESTS_JP,
      window: win,
      tripMin: 5, tripMax: 9,
      priceCap: Infinity,        // 价格不设区间限制
      tiers: [
        { key: 'T1', cap: 2000, label: '<¥2000' },
        { key: 'T2', cap: 4000, label: '¥2000-4000' },
        { key: 'T3', cap: 6000, label: '¥4000-6000' },
        { key: 'T4', cap: 8000, label: '¥6000-8000' },
        { key: 'T5', cap: Infinity, label: '¥8000+' },
      ],
      rules: { intlOnlyOrigins: ['HKG'], transitMinKm: 3000 },
      weather: { mode: 'window', window: win },
      koyo: true,
      koyoYear: kw.year,         // 红叶期所属年度（决定 koyo.js 物候表年份）
      koyoInfo: kw,
      hotelDomain: 'ctrip',
      probe: { kind: 'anchors', anchors: probeDates },
      title: '大湾区出发 · 日本 ' + kw.label + ' 机票监控',
      sub: '单人往返含税总价 · 经济舱 · 含枫叶颜色预报',
      desc: '大湾区 5 城出发，' + kw.label + '（' + kw.start + '～' + kw.end + '）飞往日本各地的往返机票；同步监控日本全境天气与枫叶变色进度、最佳观赏窗口。红叶季过去后自动切换到下一年度。',
    };
  })(),

  // ===== 三、未来一年全球低价出游机票监控 =====
  'global-year': {
    id: 'global-year',
    name: '未来一年全球低价出游机票监控',
    short: '全球低价(一年)',
    origins: [...GBA_ORIGINS, ...EXTRA_DEPARTURES],
    destinations: DESTS,
    window: { start: '2026-07-31', end: '2027-07-31' },
    tripMin: 5, tripMax: 20,
    // 全球模块按目的地 area 区分偏好行程天数：
    //   短程区域（国内 / 东亚 / 东南亚）  → 5 ~ 9 天
    //   长程区域（美洲 / 大洋洲 / 欧洲 / 非洲 + 亚洲其他）→ 12 ~ 20 天
    tripRangesByArea: {
      short: { min: 5, max: 9,   areas: ['domestic', 'east-asia', 'southeast-asia'] },
      long:  { min: 12, max: 20, areas: ['oceania', 'europe', 'america', 'africa', 'south-asia', 'central-asia', 'middle-east'] },
    },
    priceCap: 5000,            // 往返总价 ≤ 5000，按每 1000 元分 5 档
    tiers: [
      { key: 'T1', cap: 1000, label: '0-1000元' },
      { key: 'T2', cap: 2000, label: '1000-2000元' },
      { key: 'T3', cap: 3000, label: '2000-3000元' },
      { key: 'T4', cap: 4000, label: '3000-4000元' },
      { key: 'T5', cap: 5000, label: '4000-5000元' },
    ],
    rules: { intlOnlyOrigins: ['HKG'], transitMinKm: 3000 },
    // 国内航线白名单（按省份）：仅保留 新疆/西藏/四川/内蒙/云南/陕西/甘肃/青海/宁夏 + 东北三省(黑吉辽)
    // 对应目的地 code：URC乌鲁木齐(新) LXA拉萨(藏) CTU成都(川) HET呼和浩特(蒙) KMG昆明/LJG丽江(滇)
    // XIY西安(陕) LHW兰州(甘) XNN西宁(青) INC银川(宁) HRB哈尔滨(黑) CGQ长春(吉) SHE沈阳/DLC大连(辽)
    domesticKeep: ['URC', 'LXA', 'CTU', 'HET', 'KMG', 'LJG', 'XIY', 'LHW', 'XNN', 'INC', 'HRB', 'CGQ', 'SHE', 'DLC'],
    weather: { mode: 'window', window: { start: '2026-07-31', end: '2027-07-31' } },
    koyo: false,
    hotelDomain: 'ctrip',
    probe: { kind: 'anchors', anchors: anchors('2026-08-15', '2027-06-15', 6) },
    title: '大湾区出发 · 未来一年全球低价机票监控',
    sub: '单人往返含税总价 · 经济舱 · 总价≤¥5000',
    desc: '大湾区 5 城出发，未来一年（至 2027-07-31）飞往全球各地的低价往返机票，按每 1000 元分档独立展示。',
  },
};

module.exports = { MODULES, GBA_ORIGINS, EXTRA_DEPARTURES, anchors };

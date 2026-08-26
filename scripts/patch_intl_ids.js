// 从 _fastscan.json (id -> slug) 反查国际城市正确 trip.com city ID, 并写回 city_trip_id.js
// 用法: node patch_intl_ids.js [--dry]
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const scanFile = path.join(__dirname, '_fastscan.json');
const targetFile = path.join(__dirname, 'city_trip_id.js');

// IATA -> 候选 slug (按优先级); trip.com SEO slug 形式
const WANT = {
  ICN: ['seoul'],
  PUS: ['busan'],
  CJU: ['jeju', 'jeju-island', 'jeju-do'],
  TYO: ['tokyo'],
  OSA: ['osaka'],
  KYO: ['kyoto'],
  NGO: ['nagoya'],
  CTS: ['sapporo'],
  SPK: ['sapporo'],
  FUK: ['fukuoka'],
  OKA: ['okinawa', 'naha'],
  HKD: ['hakodate'],
  HIJ: ['hiroshima'],
  SDJ: ['sendai'],
  BKK: ['bangkok'],
  HKT: ['phuket'],
  CNX: ['chiang-mai', 'chiangmai'],
  HAN: ['hanoi'],
  SGN: ['ho-chi-minh-city', 'hochiminh', 'ho-chi-minh'],
  CXR: ['nha-trang', 'nhatrang'],
  PQC: ['phu-quoc', 'phuquoc', 'phu-quoc-island'],
  KUL: ['kuala-lumpur'],
  DPS: ['bali', 'denpasar'],
  SIN: ['singapore'],
  MNL: ['manila'],
  DXB: ['dubai'],
  DOH: ['doha'],
  SYD: ['sydney'],
  MEL: ['melbourne'],
  BNE: ['brisbane'],
  AKL: ['auckland'],
  LON: ['london'],
  PAR: ['paris'],
  ROM: ['rome', 'roma'],
  MIL: ['milan', 'milano'],
  MAD: ['madrid'],
  BCN: ['barcelona'],
  FRA: ['frankfurt', 'frankfurt-am-main'],
  AMS: ['amsterdam'],
  ZRH: ['zurich'],
  VIE: ['vienna'],
  MOW: ['moscow', 'moscow-2'],
  NYC: ['new-york', 'new-york-city'],
  LAX: ['los-angeles'],
  SFO: ['san-francisco'],
  SEA: ['seattle'],
  YVR: ['vancouver'],
  YTO: ['toronto'],
};

// 已从 trip.com SEO 交叉链接直接确认的 ID (最高优先级, 无需扫描)
const KNOWN = {
  TYO: 228, ICN: 274, PUS: 253, FUK: 248,
  BKK: 359, HAN: 286, SGN: 301, KUL: 315,
  DPS: 723, SIN: 73, DXB: 220, MEL: 358,
  LON: 338, FRA: 250,
};

let scan = {};
let loaded = 0;
for (const f of ['_fastscan.json', '_fastscan2.json', '_fastscan3.json']) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) continue;
  try {
    Object.assign(scan, JSON.parse(fs.readFileSync(p, 'utf8')));
    loaded++;
    console.log('载入 ' + f);
  } catch (e) { console.log('跳过 ' + f + ' (' + e.message + ')'); }
}
if (!loaded) { console.error('!! 无法读取任何扫描文件'); process.exit(1); }

// slug -> id (取最小 id, 主城市通常 id 更小)
const slugToId = {};
for (const [id, v] of Object.entries(scan)) {
  if (!v || !v.slug) continue;
  const n = parseInt(id, 10);
  // canonId 与自身一致才可信 (避免重定向到别的城市)
  if (v.canonId && v.canonId !== n) continue;
  if (slugToId[v.slug] === undefined || n < slugToId[v.slug]) slugToId[v.slug] = n;
}
console.log(`扫描映射: ${Object.keys(slugToId).length} 个 slug`);

let src = fs.readFileSync(targetFile, 'utf8');
const resolved = {}, missing = [];

for (const [iata, slugs] of Object.entries(WANT)) {
  if (KNOWN[iata]) { resolved[iata] = { id: KNOWN[iata], via: 'SEO直连' }; continue; }
  let hit = null, hitSlug = null;
  for (const s of slugs) {
    if (slugToId[s] !== undefined) { hit = slugToId[s]; hitSlug = s; break; }
  }
  if (hit !== null) resolved[iata] = { id: hit, via: 'scan:' + hitSlug };
  else missing.push(iata + ' (' + slugs.join('/') + ')');
}

// 打补丁
const rows = [];
let changed = 0;
for (const [iata, info] of Object.entries(resolved)) {
  const re = new RegExp('(' + iata + ':\\s*\\{\\s*country:\\s*\\d+,\\s*city:\\s*)(\\d+)', 'g');
  let oldId = null;
  src = src.replace(re, (m, pre, cur) => {
    oldId = cur;
    return pre + info.id;
  });
  if (oldId === null) { rows.push([iata, '?', info.id, '未匹配到行', info.via]); continue; }
  const ok = String(oldId) === String(info.id);
  if (!ok) changed++;
  rows.push([iata, oldId, info.id, ok ? '已正确' : '已修正', info.via]);
}

console.log('\nIATA  旧ID    新ID    状态      来源');
console.log('-'.repeat(58));
for (const r of rows) {
  console.log(
    r[0].padEnd(6) + String(r[1]).padEnd(8) + String(r[2]).padEnd(8) + r[3].padEnd(10) + r[4]
  );
}
console.log('-'.repeat(58));
console.log(`解析成功 ${Object.keys(resolved).length} / ${Object.keys(WANT).length}，其中修正 ${changed} 个`);
if (missing.length) {
  console.log('\n!! 未找到 (' + missing.length + '):');
  missing.forEach((m) => console.log('   ' + m));
}

if (!DRY) {
  fs.writeFileSync(targetFile, src);
  console.log('\n✅ 已写回 ' + targetFile);
} else {
  console.log('\n(dry run, 未写盘)');
}

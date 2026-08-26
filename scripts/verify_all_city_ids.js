// 用携程全球搜索接口 (权威源) 全量复核 city_trip_id.js 的 trip.com city ID
// API: https://m.ctrip.com/restapi/h5api/globalsearch/search?action=gsonline&source=globalonline&keyword=<中文名>
//      返回 data[].cityId 即 trip.com ?city= 所需 ID (已实测 东京->228 / 巴塞罗那->40795 均正确)
// 用法: node verify_all_city_ids.js [--fix]
const fs = require('fs');
const path = require('path');
const https = require('https');

const FIX = process.argv.includes('--fix');
const targetFile = path.join(__dirname, 'city_trip_id.js');
const CITY = require('./city_trip_id.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

function get(url, opts = {}) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': '*/*' }, timeout: opts.timeout || 15000 }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c;
        if (opts.stopAt && buf.includes(opts.stopAt)) { req.destroy(); resolve(buf); }
        if (buf.length > (opts.maxBytes || 4e6)) { req.destroy(); resolve(buf); }
      });
      res.on('end', () => resolve(buf));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
}

// 查询城市名 -> trip.com cityId
async function lookup(name) {
  const url = 'https://m.ctrip.com/restapi/h5api/globalsearch/search?action=gsonline&source=globalonline&keyword='
    + encodeURIComponent(name) + '&t=' + Date.now();
  const raw = await get(url);
  if (!raw) return null;
  let j;
  try { j = JSON.parse(raw); } catch (e) { return null; }
  const arr = (j && j.data) || [];
  if (!arr.length) return null;
  // 优先: word 完全等于查询名 且 cityId>0
  let best = arr.find((d) => d.word === name && d.cityId > 0);
  // 次选: word 包含查询名
  if (!best) best = arr.find((d) => d.word && d.word.includes(name) && d.cityId > 0);
  // 兜底: 第一个 cityId>0
  if (!best) best = arr.find((d) => d.cityId > 0);
  return best ? { id: best.cityId, word: best.word, eName: best.eName } : null;
}

// 用 trip.com 页面 title 验证 ID
async function titleOf(id) {
  const html = await get('https://www.trip.com/hotels/list?city=' + id, { stopAt: '</title>', maxBytes: 3e5 });
  const m = html.match(/<title>([^<]*)<\/title>/i);
  if (!m) return '';
  return m[1].replace(/\s*\|\s*Trip\.com\s*$/i, '').replace(/\s*Hotels\s*-\s*Where to stay in.*$/i, '').trim();
}

(async () => {
  const codes = Object.keys(CITY);
  console.log(`复核 ${codes.length} 个城市 (携程全球搜索接口 + trip.com title 双重验证)\n`);

  const rows = [];
  const CONC = 6;
  let idx = 0;
  let done = 0;

  async function worker() {
    while (idx < codes.length) {
      const code = codes[idx++];
      const entry = CITY[code];
      const name = entry.name;
      const oldId = entry.city;
      const hit = await lookup(name);
      let newId = hit ? hit.id : null;
      let title = '';
      if (newId) title = await titleOf(newId);
      // 若查得的 ID 页面为空, 回退检查旧 ID
      let oldTitle = '';
      if (!title) oldTitle = await titleOf(oldId);
      rows.push({ code, name, oldId, newId, title, oldTitle });
      done++;
      if (done % 10 === 0) process.stderr.write(`  ...${done}/${codes.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  rows.sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code));

  let ok = 0, fixed = 0, fail = 0;
  const changes = [];
  console.log('代码  城市        旧ID     新ID     状态    trip.com 解析');
  console.log('-'.repeat(74));
  for (const r of rows) {
    let status, useId = r.oldId;
    if (r.newId && r.title) {
      if (r.newId === r.oldId) { status = '✅正确'; ok++; }
      else { status = '🔧修正'; fixed++; useId = r.newId; changes.push(r); }
    } else if (r.oldTitle) {
      status = '⚠️保留'; ok++;   // 接口没查到但旧 ID 有效
    } else {
      status = '❌失败'; fail++;
    }
    console.log(
      r.code.padEnd(6) + String(r.name).padEnd(11) +
      String(r.oldId).padEnd(9) + String(r.newId || '-').padEnd(9) +
      status.padEnd(8) + (r.title || r.oldTitle || '(空)')
    );
  }
  console.log('-'.repeat(74));
  console.log(`✅ 已正确 ${ok}   🔧 需修正 ${fixed}   ❌ 无法解析 ${fail}`);

  if (FIX && changes.length) {
    let src = fs.readFileSync(targetFile, 'utf8');
    let n = 0;
    for (const c of changes) {
      const re = new RegExp('(' + c.code + ':\\s*\\{\\s*country:\\s*\\d+,\\s*city:\\s*)(\\d+)');
      if (re.test(src)) { src = src.replace(re, (m, pre) => pre + c.newId); n++; }
    }
    fs.writeFileSync(targetFile, src);
    console.log(`\n✅ 已写回 ${n} 条修正到 city_trip_id.js`);
  } else if (changes.length) {
    console.log('\n(dry run — 加 --fix 写盘)');
  }
})();

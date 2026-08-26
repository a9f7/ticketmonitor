// 用本地全量城市目录(/tmp/allcities.txt) 精确匹配国内+港澳台城市的正确 ID
// 国际城市暂不动（交给后台 trip.com 扫描修正）
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'city_trip_id.js');
let src = fs.readFileSync(file, 'utf8');

// 解析现有条目
const entries = [];
const re = /(\b[A-Z]{3})\s*:\s*\{\s*country\s*:\s*(\d+)\s*,\s*city\s*:\s*(\d+)\s*,\s*name\s*:\s*'([^']+)'/g;
let m;
while ((m = re.exec(src))) entries.push({ code: m[1], country: +m[2], city: +m[3], name: m[4] });

// 解析全量目录：格式 "display":"城市","data":"En|中|ID"
const allRaw = fs.readFileSync(path.join(__dirname, '_allcities.txt'), 'utf8');
const dirMap = {}; // name -> id
for (const mm of allRaw.matchAll(/"display":"([^"]+)","data":"[^"|]*\|[^"|]*\|(\d+)"/g)) {
  const name = mm[1];
  const id = +mm[2];
  if (!dirMap[name]) dirMap[name] = id; // 首个精确匹配优先
}

// 港澳台 + 国内判断：名字含中文且无英文字母且不在国际名单
const intlNames = new Set(['东京','大阪','京都','名古屋','札幌','福冈','冲绳','函馆','广岛','仙台','首尔','釜山','济州岛','曼谷','普吉','清迈','河内','胡志明市','芽庄','富国岛','吉隆坡','巴厘岛','新加坡','马尼拉','迪拜','多哈','悉尼','墨尔本','布里斯班','奥克兰','伦敦','巴黎','罗马','米兰','马德里','巴塞罗那','法兰克福','阿姆斯特丹','苏黎世','维也纳','莫斯科','纽约','洛杉矶','旧金山','西雅图','温哥华','多伦多']);
// 注意：港澳台用「中国香港/中国澳门/中国台北」在表里，目录里是「香港/澳门/台北」
const alias = { '中国香港':'香港', '中国澳门':'澳门', '中国台北':'台北' };

const corrections = [];
let applied = 0;
for (const e of entries) {
  if (intlNames.has(e.name)) continue; // 国际留给后台
  const lookup = alias[e.name] || e.name;
  const correct = dirMap[lookup];
  if (correct == null) { console.error('!! 目录未找到: ' + e.name); continue; }
  if (correct !== e.city) {
    corrections.push({ code: e.code, name: e.name, oldCity: e.city, newCity: correct });
  }
  applied++;
}
// 应用修正
for (const c of corrections) {
  const re2 = new RegExp("(" + c.code + "\\s*:\\s*\\{\\s*country\\s*:\\s*\\d+\\s*,\\s*city\\s*:\\s*)" + c.oldCity + "(,\\s*name\\s*:\\s*'" + c.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + "')");
  if (re2.test(src)) {
    src = src.replace(re2, "$1" + c.newCity + "$2");
  } else {
    console.error('!! 替换失败: ' + c.code);
  }
}
fs.writeFileSync(file, src);
console.log('国内+港澳台已处理 ' + applied + ' 条，修正 ' + corrections.length + ' 条：');
console.log(corrections.map(c => `${c.code} ${c.name}: ${c.oldCity} -> ${c.newCity}`).join('\n'));

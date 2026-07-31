// 多模块统一流水线：依次抓取 -> 天气 -> 构建，复制到 dist/<moduleId>/，并生成总览 hub。
// 用法: node pipeline.js [moduleId ...]   （不传则运行全部模块）
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { MODULES } = require('./modules');

const ROOT = path.resolve(__dirname, '..');
const node = process.argv[2] && !MODULES[process.argv[2]] ? process.argv[2] : process.execPath;
// 解析要运行的模块（参数中属于模块 id 的部分）
const argMods = process.argv.slice(2).filter(a => MODULES[a]);
const ids = argMods.length ? argMods : Object.keys(MODULES);

function run(script, mod) {
  console.log('\n=== 运行 ' + script + (mod ? ' [' + mod + ']' : '') + ' ===');
  const r = spawnSync(node, [path.join(ROOT, 'scripts', script), mod].filter(Boolean), { cwd: ROOT, stdio: 'inherit' });
  if (r.error) { console.error(script + ' 运行异常:', r.error.message); process.exit(1); }
  if (r.status !== 0) { console.error(script + ' 退出码非 0:', r.status); process.exit(r.status || 1); }
}

function copyModule(mod) {
  const srcDir = path.join(ROOT, 'data', mod);
  const dstDir = path.join(ROOT, 'dist', mod, 'data');
  fs.mkdirSync(dstDir, { recursive: true });
  for (const f of ['flights.json', 'weather.json', 'summary.txt']) {
    const src = path.join(srcDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dstDir, f));
  }
}

const RESUME = process.env.RESUME === '1';
const modInfos = [];
for (const id of ids) {
  console.log('\n################ 模块：' + MODULES[id].name + ' ################');
  const m = MODULES[id];
  const flPath = path.join(ROOT, 'data', id, 'flights.json');
  const wxPath = path.join(ROOT, 'data', id, 'weather.json');
  if (RESUME && fs.existsSync(flPath)) {
    console.log('[RESUME] 跳过 scrape.js [' + id + ']：' + flPath + ' 已存在');
  } else {
    run('scrape.js', id);
  }
  if (m.weather) {
    if (RESUME && fs.existsSync(wxPath)) {
      console.log('[RESUME] 跳过 weather.js [' + id + ']：' + wxPath + ' 已存在');
    } else {
      run('weather.js', id);
    }
  }
  run('build.js', id);
  copyModule(id);
  // 读取生成时间用于 hub
  let gen = '';
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', id, 'flights.json'), 'utf8'));
    gen = new Date(new Date(d.generatedAt).getTime() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);
  } catch (e) {}
  let hits = '';
  try { hits = String(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', id, 'flights.json'), 'utf8')).routes.length); } catch (e) {}
  modInfos.push({ id, name: MODULES[id].name, desc: MODULES[id].desc, title: MODULES[id].title, gen, hits });
}

// ---------- 根入口：dist/index.html 直接重定向到 gba-summer ----------
const hubHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0; url=gba-summer/index.html">
<title>机票监控</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6f8;color:#1b1f26;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:14px;text-align:center}</style>
</head>
<body>
<div>
  <div style="font-size:36px;margin-bottom:12px">✈️</div>
  <div>正在跳转大湾区暑期模块…</div>
  <div style="margin-top:10px"><a href="gba-summer/index.html" style="color:#2563d9;text-decoration:none">如未自动跳转，请点击此处</a></div>
</div>
</body>
</html>`;
fs.writeFileSync(path.join(ROOT, 'dist', 'index.html'), hubHtml);
console.log('\n✅ 流水线完成，dist/ 已就绪（含 ' + ids.length + ' 个模块 + 根入口跳转），可重新部署。');

// 多模块统一流水线：依次抓取 -> 天气 -> 构建，复制到 dist/<moduleId>/，并生成总览 hub。
// 用法: node pipeline.js [moduleId ...]   （不传则运行全部模块）
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { MODULES } = require('./modules');

// 强制 stdout/stderr 立即 flush：Node 在 pipe 模式下 stdout 仍会 block-buffer，
// 所以把 console.log/info/error 全部重定向到 stderr（stderr 在 pipe 模式下 unbuffered）。
{
  const flush = (args) => {
    const s = args.map(a => typeof a === 'string' ? a : require('util').inspect(a)).join(' ') + '\n';
    fs.writeSync(process.stderr.fd, s);
  };
  console.log = function (...a) { flush(a); };
  console.info = console.log;
  console.error = function (...a) { flush(a); };
}

const ROOT = path.resolve(__dirname, '..');
const node = process.argv[2] && !MODULES[process.argv[2]] ? process.argv[2] : process.execPath;
// 解析要运行的模块（参数中属于模块 id 的部分）
const argMods = process.argv.slice(2).filter(a => MODULES[a]);
const ids = argMods.length ? argMods : Object.keys(MODULES);

function run(script, mod, opts) {
  opts = opts || {};
  const tag = opts.soft ? ' (soft：失败不致命，交由降级/回滚处理)' : '';
  console.log('\n=== 运行 ' + script + (mod ? ' [' + mod + ']' : '') + tag + ' ===');
  const r = spawnSync(node, [path.join(ROOT, 'scripts', script), mod].filter(Boolean), { cwd: ROOT, stdio: 'inherit' });
  if (r.error) { console.error(script + ' 运行异常:', r.error.message); if (opts.soft) return false; process.exit(1); }
  if (r.status !== 0) { console.error(script + ' 退出码非 0:', r.status); if (opts.soft) return false; process.exit(r.status || 1); }
  return true;
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
// SKIP_DETAIL=1：已知 Trip.com FlightListSearch 被 whaleguard 拦截时，直接走日历低价模式，省去无效的详单抓取
const SKIP_DETAIL = process.env.SKIP_DETAIL === '1';
function routeCount(id) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', id, 'flights.json'), 'utf8'));
    return (d.routes || []).length;
  } catch (e) { return -1; }
}
const modInfos = [];
for (const id of ids) {
  console.log('\n################ 模块：' + MODULES[id].name + ' ################');
  const m = MODULES[id];
  const flPath = path.join(ROOT, 'data', id, 'flights.json');
  const wxPath = path.join(ROOT, 'data', id, 'weather.json');
  // 抓取前记录上一轮命中数并备份，供降级判定与数据回滚使用
  const prevCount = routeCount(id);
  const bakPath = flPath + '.bak';
  if (fs.existsSync(flPath)) fs.copyFileSync(flPath, bakPath);

  if (SKIP_DETAIL) {
    console.log('[SKIP_DETAIL] 跳过 scrape.js [' + id + ']，直接走日历实时低价模式');
    run('scrape_calendar.js', id, { soft: true });
  } else if (RESUME && fs.existsSync(flPath)) {
    console.log('[RESUME] 跳过 scrape.js [' + id + ']：' + flPath + ' 已存在');
  } else {
    run('scrape.js', id, { soft: true });
    // FlightListSearch 被 Trip.com whaleguard 反爬拦截时会返回 0 条或极少条（劣质数据会静默覆盖好数据）
    // → 判定条件：为空，或不足上一轮命中数的一半，均触发日历实时低价降级
    const nowCount = routeCount(id);
    const tooFew = prevCount > 0 && nowCount < prevCount * 0.5;
    if (nowCount <= 0 || tooFew) {
      console.log('[降级] ' + id + ' 详单抓取命中 ' + nowCount + ' 条（上轮 ' + prevCount +
        ' 条），疑似 Trip.com whaleguard 拦截，改用日历实时低价模式');
      run('scrape_calendar.js', id, { soft: true });
    }
  }

  // 本轮抓取若仍明显劣于上一轮（不足一半），回滚到备份，避免线上数据倒退
  const finalCount = routeCount(id);
  if (prevCount > 0 && finalCount < prevCount * 0.5 && fs.existsSync(bakPath)) {
    console.error('  ⚠ ' + id + ' 本轮仅 ' + finalCount + ' 条（上轮 ' + prevCount + ' 条），回滚到上一轮数据');
    fs.copyFileSync(bakPath, flPath);
  }
  if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
  if (m.weather) {
    if (RESUME && fs.existsSync(wxPath)) {
      console.log('[RESUME] 跳过 weather.js [' + id + ']：' + wxPath + ' 已存在');
    } else {
      run('weather.js', id, { soft: true });
    }
  }
  run('build.js', id, { soft: true });
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
  <div>正在跳转大湾区寒暑期模块…</div>
  <div style="margin-top:10px"><a href="gba-summer/index.html" style="color:#2563d9;text-decoration:none">如未自动跳转，请点击此处</a></div>
</div>
</body>
</html>`;
fs.writeFileSync(path.join(ROOT, 'dist', 'index.html'), hubHtml);
fs.writeFileSync(path.join(ROOT, 'dist', '.nojekyll'), '');
console.log('\n✅ 流水线完成，dist/ 已就绪（含 ' + ids.length + ' 个模块 + 根入口跳转），可重新部署。');

// ---------- 安全发布：仅当所有模块均有有效数据时才推送 gh-pages（否则保留线上最后有效版本） ----------
const allIds = Object.keys(MODULES);
const allValid = allIds.every(id => {
  const ok = routeCount(id) > 0 && fs.existsSync(path.join(ROOT, 'dist', id, 'index.html'));
  if (!ok) console.error('  ⚠ 模块 ' + id + ' 无有效数据（' + routeCount(id) + ' 条 / dist 缺失），将跳过发布');
  return ok;
});
if (!allValid) {
  console.error('⚠ 存在模块抓取为空，跳过 gh-pages 推送以保留线上最后有效版本。');
} else if (process.env.GH_TOKEN) {
  console.log('\n=== 推送 gh-pages (Git Data API) ===');
  const r = spawnSync(node, [path.join(ROOT, 'scripts', 'push_ghpages_api.mjs'), path.join(ROOT, 'dist'), 'gh-pages'], { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (r.status !== 0) console.error('推送失败（退出码 ' + r.status + '）');
  else console.log('✅ 已推送 gh-pages: https://a9f7.github.io/ticketmonitor/');
} else {
  console.log('（未设置 GH_TOKEN，跳过自动推送；可手动运行 node scripts/push_ghpages_api.mjs dist gh-pages）');
}

// ---------- 上传守护：最终核对本地 dist 与 gh-pages 是否一致（自愈上轮/本轮回推失败） ----------
// 无论上方 push 是否成功，都在末尾再核对一次：若发现本地有未上传或内容不一致的文件，立即增量补齐。
if (process.env.GH_TOKEN) {
  console.log('\n=== 上传守护 sync_guard：核对 dist 与 gh-pages ===');
  const g = spawnSync(node, [path.join(ROOT, 'scripts', 'sync_guard.js')], { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (g.status !== 0) console.error('上传守护异常（退出码 ' + g.status + '），请关注');
}

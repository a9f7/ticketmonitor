// 上传守护：核对本地 dist/ 与已发布的 GitHub Pages（gh-pages）是否一致，
// 若发现本地有未上传（或上传了但内容不一致）的文件，立即增量补齐上传。
// 同时比对 data/<mod>/*.json 与 dist/<mod>/data/*.json，若源数据更新了但 dist 未重新构建则告警。
//
// 用法（需在环境变量中设置 GH_TOKEN）：
//   node scripts/sync_guard.js
// 退出码：0 = 已同步或已补齐；1 = 缺少 GH_TOKEN / 网络或 API 失败 / 本地 dist 为空。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'a9f7';
const REPO = 'ticketmonitor';
const BRANCH = 'gh-pages';
const API = 'https://api.github.com';
const auth = { Authorization: `Bearer ${TOKEN}` };
const ROOT = path.resolve(__dirname, '..');

const log = (...a) => process.stderr.write(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n');

// git blob SHA-1（与 `git hash-object --no-filters` 完全一致，且不受 CRLF 影响）
function blobSha(buf) {
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

async function api(method, urlPath, body) {
  const res = await fetch(API + urlPath, {
    method,
    headers: { ...auth, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json', 'User-Agent': 'workbuddy-syncguard' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${urlPath}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (!TOKEN) { console.error('缺少 GH_TOKEN 环境变量，无法核对/上传'); process.exit(1); }

  const DIST = path.join(ROOT, 'dist');
  if (!fs.existsSync(DIST)) { console.error('本地 dist/ 不存在'); process.exit(1); }

  // 1) 本地 dist 清单
  const localFiles = walk(DIST);
  if (!localFiles.length) { console.error('本地 dist/ 为空，拒绝推送（避免清空线上）'); process.exit(1); }
  const local = new Map(); // relPath -> { sha, buf }
  for (const rel of localFiles) {
    const buf = fs.readFileSync(path.join(DIST, rel));
    local.set(rel, { sha: blobSha(buf), buf });
  }
  log(`本地 dist/ 文件数: ${localFiles.length}`);

  // 2) 已发布的 gh-pages 树
  let remoteMap = new Map(); // relPath -> sha
  try {
    const tree = await api('GET', `/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`);
    if (tree.truncated) throw new Error('树过大被截断，改用全量推送');
    for (const e of tree.tree) if (e.type === 'blob') remoteMap.set(e.path, e.sha);
    log(`线上 gh-pages 文件数: ${remoteMap.size}`);
  } catch (e) {
    console.error('获取线上树失败：' + e.message + '（将执行全量推送兜底）');
    remoteMap = new Map(); // 视为全缺失 → 全量上传
  }

  // 3) 比对
  const missing = [];
  const changed = [];
  const extra = [];
  for (const [rel, info] of local) {
    if (!remoteMap.has(rel)) missing.push(rel);
    else if (remoteMap.get(rel) !== info.sha) changed.push(rel);
  }
  for (const rel of remoteMap.keys()) if (!local.has(rel)) extra.push(rel);

  // 4) 源数据 vs 已构建 dist 一致性告警（提示是否需要重新构建）
  const DATA = path.join(ROOT, 'data');
  if (fs.existsSync(DATA)) {
    for (const mod of fs.readdirSync(DATA, { withFileTypes: true })) {
      if (!mod.isDirectory()) continue;
      const id = mod.name;
      const dDir = path.join(DATA, id);
      const dstDir = path.join(DIST, id, 'data');
      for (const f of ['flights.json', 'weather.json', 'summary.txt']) {
        const ds = path.join(dDir, f), dst = path.join(dstDir, f);
        if (!fs.existsSync(ds) || !fs.existsSync(dst)) continue;
        const s1 = blobSha(fs.readFileSync(ds)), s2 = blobSha(fs.readFileSync(dst));
        if (s1 !== s2) console.error(`  ⚠ 模块 ${id} 的源数据 ${f} 比已构建的 dist 新，可能需要重新运行 pipeline 构建后再发布`);
      }
    }
  }

  if (!missing.length && !changed.length) {
    if (extra.length) console.log(`✅ 本地 dist/ 与 gh-pages 内容一致；线上另有 ${extra.length} 个本地不存在的文件（保留不动）：${extra.join(', ')}`);
    else console.log('✅ 本地 dist/ 与 gh-pages 完全一致，无需上传');
    process.exit(0);
  }

  console.log(`检测到未上传/不一致：${missing.length} 个缺失，${changed.length} 个内容变更`);
  if (missing.length) log('  缺失: ' + missing.join(', '));
  if (changed.length) log('  变更: ' + changed.join(', '));

  // 5) 增量补齐：只上传缺失/变更的文件（基于当前 head 的 base_tree，保留其余文件）
  const toUpload = [...missing, ...changed];
  const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`);
  const headSha = ref.object.sha;
  const headCommit = await api('GET', `/repos/${OWNER}/${REPO}/git/commits/${headSha}`);
  const baseTree = headCommit.tree.sha;

  const entries = [];
  for (let i = 0; i < toUpload.length; i++) {
    const rel = toUpload[i];
    const buf = local.get(rel).buf;
    const b = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
    entries.push({ path: rel, mode: '100644', type: 'blob', sha: b.sha });
    if ((i + 1) % 20 === 0 || i + 1 === toUpload.length) log(`  blob ${i + 1}/${toUpload.length}`);
  }
  const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { base_tree: baseTree, tree: entries });
  const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: `site: 上传守护补齐 ${toUpload.length} 个文件（sync_guard）`,
    tree: tree.sha,
    parents: [headSha],
  });
  await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });
  try {
    const build = await api('POST', `/repos/${OWNER}/${REPO}/pages/builds`, {});
    log(`Pages 构建状态: ${build.status || 'queued'}`);
  } catch (e) { log(`触发 Pages 构建失败（不影响上传）: ${e.message}`); }

  console.log(`✅ 已补齐上传 ${toUpload.length} 个文件: ${toUpload.join(', ')}`);
  console.log(`站点: https://${OWNER}.github.io/${REPO}/`);
  process.exit(0);
}

main().catch(e => { console.error('SYNC GUARD FAILED:', e.message); process.exit(1); });
